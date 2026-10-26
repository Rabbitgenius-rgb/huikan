'use strict';
// Decides whether the gem renders in 3D or the energy-saving 2D mode.
const { BrowserWindow, powerMonitor, systemPreferences } = require('electron');
const { state } = require('./state');

function compute() {
  if (state.mode !== 'auto') return { mode: state.mode, effective: state.mode, reason: 'manual' };

  let reason = null;
  try {
    if (powerMonitor.isOnBatteryPower()) reason = 'battery';
  } catch {
    // not supported on this platform
  }
  try {
    if (systemPreferences.getAnimationSettings().prefersReducedMotion) reason = 'reduced-motion';
  } catch {
    // not supported on this platform
  }
  return { mode: 'auto', effective: reason ? '2d' : '3d', reason };
}

let lastKey = '';
let appearanceProvider=()=>undefined;

function current() {
  return {...compute(),appearance:appearanceProvider()};
}

function broadcast(force) {
  const s = current();
  const key = JSON.stringify(s);
  if (!force && key === lastKey) return;
  lastKey = key;
  for (const w of BrowserWindow.getAllWindows()) {
    if (w.isDestroyed()) continue;
    // Desktop notes keep their solid paper surface; glass belongs to the panel.
    if (state.byWc.has(w.webContents.id)) w.setHasShadow(false);
    else if (s.appearance) w.setHasShadow(s.appearance.shadow);
    w.webContents.send('settings', s);
  }
}

function start() {
  powerMonitor.on('on-battery', () => broadcast(false));
  powerMonitor.on('on-ac', () => broadcast(false));
  // Reduced-motion has no change event in Electron, so poll cheaply.
  setInterval(() => broadcast(false), 5000).unref();
}

function setMode(mode) {
  if (!['auto', '3d', '2d'].includes(mode)) return;
  state.mode = mode;
  if (state.service) void state.service.setMode(mode).catch(() => {});
  broadcast(true);
}

module.exports = { current, broadcast, start, setMode, setAppearanceProvider(provider){appearanceProvider=provider;} };
