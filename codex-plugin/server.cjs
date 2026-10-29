'use strict';
// Local MCP adapter. Only explicitly supplied excerpts cross the authenticated
// Huikan bridge. This process never reads Codex transcripts or credentials.
const crypto = require('node:crypto');
const path = require('node:path');
const os = require('node:os');
const { resolveBridgeDirectory } = require('../shared/connection-discovery.cjs');
const { callPrivate } = require('../shared/private-rpc.cjs');
const VERSION = '0.3.0';
const MAX_MESSAGE_BYTES = 1024 * 1024;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const THREAD = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|thr_[A-Za-z0-9_-]{1,200})$/i;
const badUnicode = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/;
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const failure = (code, message) => Object.assign(new Error(message), { code });
function shape(value, fields) {
  if (!object(value) || Object.keys(value).some(key => !fields.includes(key))) throw failure('INVALID_ARGUMENT', '工具参数包含不支持的字段');
}
function text(value, name, maximum, empty = false) {
  if (typeof value !== 'string' || value.length > maximum || value.includes('\0') || badUnicode.test(value) || (!empty && !value.trim())) throw failure('INVALID_ARGUMENT', `${name}无效`);
  return value;
}
function threadId(value) {
  if (typeof value !== 'string' || !THREAD.test(value)) throw failure('SOURCE_REQUIRED', '请提供当前 Codex 对话的技术 thread ID；不能用标题、最近聊天或根 session ID 猜测');
  return UUID.test(value) ? value.toLowerCase() : value;
}
function instanceId(env, home) {
  const configured = env.CODEX_HOME || path.join(home, '.codex');
  return 'codex:' + crypto.createHash('sha256').update(path.resolve(configured)).digest('hex').slice(0, 24);
}
function stableRequestId(value) {
  // A lost response can be retried without manufacturing another identity.
  const bytes = crypto.createHash('sha256').update(JSON.stringify(value)).digest().subarray(0, 16);
  bytes[6] = (bytes[6] & 15) | 0x50; bytes[8] = (bytes[8] & 63) | 0x80;
  const raw = bytes.toString('hex');
  return `${raw.slice(0,8)}-${raw.slice(8,12)}-${raw.slice(12,16)}-${raw.slice(16,20)}-${raw.slice(20)}`;
}
const stringSchema = (description, maxLength) => ({ type: 'string', description, ...(maxLength ? { maxLength } : {}) });
const sourceSchema = stringSchema('Current Codex technical thread ID from the exact current execution context or a user-provided Codex thread link. Caller-supplied attribution; never guess from a title, recent chat, or a long-lived MCP process.', 256);
const annotations = readOnlyHint => ({ readOnlyHint, destructiveHint: false, openWorldHint: false });
const TOOLS = [
  { name: 'connection_status', description: 'Check whether the local Huikan workbench and Codex adapter are actually reachable. Configuration alone is not a connection. Does not read conversations.', inputSchema: { type: 'object', properties: {}, additionalProperties: false }, annotations: annotations(true) },
  { name: 'save_excerpt', description: 'Save exact text to the local Huikan recall workbench only when the user explicitly asks to 留作回看, 保存到回看, or save an excerpt. Requires the exact Codex thread ID for caller-supplied source attribution. Never scan transcripts or silently summarize the excerpt.', inputSchema: { type: 'object', properties: { threadId: sourceSchema, title: stringSchema('Short excerpt title; does not replace or rewrite the original text.', 500), threadTitle: stringSchema('Exact current conversation display title when known; otherwise omit. It is display metadata, not a thread identity.', 500), text: stringSchema('Exact text the user authorized saving, preserving newlines and wording.', 200000), topic: stringSchema('Optional user-chosen topic; never invent a classification.', 40), requestId: stringSchema('Optional UUID from an earlier attempt. Reuse it without changing any input when retrying.', 36) }, required: ['threadId', 'title', 'text'], additionalProperties: false }, annotations: annotations(false) },
  { name: 'list_recalls', description: 'Read saved Huikan excerpts attributed to one explicitly identified Codex thread. Does not scan Codex chat history or switch the floating window.', inputSchema: { type: 'object', properties: { threadId: sourceSchema }, required: ['threadId'], additionalProperties: false }, annotations: annotations(true) },
  { name: 'show_recalls', description: 'Select an explicitly identified Codex thread in the Huikan floating window. This follows an explicit tool call, not automatic foreground-window detection.', inputSchema: { type: 'object', properties: { threadId: sourceSchema, title: stringSchema('Optional display title for this Codex thread.', 500) }, required: ['threadId'], additionalProperties: false }, annotations: annotations(false) },
];
const INSTRUCTIONS = "Local Huikan recall tools. Save exact text only on explicit user intent. Thread calls need the current technical threadId (caller-supplied). Never infer it from startup, titles, recent files, or CODEX_SESSION_ID. If needed, read only CODEX_THREAD_ID from this turn's execution environment; if absent ask for its Codex thread link. Do not read transcripts. Only status=saved means success; retry pending with the same requestId. Duplicates keep first source. Links open threads, not messages.";

