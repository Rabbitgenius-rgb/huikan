'use strict';
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, globalShortcut, nativeTheme, shell } = require('electron');
const path = require('path');
const os = require('os');
const { createRecallService } = require('./recall-service.cjs');
const { startPrivateServer, callPrivate } = require('./transport');
app.setName('梦藏回看候选');
const candidateRoot = path.resolve(__dirname, '../..');
let candidateConfig = {};
try { candidateConfig = require('../candidate-config.json'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const userData = process.env.MENGCANG_RECALL_USER_DATA || candidateConfig.userDataPath || (app.isPackaged ? app.getPath('userData') : path.join(candidateRoot, 'runtime/sticky-user'));
const bridgeDirectory = process.env.MENGCANG_RECALL_BRIDGE_DIR || candidateConfig.bridgeDirectory || (app.isPackaged ? path.join(os.homedir(), 'Library/Application Support/Mengcang Recall/bridge') : path.join(candidateRoot, 'runtime/bridge'));
if (!path.isAbsolute(userData) || !path.isAbsolute(bridgeDirectory)) throw Error('回看数据路径必须是绝对路径');
app.setPath('userData', userData);
const diagnosticEnabled = process.env.MENGCANG_RECALL_DIAGNOSTICS === '1';
const diagnostics = require('./window-diagnostics.cjs').createWindowDiagnostics({ enabled: diagnosticEnabled, userData, app, BrowserWindow });
let bridge, refreshTimer, quitAllowed = false;
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
if(process.send){process.on('message',value=>{if(value?.type==='huikan-quit')app.quit();});process.once('disconnect',()=>app.quit());}
const { state, PRELOAD, pinnedIds } = require('./state');
const settings = require('./settings');
const stickies = require('./stickies');
const { stickyItem } = require('./sticky-title.cjs');
const panelPreview = require('./panel-preview');
const { createTopicOrganizer } = require('./topic-organizer.cjs');
const { nativeState, launchNativeFrontend } = require('./native-frontend.cjs');
const configuredNative = process.env.MENGCANG_RECALL_NATIVE_UI || candidateConfig.nativeUIPath;
const nativeUIPath = configuredNative ? (path.isAbsolute(configuredNative) ? configuredNative : path.join(process.resourcesPath, configuredNative)) : null;
let nativeFrontend, topicOrganizer, appearance;

const PANEL_W = 320;
const PANEL_H = 400;

function trayIcon() {
  // Tiny diamond drawn as a template image so macOS tints it for light/dark menu bars.
  const size = 18;
  const buf = Buffer.alloc(size * size * 4, 0);
  const c = (size - 1) / 2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const d = Math.abs(x - c) / 7.5 + Math.abs(y - c) / 7.5;
      if (d <= 1) {
        const i = (y * size + x) * 4;
        buf[i + 3] = d > 0.82 ? 255 : 150;
      }
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: size, height: size });
  img.setTemplateImage(true);
  return img;
}

function createPanel() {
  const win = new BrowserWindow({
    title: '梦藏 · 对话回看浮窗',
    width: PANEL_W,
    height: PANEL_H,
    show: false,
    frame: false,
    transparent: true,
    backgroundColor: '#00000000',
    // Native behind-window blur: CSS backdrop-filter cannot sample the desktop.
    ...(process.platform === 'darwin' ? {
      vibrancy: 'menu',
      visualEffectState: 'active',
      roundedCorners: true,
    } : {}),
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, accessibleTitle: '梦藏对话回看条目' },
  });
  win.accessibleTitle = '梦藏 · 对话回看浮窗';
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  protectWindow(win);
  win.loadFile(path.join(__dirname, 'panel', 'index.html'));
  // Hide on blur, except while a tear-off drag is in progress.
  win.on('blur', () => {
    if (!state.tearing && !win.webContents.isDevToolsOpened()) { diagnostics.record('panel.blur.hide', win); win.hide(); }
    else diagnostics.record('panel.blur.keep', win);
  });
  return win;
}

