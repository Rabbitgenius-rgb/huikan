'use strict';
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, screen, globalShortcut, nativeTheme, shell, dialog } = require('electron');
const path = require('path');
const os = require('os');
const { createRecallService } = require('./recall-service.cjs');
const { panelPosition } = require('./panel-position.cjs');
const { glassWindowOptions, attachGlassMaterial } = require('./window-material.cjs');
const { startPrivateServer, callPrivate } = require('./transport');
app.setName('梦藏回看候选');
const candidateRoot = path.resolve(__dirname, '../..');
let candidateConfig = {};
try { candidateConfig = require('../candidate-config.json'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; }
const userData = process.env.MENGCANG_RECALL_USER_DATA || candidateConfig.userDataPath || (app.isPackaged ? app.getPath('userData') : path.join(candidateRoot, 'runtime/sticky-user'));
const bridgeDirectory = process.env.MENGCANG_RECALL_BRIDGE_DIR || candidateConfig.bridgeDirectory || (app.isPackaged ? (process.platform === 'darwin' ? path.join(os.homedir(), 'Library/Application Support/Mengcang Recall/bridge') : path.join(app.getPath('userData'), 'bridge')) : path.join(candidateRoot, 'runtime/bridge'));
if (!path.isAbsolute(userData) || !path.isAbsolute(bridgeDirectory)) throw Error('回看数据路径必须是绝对路径');
app.setPath('userData', userData);
const diagnosticEnabled = process.env.MENGCANG_RECALL_DIAGNOSTICS === '1';
const diagnostics = require('./window-diagnostics.cjs').createWindowDiagnostics({ enabled: diagnosticEnabled, userData, app, BrowserWindow });
let bridge, refreshTimer, quitAllowed = false;
const primary = app.requestSingleInstanceLock();
if (!primary) app.quit();
if(process.send){process.on('message',value=>{if(value?.type==='huikan-quit')app.quit();else if(value?.type==='huikan-workbench-hidden')notifyWorkbenchHidden();});process.once('disconnect',()=>app.quit());}
const { state, PRELOAD, pinnedIds } = require('./state');
const settings = require('./settings');
const stickies = require('./stickies');
const { stickyItem } = require('./sticky-title.cjs');
const panelPreview = require('./panel-preview');
const { createTopicOrganizer } = require('./topic-organizer.cjs');
const { topicPresentation, createTopicOrganizationRequest } = require('./topic-presentation.cjs');
const { nativeState, launchNativeFrontend } = require('./native-frontend.cjs');
const configuredNative = process.env.MENGCANG_RECALL_NATIVE_UI || candidateConfig.nativeUIPath;
const nativeUIPath = configuredNative ? (path.isAbsolute(configuredNative) ? configuredNative : path.join(process.resourcesPath, configuredNative)) : null;
let nativeFrontend, topicOrganizer, appearance, topicPreviewController, recallShortcut;
let lastPayload = '', topicDialogOpen = false, hiddenHintRequested = false, hiddenHintShown = false;

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
        // An outlined white diamond stays visible on both light and dark
        // Windows taskbars; macOS continues to tint its template image.
        if (process.platform === 'win32' && d < 0.78) buf[i] = buf[i + 1] = buf[i + 2] = 255;
        buf[i + 3] = process.platform === 'win32' ? 255 : d > 0.82 ? 255 : 150;
      }
    }
  }
  const img = nativeImage.createFromBitmap(buf, { width: size, height: size });
  if (process.platform === 'darwin') img.setTemplateImage(true);
  return img;
}

function createPanel() {
  const win = new BrowserWindow({
    title: '梦藏 · 对话回看浮窗',
    width: PANEL_W,
    height: PANEL_H,
    show: false,
    frame: false,
    ...glassWindowOptions(),
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    hasShadow: true,
    webPreferences: { preload: PRELOAD, contextIsolation: true, sandbox: true, accessibleTitle: '梦藏对话回看条目' },
  });
  win.accessibleTitle = '梦藏 · 对话回看浮窗';
  attachGlassMaterial(win);
  if (process.platform !== 'win32') win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  protectWindow(win);
  win.loadFile(path.join(__dirname, 'panel', 'index.html'));
  // Hide on blur, except while a tear-off drag is in progress.
  win.on('blur', () => {
    // Native focus moves between the home and topic windows in two events.
    // Let the receiving window become focused before deciding to dismiss both.
    setImmediate(() => {
      if (win.isDestroyed() || win.isFocused()) return;
      if (!state.tearing && !topicDialogOpen && !topicPreviewController?.hasFocus?.() && !win.webContents.isDevToolsOpened()) { diagnostics.record('panel.blur.hide', win); win.hide(); }
      else diagnostics.record('panel.blur.keep', win);
    });
  });
  if (process.platform === 'win32') {
    win.on('close', event => { if (!state.quitting) { event.preventDefault(); hidePanel(); } });
    win.webContents.on('before-input-event', (event, input) => {
      if (input.type === 'keyDown' && input.key === 'Escape') { event.preventDefault(); hidePanel(); }
    });
  }
  return win;
}