function createAdapter({ env = process.env, home = os.homedir(), resolveDirectory, call = callPrivate, clientId = crypto.randomUUID() } = {}) {
  if (!UUID.test(clientId)) throw failure('INVALID_ARGUMENT', 'Codex 连接标识无效');
  const instance = instanceId(env, home);
  const resolve = resolveDirectory || (() => resolveBridgeDirectory({ env, home }));
  const rpc = async (service, method, params, timeoutMs = 15000) => call({ directory: await resolve(), service, method, params, timeoutMs });
  async function heartbeat() { return rpc('sticky', 'codexHeartbeat', { clientId }, 5000); }
  async function activate(id, title = '') {
    await heartbeat();
    const result = await rpc('sticky', 'codexContext', { clientId, instanceId: instance, sessionId: id, sessionTitle: title });
    if (result?.accepted !== true) throw failure('CONTEXT_UNAVAILABLE', '回看尚未接受此 Codex 对话，请重试');
    return result;
  }
  async function invoke(name, args = {}) {
    if (name === 'connection_status') {
      shape(args, []);
      try {
        const [status, library] = await Promise.all([rpc('sticky', 'connectionStatus', {}), rpc('mengcang', 'status', {})]);
        return { reachable: status?.protocol === 1, libraryReady: library?.ready === true, codex: status?.codex || { connected: false }, sourceBinding: 'caller-supplied', automaticForegroundFollowing: false, threadBacklinksOnly: true };
      } catch (error) {
        return { reachable: false, libraryReady: false, sourceBinding: 'caller-supplied', error: { code: error.code || 'UNAVAILABLE', message: '请打开回看并等待本机工作台就绪，然后重试连接。' } };
      }
    }
    if (name === 'list_recalls') {
      shape(args, ['threadId']); const id = threadId(args.threadId);
      const result = await rpc('mengcang', 'list', { instanceId: instance, sessionId: id });
      if (!Array.isArray(result?.items) || result.items.some(item => item?.externalSource?.provider !== 'codex' || item.externalSource.instanceId !== instance || item.externalSource.sessionId !== id)) throw failure('INVALID_RESPONSE', '回看返回了其他来源的内容');
      return { threadId: id, sourceBinding: 'caller-supplied', items: result.items };
    }
    if (name === 'show_recalls') {
      shape(args, ['threadId', 'title']); const id = threadId(args.threadId), title = args.title === undefined ? '' : text(args.title, '对话标题', 500, true);
      await activate(id, title);
      const shown = await rpc('sticky', 'appearanceShow', {});
      if (shown?.shown !== true) throw failure('WINDOW_UNAVAILABLE', '已选择对话，但浮窗尚未打开，请在系统托盘或菜单栏打开回看');
      return { selected: true, opened: true, threadId: id, sourceBinding: 'caller-supplied', automaticForegroundFollowing: false };
    }
    if (name === 'save_excerpt') {
      shape(args, ['threadId', 'threadTitle', 'title', 'text', 'topic', 'requestId']);
      const id = threadId(args.threadId), title = text(args.title, '摘录标题', 500), body = text(args.text, '回看原文', 200000);
      const threadTitle = args.threadTitle === undefined ? 'Codex 聊天' : text(args.threadTitle, '对话标题', 500);
      const topic = args.topic === undefined ? undefined : text(args.topic, '主题', 40).trim();
      if (topic !== undefined && /[\x00-\x1f\x7f]/u.test(topic)) throw failure('INVALID_ARGUMENT', '主题不能包含控制字符');
      if (args.requestId !== undefined && (typeof args.requestId !== 'string' || !UUID.test(args.requestId))) throw failure('INVALID_ARGUMENT', '收藏请求标识必须是 UUID');
      const requestId = args.requestId?.toLowerCase() || stableRequestId({ instance, threadId: id, threadTitle, title, text: body, ...(topic === undefined ? {} : { topic }) });
      const capture = { requestId, title, text: body, externalSource: { version: 1, provider: 'codex', instanceId: instance, sessionId: id, sessionTitle: threadTitle, messageId: 'capture-' + requestId, eventSeq: 0, turn: 0 }, ...(topic === undefined ? {} : { manualTopic: topic }) };
      try {
        await activate(id, threadTitle);
        const result = await rpc('sticky', 'capture', capture, 25000);
        if (result?.status !== 'saved' || !result.item?.externalSource) return { status: 'pending', requestId, threadId: id, sourceBinding: 'caller-supplied', error: result?.error || { code: 'SAVE_UNCONFIRMED', message: '尚未确认保存，请保留原文并使用相同请求重试。' } };
        const saved = result.item.externalSource;
        const inCurrentThread = saved.provider === 'codex' && saved.instanceId === instance && saved.sessionId === id;
        const duplicate = result.duplicate === true || !inCurrentThread || saved.messageId !== capture.externalSource.messageId;
        return { status: 'saved', requestId, threadId: id, sourceBinding: 'caller-supplied', item: result.item, duplicate, inCurrentThread, existingSource: saved, backlinkPrecision: 'thread', ...(duplicate ? { message: '相同原文沿用首次保存的条目和来源。' } : {}) };
      } catch (error) {
        return { status: 'pending', requestId, threadId: id, sourceBinding: 'caller-supplied', error: { code: error.code || 'SAVE_UNCONFIRMED', message: typeof error.message === 'string' ? error.message.slice(0, 500) : '保存结果尚未确认，请使用相同请求重试。' } };
      }
    }
    throw failure('METHOD_NOT_FOUND', '不支持的回看工具');
  }
  return { invoke, heartbeat, instanceId: instance, clientId };
}
function toolResult(value) {
  const isError = value.status === 'pending' || value.reachable === false || !!value.error;
  return { content: [{ type: 'text', text: JSON.stringify(value) }], structuredContent: value, ...(isError ? { isError: true } : {}) };
}
function startStdio({ input = process.stdin, output = process.stdout, adapter = createAdapter(), heartbeatMs = 3000 } = {}) {
  let buffer = Buffer.alloc(0), ready = false, closed = false, resolveDone;
  const pending = new Set(), done = new Promise(resolve => { resolveDone = resolve; });
  const write = value => {
    if (closed) return;
    let serialized = JSON.stringify(value);
    if (Buffer.byteLength(serialized) > MAX_RESPONSE_BYTES) serialized = JSON.stringify({ jsonrpc: '2.0', id: value.id ?? null, error: { code: -32603, message: '回看响应过大，请缩小读取范围。' } });
    output.write(serialized + '\n');
  };
  const protocolError = (id, code, message) => write({ jsonrpc: '2.0', id, error: { code, message } });
  async function dispatch(value) {
    if (!object(value) || value.jsonrpc !== '2.0' || typeof value.method !== 'string' || (Object.hasOwn(value, 'id') && typeof value.id !== 'string' && !Number.isSafeInteger(value.id))) return protocolError(null, -32600, 'Invalid Request');
    const hasId = Object.hasOwn(value, 'id');
    if (!hasId) return; // Notifications have no reply and never perform writes.
    const { id, method, params = {} } = value;
    if (method === 'initialize') {
      if (ready) return protocolError(id, -32600, 'Already initialized');
      if (!object(params) || typeof params.protocolVersion !== 'string') return protocolError(id, -32602, 'Invalid initialization parameters');
      ready = true;
      void heartbeat();
      const versions = new Set(['2024-11-05', '2025-03-26', '2025-06-18', '2025-11-25']);
      return write({ jsonrpc: '2.0', id, result: { protocolVersion: versions.has(params.protocolVersion) ? params.protocolVersion : '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'huikan-codex', version: VERSION }, instructions: INSTRUCTIONS } });
    }
    if (method === 'ping') return write({ jsonrpc: '2.0', id, result: {} });
    if (!ready) return protocolError(id, -32002, 'Initialize the MCP connection first');
    if (method === 'tools/list') {
      if (!object(params) || Object.keys(params).some(key => key !== 'cursor' && key !== '_meta') || (params.cursor !== undefined && params.cursor !== '')) return protocolError(id, -32602, 'Invalid tools cursor');
      return write({ jsonrpc: '2.0', id, result: { tools: TOOLS } });
    }
    if (method === 'tools/call') {
      if (!object(params) || Object.keys(params).some(key => !['name', 'arguments', '_meta'].includes(key)) || !TOOLS.some(tool => tool.name === params.name)) return protocolError(id, -32602, 'Unknown tool');
      try { return write({ jsonrpc: '2.0', id, result: toolResult(await adapter.invoke(params.name, params.arguments ?? {})) }); }
      catch (error) { return write({ jsonrpc: '2.0', id, result: toolResult({ status: 'pending', error: { code: error.code || 'REQUEST_FAILED', message: error.message || '本机操作未完成。' } }) }); }
    }
    return protocolError(id, -32601, 'Method not found');
  }
  function onData(chunk) {
    if (closed) return;
    buffer = Buffer.concat([buffer, Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)]);
    while (!closed) {
      const newline = buffer.indexOf(10);
      if (newline < 0) { if (buffer.length > MAX_MESSAGE_BYTES) { protocolError(null, -32700, 'MCP message too large'); close(); } return; }
      const frame = buffer.subarray(0, newline); buffer = buffer.subarray(newline + 1);
      if (frame.length > MAX_MESSAGE_BYTES) { protocolError(null, -32700, 'MCP message too large'); close(); return; }
      let value; try { value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(frame)); } catch { protocolError(null, -32700, 'Parse error'); continue; }
      const task = dispatch(value); pending.add(task); task.finally(() => pending.delete(task)).catch(() => protocolError(null, -32603, 'Internal error'));
    }
  }
  async function heartbeat() { if (!ready || closed) return; try { await adapter.heartbeat(); } catch {} }
  const timer = setInterval(() => { void heartbeat(); }, heartbeatMs); timer.unref?.(); void heartbeat();
  function close() { if (closed) return; closed = true; clearInterval(timer); input.removeListener('data', onData); input.removeListener('end', onEnd); input.removeListener('error', close); output.removeListener('error', close); input.pause?.(); void Promise.allSettled([...pending]).then(resolveDone); }
  function onEnd() { void Promise.allSettled([...pending]).then(close); }
  input.on('data', onData); input.once('end', onEnd); input.once('error', close); output.once('error', close); input.resume?.();
  return Object.assign(done, { close });
}
if (require.main === module) startStdio();
module.exports = { createAdapter, startStdio, TOOLS, INSTRUCTIONS, threadId, stableRequestId, instanceId, MAX_MESSAGE_BYTES };
