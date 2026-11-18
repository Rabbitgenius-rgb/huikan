'use strict';
const { BrowserWindow, screen } = require('electron');
const path = require('node:path');
const { loadWhalePetAsset, loadWhalePetMotionAsset, loadBagPetVideos } = require('./whale-pet-asset.cjs');
const { state, PRELOAD, MAX_STICKIES, notifyPinned } = require('./state');

const actor = { width: Math.round(148 * 2 / 3), height: Math.round(166 * 2 / 3) };
const actorCentre = Math.floor(actor.width / 2);
const openSize = { width: 326, height: 510 };
const validPoint = (x, y) => [x, y].every(value => Number.isFinite(value) && Math.abs(value) < 1e7);
let win, anchor, open = false, ready = false, restored = false, moving = null;
let revision = 0, lastNotes = '', writes = Promise.resolve(), mutating = false;
let protectWindow = () => {}, decorateItem = item => item;
let tearOwner;

function queue(task) {
  const result = writes.then(task);
  writes = result.catch(() => {});
  return result;
}

function areaAt(point) {
  return screen.getDisplayNearestPoint({ x: Math.round(point.x), y: Math.round(point.y) }).workArea;
}

function frameAt(point, expanded) {
  const area = areaAt(point);
  const margin = 8;
  const width = expanded ? Math.min(openSize.width, area.width - margin*2) : actor.width;
  const height = expanded ? Math.min(openSize.height, area.height - margin*2) : actor.height;
  const clamp = (n, a, b) => Math.round(Math.max(a, Math.min(n, b)));
  const x = clamp(point.x - Math.floor(width / 2), area.x + margin, area.x + area.width - width - margin);
  const y = clamp(point.y - height, area.y + margin, area.y + area.height - height - margin);
  return {
    bounds:{ x, y, width, height },
    actorLeft:clamp(point.x - x - actorCentre, 0, width - actor.width),
    actorBottom:clamp(y + height - point.y, 0, height - actor.height),
  };
}

function initialAnchor(point) {
  const area = point ? areaAt(point) : screen.getPrimaryDisplay().workArea;
  return point || { x: area.x + area.width - 105, y: area.y + area.height - 38 };
}

function position(expanded) {
  if (!win || win.isDestroyed()) return null;
  const geometry = frameAt(anchor, expanded);
  if (!expanded) {
    // Persist a reachable anchor after dragging or changing monitor layout.
    anchor = {x:geometry.bounds.x + actorCentre, y:geometry.bounds.y + actor.height};
  }
  const current = win.getBounds();
  if (Object.keys(current).some(key => current[key] !== geometry.bounds[key])) win.setBounds(geometry.bounds);
  return { left:geometry.actorLeft, bottom:geometry.actorBottom,
    below:geometry.bounds.height - geometry.actorBottom - actor.height < geometry.actorBottom };

}

const notes = () => [...state.stickies.values()].map(note => note.item);
const send = (channel, ...args) => { if (win && ready && !win.isDestroyed()) win.webContents.send(channel, ...args); };
const updateVisibility = () => {
  if (!win || !ready || win.isDestroyed()) return;
  if (state.stickiesHidden || !state.stickies.size) win.hide();
  else if (!win.isVisible()) win.showInactive();
};

function create() {
  const window = new BrowserWindow({
    title:'回看 · 书包便签',
    ...frameAt(anchor, false).bounds,
    show:false, frame:false, transparent:true, hasShadow:false, movable:false,
    resizable:false, fullscreenable:false, skipTaskbar:true, alwaysOnTop:true, acceptFirstMouse:true,
    webPreferences:{preload:PRELOAD, sandbox:true, contextIsolation:true, backgroundThrottling:false, accessibleTitle:'回看书包便签'},
  });
  win = window;
  state.byWc.set(window.webContents.id, { win:window });
  const wcId = window.webContents.id;
  protectWindow(window);
  window.setAlwaysOnTop(true, 'floating');
  if (process.platform !== 'win32') window.setVisibleOnAllWorkspaces(true, {visibleOnFullScreen:true});
  window.once('ready-to-show', () => {
    if (window !== win) return;
    ready = true;
    position(false);
    updateVisibility();
    send('bag:visible', window.isVisible());
  });
  window.on('closed', () => {
    state.byWc.delete(wcId);
    if (win !== window) return;
    win = null; ready = false; open = false; moving = null;
  });
  window.on('hide', () => send('bag:visible', false));
  window.on('show', () => send('bag:visible', true));
  window.webContents.on('did-fail-load', (_event, code, _message, _url, isMainFrame) => {
    if (isMainFrame && code !== -3 && !window.isDestroyed()) window.close();
  });
  void window.loadFile(path.join(__dirname, 'bag', 'index.html')).catch(() => {
    if (!window.isDestroyed()) window.close();
  });
}

