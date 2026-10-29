'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { createAdapter, startStdio, TOOLS, INSTRUCTIONS, MAX_MESSAGE_BYTES } = require('../codex-plugin/server.cjs');
const THREAD = '10000000-0000-4000-8000-000000000001';
const OTHER = '10000000-0000-4000-8000-000000000002';
const CLIENT = 'b003b3e4-1617-4ed0-83f4-8bd34ac06a32';
const original = '原文 🧪\n```js\nconst value = "保留";\n```\n结尾。';
const tick = () => new Promise(resolve => setImmediate(resolve));
function fixture(handler) {
  const calls = []; let directory = '/test/first-bridge';
  const adapter = createAdapter({ env: { CODEX_HOME: '/test/codex', CODEX_THREAD_ID: OTHER, CODEX_SESSION_ID: OTHER }, home: '/test/home', clientId: CLIENT, resolveDirectory: async () => directory, call: async request => {
    calls.push(request);
    const custom = await handler?.(request); if (custom !== undefined) return custom;
    if (request.method === 'codexHeartbeat') return { accepted: true };
    if (request.method === 'codexContext') return { accepted: true, provider: 'codex' };
    if (request.method === 'capture') return { status: 'saved', item: { id: 'saved-one', title: request.params.title, text: request.params.text, externalSource: request.params.externalSource } };
    if (request.method === 'connectionStatus') return { protocol: 1, codex: { connected: true } };
    if (request.method === 'status') return { ready: true };
    if (request.method === 'list') return { items: [] };
    if (request.method === 'appearanceShow') return { shown: true };
    throw Error('Unexpected fixture request');
  } });
  return { adapter, calls, moveBridge: value => { directory = value; } };
}
function wire(adapter) {
  const input = new PassThrough(), output = new PassThrough(), frames = []; let buffer = '';
  output.on('data', chunk => { buffer += chunk.toString(); for (;;) { const at = buffer.indexOf('\n'); if (at < 0) break; frames.push(JSON.parse(buffer.slice(0, at))); buffer = buffer.slice(at + 1); } });
  const done = startStdio({ input, output, adapter, heartbeatMs: 100000 });
  const send = async value => { input.write(JSON.stringify(value) + '\n'); await tick(); };
  const initialize = () => send({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'synthetic-test', version: '1' } } });
  return { input, output, frames, send, initialize, done };
}

test('Codex MCP never guesses a thread from startup environment and resolves the live bridge per call', async () => {
  const f = fixture();
  await assert.rejects(f.adapter.invoke('save_excerpt', { title: '标题', text: original }), /技术 thread ID/);
  for (const threadId of [THREAD + '/other', 'codex://threads/' + THREAD, 'latest', '__proto__', 'thr_bad?target=x']) {
    await assert.rejects(f.adapter.invoke('show_recalls', { threadId }), /技术 thread ID/);
  }
  assert.equal(f.calls.length, 0);
  assert.match(f.adapter.instanceId, /^codex:[a-f0-9]{24}$/);
  const status = await f.adapter.invoke('connection_status');
  assert.equal(status.sourceBinding, 'caller-supplied'); assert.equal(status.automaticForegroundFollowing, false);
  f.moveBridge('/test/new-bridge');
  await f.adapter.invoke('list_recalls', { threadId: THREAD });
  assert.equal(f.calls.at(-1).directory, '/test/new-bridge');
  assert.equal(f.calls.at(-1).params.sessionId, THREAD);
  assert.equal(f.calls.filter(value => value.method === 'codexContext').length, 0, 'listing may not switch the active source');
});

test('an explicit save preserves exact text, topic, namespaced source and retry identity', async () => {
  const f = fixture(), args = { threadId: THREAD, title: '原文标题', threadTitle: '本次对话', text: original, topic: '自己的主题' };
  const first = await f.adapter.invoke('save_excerpt', args), again = await f.adapter.invoke('save_excerpt', args);
  assert.equal(first.status, 'saved'); assert.equal(first.inCurrentThread, true); assert.equal(first.duplicate, false);
  assert.equal(first.requestId, again.requestId);
  const captures = f.calls.filter(value => value.method === 'capture');
  assert.deepEqual(captures[0].params, captures[1].params);
  const capture = captures[0].params;
  assert.equal(capture.text, original); assert.equal(capture.manualTopic, '自己的主题');
  assert.equal(capture.externalSource.sessionTitle, '本次对话');
  assert.equal(capture.externalSource.provider, 'codex'); assert.equal(capture.externalSource.sessionId, THREAD);
  assert.equal(capture.externalSource.instanceId, f.adapter.instanceId);
  assert.equal(capture.externalSource.messageId, 'capture-' + first.requestId);
  assert.equal(capture.externalSource.eventSeq, 0); assert.equal(capture.externalSource.turn, 0);
  assert.equal(capture.externalSource.selection, undefined, 'no fabricated native message offsets');
  assert.deepEqual(f.calls.slice(0, 3).map(call => call.method), ['codexHeartbeat', 'codexContext', 'capture']);
});

