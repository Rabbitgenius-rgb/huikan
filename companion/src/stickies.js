'use strict';
const { BrowserWindow, screen } = require('electron');
const path = require('path');
const { state, PRELOAD, MAX_STICKIES, SIZES, notifyPinned } = require('./state');
const settings = require('./settings');
const DOCK_GAP = 8, SNAP_DISTANCE = 24;
let protectWindow = () => {};
let decorateItem = item => item;
const validPoint = (x, y) => Number.isFinite(x) && Number.isFinite(y) && Math.abs(x) < 1e7 && Math.abs(y) < 1e7;
const panelEvent = e => e.sender === state.panel?.webContents && (!e.senderFrame || e.senderFrame === e.sender.mainFrame);
const persist = rec => state.service.setPin(rec.id, { ...stableBounds(rec), state: rec.state, ...(rec.dockBelow ? { dockBelow: rec.dockBelow } : {}) });
const saveLayout = rec => { void persist(rec).catch(() => rec.win.webContents.send('sticky:error', '便签位置尚未保存，请检查磁盘后重试')); };

const stableBounds = rec => rec.transition?.target || rec.following?.target || rec.win.getBounds();
const sameConversation = (a, b) => a.item.externalSource.instanceId === b.item.externalSource.instanceId && a.item.externalSource.sessionId === b.item.externalSource.sessionId;
const living = () => [...state.stickies.values()].filter(rec => !rec.win.isDestroyed());
function followers(rec) {
  const result = [], seen = new Set([rec.id]);
  let parent = rec;
  while (parent) {
    const child = living().find(other => other.dockBelow === parent.id && !seen.has(other.id));
    if (!child) break;
    result.push(child); seen.add(child.id); parent = child;
  }
  return result;
}
function dockRoot(rec) {
  const seen = new Set([rec.id]);
  while (rec.dockBelow) {
    const parent = state.stickies.get(rec.dockBelow);
    if (!parent || parent.win.isDestroyed() || seen.has(parent.id) || !sameConversation(rec, parent)) { rec.dockBelow = null; break; }
    seen.add(parent.id); rec = parent;
  }
  return rec;
}
function dockLayout(rec, overrides = new Map()) {
  const root = dockRoot(rec), chain = [root, ...followers(root)];
  const boundsOf = note => overrides.get(note.id) || stableBounds(note);
  const b = boundsOf(root), area = screen.getDisplayMatching(b).workArea;
  const total = chain.reduce((height, note) => height + boundsOf(note).height, 0) + DOCK_GAP * (chain.length - 1);
  const left = area.x + 12, right = area.x + area.width - 12, bottom = area.y + area.height - 12;
  const columnWidth = Math.max(...chain.map(note => boundsOf(note).width));
  let edge = Math.min(Math.max(b.x + b.width, left + columnWidth), right);
  let top = Math.min(Math.max(b.y, area.y + 12), Math.max(area.y + 12, bottom - total));
  const columnTop = top, result = [];
  for (const note of chain) {
    const bounds = boundsOf(note);
    let dockBelow = note.dockBelow;
    if (top + bounds.height > bottom && note !== root) {
      const nextLeft = edge - columnWidth - 16;
      edge = nextLeft - columnWidth >= left ? nextLeft : Math.min(right, edge + columnWidth + 16);
      top = columnTop; dockBelow = null;
    }
    const target = { ...bounds, x: Math.round(Math.min(Math.max(edge - bounds.width, left), right - bounds.width)), y: Math.round(top) };
    result.push({ note, target, dockBelow });
    top += bounds.height + DOCK_GAP;
  }
  return result;
}
function arrangeDock(rec) {
  if (!rec.dockBelow && !followers(rec).length) return;
  for (const {note, target, dockBelow} of dockLayout(rec)) {
    if (note.transition || note.following || note.drag) continue;
    note.dockBelow = dockBelow;
    if (!equalBounds(note.win.getBounds(), target)) note.win.setBounds(target);
    saveLayout(note);
  }
}
const equalBounds = (a, b) => ['x', 'y', 'width', 'height'].every(key => a[key] === b[key]);
function releaseFollowers(rec, notify = true) {
  const released = [];
  for (const note of living()) {
    if (note.following?.owner !== rec.id) continue;
    note.following = null; released.push(note);
    if (notify) note.win.webContents.send('sticky:motion-idle');
  }
  return released;
}
function nearestDock(rec, allowHidden = false) {
  const excluded = new Set([rec.id, ...followers(rec).map(note => note.id)]), b = stableBounds(rec);
  let best = null, distance = Infinity;
  for (const other of living()) {
    if (excluded.has(other.id) || (!allowHidden && !other.win.isVisible()) || other.drag || other.transition || !sameConversation(rec, other)) continue;
    if (living().some(child => child.dockBelow === other.id && !excluded.has(child.id))) continue;
    const anchor = stableBounds(other);
    const dx = Math.abs(b.x + b.width - anchor.x - anchor.width);
    const dy = Math.abs(b.y - anchor.y - anchor.height - DOCK_GAP);
    if (b.y > anchor.y && dx <= SNAP_DISTANCE && dy <= SNAP_DISTANCE && dx + dy < distance) { best = other; distance = dx + dy; }
  }
  return best;
}
function attachToLatest(rec) {
  const candidates = living().filter(other => other !== rec && other.win.isVisible() && !other.drag && sameConversation(rec, other));
  const anchor = candidates.at(-1);
  if (!anchor) return;
  rec.dockBelow = (followers(anchor).at(-1) || anchor).id;
  arrangeDock(rec);
}