function togglePanel() {
  if (nativeUIPath) { nativeFrontend?.show(); return; }
  const win = state.panel;
  diagnostics.record('panel.toggle', win);
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) {
    win.hide();
    return;
  }
  showPanel();
}

// Opening or reactivating the app is idempotent. Only an explicit tray/shortcut
// toggle hides the panel; macOS activation must never toggle it back off.
function showPanel() {
  if (nativeUIPath) { nativeFrontend?.show(); return; }
  const win = state.panel;
  diagnostics.record('panel.open.request', win);
  if (!win || win.isDestroyed() || state.quitting) return;
  const tb = state.tray.getBounds();
  const display = screen.getDisplayNearestPoint({ x: tb.x, y: tb.y });
  const area = display.workArea;
  const x = Math.min(Math.max(Math.round(tb.x + tb.width / 2 - PANEL_W / 2), area.x + 8), area.x + area.width - PANEL_W - 8);
  const y = Math.round(tb.y + tb.height + 6);
  diagnostics.geometry('panel.position', win, tb, area, { x, y, width: PANEL_W, height: PANEL_H });
  win.setPosition(x, y, false);
  win.show();
  diagnostics.record('panel.open.shown', win);
  if (process.platform === 'darwin') app.focus({ steal: true });
  diagnostics.record('panel.open.app-focused', win);
  win.focus();
  diagnostics.record('panel.open.window-focused', win);
  win.webContents.send('pinned:change', pinnedIds());
}

function buildTrayMenu() {
  return Menu.buildFromTemplate([
    { label: '打开回看浮窗', accelerator: 'CommandOrControl+Shift+K', click: showPanel },
    { type: 'separator' },
    { label: state.stickiesHidden ? '显示所有便签' : '隐藏所有便签', click: () => { stickies.setAllHidden(!state.stickiesHidden); } },
    { type: 'separator' },
    { label: '外观：自动（电池/减弱动态时用 2D）', type: 'radio', checked: state.mode === 'auto', click: () => settings.setMode('auto') },
    { label: '外观：始终 3D', type: 'radio', checked: state.mode === '3d', click: () => settings.setMode('3d') },
    { label: '外观：始终 2D（节能）', type: 'radio', checked: state.mode === '2d', click: () => settings.setMode('2d') },
    { type: 'separator' },
    { label: '退出', role: 'quit' },
  ]);
}

