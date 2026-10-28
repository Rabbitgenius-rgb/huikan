'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('topic actions require the current item and the sending window main frame', () => {
  const filename = path.join(__dirname, '../companion/src/main.js');
  const panel = { id: 1, mainFrame: {} }, popup = { id: 2, mainFrame: {} }, stranger = { id: 3, mainFrame: {} };
  const state = { panel: { webContents: panel }, items: [{ id: 'current-item' }], byWc: new Map() };
  const controller = {
    ownsWebContents: wc => wc === popup,
    ownsItem: (wc, id) => wc === popup && id === 'topic-item',
  };
  const context = vm.createContext({
    __dirname: path.dirname(filename), process: { env: {} }, module: { exports: {} }, controller,
    require: name => {
      if (name === 'electron') return { app: { setName() {}, setPath() {}, quit() {}, on() {}, requestSingleInstanceLock: () => false } };
      if (name === './state') return { state };
      if (name === './window-diagnostics.cjs') return { createWindowDiagnostics: () => ({}) };
      if (name.startsWith('.')) return {};
      return require(name);
    },
  });
  vm.runInContext(fs.readFileSync(filename, 'utf8') + '\n topicPreviewController = controller; module.exports = { trustedPanelSender };', context, { filename });
  const { trustedPanelSender: allowed } = context.module.exports;
  const event = (sender, senderFrame = sender.mainFrame) => ({ sender, senderFrame });
  assert.equal(allowed(event(panel)), true, 'main panel can finish a drag');
  assert.equal(allowed(event(panel), 'current-item'), true);
  assert.equal(allowed(event(panel), 'previous-source-item'), false, 'cached items from other sources are not panel actions');
  assert.equal(allowed(event(popup)), true, 'an owned popup can finish its drag');
  assert.equal(allowed(event(popup), 'topic-item'), true);
  assert.equal(allowed(event(popup), 'current-item'), false, 'popup actions stay within its topic');
  assert.equal(allowed(event(stranger)), false);
  assert.equal(allowed(event(stranger), 'current-item'), false);
  assert.equal(allowed(event(panel, {}), 'current-item'), false, 'subframes cannot send panel actions');
  assert.equal(allowed(event(popup, {}), 'topic-item'), false);
  assert.equal(allowed(event(panel), null), false);
  assert.equal(allowed(event(popup), 123), false);
  state.items = [{ id: 'new-source-item' }];
  assert.equal(allowed(event(panel), 'current-item'), false, 'source switches invalidate old panel items immediately');
  assert.equal(allowed(event(panel), 'new-source-item'), true);
});
