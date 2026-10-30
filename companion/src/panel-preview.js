'use strict';
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { state, PRELOAD } = require('./state');
const { glassWindowOptions, attachGlassMaterial } = require('./window-material.cjs');

// Topic details share the panel's source context and native glass material.
function attach(panel, ipcMain, { getData, onDismiss } = {}) {
  let preview = null, loaded = false, request = 0, active = null, outsideSince = 0;
  const data = () => typeof getData === 'function' ? getData() : null;
  const mainFrame = event => !event.senderFrame || event.senderFrame === event.sender.mainFrame;
  function selected() {
    if (!active || panel.isDestroyed() || !panel.isVisible()) return null;
    const payload = data();
    if (!payload || payload.sourceKey !== active.sourceKey) return null;
    const topic = payload.topics?.find(value => value.id === active.topicId);
    if (!topic) return null;
    const ids = new Set(topic.itemIds);
    const items = payload.items.filter(item => ids.has(item.id));
    return items.length ? { payload, topic, items } : null;
  }
  const ownsWebContents = wc => !!preview && !preview.isDestroyed() && wc === preview.webContents && preview.isVisible() && !!selected();
  const ownsItem = (wc, id) => ownsWebContents(wc) && selected().items.some(item => item.id === id);
  const hasFocus = () => !!preview && !preview.isDestroyed() && preview.isFocused() && !!selected();
  function hide() {
    active = null; request++; outsideSince = 0;
    if (preview && !preview.isDestroyed()) preview.hide();
  }
  function deliver() {
    const current = selected();
    if (!current) return hide();
    if (loaded && preview && !preview.isDestroyed() && !state.tearing) {
      preview.webContents.send('preview:content', {
        request: active.request, sourceKey: active.sourceKey, topic: current.topic,
        items: current.items, pinned: current.payload.pinned, settings: current.payload.settings,
      });
    }
  }
  function ensureWindow() {
    if (preview && !preview.isDestroyed()) return;
    loaded = false;
    const win = new BrowserWindow({
      title: '回看 · 主题原文', width: 320, height: 400, show: false, parent: panel,
      frame: false, ...glassWindowOptions(), resizable: false, movable: false,
      fullscreenable: false, skipTaskbar: true, alwaysOnTop: true, hasShadow: true,
      webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, accessibleTitle: '主题回看原文' },
    });
    preview = win;
    attachGlassMaterial(win);
    win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    win.webContents.on('will-navigate', event => event.preventDefault());
    if (process.platform !== 'win32') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    win.webContents.once('did-finish-load', () => { loaded = true; deliver(); });
    win.on('focus', () => { if (active) active.persistent = true; });
    win.on('blur', () => setImmediate(() => {
      if (state.tearing || panel.isDestroyed() || panel.isFocused() || hasFocus()) return;
      hide(); panel.hide();
    }));
    win.on('closed', () => { if (preview === win) { preview = null; loaded = false; active = null; } });
    if (process.platform === 'win32') {
      const dismiss = () => { if (typeof onDismiss === 'function') onDismiss(); else { hide(); if (!panel.isDestroyed()) panel.hide(); } };
      win.on('close', event => { if (!state.quitting) { event.preventDefault(); dismiss(); } });
      win.webContents.on('before-input-event', (event, input) => {
        if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); dismiss(); }
      });
    }
    win.loadFile(path.join(__dirname, 'panel', 'preview.html'));
  }
  function show(event, kind, id, row) {
    if (!mainFrame(event) || event.sender !== panel.webContents || !panel.isVisible() || state.tearing || kind !== 'topic') return;
    if (typeof id !== 'string' || !row || !Number.isFinite(row.top) || !Number.isFinite(row.height)) return;
    const bounds = panel.getContentBounds(), payload = data();
    if (row.height <= 0 || row.top + row.height < 0 || row.top > bounds.height || !payload?.topics?.some(topic => topic.id === id)) return;
    ensureWindow();
    active = { sourceKey: payload.sourceKey, topicId: id, request: ++request, row, persistent: row.persistent === true };
    outsideSince = 0; deliver();
  }
  function close(event) {
    if (!mainFrame(event)) return;
    if (event.sender === preview?.webContents) { hide(); if (panel.isVisible()) panel.focus(); }
    else if (event.sender === panel.webContents) hide();
  }
  function ready(event, token) {
    if (!mainFrame(event) || !active || token !== active.request || event.sender !== preview?.webContents) return;
    if (!selected()) return hide();
    if (state.tearing) return;
    const bounds = panel.getContentBounds(), area = screen.getDisplayMatching(bounds).workArea;
    const width = Math.min(320, area.width - 24), height = Math.min(400, area.height - 24), gap = 16;
    let x = bounds.x + bounds.width + gap;
    if (x + width > area.x + area.width - 12) x = bounds.x - width - gap;
    x = Math.min(Math.max(x, area.x + 12), area.x + area.width - width - 12);
    const middle = bounds.y + active.row.top + active.row.height / 2;
    const y = Math.min(Math.max(middle - height / 2, area.y + 12), area.y + area.height - height - 12);
    preview.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
    if (!active.presented) {
      active.presented = true;
      if (active.persistent) { preview.show(); preview.focus(); }
      else if (!preview.isVisible()) preview.showInactive();
    }
  }
  ipcMain.on('preview:show', show); ipcMain.on('preview:hide', close); ipcMain.on('preview:ready', ready);
  // The union includes the gap so moving between the two windows stays continuous.
  const hoverWatch = setInterval(() => {
    if (!active || active.persistent || state.tearing || !preview || preview.isDestroyed() || !preview.isVisible()) return;
    const a = panel.getBounds(), b = preview.getBounds(), cursor = screen.getCursorScreenPoint();
    const left = Math.min(a.x, b.x) - 4, top = Math.min(a.y, b.y) - 4;
    const right = Math.max(a.x + a.width, b.x + b.width) + 4, bottom = Math.max(a.y + a.height, b.y + b.height) + 4;
    if (cursor.x >= left && cursor.x <= right && cursor.y >= top && cursor.y <= bottom) outsideSince = 0;
    else if (!outsideSince) outsideSince = Date.now();
    else if (Date.now() - outsideSince > 200) hide();
  }, 80);
  hoverWatch.unref();
  panel.on('hide', hide); panel.on('move', hide);
  panel.once('closed', () => {
    clearInterval(hoverWatch); hide();
    ipcMain.removeListener('preview:show', show); ipcMain.removeListener('preview:hide', close); ipcMain.removeListener('preview:ready', ready);
    if (preview && !preview.isDestroyed()) preview.destroy();
  });
  return { ownsWebContents, ownsItem, hasFocus, hide, refresh: () => { if (active) deliver(); } };
}
module.exports = { attach };
