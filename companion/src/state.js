'use strict';
// Shared main-process state. Kept in one place so modules stay small.
const path = require('path');

const state = {
  panel: null,
  tray: null,
  mode: 'auto', // 'auto' | '3d' | '2d'
  tearing: null, // sticky record currently being dragged out of the panel
  stickiesHidden: false,
  items: [],
  conversation: { title: '等待 Harness 对话', turns: 0, outline: [] },
  service: null,
  snapshot: null,
  quitting: false,
  // id -> record { id, win, wcId, state, origin }
  stickies: new Map(),
  // webContents id -> record
  byWc: new Map(),
};

const PRELOAD = path.join(__dirname, 'preload.js');
const MAX_STICKIES = 5;
const SIZES = {
  // Retain the stored mode key; its first-version surface is now a title tag.
  gem: { w: 200, h: 52 },
  note: { w: 300, h: 236 },
  large: { w: 340, h: 430 },
};

function pinnedIds() {
  return [...state.stickies.keys()];
}

function notifyPinned() {
  const p = state.panel;
  if (p && !p.isDestroyed()) p.webContents.send('pinned:change', pinnedIds());
}

module.exports = { state, PRELOAD, MAX_STICKIES, SIZES, pinnedIds, notifyPinned };