function syncItems() {
  if (!restored || mutating || state.quitting) return;
  const previous = new Map(state.stickies);
  const layouts = state.service.pinnedLayouts();
  state.stickies.clear();
  for (const id of Object.keys(layouts)) {
    if (state.stickies.size >= MAX_STICKIES) break;
    const raw = state.service.getItem(id);
    if (raw) state.stickies.set(id, {id, item:decorateItem(raw, previous.get(id)?.item)});
  }
  const list = notes();
  const fingerprint = JSON.stringify(list);
  if (fingerprint !== lastNotes) {
    lastNotes = fingerprint;
    revision++;
    notifyPinned();
    send('bag:notes', { revision, notes:list });
  }
  if (list.length && !win) create();
  if (!list.length && win && !win.isDestroyed()) win.close();
  updateVisibility();
}

async function restore() {
  const stored = state.service.bagAnchor();
  const layout = Object.entries(state.service.pinnedLayouts()).find(([id, value]) =>
    state.service.getItem(id) && value && validPoint(value.x, value.y))?.[1];
  const legacyWidth = layout && (Number.isFinite(layout.width) && layout.width > 0 && layout.width < 10000
    ? layout.width : ({gem:112,note:300,large:340}[layout.state] || 112));
  anchor = stored || (layout ? { x:layout.x + legacyWidth - actorCentre, y:layout.y + actor.height } : initialAnchor());
  restored = true;
  syncItems();
}

async function add(id, point) {
  if (state.quitting || typeof id !== 'string' || !state.items.some(item => item.id === id)) return {ok:false, reason:'invalid-item'};
  return queue(async () => {
    const existing = state.stickies.has(id);
    if (!existing && state.stickies.size >= MAX_STICKIES) return {ok:false, reason:'limit', max:MAX_STICKIES};
    if (point && existing) return {ok:false, reason:'already-pinned'};
    if (!existing) {
      if (!state.stickies.size && point) anchor = initialAnchor(point);
      mutating = true;
      const bounds = frameAt(anchor,false).bounds;
      try { await state.service.setPin(id, {x:bounds.x + bounds.width - 112,y:bounds.y,state:'gem'}); }
      catch { return {ok:false, reason:'save-failed'}; }
      finally { mutating = false; syncItems(); }
    }
    setAllHidden(false);
    return {ok:true, alreadyPinned:existing};
  });
}

function pinItem(id) { return add(id); }

async function beginTear(id, point) {
  if (!validPoint(point?.x, point?.y)) return {ok:false, reason:'invalid-item'};
  if (state.tearing) return {ok:false, reason:'forbidden'};
  const gesture = {move: !state.stickies.size};
  state.tearing = gesture;
  const result = await add(id, { x:point.x, y:point.y + actor.height });
  if (!result.ok && state.tearing === gesture) state.tearing = null;
  return result;
}

function moveTear(x, y) {
  if (!state.tearing?.move || !validPoint(x,y) || open) return;
  anchor = { x, y:y + actor.height/2 };
  position(false);
}
function endTear() {
  const moved = state.tearing?.move;
  state.tearing = null;
  if (moved) saveAnchor();
}

function setAllHidden(hidden) {
  state.stickiesHidden = hidden;
  if (!hidden) syncItems();
  updateVisibility();
}

async function persistAll() {
  if (state.tearing?.move || moving) await state.service.setBagAnchor(anchor);
  await writes;
}
function saveAnchor() {
  const value = { ...anchor };
  return queue(() => state.service.setBagAnchor(value)).catch(() => send('bag:error','大肥鱼的位置尚未保存，请重试'));
}
function ownsWindow(event) {
  return win && !win.isDestroyed() && event.sender === win.webContents && (!event.senderFrame || event.senderFrame === event.sender.mainFrame);
}
function ownsItem(event, id) {
  return ownsWindow(event) && typeof id === 'string' && state.stickies.has(id);
}