function boundsFor(kind, anchor) {
  const size = SIZES[kind];
  // anchor is the point that stays fixed when the window changes size (top-right corner)
  return { x: Math.round(anchor.x - size.w), y: Math.round(anchor.y), width: size.w, height: size.h };
}

function createWindow(id, point) {
  const size = SIZES.note;
  const win = new BrowserWindow({
    title: '梦藏 · 回看便签',
    x: Math.round(point.x - size.w / 2),
    y: Math.round(point.y - 20),
    width: size.w,
    height: size.h,
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    show: false,
    webPreferences: {
      preload: PRELOAD,
      contextIsolation: true,
      sandbox: true,
      // Floating notes normally do not own app focus. Their short, event-driven
      // morphs must still receive frames while another window is active.
      backgroundThrottling: false,
      accessibleTitle: '回看便签内容',
    },
  });
  win.accessibleTitle = '梦藏 · 回看便签';
  win.setAlwaysOnTop(true, 'floating');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  protectWindow(win);
  win.loadFile(path.join(__dirname, 'note', 'index.html'), { query: { id } });
  return win;
}

function register(id, win, origin, initialState = 'note', focusOnShow = false) {
  const rec = { id, item: decorateItem(state.service.getItem(id)), win, wcId: win.webContents.id, state: initialState, origin, drag: null };
  state.stickies.set(id, rec);
  state.byWc.set(rec.wcId, rec);
  win.once('ready-to-show', () => { if (rec.state !== 'note') setState(rec, rec.state); snapToEdge(win); arrangeDock(rec); if (focusOnShow) { win.show(); win.focus(); } else if (!state.stickiesHidden) win.showInactive(); });
  win.on('closed', () => {
    state.stickies.delete(id);
    state.byWc.delete(rec.wcId);
    if (state.tearing === rec) state.tearing = null;
    const released = new Set(releaseFollowers(rec));
    for (const child of living().filter(child => child.dockBelow === id)) { child.dockBelow = null; released.add(child); }
    if (!state.quitting) for (const child of released) saveLayout(child);
    if (!state.quitting) void state.service.setPin(id, null).catch(() => {});
    notifyPinned();
  });
  notifyPinned();
  return rec;
}

function createPinned(id, point, focusOnShow = false) {
  return register(id, createWindow(id, point), point, 'note', focusOnShow);
}