function hidePanel() {
  if (state.quitting) return;
  if (state.tearing) stickies.endTear();
  topicPreviewController?.hide?.();
  if (state.panel && !state.panel.isDestroyed()) state.panel.hide();
}

function togglePanel() {
  if (state.quitting) return;
  if (nativeUIPath) { nativeFrontend?.show(); return; }
  const win = state.panel;
  diagnostics.record('panel.toggle', win);
  if (!win || win.isDestroyed()) return;
  if (win.isVisible()) {
    hidePanel();
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
  const { x, y } = panelPosition(tb, area, PANEL_W, PANEL_H);
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

function managedByWorkbench() { return process.platform === 'win32' && typeof process.send === 'function' && process.connected !== false; }
function sendWorkbench(type) {
  try { process.send({ type }, error => { if (error) app.quit(); }); }
  catch { app.quit(); }
}
function requestQuit() { if (managedByWorkbench()) sendWorkbench('huikan-request-quit'); else app.quit(); }
function notifyTrayReady() {
  if (!managedByWorkbench() || !bridge || !state.tray || state.tray.isDestroyed() || !state.panel || state.panel.isDestroyed() || state.quitting) return;
  const notify = () => {
    if (!state.tray.isDestroyed() && !state.panel.isDestroyed() && !state.panel.webContents.isLoading() && !state.quitting) sendWorkbench('huikan-tray-ready');
  };
  if (state.panel.webContents.isLoading()) state.panel.webContents.once('did-finish-load', notify);
  else notify();
}
function notifyWorkbenchHidden() {
  if (process.platform !== 'win32' || hiddenHintShown) return;
  if (!state.tray || !recallShortcut) { hiddenHintRequested = true; return; }
  hiddenHintRequested = false; hiddenHintShown = true;
  const shortcut = recallShortcut.status();
  try { state.tray.displayBalloon({ iconType: 'info', title: '回看仍在后台运行', respectQuietTime: true,
    content: shortcut.registered ? `点击托盘图标或按 ${shortcut.label} 打开回看。右键图标可打开工作台、更改快捷键或退出。`
      : '点击托盘图标打开回看。快捷键暂未启用，可右键图标选择其他组合；“退出回看”会结束后台连接。' }); } catch { /* Windows may suppress notifications; the tray and menu remain available. */ }
}
function updateTrayTooltip() {
  const shortcut = recallShortcut?.status();
  state.tray?.setToolTip(shortcut ? `回看 · 对话摘录\n${shortcut.registered ? shortcut.label : '快捷键未启用，请右键设置'}` : '梦藏 · 对话回看');
}
async function changeRecallShortcut(accelerator) {
  try {
    const result = await recallShortcut.select(accelerator); updateTrayTooltip();
    if (result.error) await dialog.showMessageBox({ type: 'warning', title: '快捷键未更改', message: result.error, buttons: ['知道了'], noLink: true });
  } catch (error) {
    await dialog.showMessageBox({ type: 'warning', title: '快捷键未更改', message: error.message, buttons: ['知道了'], noLink: true }).catch(() => {});
  }
}
function buildTrayMenu() {
  const shortcut = recallShortcut?.status();
  return Menu.buildFromTemplate([
    { label: '打开回看浮窗', ...(shortcut?.registered ? { accelerator: shortcut.accelerator } : !shortcut ? { accelerator: 'CommandOrControl+Shift+K' } : {}), click: showPanel },
    ...(managedByWorkbench() ? [{ label: '打开回看工作台', click: () => sendWorkbench('huikan-open-workbench') }] : []),
    ...(recallShortcut ? [{ label: '唤出快捷键', submenu: [
      ...recallShortcut.choices.map(choice => ({ label: choice.label, type: 'radio', checked: shortcut.registered && choice.accelerator === shortcut.accelerator, click: () => { void changeRecallShortcut(choice.accelerator); } })),
      ...(shortcut.error ? [{ type: 'separator' }, { label: shortcut.registered ? '上次更改未完成，保留原快捷键' : '快捷键未启用，请选择其他组合', enabled: false }] : []),
    ] }] : []),
    { type: 'separator' },
    { label: state.stickiesHidden ? '显示所有便签' : '隐藏所有便签', click: () => { stickies.setAllHidden(!state.stickiesHidden); } },
    { type: 'separator' },
    { label: '外观：自动（电池/减弱动态时用 2D）', type: 'radio', checked: state.mode === 'auto', click: () => settings.setMode('auto') },
    { label: '外观：始终 3D', type: 'radio', checked: state.mode === '3d', click: () => settings.setMode('3d') },
    { label: '外观：始终 2D（节能）', type: 'radio', checked: state.mode === '2d', click: () => settings.setMode('2d') },
    { type: 'separator' },
    process.platform === 'win32' ? { label: '退出回看', click: requestQuit } : { label: '退出', role: 'quit' },
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
  return trusted(event, wc) && (wc === state.panel?.webContents || state.byWc.has(wc.id) || topicPreviewController?.ownsWebContents?.(wc));
}
function trustedPanelSender(event, id) {
  const wc = event.sender;
  if (!trusted(event, wc)) return false;
  if (wc === state.panel?.webContents) return id === undefined || (typeof id === 'string' && state.items.some(item => item.id === id));
  if (id === undefined) return Boolean(topicPreviewController?.ownsWebContents?.(wc));
  return typeof id === 'string' && Boolean(topicPreviewController?.ownsItem?.(wc, id));
}
function payload() {
  const snapshot = state.snapshot || state.service.snapshot();
  return { conversation: state.conversation, items: state.items, pinned: pinnedIds(), settings: settings.current(), mode: state.mode, inputDiagnostics: diagnosticEnabled, ...snapshot, ...topicPresentation(snapshot, topicOrganizer?.snapshot()) };
}
function safeReply(fn) {
  return async (...args) => { try { return { ok: true, data: await fn(...args) }; } catch (e) { return { ok: false, error: { code: e.code || 'REQUEST_FAILED', message: String(e.message || '操作未完成').slice(0, 500) } }; } };
}
function publishNative() {
  if (topicOrganizer && state.service) {
    const value = {...nativeState(state.service.snapshot(), topicOrganizer.snapshot()), appearance:appearance?.get()};
    nativeFrontend?.update(value);
    const nextPayload = payload(), next = JSON.stringify(nextPayload);
    if (next !== lastPayload) {
      lastPayload = next;
      state.panel?.webContents.send('data:changed', nextPayload);
      topicPreviewController?.refresh?.();
    }
    stickies.syncItems();
  }
}
function generateHarnessTopics(request) {
  if (/^codex:[a-f0-9]{24}$/.test(request.instanceId)) throw Error('Codex 摘录暂不使用 Harness 模型整理主题，请使用自定主题');
  return callPrivate({ directory: bridgeDirectory, service: 'harness-topics', method: 'generate', params: request, timeoutMs: 65000 });
}

async function revealItem(id) {
  const item = state.service.getItem(id);
  if (!item) throw Error('找不到回看条目');
  if (item.externalSource.provider === 'codex') {
    const threadId = require('./recall-service.cjs').codexThreadId(item.externalSource.sessionId);
    await shell.openExternal(`codex://threads/${encodeURIComponent(threadId)}`);
    return { ok: true, target: 'thread', precise: false };
  }
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
  if (name === 'topics:retry') { if (snapshot.active?.provider === 'codex') throw Error('Codex 摘录暂不使用 Harness 模型整理主题，请使用自定主题'); topicOrganizer.retry(); return; }
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
  topicOrganizer = await createTopicOrganizer({ userData, automatic: Boolean(nativeUIPath),
    generate: generateHarnessTopics,
    onChange: publishNative,
  });
  const update = snap => {
    state.snapshot = snap;
    state.items = snap.items;
    state.conversation = { title: snap.active?.sessionTitle || (snap.active?.sessionId ? '未命名对话' : '等待 AI 对话'), turns: 0, outline: [] };
    topicOrganizer.update(snap); publishNative();
  };
  state.service.events.on('change', update);
  update(state.service.snapshot());
  if (!nativeUIPath) {
  state.tray = new Tray(trayIcon());
  updateTrayTooltip();
  if (process.platform === 'darwin') state.tray.setTitle('回看');
  state.tray.on('click', togglePanel);
  state.tray.on('right-click', () => state.tray.popUpContextMenu(buildTrayMenu()));
  }
  state.panel = createPanel();
  app.on('activate', showPanel);
  topicPreviewController = panelPreview.attach(state.panel, ipcMain, { getData: payload, onDismiss: hidePanel });
  ipcMain.handle('data:get', event => trustedApp(event) ? payload() : null);
  const requestTopicOrganization = createTopicOrganizationRequest({
    getSnapshot: () => state.service.snapshot(),
    organize: () => topicOrganizer.retry(),
    confirm: async () => {
      topicDialogOpen = true;
      try {
        const { response } = await dialog.showMessageBox(state.panel, {
          type: 'question', title: '使用 Harness 模型整理主题',
          message: '将当前已保存的摘录发送给 Harness 中配置的模型服务？',
          detail: '仅发送当前对话中尚未自定主题的摘录。手动主题和保存的原文不会改变。',
          buttons: ['整理主题', '取消'], defaultId: 1, cancelId: 1, noLink: true,
        });
        return response === 0;
      } finally { topicDialogOpen = false; }
    },
  });
  ipcMain.handle('topics:organize', safeReply((event, sourceKey) => {
    if (!trusted(event, state.panel.webContents)) throw Error('此窗口不能整理主题');
    if (state.service.snapshot().active?.provider === 'codex') throw Error('Codex 摘录暂不使用 Harness 模型整理主题，请使用自定主题');
    return requestTopicOrganization(sourceKey);
  }));
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
    const ownSticky = trusted(event, event.sender) && state.byWc.get(event.sender.id)?.id === id;
    if (typeof id !== 'string' || (!trustedPanelSender(event, id) && !ownSticky)) throw Error('此窗口不能定位该条目');
    return revealItem(id);
  }));
  ipcMain.handle('review:set', safeReply((event, id, due) => {
    const ownSticky = trusted(event, event.sender) && state.byWc.get(event.sender.id)?.id === id;
    if (typeof id !== 'string' || (!(trustedPanelSender(event, id) && event.sender === state.panel.webContents) && !ownSticky)) throw Error('此窗口不能更改该条目');
    return state.service.setReview(id, due);
  }));
  ipcMain.handle('link:open', safeReply(async (event, value) => {
    if (!trustedApp(event) || typeof value !== 'string' || value.length > 8192) throw Error('链接无效');
    const url = new URL(value);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) throw Error('仅支持安全网页链接');
    await shell.openExternal(url.href); return true;
  }));
  stickies.wire(ipcMain, { protectWindow, isPanelSender: trustedPanelSender, decorateItem: (item, previous) => stickyItem(item, topicOrganizer?.snapshot().topics || [], previous) });
  await state.service.refresh();
  await stickies.restore();
  settings.start();
  bridge = await startPrivateServer({ directory: bridgeDirectory, service: 'sticky', handlers: {...state.service.handlers,appearanceGet:()=>appearance.get(),appearanceSet:value=>appearance.set(value),appearanceShow:()=>{showPanel();return {shown:true};}} });
  refreshTimer = setInterval(() => { void state.service.refresh(); update(state.service.snapshot()); }, 4000);
  refreshTimer.unref();
  if (nativeUIPath) {
    nativeFrontend = launchNativeFrontend({ appPath: nativeUIPath, onAction: nativeAction, onExit: () => { if (!state.quitting) app.quit(); } });
    publishNative();
  } else if (process.platform === 'win32') {
    recallShortcut = require('./recall-shortcut.cjs').createRecallShortcut({ directory: userData, globalShortcut, invoke: togglePanel });
    await recallShortcut.start(); updateTrayTooltip();
    if (hiddenHintRequested) notifyWorkbenchHidden();
  } else globalShortcut.register('CommandOrControl+Shift+K', togglePanel);
  app.on('second-instance', showPanel);
  if (process.argv.includes('--show-panel')) {
    if (!state.panel.webContents.isLoading()) showPanel();
    else state.panel.once('ready-to-show', showPanel);
  }
  notifyTrayReady();
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
    await recallShortcut?.close();
    quitAllowed = true; app.quit();
  })().catch(error => { state.quitting = false; console.error('Recall state not saved:', error.code || 'SAVE_FAILED'); });
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', event => event.preventDefault());
