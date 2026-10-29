'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { EventEmitter } = require('node:events');

const VERSION = '0.2.0-rc.2';
const SUPPORTED_VERSIONS = new Set(['0.2.0-rc.2', '0.2.1-rc.3']);
const CODEX_INSTANCE = /^codex:[a-f0-9]{24}$/;
const CODEX_THREAD = /^(?:[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}|thr_[A-Za-z0-9_-]{1,252})$/i;
const CLIENT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const CODEX_MESSAGE = /^capture-([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i;
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const fail = (code, message) => Object.assign(new Error(message), { code });
function string(value, name, max = 256, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.length) || /\0/.test(value)) throw fail('INVALID_ARGUMENT', `${name} 无效`);
  return value;
}
function integer(value, name) {
  if (!Number.isSafeInteger(value) || value < 0) throw fail('INVALID_ARGUMENT', `${name} 无效`);
  return value;
}
function codexThreadId(value) {
  const id = string(value, 'Codex thread ID');
  if (!CODEX_THREAD.test(id)) throw fail('INVALID_SOURCE', 'Codex 线程标识无效');
  return id;
}
function sourceOf(v) {
  if (!object(v) || v.version !== 1 || !['deepseek-harness', 'codex'].includes(v.provider)) throw fail('INVALID_SOURCE', '不支持的回看来源');
  const out = { version: 1, provider: v.provider, instanceId: string(v.instanceId, 'instanceId'), sessionId: string(v.sessionId, 'sessionId'), messageId: string(v.messageId, 'messageId'), eventSeq: integer(v.eventSeq, 'eventSeq'), turn: integer(v.turn, 'turn'), sessionTitle: string(v.sessionTitle, 'sessionTitle', 500, true) };
  if (out.provider === 'codex') {
    codexThreadId(out.sessionId);
    if (!CODEX_INSTANCE.test(out.instanceId) || !CODEX_MESSAGE.test(out.messageId) || out.eventSeq !== 0 || Object.is(out.eventSeq, -0) || out.turn !== 0 || Object.is(out.turn, -0) || v.selection !== undefined) throw fail('INVALID_SOURCE', 'Codex 来源不能伪造消息或选区位置');
  }
  if (v.selection !== undefined) {
    const s = v.selection;
    if (!object(s)) throw fail('INVALID_SOURCE', '选区来源无效');
    out.selection = { text: string(s.text, 'selection.text', 200000), start: integer(s.start, 'selection.start'), end: integer(s.end, 'selection.end'), prefix: string(s.prefix, 'selection.prefix', 128, true), suffix: string(s.suffix, 'selection.suffix', 128, true) };
    if (out.selection.end <= out.selection.start || out.selection.end - out.selection.start !== out.selection.text.length) throw fail('INVALID_SOURCE', '选区范围与文字长度不一致');
  }
  return out;
}
function captureOf(v) {
  if (!object(v) || typeof v.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v.requestId)) throw fail('INVALID_ARGUMENT', '收藏请求标识无效');
  const text = string(v.text, 'text', 200000);
  if (!text.trim()) throw fail('INVALID_ARGUMENT', '不能保存空白内容');
  const externalSource = sourceOf(v.externalSource);
  if (externalSource.provider === 'codex' && externalSource.messageId.toLowerCase() !== `capture-${v.requestId.toLowerCase()}`) throw fail('INVALID_SOURCE', 'Codex 保存请求与来源标识不一致');
  if (externalSource.selection && externalSource.selection.text !== text) throw fail('INVALID_SOURCE', '保存内容与选区文字不一致');
  const result = { requestId: v.requestId, text, title: string(v.title, 'title', 500), externalSource };
  if (v.manualTopic !== undefined) result.manualTopic = topicTitle(v.manualTopic);
  return result;
}
function topicTitle(value) {
  const title = string(value, 'manualTopic', 40).trim();
  if (!title || /[\x00-\x1f\x7f]/u.test(title)) throw fail('INVALID_ARGUMENT', '请输入 1–40 字的主题');
  return title;
}
function itemOf(v) {
  if (!object(v) || typeof v.due !== 'boolean') throw fail('INVALID_RESPONSE', '梦藏返回的回看条目无效');
  if (['__proto__', 'prototype', 'constructor'].includes(v.id)) throw fail('INVALID_RESPONSE', '梦藏返回的条目标识无效');
  return { id: string(v.id, 'item.id'), title: string(v.title, 'item.title', 500, true), text: string(v.text, 'item.text', 200000, true), savedAt: string(v.savedAt, 'savedAt', 100), due: v.due, externalSource: sourceOf(v.externalSource) };
}
const digest = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const keyOf = s => s ? `${s.instanceId}\0${s.sessionId}` : '';
const errorOf = e => ({ code: typeof e?.code === 'string' ? e.code : 'UNAVAILABLE', message: typeof e?.message === 'string' ? e.message.slice(0, 500) : '连接暂不可用，请重试' });

