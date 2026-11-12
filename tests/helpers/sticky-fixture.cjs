'use strict';
const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
const { EventEmitter } = require('node:events');

// Native window/IPC boundary only. All layout and ownership decisions execute
// the production stickies module, including source validation and persistence.
function stickyFixture() {
  const root = path.resolve(__dirname, '../..'), handles = new Map(), listeners = new Map();
  const stateFile = { exports: {} };
  vm.runInNewContext(fs.readFileSync(path.join(root, 'companion/src/state.js'), 'utf8'), { require, module: stateFile, __dirname: path.join(root, 'companion/src') });
  const stateModule = stateFile.exports, { state, SIZES } = stateModule;
  const cursor = { x: -10000, y: -10000 };
  let sequence = 100;
  class Window extends EventEmitter {
    constructor(options = {}) {
      super(); this.options = options; this.bounds = { x: options.x || 0, y: options.y || 0, width: options.width || 320, height: options.height || 400 };
      this.visible = true; this.destroyed = false; this.messages = []; this.ignored = false;
      this.webContents = { id: sequence++, mainFrame: {}, send: (name, ...args) => { this.messages.push([name, ...args]); this.onSend?.(name, ...args); }, isDestroyed: () => this.destroyed };
    }
    getBounds() { return { ...this.bounds }; }
    setBounds(value) { this.bounds = { ...value }; this.onBounds?.(this.bounds); }
    isDestroyed() { return this.destroyed; }
    isVisible() { return this.visible; }
    setAlwaysOnTop() {}
    setVisibleOnAllWorkspaces() {}
    loadFile(file, options) { this.file = file; this.query = options.query; }
    show() { this.visible = true; }
    showInactive() { this.visible = true; }
    hide() { this.visible = false; }
    focus() {}
    setIgnoreMouseEvents(value) { this.ignored = value; }
    close() { this.destroyed = true; this.emit('closed'); }
  }
  state.panel = new Window({ x: 20, y: 30, width: 320, height: 400 });
  const pins = {}, reads = [], items = new Map();
  state.service = { getItem: id => items.get(id), setPin: async (id, layout) => { if (layout) pins[id] = { ...layout }; else delete pins[id]; }, pinnedLayouts: () => pins, markRead: async ids => reads.push(...ids) };
  function add(id, text = '合成摘录：保留正文与来源。') {
    const item = { id, title: '鲸鱼娘便签测试', text, externalSource: { provider: 'codex', instanceId: 'isolated', sessionId: 'synthetic', messageId: 'message-' + id } };
    items.set(id, item); state.items.push(item); return item;
  }
  const ipc = { handle: (name, fn) => handles.set(name, fn), on: (name, fn) => listeners.set(name, fn) };
  const module = { exports: {} };
  const localRequire = name => name === 'electron' ? { BrowserWindow: Window, screen: { getCursorScreenPoint: () => ({ ...cursor }), getDisplayMatching: () => ({ workArea: { x: 0, y: 24, width: 1440, height: 876 } }) } }
    : name === './state' ? stateModule : name === './settings' ? { current: () => ({}) }
    : name === './whale-pet-asset.cjs' ? require(path.join(root, 'companion/src/whale-pet-asset.cjs')) : require(name);
  vm.runInNewContext(fs.readFileSync(path.join(root, 'companion/src/stickies.js'), 'utf8'), { require: localRequire, module, __dirname: path.join(root, 'companion/src'), process, setInterval, clearInterval });
  const stickies = module.exports; stickies.wire(ipc);
  const event = rec => ({ sender: rec.win.webContents, senderFrame: rec.win.webContents.mainFrame });
  const invoke = (rec, name, ...args) => handles.get(name)(event(rec), ...args);
  const send = (rec, name, ...args) => listeners.get(name)(event(rec), ...args);
  async function pin(id) { await stickies.pinItem(id); const rec = state.stickies.get(id); rec.win.emit('ready-to-show'); return rec; }
  const destroy = () => { state.quitting = true; for (const rec of state.stickies.values()) rec.win.close(); state.panel.close(); };
  return { state, SIZES, pins, reads, items, cursor, add, pin, event, invoke, send, handles, listeners, stickies, destroy };
}
module.exports = { stickyFixture };
