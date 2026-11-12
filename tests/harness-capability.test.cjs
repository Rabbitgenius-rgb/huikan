'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { createRecallService } = require('../companion/src/recall-service.cjs');
const future = '0.2.9-rc.1';
const ctx = () => ({ sessions: { list: { getSnapshot() {}, subscribe() {} }, binding() {} }, uiWorkspace: { openSession() {} }, uiConversation: { binding() {} }, connection: { rpc: { call() {} } }, slots: { inject() {}, register() {} }, effect() {} });

test('future versions use actual public APIs; missing APIs are refused for verified and future versions alike', async () => {
  const { assertCompatible } = await import('../harness-plugin/src/core.js');
  for (const version of ['0.2.2-rc.1', future]) {
    assert.doesNotThrow(() => assertCompatible(version, ctx()));
    for (const area of ['uiConversation', 'uiWorkspace', 'connection', 'slots']) assert.throws(() => assertCompatible(version, { ...ctx(), [area]: {} }), { code: 'interface-incompatible' });
  }
  assert.throws(() => assertCompatible('not-a-version', ctx()));
});

async function dom() {
  const code = await fs.readFile(new URL('../harness-plugin/src/dom.js', 'file://' + __filename), 'utf8');
  const sandbox = { recallError: (code, message) => Object.assign(Error(message), { code }), isHarnessVersion: v => /^\d+\.\d+\.\d+(?:-[\w.]+)?$/.test(v) };
  vm.runInNewContext(code.replace(/^export /gm, '') + '\nthis.api = { configureDomVersion, messageBody };', sandbox);
  return sandbox.api;
}
function element(kind, selectors) {
  const e = { dataset: { chatFlowKind: kind }, querySelector: s => selectors[s]?.[0] || null, querySelectorAll: s => selectors[s] || [] };
  for (const bodies of Object.values(selectors)) for (const b of bodies) b.closest = s => s === '[data-chat-node-key]' ? e : null;
  return e;
}

test('future versions detect public user markers and known assistant markup without a version-table entry', async () => {
  const api = await dom(); api.configureDomVersion(future);
  for (const [kind, selector] of [['user', '[data-message-bubble]'], ['steering', '[data-message-bubble]'], ['assistant-step', '.XNZzAa_body']]) {
    const body = {}; assert.equal(api.messageBody(element(kind, { [selector]: [body] })), body);
  }
});

test('old adapters still work, while absent and ambiguous message bodies are rejected', async () => {
  const api = await dom();
  for (const [version, selector] of [['0.2.0-rc.2', '.IzP3Va_bubble'], ['0.2.1-rc.3', '.AkCqbG_bubble']]) {
    api.configureDomVersion(version);const body = {};assert.equal(api.messageBody(element('user', { [selector]: [body] })), body);
  }
  api.configureDomVersion('0.2.2-rc.1');
  assert.throws(() => api.messageBody(element('user', {})), { code: 'structure-unsupported' });
  assert.throws(() => api.messageBody(element('user', { '[data-message-bubble]': [{}, {}] })), { code: 'structure-unsupported' });
  assert.throws(() => api.messageBody({ dataset: { chatFlowKind: 'assistant-step', chatGroupPart: 'reasoning' } }), /消息正文/);
});

test('future heartbeats require a positive capability report and recover after a failed check', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'huikan-harness-compat-'));
  const service = await createRecallService({ userData: root, callDream: async () => ({ workspaceId: 'fixture', revision: 1, items: [] }) });
  t.after(async () => { await service.close(); await fs.rm(root, { recursive: true, force: true }); });
  const context = { viewId: 'fixture-view', instanceId: 'fixture-instance', sessionId: 'fixture-session', sessionTitle: '合成测试', focused: true, supported: true, version: future, contextSeq: 1, focusEpoch: Date.now() };
  await service.handlers.publishContext(context);
  assert.equal(service.handlers.connectionStatus({}).connected, false, 'An unknown version cannot self-approve with the old supported flag');
  const report = state => ({ protocol: 1, state, ...(state === 'incompatible' ? { message: '消息正文结构发生变化，请更新回看插件。' } : {}) });
  const reply = await service.handlers.publishContext({ ...context, contextSeq: 2, compatibility: report('ready') });
  assert.equal(reply.compatibilityProtocol, 1);
  assert.equal(service.handlers.connectionStatus({}).connected, true);
  await service.handlers.publishContext({ ...context, contextSeq: 3, supported: false, compatibility: report('incompatible') });
  assert.equal(service.handlers.connectionStatus({}).connected, false);
  assert.equal(service.handlers.connectionStatus({}).compatibility.state, 'incompatible');
  await service.handlers.publishContext({ ...context, contextSeq: 4, compatibility: report('ready') });
  assert.equal(service.handlers.connectionStatus({}).connected, true);
  await assert.rejects(service.handlers.publishContext({ ...context, contextSeq: 5, compatibility: { protocol: 99, state: 'ready' } }));
});