test('uncertain saves remain pending and a global duplicate keeps its actual first source', async () => {
  let fail = true;
  const canonicalSource = { version: 1, provider: 'deepseek-harness', instanceId: 'old-instance', sessionId: 'first-session', messageId: 'first-message', eventSeq: 2, turn: 1, sessionTitle: '首次保存' };
  const f = fixture(request => {
    if (request.method !== 'capture') return;
    if (fail) throw Object.assign(Error('本机等待超时'), { code: 'TIMEOUT' });
    return { status: 'saved', item: { id: 'canonical', title: request.params.title, text: request.params.text, externalSource: canonicalSource } };
  });
  const args = { threadId: THREAD, title: '原文标题', text: original };
  const pending = await f.adapter.invoke('save_excerpt', args);
  assert.equal(pending.status, 'pending'); assert.equal(pending.error.code, 'TIMEOUT');
  fail = false;
  const saved = await f.adapter.invoke('save_excerpt', { ...args, requestId: pending.requestId });
  assert.equal(saved.status, 'saved'); assert.equal(saved.duplicate, true); assert.equal(saved.inCurrentThread, false);
  assert.deepEqual(saved.existingSource, canonicalSource); assert.equal(saved.requestId, pending.requestId);
  assert.deepEqual(f.calls.filter(x => x.method === 'capture')[0].params, f.calls.filter(x => x.method === 'capture')[1].params);
});

test('show_recalls opens the real floating window only after selecting its explicit thread', async () => {
  const f = fixture();
  const shown = await f.adapter.invoke('show_recalls', { threadId: THREAD, title: '指定对话' });
  assert.equal(shown.opened, true); assert.equal(shown.selected, true);
  assert.deepEqual(f.calls.map(call => call.method), ['codexHeartbeat', 'codexContext', 'appearanceShow']);
  assert.equal(f.calls[1].params.sessionId, THREAD);
  const missing = fixture(request => request.method === 'appearanceShow' ? { shown: false } : undefined);
  await assert.rejects(missing.adapter.invoke('show_recalls', { threadId: THREAD }), /浮窗尚未打开/);
});

test('the list boundary rejects cross-provider and cross-thread responses', async () => {
  const f = fixture(request => request.method === 'list' ? { items: [{ externalSource: { provider: 'codex', instanceId: request.params.instanceId, sessionId: OTHER } }] } : undefined);
  await assert.rejects(f.adapter.invoke('list_recalls', { threadId: THREAD }), /其他来源/);
  await assert.rejects(f.adapter.invoke('save_excerpt', { threadId: THREAD, title: 'x', text: original, topic: '主题\n注入' }), /控制字符/);
  await assert.rejects(f.adapter.invoke('save_excerpt', { threadId: THREAD, title: 'x', text: original, unexpected: true }), /不支持的字段/);
});

test('stdio negotiates MCP, exposes real tool schemas, and notifications cannot write', async () => {
  let heartbeats = 0;
  const calls = [], adapter = { heartbeat: async () => { heartbeats++; }, invoke: async (name, args) => { calls.push({ name, args }); return { status: 'saved' }; } };
  const w = wire(adapter);
  await tick(); assert.equal(heartbeats, 0, 'a process alone is not a Codex MCP handshake');
  await w.send({ jsonrpc: '2.0', id: 0, method: 'tools/list' });
  assert.equal(w.frames[0].error.code, -32002);
  await w.initialize();
  assert.equal(heartbeats, 1);
  assert.equal(w.frames[1].result.protocolVersion, '2025-06-18');
  assert.ok(INSTRUCTIONS.length <= 512); assert.match(w.frames[1].result.instructions, /CODEX_THREAD_ID/);
  await w.send({ jsonrpc: '2.0', method: 'notifications/initialized' });
  await w.send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
  assert.deepEqual(w.frames[2].result.tools.map(tool => tool.name), TOOLS.map(tool => tool.name));
  assert.equal(w.frames[2].result.tools.find(tool => tool.name === 'save_excerpt').annotations.readOnlyHint, false);
  assert.equal(w.frames[2].result.tools.find(tool => tool.name === 'list_recalls').annotations.readOnlyHint, true);
  await w.send({ jsonrpc: '2.0', method: 'tools/call', params: { name: 'save_excerpt', arguments: {} } });
  assert.equal(calls.length, 0, 'notifications must not execute a write tool');
  await w.send({ jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'save_excerpt', arguments: { threadId: THREAD, title: '标题', text: original } } });
  assert.equal(w.frames.at(-1).result.structuredContent.status, 'saved');
  assert.deepEqual(calls[0].args.text, original);
  w.input.end(); await w.done;
});

