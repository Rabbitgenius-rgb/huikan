'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const { SUPPORTED } = require('../desktop/harness-detection.cjs');
const { SUPPORTED_VERSIONS, createRecallService } = require('../companion/src/recall-service.cjs');
const manifest = require('../harness-plugin/package.json');
const versions = ['0.2.0-rc.2', '0.2.1-rc.3', '0.2.2-rc.1'];

test('desktop detection, plugin and companion agree on the three verified Harness versions', async () => {
  const core = await import('../harness-plugin/src/core.js');
  for (const supported of [SUPPORTED, SUPPORTED_VERSIONS, core.SUPPORTED_VERSIONS]) assert.deepEqual([...supported], versions);
  assert.equal(manifest.engines.dsh, '*');
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-typert-protocol'], '*');
  assert.equal(manifest.peerDependencies['@deepseek-ai/dsh-llm'], '*');
});

test('verified builds and future builds both require the public session APIs', async () => {
  const { assertCompatible } = await import('../harness-plugin/src/core.js');
  const ctx = { sessions: { list: { getSnapshot() {}, subscribe() {} }, binding() {} }, uiWorkspace: { openSession() {} }, uiConversation: { binding() {} }, connection: { rpc: { call() {} } }, slots: { inject() {}, register() {} }, effect() {} };
  for (const version of versions) assert.doesNotThrow(() => assertCompatible(version, ctx));
  assert.throws(() => assertCompatible('0.2.2-rc.1', { ...ctx, uiConversation: {} }), { code: 'interface-incompatible' });
  assert.doesNotThrow(() => assertCompatible('0.2.3-rc.1', ctx));
});

async function dom() {
  const code = await fs.readFile(new URL('../harness-plugin/src/dom.js', 'file://' + __filename), 'utf8');
  const sandbox = { recallError: (code, message) => Object.assign(Error(message), { code }), isHarnessVersion: require('../shared/harness-compatibility.cjs').isHarnessVersion };
  vm.runInNewContext(code.replace(/^export /gm, '') + '\nthis.api = { configureDomVersion, messageBody };', sandbox);
  return sandbox.api;
}

test('0.2.2-rc.1 user text uses its public message-bubble marker and assistant text keeps its verified body', async () => {
  const api = await dom(); api.configureDomVersion('0.2.2-rc.1');
  for (const [kind, selector] of [['user', '[data-message-bubble]'], ['steering', '[data-message-bubble]'], ['assistant-step', '.XNZzAa_body']]) {
    const body = { kind }, element = { dataset: { chatFlowKind: kind }, querySelectorAll: value => value === selector ? [body] : [] };body.closest = value => value === '[data-chat-node-key]' ? element : null;
    assert.equal(api.messageBody(element), body);
  }
  assert.throws(() => api.messageBody({ dataset: { chatFlowKind: 'assistant-step', chatGroupPart: 'reasoning' } }), /消息正文/);
  assert.throws(() => api.messageBody({ dataset: { chatFlowKind: 'tool' }, querySelectorAll: () => [] }), { code: 'structure-unsupported' });
});

test('older DOM adapters remain available and future builds can use structural detection', async () => {
  const api = await dom();
  for (const [version, selector] of [['0.2.0-rc.2', '.IzP3Va_bubble'], ['0.2.1-rc.3', '.AkCqbG_bubble']]) {
    api.configureDomVersion(version);
    const body = {}, element = { dataset: { chatFlowKind: 'user' }, querySelectorAll: value => value === selector ? [body] : [] };body.closest = value => value === '[data-chat-node-key]' ? element : null;
    assert.equal(api.messageBody(element), body);
  }
  assert.doesNotThrow(() => api.configureDomVersion('0.2.3-rc.1'));
});

test('a valid 0.2.2-rc.1 heartbeat connects, while an unverified version stays disconnected', async t => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'huikan-harness-compat-'));
  const service = await createRecallService({ userData: root, callDream: async method => {
    assert.equal(method, 'list'); return { workspaceId: 'fixture', revision: 1, items: [] };
  } });
  t.after(async () => { await service.close(); await fs.rm(root, { recursive: true, force: true }); });
  const context = { viewId: 'fixture-view', instanceId: 'fixture-instance', sessionId: 'fixture-session', sessionTitle: '合成测试', focused: true, supported: true, version: '0.2.2-rc.1', contextSeq: 1, focusEpoch: Date.now() };
  await service.handlers.publishContext(context);
  assert.equal(service.handlers.connectionStatus({}).connected, true);
  await service.handlers.publishContext({ ...context, version: '0.2.3-rc.1', contextSeq: 2 });
  assert.equal(service.handlers.connectionStatus({}).connected, false);
});