// Keyboard pinning uses the same native note, source ownership and persistence
// as tear-off, without entering an unfinished pointer gesture.
async function pinItem(id) {
  if (typeof id !== 'string' || !state.items.some(item => item.id === id)) return { ok: false, reason: 'invalid-item' };
  const existing = state.stickies.get(id);
  if (existing && !existing.win.isDestroyed()) { if (!existing.win.isVisible()) attachToLatest(existing); existing.win.show(); existing.win.focus(); return { ok: true, alreadyPinned: true }; }
  if (state.stickies.size >= MAX_STICKIES) return { ok: false, reason: 'limit', max: MAX_STICKIES };
  const bounds = state.panel.getBounds(), area = screen.getDisplayMatching(bounds).workArea;
  const size = SIZES.note;
  const beside = bounds.x + bounds.width + 16;
  const x = Math.min(Math.max(beside + size.w <= area.x + area.width - 12 ? beside : bounds.x - size.w - 16, area.x + 12), area.x + area.width - size.w - 12);
  const y = Math.min(Math.max(bounds.y + 32, area.y + 12), area.y + area.height - size.h - 12);
  const rec = createPinned(id, { x: x + size.w / 2, y: y + 20 }, true);
  attachToLatest(rec);
  try { await persist(rec); return { ok: true, alreadyPinned: false }; }
  catch { rec.win.webContents.send('sticky:error', '便签位置尚未保存，请检查磁盘后重试'); return { ok: false, reason: 'save-failed' }; }
}

// Called when a panel item is dragged past the panel edge.
function beginTear(id, screenPoint) {
  if (!validPoint(screenPoint.x, screenPoint.y) || !state.items.some(item => item.id === id)) return { ok: false, reason: 'invalid-item' };
  if (state.stickies.has(id)) return { ok: false, reason: 'already-pinned' };
  if (state.stickies.size >= MAX_STICKIES) return { ok: false, reason: 'limit', max: MAX_STICKIES };
  const rec = createPinned(id, screenPoint);
  saveLayout(rec);
  rec.tearing = true;
  state.tearing = rec;
  return { ok: true };
}

function moveTear(x, y) {
  if (!validPoint(x, y)) return;
  const rec = state.tearing;
  if (!rec || rec.win.isDestroyed()) return;
  const size = SIZES[rec.state];
  rec.win.setBounds({ x: Math.round(x - size.w / 2), y: Math.round(y - 20), width: size.w, height: size.h });
}

function endTear() {
  const rec = state.tearing;
  state.tearing = null;
  if (!rec || rec.win.isDestroyed()) return;
  rec.tearing = false;
  snapToEdge(rec.win);
  const anchor = nearestDock(rec);
  if (anchor) rec.dockBelow = anchor.id;
  arrangeDock(rec);
  saveLayout(rec);
}

function snapToEdge(win) {
  const b = win.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  const margin = 12;
  const x = Math.min(Math.max(b.x, area.x + margin), area.x + area.width - b.width - margin);
  const y = Math.min(Math.max(b.y, area.y + margin), area.y + area.height - b.height - margin);
  if (x !== b.x || y !== b.y) win.setBounds({ x, y, width: b.width, height: b.height }, true);
}

function setState(rec, next) {
  if (!SIZES[next] || rec.win.isDestroyed()) return;
  const b = rec.win.getBounds();
  releaseFollowers(rec); rec.transition = null;
  // keep the top-right corner fixed so the sticky "folds up" toward its corner
  const anchor = { x: b.x + b.width, y: b.y };
  rec.state = next;
  rec.win.setBounds(boundsFor(next, anchor));
  if (next === 'large' && rec.contentHeight) fitContent(rec, rec.contentHeight);
  snapToEdge(rec.win);
  rec.win.webContents.send('sticky:state', next);
  if (next !== 'gem') rec.win.setIgnoreMouseEvents(false);
  saveLayout(rec);
  arrangeDock(rec);
}