function trusted(event, wc) {
  return event.sender === wc && (!event.senderFrame || event.senderFrame === wc.mainFrame);
}
function protectWindow(win) {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.webContents.session.setPermissionRequestHandler((_wc, _permission, cb) => cb(false));
}
function trustedApp(event) {
  const wc = event.sender;
  return trusted(event, wc) && (wc === state.panel?.webContents || state.byWc.has(wc.id));
}
function payload() {
  return { conversation: state.conversation, items: state.items, pinned: pinnedIds(), settings: settings.current(), mode: state.mode, inputDiagnostics: diagnosticEnabled, ...state.snapshot };
}
function safeReply(fn) {
  return async (...args) => { try { return { ok: true, data: await fn(...args) }; } catch (e) { return { ok: false, error: { code: e.code || 'REQUEST_FAILED', message: String(e.message || '操作未完成').slice(0, 500) } }; } };
}
function publishNative() {
  if (topicOrganizer && state.service) {
    const value = {...nativeState(state.service.snapshot(), topicOrganizer.snapshot()), appearance:appearance?.get()};
    nativeFrontend?.update(value);
    stickies.syncItems();
  }
}
async function revealItem(id) {
  if (!state.service.getItem(id)) throw Error('找不到回看条目');
  // Bring the installed host forward before asking its browser client to poll.
  // macOS may throttle the client's timers while another app owns focus.
  if (candidateConfig.harnessAppPath) {
    const error = await shell.openPath(candidateConfig.harnessAppPath);
    if (error) throw Error('未能打开 Harness，请先打开后重试');
  }
  return state.service.requestNavigation(id);
}
async function nativeAction(action) {
  const name = action.action;
  if (name === 'frame') {
    if (![action.x, action.y, action.width, action.height].every(Number.isFinite) || action.width !== 320 || action.height !== 400 || Math.abs(action.x) > 1e7 || Math.abs(action.y) > 1e7) throw Error('浮窗位置无效');
    state.panel.setBounds({ x: Math.round(action.x), y: Math.round(action.y), width: 320, height: 400 }); return;
  }
  if (name === 'tear:move') { stickies.moveTear(action.x, action.y); return; }
  if (name === 'tear:end') { stickies.endTear(); return; }
  const snapshot = state.service.snapshot();
  if (action.sourceKey !== nativeState(snapshot, topicOrganizer.snapshot()).sourceKey) throw Error('当前对话已经切换，请重新选择内容');
  if (name === 'read') {
    if (!Array.isArray(action.ids) || !action.ids.length || action.ids.some(id => !snapshot.items.some(item => item.id === id))) throw Error('阅读条目不属于当前对话');
    return state.service.markRead(action.ids);
  }
  if (['reveal', 'pin', 'tear:start'].includes(name)) {
    if (typeof action.id !== 'string' || !snapshot.items.some(item => item.id === action.id)) throw Error('条目不属于当前对话');
    if (name === 'reveal') return revealItem(action.id);
    const result = name === 'pin' ? await stickies.pinItem(action.id) : stickies.beginTear(action.id, { x: action.x, y: action.y });
    if (!result.ok) throw Error(result.reason === 'limit' ? '最多同时贴5个便签' : result.reason === 'already-pinned' ? '这段内容已经贴出' : '便签暂未贴出，请重试');
    return result;
  }
  if (name === 'topics:retry') { topicOrganizer.retry(); return; }
  if (name === 'toggleNotes') { if (typeof action.hidden !== 'boolean') throw Error('便签状态无效'); stickies.setAllHidden(action.hidden); return; }
  if (name === 'mode') { if (!['auto', '2d', '3d'].includes(action.mode)) throw Error('外观无效'); settings.setMode(action.mode); return; }
  if (name === 'retry') { if (!snapshot.pending.some(x => x.requestId === action.id)) throw Error('找不到待保存内容'); return state.service.retry(action.id); }
  throw Error('不支持的浮窗操作');
}

