'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const recall = require('../companion/src/recall-service.cjs');

function mainFixture() {
  const opened = [], navigation = [], generated = [];
  let current = { id: 'saved', externalSource: { provider: 'codex', sessionId: 'thr_saved-thread' } };
  const state = { service: { getItem: () => current, requestNavigation: id => { navigation.push(id); return { ok: true }; } } };
  const filename = path.join(__dirname, '../companion/src/main.js');
  const context = vm.createContext({ __dirname: path.dirname(filename), process: { env: {} }, module: { exports: {} },
    require: name => {
      if (name === 'electron') return { shell: { openExternal: async url => { opened.push(['external', url]); }, openPath: async value => { opened.push(['path', value]); return ''; } },
        app: { setName() {}, setPath() {}, on() {}, quit() {}, requestSingleInstanceLock: () => false } };
      if (name === './state') return { state };
      if (name === './recall-service.cjs') return recall;
      if (name === './window-diagnostics.cjs') return { createWindowDiagnostics: () => ({}) };
      if (name === './transport') return { callPrivate: async value => { generated.push(value); return { topics: [] }; } };
      if (name.startsWith('.')) return {};
      return require(name);
    },
  });
  vm.runInContext(fs.readFileSync(filename, 'utf8') + '\ncandidateConfig.harnessAppPath="/synthetic/Harness.app";module.exports={revealItem,generateHarnessTopics};', context, { filename });
  return { ...context.module.exports, opened, navigation, generated, set item(value) { current = value; } };
}

test('Codex navigation opens only a validated thread and preserves the Harness navigation path', async () => {
  const f = mainFixture();
  const result = await f.revealItem('saved');
  assert.equal(result.target, 'thread'); assert.equal(result.precise, false);
  assert.deepEqual(f.opened, [['external', 'codex://threads/thr_saved-thread']]);
  assert.deepEqual(f.navigation, []);
  f.item = { externalSource: { provider: 'codex', sessionId: 'thr_saved?url=https://other.test' } };
  await assert.rejects(f.revealItem('saved'), /线程标识无效/);
  assert.equal(f.opened.length, 1);
  f.item = { externalSource: { provider: 'deepseek-harness', sessionId: 'harness-thread' } };
  await f.revealItem('harness-saved');
  assert.deepEqual(f.opened[1], ['path', '/synthetic/Harness.app']);
  assert.deepEqual(f.navigation, ['harness-saved']);
});

test('Codex excerpt topics can never be sent to the Harness model transport', async () => {
  const f = mainFixture();
  await assert.rejects(async () => f.generateHarnessTopics({ instanceId: `codex:${'a'.repeat(24)}`, items: [{ text: '不应发给 Harness 的 Codex 原文' }] }), /不使用 Harness 模型/);
  assert.equal(f.generated.length, 0);
  await f.generateHarnessTopics({ instanceId: 'harness-instance', items: [{ text: '已授权的 Harness 原文' }] });
  assert.equal(f.generated.length, 1);
  assert.equal(f.generated[0].service, 'harness-topics');
});