/** Owns only recoverable delivery state, a discardable library cache, and window preferences. */
async function createRecallService({ userData, callDream, now = Date.now, navigationTimeoutMs = 12000, onContext = () => {} }) {
  if (!path.isAbsolute(userData) || typeof callDream !== 'function') throw Error('Invalid recall service configuration');
  await fs.mkdir(userData, { recursive: true, mode: 0o700 });
  const file = path.join(userData, 'recall-state.json');
  const events = new EventEmitter();
  let data = { version: 1, outbox: {}, receipts: {}, cache: {}, pinned: {}, topicAssignments: {}, readItems: {}, mode: 'auto', active: null };
  try {
    const raw = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!object(raw) || raw.version !== 1) throw Error('Unknown recall state');
    data = { ...data, ...raw };
    for (const k of ['outbox', 'receipts', 'cache', 'pinned', 'topicAssignments', 'readItems']) if (!object(data[k])) throw Error('Invalid recall state');
    if (Object.values(data.readItems).some(value => value !== true)) throw Error('Invalid reading state');
    for (const title of Object.values(data.topicAssignments)) topicTitle(title);
    for (const item of Object.values(data.cache)) itemOf(item);
    for (const pending of Object.values(data.outbox)) captureOf(pending.capture);
    if (data.active && (!object(data.active) || typeof data.active.instanceId !== 'string' || typeof data.active.sessionId !== 'string')) throw Error('Invalid active source');
    if (data.active?.provider === 'codex' && (!CODEX_INSTANCE.test(data.active.instanceId) || !CLIENT_ID.test(data.active.clientId || '') || !CODEX_THREAD.test(data.active.sessionId))) throw Error('Invalid Codex active source');
  } catch (e) { if (e.code !== 'ENOENT') throw fail('STATE_READ_FAILED', '回看本地状态无法读取；保留原文件，请检查后重试'); }
  let writes = Promise.resolve(), persistenceError = null, libraryError = null, generation = 0, refreshPromise = null, refreshKey = null, closed = false;
  const views = new Map(), codexClients = new Map(), inFlight = new Map(), navigations = new Map();
  const libraryRevisions = new Map();
  function acceptRevision(result) {
    const workspaceId = string(result?.workspaceId, 'workspaceId', 500);
    const revision = integer(result?.revision, 'revision');
    if (revision < (libraryRevisions.get(workspaceId) ?? -1)) return false;
    libraryRevisions.set(workspaceId, revision); return true;
  }
  function persist() {
    const json = JSON.stringify(data);
    const task = writes.then(async () => {
      const temp = `${file}.${crypto.randomUUID()}.tmp`;
      try {
        await fs.writeFile(temp, json, { mode: 0o600, flag: 'wx' });
        const handle = await fs.open(temp, 'r+'); try { await handle.sync(); } finally { await handle.close(); }
        await fs.rename(temp, file); persistenceError = null;
      } catch (e) { await fs.rm(temp, { force: true }).catch(() => {}); persistenceError = errorOf(e); throw e; }
    });
    writes = task.catch(() => {});
    return task;
  }
  function liveCodexClient(clientId) { const client = codexClients.get(clientId); return !!client && now() - client.seenAt < 10000; }
  function liveView(v) { return v && now() - v.seenAt < 10000 && v.supported && SUPPORTED_VERSIONS.has(v.version); }
  function withTopic(item) {
    const title = data.topicAssignments[item.id];
    return typeof title === 'string' ? { ...item, manualTopic: title } : item;
  }
  function snapshot() {
    const active = data.active;
    const sourceKey = keyOf(active);
    const items = Object.values(data.cache).filter(item => keyOf(item.externalSource) === sourceKey).map(withTopic).sort((a, b) => a.externalSource.eventSeq - b.externalSource.eventSeq || (a.externalSource.selection?.start ?? 0) - (b.externalSource.selection?.start ?? 0) || a.savedAt.localeCompare(b.savedAt));
    const pending = Object.values(data.outbox).filter(p => keyOf(p.capture.externalSource) === sourceKey).map(p => ({ requestId: p.capture.requestId, title: p.capture.title, text: p.capture.text, externalSource: p.capture.externalSource, error: p.error || null, saving: inFlight.has(p.capture.requestId) }));
    const view = active && views.get(active.viewId);
    const codexActive = active?.provider === 'codex';
    return { active, items, pending, connected: codexActive ? liveCodexClient(active.clientId) : !!liveView(view), supported: codexActive || (!!view && view.supported && SUPPORTED_VERSIONS.has(view.version)), libraryError, persistenceError, pinned: Object.keys(data.pinned), read: items.filter(item => data.readItems[item.id] === true).map(item => item.id), mode: data.mode };
  }
  const changed = () => events.emit('change', snapshot());
  async function refresh() {
    const active = data.active;
    // Pinned windows remain visible across thread switches. Reconcile their
    // source lists too, including when Harness has no active conversation.
    const sources = new Map();
    if (active?.sessionId) sources.set(keyOf(active), active);
    for (const id of Object.keys(data.pinned)) {
      const source = data.cache[id]?.externalSource;
      if (source) sources.set(keyOf(source), source);
    }
    if (!sources.size) { changed(); return; }
    if (refreshPromise && refreshKey === keyOf(active)) return refreshPromise;
    const requestGeneration = generation, requestKey = keyOf(active);
    const run = (async () => {
      const failures = [];
      await Promise.all([...sources].map(async ([sourceKey, source]) => { try {
        const result = await callDream('list', { instanceId: source.instanceId, sessionId: source.sessionId });
        if (!Array.isArray(result?.items)) throw fail('INVALID_RESPONSE', '梦藏返回的回看列表无效');
        const items = result.items.map(itemOf);
        if (items.some(item => keyOf(item.externalSource) !== sourceKey)) throw fail('INVALID_RESPONSE', '梦藏返回了其他会话的条目');
        if (closed || requestGeneration !== generation || requestKey !== keyOf(data.active)) return;
        if (!acceptRevision(result)) return;
        const ids = new Set(items.map(item => item.id)), removed = new Set();
        for (const [id, item] of Object.entries(data.cache)) if (keyOf(item.externalSource) === sourceKey && !ids.has(id)) {
          delete data.cache[id]; delete data.pinned[id]; removed.add(id);
        }
        for (const layout of Object.values(data.pinned)) if (removed.has(layout.dockBelow)) delete layout.dockBelow;
        for (const item of items) data.cache[item.id] = item;
        libraryError = null; await persist(); changed();
      } catch (e) { failures.push(e); } }));
      if (failures.length && !closed && requestGeneration === generation) { libraryError = errorOf(failures[0]); changed(); }
    })();
    refreshPromise = run; refreshKey = requestKey; await run; if (refreshPromise === run) { refreshPromise = null; refreshKey = null; }
  }
  async function publishContext(v) {
    if (!object(v) || typeof v.focused !== 'boolean' || typeof v.supported !== 'boolean') throw fail('INVALID_ARGUMENT', '会话状态无效');
    if (v.contextSeq === undefined || v.focusEpoch === undefined) throw fail('CONTEXT_PROTOCOL_UNSUPPORTED', '焦点协议已更新，请同时更新回看插件与浮窗，并重新加载 Harness 页面');
    const contextSeq = integer(v.contextSeq, 'contextSeq'), focusEpoch = integer(v.focusEpoch, 'focusEpoch');
    if (!contextSeq || (v.focused && !focusEpoch)) throw fail('INVALID_ARGUMENT', '焦点状态序号无效');
    const view = { viewId: string(v.viewId, 'viewId'), instanceId: string(v.instanceId, 'instanceId'), sessionId: string(v.sessionId, 'sessionId', 256, true), sessionTitle: string(v.sessionTitle, 'sessionTitle', 500, true), focused: v.focused, supported: v.supported, version: string(v.version, 'version', 100), contextSeq, focusEpoch, seenAt: now() };
    const previous = views.get(view.viewId);
    if (previous && previous.instanceId !== view.instanceId) throw fail('INVALID_ARGUMENT', '窗口来源身份发生变化');
    const trace = (accepted, reason) => { try { onContext({ contextProtocol: 2, viewId: view.viewId, instanceId: view.instanceId, sessionId: view.sessionId, contextSeq, focusEpoch, reportedFocused: view.focused, accepted, reason, activeViewId: data.active?.viewId || '', activeInstanceId: data.active?.instanceId || '', activeSessionId: data.active?.sessionId || '', activeFocusEpoch: data.active?.focusEpoch || 0 }); } catch {} };
    if (previous && contextSeq <= previous.contextSeq) { trace(false, 'stale-sequence'); return { accepted: false, contextProtocol: 2 }; }
    if ((previous && focusEpoch < previous.focusEpoch) || (data.active?.viewId === view.viewId && focusEpoch < (data.active.focusEpoch || 0))) { trace(false, 'stale-focus-epoch'); return { accepted: false, contextProtocol: 2 }; }
    view.focusedAt = focusEpoch;
    views.set(view.viewId, view);
    // A Codex tool chooses a source, not OS focus. Keep the last Harness epoch
    // only as an ordering barrier so its unchanged heartbeat cannot steal back.
    const priorEpoch = data.active?.provider === 'codex' ? data.active.harnessFocusEpoch || 0 : data.active?.focusEpoch || 0;
    const newFocus = focusEpoch > priorEpoch;
    const currentView = data.active?.viewId === view.viewId;
    if (newFocus || currentView) {
      // A blur never creates a focus epoch. A newer real epoch can arrive after
      // that window already blurred while transport was busy; retain that focus.
      const next = { provider: 'deepseek-harness', viewId: view.viewId, instanceId: view.instanceId, sessionId: view.sessionId, sessionTitle: view.sessionTitle, focusEpoch };
      const switched = keyOf(next) !== keyOf(data.active);
      const different = JSON.stringify(next) !== JSON.stringify(data.active);
      data.active = next;
      trace(true, newFocus ? 'new-focus-epoch' : 'current-view');
      if (different) { generation++; await persist(); }
      changed();
      if (switched || (!refreshPromise && !previous)) void refresh();
    } else trace(true, 'background-view');
    return { accepted: true, contextProtocol: 2 };
  }
  function codexClient(v) {
    if (!object(v) || typeof v.clientId !== 'string' || !CLIENT_ID.test(v.clientId)) throw fail('INVALID_ARGUMENT', 'Codex 客户端标识无效');
    return v.clientId.toLowerCase();
  }
  function codexHeartbeat(v) {
    const clientId = codexClient(v), previous = codexClients.get(clientId);
    if (Object.keys(v).some(key => key !== 'clientId')) throw fail('INVALID_ARGUMENT', 'Codex 心跳包含不支持的字段');
    codexClients.set(clientId, { ...previous, seenAt: now() });
    changed();
    return { accepted: true };
  }
  async function codexContext(v) {
    const clientId = codexClient(v);
    if (Object.keys(v).some(key => !['clientId','instanceId','sessionId','sessionTitle'].includes(key))) throw fail('INVALID_ARGUMENT', 'Codex 来源包含不支持的字段');
    if (!liveCodexClient(clientId)) throw fail('CODEX_UNAVAILABLE', 'Codex 本机连接已断开，请重新连接后重试');
    const instanceId = string(v.instanceId, 'instanceId');
    if (!CODEX_INSTANCE.test(instanceId)) throw fail('INVALID_SOURCE', 'Codex 实例标识无效');
    const sessionId = codexThreadId(v.sessionId), sessionTitle = string(v.sessionTitle, 'sessionTitle', 500, true);
    const client = codexClients.get(clientId);
    if (client.instanceId && client.instanceId !== instanceId) throw fail('INVALID_SOURCE', 'Codex 客户端来源发生变化');
    const harnessFocusEpoch = [...views.values()].reduce((epoch, view) => Math.max(epoch, view.focusEpoch), Math.max(data.active?.harnessFocusEpoch || 0, data.active?.focusEpoch || 0));
    const next = { provider: 'codex', clientId, viewId: `codex:${clientId}`, instanceId, sessionId, sessionTitle, harnessFocusEpoch };
    const switched = keyOf(next) !== keyOf(data.active);
    const previous = data.active;
    data.active = next;
    if (JSON.stringify(next) !== JSON.stringify(previous)) {
      generation++;
      try { await persist(); } catch (error) { data.active = previous; changed(); throw error; }
    }
    client.instanceId = instanceId;
    changed();
    if (switched) await refresh();
    return { accepted: true, provider: 'codex' };
  }
  async function deliver(capture) {
    const id = capture.requestId, hash = digest(capture);
    // Topic grouping belongs to this companion, alongside its AI topic cache.
    // The existing library capture transaction still receives its canonical fields.
    const { manualTopic, ...libraryCapture } = capture;
    const existing = data.outbox[id] || data.receipts[id];
    if (existing && existing.digest !== hash) throw fail('REQUEST_CONFLICT', '同一收藏请求的内容发生变化');
    if (inFlight.has(id)) return inFlight.get(id);
    const task = (async () => {
      if (data.receipts[id]) {
        const receipt = data.receipts[id];
        const result = await callDream('capture', libraryCapture);
        const item = itemOf(result.item); if (acceptRevision(result)) data.cache[item.id] = item;
        if (item.id !== receipt.itemId) throw fail('INVALID_RESPONSE', '收藏回执身份不一致');
        if (manualTopic !== undefined) data.topicAssignments[item.id] = manualTopic;
        await persist(); changed(); return { requestId: id, status: 'saved', ...(capture.externalSource.provider === 'codex' ? { duplicate: true } : {}), item: withTopic(item) };
      }
      data.outbox[id] = { capture, digest: hash, error: null };
      await persist(); changed();
      try {
        const result = await callDream('capture', libraryCapture);
        const item = itemOf(result.item);
        const acknowledgement = result.captureReceipt;
        const confirmedDuplicate = result.duplicate === true && acknowledgement?.requestId === id.toLowerCase() && acknowledgement?.itemId === item.id && acknowledgement?.payloadHash === digest({ ...libraryCapture, requestId: id.toLowerCase() });
        // Global deduplication keeps the canonical excerpt's original source.
        // Accept that different source only with a receipt for this exact request.
        if (keyOf(item.externalSource) !== keyOf(capture.externalSource) && !confirmedDuplicate) throw fail('INVALID_RESPONSE', '收藏来源不一致');
        if (acceptRevision(result)) data.cache[item.id] = item;
        data.receipts[id] = { digest: hash, itemId: item.id };
        if (manualTopic !== undefined) data.topicAssignments[item.id] = manualTopic;
        delete data.outbox[id]; libraryError = null;
        await persist(); changed();
        // This is a transient acknowledgement, not part of the recoverable save.
        // Receipts/replays and list refreshes deliberately do not emit it.
        try { events.emit('captured', { requestId: id, itemId: item.id, sourceIdentity: { instanceId: capture.externalSource.instanceId, sessionId: capture.externalSource.sessionId } }); } catch {}
        return { requestId: id, status: 'saved', ...(capture.externalSource.provider === 'codex' ? { duplicate: result.duplicate === true } : {}), item: withTopic(item) };
      } catch (e) {
        // Even when the server committed but its reply was lost, retry uses the same request ID.
        if (!data.outbox[id]) data.outbox[id] = { capture, digest: hash };
        delete data.receipts[id];
        data.outbox[id].error = errorOf(e); libraryError = errorOf(e);
        await persist(); changed();
        return { requestId: id, status: 'pending', error: errorOf(e) };
      }
    })();
    inFlight.set(id, task);
    try { return await task; } finally { inFlight.delete(id); changed(); }
  }
  async function capture(v) { return deliver(captureOf(v)); }
  async function retry(requestId) {
    string(requestId, 'requestId');
    const p = data.outbox[requestId]; if (!p) throw fail('NOT_FOUND', '没有这条待保存内容');
    return deliver(p.capture);
  }
  function getItem(id) { return Object.hasOwn(data.cache, id) ? withTopic(data.cache[id]) : null; }
  async function markRead(ids) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 512 || ids.some(id => typeof id !== 'string' || !getItem(id))) throw fail('INVALID_ARGUMENT', '阅读条目无效');
    const added = [...new Set(ids)].filter(id => !Object.hasOwn(data.readItems, id));
    if (!added.length) return;
    for (const id of added) data.readItems[id] = true;
    try { await persist(); }
    catch (error) { for (const id of added) delete data.readItems[id]; changed(); throw error; }
    changed();
  }
  async function setReview(id, due) {
    string(id, 'id'); if (typeof due !== 'boolean' || !getItem(id)) throw fail('INVALID_ARGUMENT', '回看状态无效');
    const result = await callDream('setReview', { id, due });
    const item = itemOf(result.item); if (item.id !== id) throw fail('INVALID_RESPONSE', '条目身份不一致');
    if (acceptRevision(result)) data.cache[id] = item; await persist(); changed(); return data.cache[id];
  }
  async function setPin(id, layout) {
    string(id, 'id');
    if (layout === null) delete data.pinned[id];
    else {
      if (!getItem(id) || !object(layout) || !['note', 'large', 'gem'].includes(layout.state) || !Number.isFinite(layout.x) || !Number.isFinite(layout.y)) throw fail('INVALID_ARGUMENT', '便签布局无效');
      if (layout.dockBelow !== undefined) {
        if (typeof layout.dockBelow !== 'string' || layout.dockBelow === id || !getItem(layout.dockBelow)) throw fail('INVALID_ARGUMENT', '便签吸附目标无效');
      }
      data.pinned[id] = { x: Math.round(layout.x), y: Math.round(layout.y), state: layout.state, ...(layout.dockBelow ? { dockBelow: layout.dockBelow } : {}) };
    }
    await persist(); changed();
  }
  async function setMode(mode) {
    if (!['auto', '2d', '3d'].includes(mode)) throw fail('INVALID_ARGUMENT', '外观模式无效');
    data.mode = mode; await persist(); changed();
  }
  function requestNavigation(id) {
    const item = getItem(id); if (!item) return Promise.reject(fail('NOT_FOUND', '找不到回看条目'));
    const candidates = [...views.values()].filter(v => v.instanceId === item.externalSource.instanceId && liveView(v));
    const preferred = candidates.find(v => v.viewId === data.active?.viewId) || candidates.sort((a, b) => b.focusEpoch - a.focusEpoch || b.seenAt - a.seenAt)[0];
    if (!preferred) return Promise.reject(fail('HARNESS_UNAVAILABLE', 'Harness 未连接或版本不兼容，原文仍保留在梦藏'));
    const commandId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { navigations.delete(commandId); reject(fail('NAVIGATION_TIMEOUT', '未能确认原文位置，请在 Harness 中检查')); }, navigationTimeoutMs);
      navigations.set(commandId, { id: commandId, viewId: preferred.viewId, instanceId: preferred.instanceId, source: item.externalSource, delivered: false, resolve, reject, timeout });
    });
  }
  function pollCommands(v) {
    if (!object(v)) throw fail('INVALID_ARGUMENT', '导航窗口无效');
    const viewId = string(v.viewId, 'viewId'), instanceId = string(v.instanceId, 'instanceId');
    const view = views.get(viewId); if (!view || view.instanceId !== instanceId || !liveView(view)) return { commands: [] };
    const commands = [];
    for (const n of navigations.values()) if (!n.delivered && n.viewId === viewId && n.instanceId === instanceId) { n.delivered = true; commands.push({ id: n.id, kind: 'reveal', source: n.source }); }
    return { commands };
  }
  function navigationResult(v) {
    if (!object(v) || typeof v.ok !== 'boolean') throw fail('INVALID_ARGUMENT', '导航结果无效');
    const n = navigations.get(string(v.id, 'id'));
    if (!n || n.viewId !== string(v.viewId, 'viewId')) return { accepted: false };
    clearTimeout(n.timeout); navigations.delete(n.id);
    if (v.ok) n.resolve({ ok: true }); else n.reject(fail(typeof v.code === 'string' ? v.code.slice(0, 100) : 'SOURCE_UNAVAILABLE', typeof v.message === 'string' ? v.message.slice(0, 500) : '未能定位原文；收藏内容仍保留'));
    return { accepted: true };
  }
  function connectionStatus(){const live=[...views.values()].filter(liveView), codexConnected=[...codexClients.keys()].some(liveCodexClient), activeCodex=data.active?.provider==='codex';return {protocol:1,connected:live.length>0,hostVersion:live[0]?.version||null,codex:{connected:codexConnected,active:activeCodex&&liveCodexClient(data.active.clientId),sessionId:activeCodex?data.active.sessionId:null}};}
  async function close() {
    closed = true;
    for (const n of navigations.values()) { clearTimeout(n.timeout); n.reject(fail('CLOSED', '浮窗已退出')); }
    navigations.clear(); await Promise.allSettled([...inFlight.values()]); await writes;
  }
  return { events, handlers: { publishContext, codexHeartbeat, codexContext, capture, pollCommands, navigationResult, connectionStatus }, snapshot, refresh, retry, getItem, markRead, setReview, setPin, setMode, requestNavigation, pinnedLayouts: () => structuredClone(data.pinned), close };
}

module.exports = { createRecallService, captureOf, sourceOf, itemOf, codexThreadId, VERSION, SUPPORTED_VERSIONS };