if (primary) app.whenReady().then(async () => {
  nativeTheme.themeSource = 'light';
  if (process.platform === 'darwin') app.dock.hide();
  appearance = await require('./appearance.cjs').createAppearance({userData,onChange:()=>{settings.broadcast(true);publishNative();}});
  settings.setAppearanceProvider(()=>appearance.get());
  state.service = await createRecallService({ userData, callDream: (method, params) => callPrivate({ directory: bridgeDirectory, service: 'mengcang', method, params, timeoutMs: 15000 }), onContext: diagnostics.context });
  state.mode = state.service.snapshot().mode;
  if (nativeUIPath) topicOrganizer = await createTopicOrganizer({ userData,
    generate: request => callPrivate({ directory: bridgeDirectory, service: 'harness-topics', method: 'generate', params: request, timeoutMs: 65000 }),
    onChange: publishNative,
  });
  let lastPayload = '';
  const update = snap => {
    state.snapshot = snap;
    state.items = snap.items;
    state.conversation = { title: snap.active?.sessionTitle || (snap.active?.sessionId ? '未命名对话' : '等待 Harness 对话'), turns: 0, outline: [] };
    if (topicOrganizer) { topicOrganizer.update(snap); publishNative(); }
    const next = JSON.stringify(payload());
    if (next !== lastPayload) {
      lastPayload = next;
      state.panel?.webContents.send('data:changed', payload());
    }
    stickies.syncItems();
  };
  state.service.events.on('change', update);
  update(state.service.snapshot());
  if (!nativeUIPath) {
  state.tray = new Tray(trayIcon());
  state.tray.setToolTip('梦藏 · 对话回看');
  if (process.platform === 'darwin') state.tray.setTitle('回看');
  state.tray.on('click', togglePanel);
  state.tray.on('right-click', () => state.tray.popUpContextMenu(buildTrayMenu()));
  }
  state.panel = createPanel();
  app.on('activate', showPanel);
  panelPreview.attach(state.panel, ipcMain);
  ipcMain.handle('data:get', event => trustedApp(event) ? payload() : null);
  if (diagnosticEnabled) ipcMain.on('diagnostic:input', (event, value) => { if (trusted(event, state.panel.webContents)) diagnostics.input(state.panel, value); });
  ipcMain.on('mode:set', (event, mode) => { if (trustedApp(event)) settings.setMode(mode); });
  ipcMain.handle('recall:retry', safeReply((event, id) => {
    if (!trusted(event, state.panel.webContents)) throw Error('此窗口不能重试收藏');
    return state.service.retry(id);
  }));
  ipcMain.handle('recall:refresh', safeReply(event => {
    if (!trustedApp(event)) throw Error('此窗口不能读取收藏');
    return state.service.refresh();
  }));
  ipcMain.handle('recall:reveal', safeReply((event, id) => {
    if (!trustedApp(event) || (event.sender !== state.panel.webContents && state.byWc.get(event.sender.id)?.id !== id)) throw Error('此窗口不能定位该条目');
    return revealItem(id);
  }));
  ipcMain.handle('review:set', safeReply((event, id, due) => {
    if (!trustedApp(event) || (event.sender !== state.panel.webContents && state.byWc.get(event.sender.id)?.id !== id)) throw Error('此窗口不能更改该条目');
    return state.service.setReview(id, due);
  }));
  ipcMain.handle('link:open', safeReply(async (event, value) => {
    if (!trustedApp(event) || typeof value !== 'string' || value.length > 8192) throw Error('链接无效');
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('仅支持安全网页链接');
    await shell.openExternal(url.href); return true;
  }));
  stickies.wire(ipcMain, { protectWindow, decorateItem: (item, previous) => stickyItem(item, topicOrganizer?.snapshot().topics || [], previous) });
  await state.service.refresh();
  await stickies.restore();
  settings.start();
  bridge = await startPrivateServer({ directory: bridgeDirectory, service: 'sticky', handlers: {...state.service.handlers,appearanceGet:()=>appearance.get(),appearanceSet:value=>appearance.set(value),appearanceShow:()=>{showPanel();return {shown:true};}} });
  refreshTimer = setInterval(() => { void state.service.refresh(); update(state.service.snapshot()); }, 4000);
  refreshTimer.unref();
  if (nativeUIPath) {
    nativeFrontend = launchNativeFrontend({ appPath: nativeUIPath, onAction: nativeAction, onExit: () => { if (!state.quitting) app.quit(); } });
    publishNative();
  } else globalShortcut.register('CommandOrControl+Shift+K', togglePanel);
  app.on('second-instance', showPanel);
  if (process.argv.includes('--show-panel')) {
    if (!state.panel.webContents.isLoading()) showPanel();
    else state.panel.once('ready-to-show', showPanel);
  }
  console.log(nativeUIPath ? 'Recall companion ready with native UI and cached Harness model topics.' : 'Recall companion ready.');
}).catch(error => { console.error('Recall startup failed:', error.code || 'STARTUP_FAILED', error.message); quitAllowed = true; app.quit(); });

app.on('before-quit', event => {
  if (quitAllowed || !state.service) return;
  event.preventDefault();
  if (state.quitting) return;
  state.quitting = true;
  void (async () => {
    await stickies.persistAll();
    await appearance?.close();
    clearInterval(refreshTimer);
    nativeFrontend?.close();
    await bridge?.close();
    await topicOrganizer?.close();
    await state.service.close();
    quitAllowed = true; app.quit();
  })().catch(error => { state.quitting = false; console.error('Recall state not saved:', error.code || 'SAVE_FAILED'); });
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', event => event.preventDefault());