// The renderer measures wrapped text; the main process owns screen bounds.
function fitContent(rec, requestedHeight) {
  if (rec.state !== 'large' || rec.win.isDestroyed() || rec.drag || rec.transition || rec.following || !Number.isFinite(requestedHeight) || requestedHeight <= 0) return;
  const b = rec.win.getBounds();
  const area = screen.getDisplayMatching(b).workArea;
  const height = Math.min(Math.max(120, Math.ceil(requestedHeight)), 600, area.height - 24);
  const y = Math.min(Math.max(b.y, area.y + 12), area.y + area.height - height - 12);
  rec.contentHeight = requestedHeight;
  if (b.height === height && b.y === y) return;
  rec.win.setBounds({ ...b, y, height });
  saveLayout(rec);
  arrangeDock(rec);
}

function prepareMorph(rec, next, rect, requestedHeight) {
  if (!SIZES[next] || rec.win.isDestroyed() || rec.drag) return null;
  const group = [dockRoot(rec), ...followers(dockRoot(rec))];
  if (group.some(note => note !== rec && (note.transition || note.drag))) return { deferred: true };
  const b = rec.win.getBounds();
  if (!rect || ![rect.x, rect.y, rect.width, rect.height].every(Number.isFinite) || rect.width < 1 || rect.height < 1 || rect.x < -1 || rect.y < -1 || rect.x + rect.width > b.width + 1 || rect.y + rect.height > b.height + 1) return null;
  const stable = rec.transition?.target || b;
  let target = boundsFor(next, { x: stable.x + stable.width, y: stable.y });
  const area = screen.getDisplayMatching(b).workArea;
  if (next === 'large') {
    if (Number.isFinite(requestedHeight) && requestedHeight > 0) rec.contentHeight = requestedHeight;
    target.height = Math.min(Math.max(120, Math.ceil(rec.contentHeight || target.height)), 600, area.height - 24);
  }
  target.x = Math.min(Math.max(target.x, area.x + 12), area.x + area.width - target.width - 12);
  target.y = Math.min(Math.max(target.y, area.y + 12), area.y + area.height - target.height - 12);
  // Plan the entire stack before allocating the changing card's surface.
  // The animation and final commit use this exact plan, including edge clamping.
  const plan = dockLayout(rec, new Map([[rec.id, target]]));
  target = plan.find(entry => entry.note === rec).target;
  releaseFollowers(rec, false);
  const from = { x: b.x + rect.x, y: b.y + rect.y, width: rect.width, height: rect.height };
  // Retain the current backing surface through reversals. Resizing to the
  // intermediate card would otherwise discard pixels on every direction change.
  const x = Math.min(b.x, target.x), y = Math.min(b.y, target.y);
  const viewport = { x, y, width: Math.max(b.x + b.width, target.x + target.width) - x, height: Math.max(b.y + b.height, target.y + target.height) - y };
  const token = (rec.morphSerial || 0) + 1;
  const participants = plan.map(entry => ({ ...entry, from: entry.note.win.getBounds() }));
  rec.morphSerial = token; rec.state = next; rec.transition = { token, target, viewport, participants, progress: 0 };
  for (const {note, target: destination} of participants) if (note !== rec) {
    note.following = { owner: rec.id, token, target: destination };
    note.win.webContents.send('sticky:motion-busy');
  }
  // Plan first; the renderer paints its anchored shell before allocation.
  return { token, next, resize: !equalBounds(b, viewport), grouped: participants.length > 1, source: b, viewport, target, from: { x: from.x - x, y: from.y - y, width: from.width, height: from.height }, to: { x: target.x - x + 6, y: target.y - y + 6, width: target.width - 12, height: target.height - 12 } };
}

function startMorph(rec, token) {
  if (!rec.transition || rec.transition.token !== token || rec.win.isDestroyed()) return false;
  rec.win.setIgnoreMouseEvents(false);
  if (!equalBounds(rec.win.getBounds(), rec.transition.viewport)) rec.win.setBounds(rec.transition.viewport);
  return true;
}

