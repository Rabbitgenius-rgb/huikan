'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

// Opt-in, bounded lifecycle evidence only. No commands, window titles, URLs,
// renderer data, configuration, credentials, or conversation text are logged.
function createWindowDiagnostics({ enabled, userData, app, BrowserWindow }) {
  const noop = () => {};
  if (!enabled) return { record: noop, geometry: noop, input: noop, context: noop };
  const directory = path.join(userData, 'diagnostics');
  let file, entries = 0, timer;
  try {
    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
    file = path.join(directory, `window-lifecycle-${process.pid}.jsonl`);
  } catch { return { record: noop, geometry: noop, input: noop, context: noop }; }
  const boundsOf = value => value && ['x', 'y', 'width', 'height'].every(key => Number.isFinite(value[key]))
    ? Object.fromEntries(['x', 'y', 'width', 'height'].map(key => [key, value[key]])) : null;
  const windowState = win => {
    try {
      if (!win || win.isDestroyed()) return win ? { windowId: win.id, destroyed: true } : null;
      return { windowId: win.id, bounds: boundsOf(win.getBounds()), visible: win.isVisible(), focused: win.isFocused(), focusable: win.isFocusable() };
    } catch { return null; }
  };
  function append(event, win, geometry) {
    if (entries >= 2000) return;
    try {
      const value = { at: new Date().toISOString(), event, window: windowState(win), windows: BrowserWindow.getAllWindows().map(windowState).filter(Boolean), appFocused: typeof app.isActive === 'function' ? app.isActive() : null, accessibilityEnabled: app.isAccessibilitySupportEnabled(), ...(geometry || {}) };
      fs.appendFileSync(file, JSON.stringify(value) + '\n', { mode: 0o600 }); entries++;
    } catch { /* Diagnostics never interfere with the product lifecycle. */ }
  }
  const record = (event, win) => append(event, win);
  app.on('browser-window-created', (_event, win) => {
    record('window.created', win);
    for (const name of ['ready-to-show', 'show', 'hide', 'focus', 'blur', 'move', 'resize', 'close', 'closed', 'unresponsive', 'responsive']) win.on(name, () => record(`window.${name}`, win));
    win.webContents.on('did-finish-load', () => record('window.loaded', win));
  });
  for (const name of ['activate', 'did-become-active', 'second-instance', 'before-quit', 'will-quit']) app.on(name, () => record(`app.${name}`));
  app.on('accessibility-support-changed', () => record('app.accessibility-changed'));
  app.once('ready', () => {
    record('app.ready');
    timer = setInterval(() => record('app.window-snapshot'), 2000); timer.unref();
  });
  app.once('will-quit', () => clearInterval(timer));
  return {
    record,
    geometry(event, win, trayBounds, workArea, targetBounds) { append(event, win, { trayBounds: boundsOf(trayBounds), workArea: boundsOf(workArea), targetBounds: boundsOf(targetBounds) }); },
    input(win, value) {
      if (!value || !['mousedown', 'mousemove', 'mouseup', 'mouseleave', 'blur', 'tear-request', 'tear-reply', 'released-guard'].includes(value.type)) return;
      const input = { type: value.type };
      for (const key of ['button', 'buttons']) if (Number.isSafeInteger(value[key]) && value[key] >= -1 && value[key] <= 31) input[key] = value[key];
      for (const key of ['screenX', 'screenY', 'clientX', 'clientY']) if (Number.isFinite(value[key]) && Math.abs(value[key]) < 1e7) input[key] = value[key];
      if (typeof value.targetClass === 'string' && /^[a-zA-Z0-9_ -]{0,100}$/.test(value.targetClass)) input.targetClass = value.targetClass;
      if (typeof value.accepted === 'boolean') input.accepted = value.accepted;
      append('panel.input', win, { input });
    },
    context(value) {
      const alias = id => typeof id === 'string' && id ? crypto.createHash('sha256').update(id).digest('hex').slice(0, 12) : null;
      const context = { contextProtocol: 2, view: alias(value.viewId), instance: alias(value.instanceId), session: alias(value.sessionId), activeView: alias(value.activeViewId), activeInstance: alias(value.activeInstanceId), activeSession: alias(value.activeSessionId) };
      for (const key of ['contextSeq', 'focusEpoch', 'activeFocusEpoch']) if (Number.isSafeInteger(value[key]) && value[key] >= 0) context[key] = value[key];
      for (const key of ['reportedFocused', 'accepted']) if (typeof value[key] === 'boolean') context[key] = value[key];
      if (['stale-sequence', 'stale-focus-epoch', 'new-focus-epoch', 'current-view', 'background-view'].includes(value.reason)) context.reason = value.reason;
      append('harness.context', null, { context });
    },
  };
}

module.exports = { createWindowDiagnostics };
