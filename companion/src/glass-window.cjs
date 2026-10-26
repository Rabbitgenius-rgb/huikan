'use strict';
const { BrowserWindow, ipcMain, screen, Menu, nativeTheme } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { GlassModel } = require('./glass-model.cjs');

function createGlassWindow({ userData, reveal, openRecall }) {
  const model = new GlassModel(), pending = [];
  const positionFile = path.join(userData, 'glass-window.json');
  let width = 88;
  let ready = false, stopped = false, hidden = false, height = 88, drag = null, preparedDrag = null, lastPayload = '', orbX = 44;
  const area = screen.getPrimaryDisplay().workArea;
  let saved;
  try { saved = JSON.parse(fs.readFileSync(positionFile, 'utf8')); } catch {}
  const initial = saved && Number.isFinite(saved.anchorX) && Number.isFinite(saved.y) ? saved : { anchorX: area.x + area.width - 60, y: area.y + 24 };
  function fit(anchorX, y, h) {
    const a = screen.getDisplayNearestPoint({ x: Math.round(anchorX), y: Math.round(y + 44) }).workArea;
    anchorX = Math.max(a.x + 44, Math.min(anchorX, a.x + a.width - 44));
    const nextX = width === 88 || anchorX - a.x < width - 44 ? 44 : 336;
    if (orbX !== nextX) { orbX = nextX; if (ready) win.webContents.send('glass:placement', orbX); }
    return { x: Math.round(anchorX - orbX), y: Math.round(Math.max(a.y, Math.min(y, a.y + a.height - h))), width, height: h };
  }
  const win = new BrowserWindow({ ...fit(initial.anchorX, initial.y, height), title: '梦藏 · 玻璃珠收藏', show: false, frame: false, transparent: true,
    backgroundColor: '#00000000', hasShadow: false, resizable: false, movable: true, fullscreenable: false, skipTaskbar: true, alwaysOnTop: true,
    webPreferences: { preload: path.join(__dirname, 'glass/preload.cjs'), contextIsolation: true, sandbox: true, backgroundThrottling: true, spellcheck: false } });
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  // Keep the native window as narrow as its visible beads. Pointer delivery
  // must not depend on a timer toggling ignoreMouseEvents before mouse-down.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadFile(path.join(__dirname, 'glass/index.html'));
  const trusted = e => e.sender === win.webContents && (!e.senderFrame || e.senderFrame === win.webContents.mainFrame);
  const send = (channel, value) => { if (ready && !win.isDestroyed()) win.webContents.send(channel, value); };
  function savePosition() {
    if (win.isDestroyed()) return;
    const { x, y } = win.getBounds();
    try { fs.writeFileSync(positionFile, JSON.stringify({ anchorX: x + orbX, y }), { mode: 0o600 }); } catch {}
  }
  function show() { hidden = false; if (!win.isDestroyed()) win.showInactive(); }
  win.on('moved', savePosition);
  function publish() {
    if (!ready || !model.value) return;
    const payload = JSON.stringify(model.value);
    if (payload !== lastPayload) { lastPayload = payload; send('glass:state', model.value); }
    if (!hidden) show();
  }
  function message(e, value) {
    if (!trusted(e) || !value || typeof value.type !== 'string') return;
    if (value.type === 'ready') {
      ready = true; lastPayload = ''; send('glass:placement', orbX); publish(); send('glass:motion', nativeTheme.shouldUseReducedMotion);
      for (const event of pending.splice(0)) if (event.sourceKey === model.value?.sourceKey) send('glass:collect', event);
    } else if (value.type === 'height' && Number.isFinite(value.height)) {
      const b = win.getBounds(), anchorX = b.x + orbX;
      width = value.width === 380 ? 380 : 88;
      height = Math.max(88, Math.min(560, Math.round(value.height)));
      win.setBounds(fit(anchorX, b.y, height));
    } else if (value.type === 'drag:prepare') {
      preparedDrag = { bounds: win.getBounds(), orbX };
    } else if (value.type === 'drag:move' && preparedDrag && [value.dx, value.dy].every(n => Number.isFinite(n) && Math.abs(n) < 1e7)) {
      drag = preparedDrag;
      win.setBounds(fit(drag.bounds.x + drag.orbX + value.dx, drag.bounds.y + value.dy, height));
    }
    else if (value.type === 'drag:end') {
      drag = preparedDrag = null; savePosition();
    }
    else if (value.type === 'menu') {
      Menu.buildFromTemplate([
        { label: '打开回看', click: openRecall },
        { label: '隐藏玻璃珠', click: () => { hidden = true; win.hide(); } },
      ]).popup({ window: win });
    }
  }
  async function onReveal(e, value) {
    if (!trusted(e) || !model.owns(value)) return { ok: false, message: '对话已经切换，请重新打开笔记' };
    try { await reveal(value.id); return { ok: true }; }
    catch { return { ok: false, message: '暂时无法回到原文，请打开 Harness 后重试' }; }
  }
  ipcMain.on('glass:ui', message); ipcMain.handle('glass:reveal', onReveal);
  const motion = () => send('glass:motion', nativeTheme.shouldUseReducedMotion);
  nativeTheme.on('updated', motion);
  const displays = () => { const b = win.getBounds(); win.setBounds(fit(b.x + orbX, b.y, height)); };
  screen.on('display-metrics-changed', displays); screen.on('display-removed', displays);
  win.on('close', e => { if (!stopped) { e.preventDefault(); hidden = true; win.hide(); } });
  return {
    update(value) { if (model.update(value)) publish(); },
    collect(value) { const event = model.collect(value); if (!event) return false; show(); if (ready) send('glass:collect', event); else pending.push(event); return true; },
    show,
    close() { stopped = true; savePosition(); nativeTheme.off('updated', motion); screen.off('display-metrics-changed', displays); screen.off('display-removed', displays); ipcMain.removeListener('glass:ui', message); ipcMain.removeHandler('glass:reveal'); if (!win.isDestroyed()) win.destroy(); },
    window: win,
  };
}
module.exports = { createGlassWindow };
