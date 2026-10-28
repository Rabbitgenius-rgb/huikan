'use strict';
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { state, PRELOAD } = require('./state');

// A separate, non-interactive window lets the excerpt sit outside native glass.
function attach(panel, ipcMain) {
  let preview = null;
  let loaded = false;
  let request = 0;
  let active = null;
  const hide = () => {
    active = null;
    request++;
    if (preview && !preview.isDestroyed()) preview.hide();
  };
  const deliver = () => {
    if (active && loaded && panel.isVisible() && !state.tearing) {
      preview.webContents.send('preview:content', active);
    }
  };
  function ensureWindow() {
    if (preview && !preview.isDestroyed()) return;
    loaded = false;
    preview = new BrowserWindow({
      title: '梦藏 · 回看原文预览',
      width: 330, height: 400, show: false, parent: panel,
      frame: false, transparent: true, backgroundColor: '#00000000',
      ...(process.platform === 'darwin' ? {
        vibrancy: 'menu', visualEffectState: 'active', roundedCorners: true,
      } : {}),
      resizable: false, movable: false, focusable: false,
      fullscreenable: false, skipTaskbar: true, alwaysOnTop: true,
      hasShadow: true,
      webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, accessibleTitle: '回看原文预览内容' },
    });
    preview.accessibleTitle = '梦藏 · 回看原文预览';
    preview.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    preview.webContents.on('will-navigate', event => event.preventDefault());
    preview.setIgnoreMouseEvents(true);
    if (process.platform !== 'win32') preview.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    preview.loadFile(path.join(__dirname, 'panel', 'preview.html'));
    preview.webContents.once('did-finish-load', () => { loaded = true; deliver(); });
  }
  ipcMain.on('preview:show', (event, kind, id, row) => {
    if (event.sender !== panel.webContents || !panel.isVisible() || state.tearing) return;
    const item = kind === 'recall' ? state.items.find(item => item.id === id) : null;
    if (!item || !row || !Number.isFinite(row.top) || !Number.isFinite(row.height)) return;
    const bounds = panel.getContentBounds();
    if (row.top + row.height < 0 || row.top > bounds.height) return;
    ensureWindow();
    active = { request: ++request, kind, item: { ...item, pinned: state.stickies.has(item.id) }, row };
    deliver();
  });
  ipcMain.on('preview:hide', event => {
    if (event.sender === panel.webContents) hide();
  });
  ipcMain.on('preview:ready', (event, token, measuredHeight) => {
    if (!active || token !== active.request || event.sender !== preview?.webContents || !Number.isFinite(measuredHeight)) return;
    if (!panel.isVisible() || state.tearing) return hide();
    const bounds = panel.getContentBounds();
    const area = screen.getDisplayMatching(bounds).workArea;
    const width = Math.min(330, area.width - 24);
    const height = Math.min(Math.max(120, Math.ceil(measuredHeight)), area.height - 24);
    const gap = 16;
    let x = bounds.x + bounds.width + gap;
    if (x + width > area.x + area.width - 12) x = bounds.x - width - gap;
    x = Math.min(Math.max(x, area.x + 12), area.x + area.width - width - 12);
    const middle = bounds.y + active.row.top + active.row.height / 2;
    const y = Math.min(Math.max(middle - height / 2, area.y + 12), area.y + area.height - height - 12);
    preview.setBounds({ x: Math.round(x), y: Math.round(y), width, height });
    preview.showInactive();
  });
  panel.on('hide', hide);
  panel.on('blur', hide);
  panel.on('move', hide);
  panel.on('closed', () => { hide(); if (preview && !preview.isDestroyed()) preview.destroy(); });
}

module.exports = { attach };