function progressMorph(rec, token, progress) {
  const transition = rec.transition;
  if (!transition || transition.token !== token || !Number.isFinite(progress) || progress < transition.progress || progress > 1) return false;
  transition.progress = progress;
  for (const {note, from, target} of transition.participants) {
    if (note === rec || note.win.isDestroyed() || note.following?.token !== token || note.following?.owner !== rec.id) continue;
    const bounds = { ...from, x: Math.round(from.x + (target.x - from.x) * progress), y: Math.round(from.y + (target.y - from.y) * progress) };
    if (!equalBounds(note.win.getBounds(), bounds)) note.win.setBounds(bounds);
  }
  return true;
}

function finishMorph(rec, token) {
  const transition = rec.transition;
  if (!transition || transition.token !== token || rec.win.isDestroyed()) return false;
  for (const {note, target, dockBelow} of transition.participants) {
    if (note.win.isDestroyed() || (note !== rec && (note.following?.owner !== rec.id || note.following?.token !== token))) continue;
    note.dockBelow = dockBelow;
    if (!equalBounds(note.win.getBounds(), target)) note.win.setBounds(target);
  }
  rec.transition = null;
  rec.win.webContents.send('sticky:state', rec.state);
  for (const {note} of transition.participants) if (!note.win.isDestroyed()) saveLayout(note);
  releaseFollowers(rec);
  return true;
}

function wire(ipcMain, options = {}) {
  protectWindow = options.protectWindow || (() => {});
  decorateItem = options.decorateItem || (item => item);
  const recOf = e => (!e.senderFrame || e.senderFrame === e.sender.mainFrame) ? state.byWc.get(e.sender.id) : null;

  ipcMain.handle('sticky:init', (e) => {
    const rec = recOf(e);
    if (!rec) return null;
    // A renderer reload must recover the destination rather than its temporary
    // animation viewport, without changing the saved note or its source.
    if (rec.transition) finishMorph(rec, rec.transition.token);
    const item = rec.item;
    return { item, state: rec.state, settings: settings.current() };
  });

  ipcMain.on('sticky:set-state', (e, next) => {
    const rec = recOf(e);
    if (rec) setState(rec, next);
  });

  ipcMain.on('sticky:fit-content', (e, height) => {
    const rec = recOf(e);
    if (rec) fitContent(rec, height);
  });
  ipcMain.handle('sticky:morph-prepare', (e, next, rect, height) => {
    const rec = recOf(e); return rec ? prepareMorph(rec, next, rect, height) : null;
  });
  ipcMain.handle('sticky:morph-start', (e, token) => {
    const rec = recOf(e); return rec ? startMorph(rec, token) : false;
  });
  ipcMain.on('sticky:morph-progress', (e, token, progress) => {
    const rec = recOf(e); if (rec) progressMorph(rec, token, progress);
  });
  ipcMain.handle('sticky:morph-finish', (e, token) => {
    const rec = recOf(e); return rec ? finishMorph(rec, token) : false;
  });
  ipcMain.handle('sticky:read', async e => {
    const rec = recOf(e);
    if (!rec || rec.state === 'gem' || rec.win.isDestroyed() || !rec.win.isVisible()) return false;
    await state.service.markRead([rec.id]); return true;
  });

  ipcMain.on('sticky:close', (e) => {
    const rec = recOf(e);
    if (rec && !rec.win.isDestroyed()) rec.win.close();
  });

  ipcMain.on('sticky:drag-start', (e) => {
    const rec = recOf(e);
    if (rec && !rec.transition && !rec.following) {
      rec.dockBelow = null;
      rec.drag = rec.win.getBounds();
      rec.dragFollowers = followers(rec).filter(child => !child.transition).map(child => ({ child, bounds: child.win.getBounds() }));
    }
  });
  ipcMain.on('sticky:drag-move', (e, dx, dy) => {
    const rec = recOf(e);
    if (!rec || !rec.drag || rec.win.isDestroyed() || !validPoint(dx, dy)) return;
    rec.win.setBounds({
      x: Math.round(rec.drag.x + dx),
      y: Math.round(rec.drag.y + dy),
      width: rec.drag.width,
      height: rec.drag.height,
    });
    for (const { child, bounds } of rec.dragFollowers || []) if (!child.win.isDestroyed()) child.win.setBounds({ ...bounds, x: Math.round(bounds.x + dx), y: Math.round(bounds.y + dy) });
  });
  ipcMain.on('sticky:drag-end', (e) => {
    const rec = recOf(e);
    if (!rec) return;
    rec.drag = null;
    rec.dragFollowers = null;
    if (rec.contentHeight) fitContent(rec, rec.contentHeight);
    snapToEdge(rec.win);
    const anchor = nearestDock(rec);
    if (anchor) rec.dockBelow = anchor.id;
    arrangeDock(rec);
    saveLayout(rec);
    const root = dockRoot(rec);
    for (const note of [root, ...followers(root)]) note.win.webContents.send('sticky:motion-idle');
  });

  // The gem is non-rectangular: let clicks fall through everywhere except on its shape.
  ipcMain.on('sticky:set-ignore', (e, ignore) => {
    const rec = recOf(e);
    if (!rec || rec.win.isDestroyed() || typeof ignore !== 'boolean') return;
    if (ignore) rec.win.setIgnoreMouseEvents(true, { forward: true });
    else rec.win.setIgnoreMouseEvents(false);
  });

  ipcMain.handle('tear:start', (event, id, x, y) => panelEvent(event) ? beginTear(id, { x, y }) : { ok: false, reason: 'forbidden' });
  ipcMain.handle('sticky:pin', (event, id) => panelEvent(event) ? pinItem(id) : { ok: false, reason: 'forbidden' });
  ipcMain.on('tear:move', (event, x, y) => { if (panelEvent(event)) moveTear(x, y); });
  ipcMain.on('tear:end', event => { if (panelEvent(event)) endTear(); });
}