function wire(ipcMain, options = {}) {
  protectWindow = options.protectWindow || protectWindow;
  decorateItem = options.decorateItem || decorateItem;
  const allowedPanel = (event,id) => (!event.senderFrame || event.senderFrame === event.sender.mainFrame) && (options.isPanelSender?.(event,id) ?? event.sender === state.panel?.webContents);
  ipcMain.handle('sticky:pin', (event,id) => allowedPanel(event,id) ? pinItem(id) : {ok:false, reason:'forbidden'});
  function releaseTear(gesture) {
    if (tearOwner !== gesture) return;
    tearOwner = null;
    gesture.event.sender.removeListener('destroyed', gesture.release);
    endTear();
  }
  ipcMain.handle('tear:start', async (event,id,x,y) => {
    if (!allowedPanel(event,id) || state.tearing || tearOwner) return {ok:false, reason:'forbidden'};
    const gesture = {event,id,release:() => releaseTear(gesture)};
    tearOwner = gesture;
    event.sender.once('destroyed', gesture.release);
    const result = await beginTear(id,{x,y});
    if (!result.ok) releaseTear(gesture);
    return result;
  });
  ipcMain.on('tear:move', (event,x,y) => {
    const gesture = tearOwner;
    if (event.sender !== gesture?.event.sender) return;
    if (allowedPanel(event,gesture.id)) moveTear(x,y); else releaseTear(gesture);
  });
  ipcMain.on('tear:end', event => {
    if (event.sender === tearOwner?.event.sender && (!event.senderFrame || event.senderFrame === event.sender.mainFrame)) releaseTear(tearOwner);
  });
  const watch = setInterval(() => {
    const gesture = tearOwner;
    if (gesture && !allowedPanel(gesture.event,gesture.id)) releaseTear(gesture);
  },150);
  watch.unref();
  state.panel?.once('closed', () => { clearInterval(watch); if (tearOwner) releaseTear(tearOwner); });

  ipcMain.handle('bag:init', event => ownsWindow(event) ? { revision, notes:notes(), actor } : null);
  ipcMain.handle('bag:idle-assets', async event => {
    if (!ownsWindow(event)) return null;
    const [source,extraSource,videos] = await Promise.all([
      loadWhalePetAsset(), loadWhalePetMotionAsset(), loadBagPetVideos(),
    ]);
    return ownsWindow(event) ? {source,extraSource,videos} : null;
  });
  ipcMain.handle('bag:frame', (event, expanded) => {
    if (!ownsWindow(event) || typeof expanded !== 'boolean' || state.stickiesHidden) return null;
    open = expanded;
    return position(open);
  });
  ipcMain.handle('bag:pointer', event => {
    if (!ownsWindow(event)) return null;
    const cursor = screen.getCursorScreenPoint(), bounds = win.getBounds();
    return { x:cursor.x - bounds.x, y:cursor.y - bounds.y };
  });
  ipcMain.on('bag:ignore', (event, ignore) => {
    if (!ownsWindow(event) || typeof ignore !== 'boolean') return;
    if (ignore && !moving) win.setIgnoreMouseEvents(true, {forward:true});
    else win.setIgnoreMouseEvents(false);
  });
  ipcMain.on('bag:drag', (event, action, dx, dy) => {
    if (!ownsWindow(event)) return;
    if (action === 'start') moving = { ...anchor };
    if (action === 'move' && moving && validPoint(dx,dy)) {
      anchor = { x:moving.x + dx, y:moving.y + dy };
      // Clamp the invisible idle bounds as well, so closing keeps the same anchor.
      const idleFrame = frameAt(anchor,false).bounds;
      anchor = { x:idleFrame.x + actorCentre, y:idleFrame.y + actor.height };
      send('bag:geometry', position(open));
    }
    if (action === 'end' && moving) { moving = null; void saveAnchor(); }
  });
  ipcMain.handle('bag:read', async (event,id) => {
    if (!ownsItem(event,id) || !open || !win.isVisible()) return false;
    await state.service.markRead([id]);
    return true;
  });
  ipcMain.handle('bag:unpin', (event,id) => {
    if (!ownsItem(event,id) || !open || state.quitting) return false;
    return queue(async () => {
      if (!state.stickies.has(id)) return false;
      mutating = true;
      try { await state.service.setPin(id,null); return true; }
      finally { mutating = false; syncItems(); }
    });
  });
  for (const event of ['display-removed','display-metrics-changed']) screen.on(event, () => {
    if (!win || win.isDestroyed()) return;
    const idleFrame = frameAt(anchor,false).bounds;
    anchor = { x:idleFrame.x + actorCentre, y:idleFrame.y + actor.height };
    send('bag:geometry', position(open));
  });
}

module.exports = { wire, pinItem, beginTear, moveTear, endTear, setAllHidden, restore, syncItems, persistAll, ownsItem };