test('stdio reports pending as an error and bounds malformed or oversized messages', async () => {
  const w = wire({ heartbeat: async () => {}, invoke: async () => ({ status: 'pending', requestId: CLIENT, error: { code: 'TIMEOUT', message: '未确认保存' } }) });
  await w.initialize();
  await w.send({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name: 'save_excerpt', arguments: { threadId: THREAD, title: '标题', text: original } } });
  assert.equal(w.frames.at(-1).result.isError, true); assert.equal(w.frames.at(-1).result.structuredContent.requestId, CLIENT);
  w.input.write('not-json\n'); await tick(); assert.equal(w.frames.at(-1).error.code, -32700);
  w.input.write(Buffer.from([0x7b, 0x22, 0x78, 0x22, 0x3a, 0x22, 0xff, 0x22, 0x7d, 0x0a])); await tick(); assert.equal(w.frames.at(-1).error.code, -32700);
  w.input.write(Buffer.alloc(MAX_MESSAGE_BYTES + 1, 0x61)); await w.done;
  assert.equal(w.frames.at(-1).error.code, -32700);
});

test('the adapter reaches the actual companion service without pretending to be Harness', async t => {
  const fs = require('node:fs/promises'), os = require('node:os'), path = require('node:path'), crypto = require('node:crypto');
  const { createRecallService } = require('../companion/src/recall-service.cjs');
  const userData = await fs.mkdtemp(path.join(os.tmpdir(), 'huikan-codex-mcp-'));
  const items = [], receipts = new Map(); let revision = 0;
  const library = async (method, params) => {
    if (method === 'status') return { ready: true, workspaceId: 'isolated-mcp' };
    if (method === 'list') return { workspaceId: 'isolated-mcp', revision, items: items.filter(item => item.externalSource.instanceId === params.instanceId && item.externalSource.sessionId === params.sessionId) };
    if (method === 'capture') {
      const duplicate = items.some(item => item.text === params.text);
      let item = items.find(item => item.text === params.text);
      if (!item) { item = { id: 'actual-service-' + items.length, title: params.title, text: params.text, due: true, savedAt: new Date().toISOString(), externalSource: params.externalSource }; items.push(item); revision++; }
      const captureReceipt = { requestId: params.requestId, itemId: item.id, payloadHash: crypto.createHash('sha256').update(JSON.stringify(params)).digest('hex') };
      receipts.set(params.requestId, captureReceipt);
      return { workspaceId: 'isolated-mcp', revision, item, duplicate, captureReceipt };
    }
    throw Error('Unsupported fixture library method');
  };
  const service = await createRecallService({ userData, callDream: library });
  t.after(async () => { await service.close(); await fs.rm(userData, { recursive: true, force: true }); });
  const adapter = createAdapter({ env: { CODEX_HOME: '/test/actual-codex' }, home: '/test/home', clientId: CLIENT, resolveDirectory: async () => '/test/owned-bridge', call: async ({ service: target, method, params }) => target === 'sticky' ? service.handlers[method](params) : library(method, params) });
  const first = await adapter.invoke('save_excerpt', { threadId: THREAD, threadTitle: '实际服务测试', title: '指定正文', text: original, topic: '跨线程来源' });
  assert.equal(first.status, 'saved'); assert.equal(first.inCurrentThread, true);
  assert.equal(service.snapshot().active.provider, 'codex');
  assert.equal(service.snapshot().items[0].text, original);
  assert.equal(service.snapshot().items[0].manualTopic, '跨线程来源');
  const connection = service.handlers.connectionStatus();
  assert.equal(connection.connected, false, 'a Codex lease is not a Harness connection');
  assert.equal(connection.codex.connected, true);
  assert.equal(connection.codex.active, true);
  const duplicate = await adapter.invoke('save_excerpt', { threadId: OTHER, title: '相同正文', text: original });
  assert.equal(duplicate.status, 'saved'); assert.equal(duplicate.duplicate, true); assert.equal(duplicate.inCurrentThread, false);
  assert.equal(duplicate.existingSource.sessionId, THREAD);
  assert.equal(service.snapshot().active.sessionId, OTHER);
  assert.deepEqual((await adapter.invoke('list_recalls', { threadId: OTHER })).items, []);
  assert.equal((await adapter.invoke('list_recalls', { threadId: THREAD })).items.length, 1);
  assert.equal(items.length, 1); assert.equal(receipts.size, 2);
});