function setAllHidden(hidden) {
  state.stickiesHidden = hidden;
  for (const rec of state.stickies.values()) {
    if (rec.win.isDestroyed()) continue;
    if (hidden) rec.win.hide();
    else rec.win.showInactive();
  }
}

async function restore() {
  for (const [id, layout] of Object.entries(state.service.pinnedLayouts()).slice(0, MAX_STICKIES)) {
    if (!state.service.getItem(id) || !validPoint(layout.x, layout.y) || !SIZES[layout.state]) continue;
    const win = createWindow(id, { x: layout.x + SIZES.note.w / 2, y: layout.y + 20 });
    const rec = register(id, win, { x: layout.x, y: layout.y }, layout.state);
    rec.dockBelow = typeof layout.dockBelow === 'string' ? layout.dockBelow : null;
    win.setBounds({ x: layout.x, y: layout.y, width: SIZES[layout.state].w, height: SIZES[layout.state].h });
  }
  // Existing nearby labels acquire a dock without moving independent notes.
  for (const rec of [...living()].sort((a, b) => stableBounds(a).y - stableBounds(b).y)) {
    if (!rec.dockBelow) {
      const anchor = nearestDock(rec, true);
      if (anchor) rec.dockBelow = anchor.id;
    }
    arrangeDock(rec);
  }
}
async function persistAll() {
  await Promise.all([...state.stickies.values()].filter(rec => !rec.win.isDestroyed()).map(persist));
}
function syncItems() {
  for (const rec of [...state.stickies.values()]) {
    if (rec.win.isDestroyed()) continue;
    const raw = state.service.getItem(rec.id);
    if (!raw) { rec.win.close(); continue; }
    const item = decorateItem(raw, rec.item);
    if (JSON.stringify(item) !== JSON.stringify(rec.item)) { rec.item = item; rec.win.webContents.send('sticky:item', item); }
  }
}
module.exports = { wire, setAllHidden, restore, persistAll, beginTear, moveTear, endTear, pinItem, syncItems };
