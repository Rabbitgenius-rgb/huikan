const { contextBridge, ipcRenderer } = require('electron');

const on = (channel, cb) => {
  ipcRenderer.on(channel, (_e, ...args) => cb(...args));
};

contextBridge.exposeInMainWorld('api', {
  // panel
  getData: () => ipcRenderer.invoke('data:get'),
  traceInput: value => ipcRenderer.send('diagnostic:input', value),
  tearStart: (id, x, y) => ipcRenderer.invoke('tear:start', id, x, y),
  pinItem: id => ipcRenderer.invoke('sticky:pin', id),
  tearMove: (x, y) => ipcRenderer.send('tear:move', x, y),
  tearEnd: () => ipcRenderer.send('tear:end'),
  setMode: (mode) => ipcRenderer.send('mode:set', mode),
  onPinnedChange: (cb) => on('pinned:change', cb),
  onDataChange: cb => on('data:changed', cb),
  retryCapture: id => ipcRenderer.invoke('recall:retry', id),
  refresh: () => ipcRenderer.invoke('recall:refresh'),
  reveal: id => ipcRenderer.invoke('recall:reveal', id),
  openLink: url => ipcRenderer.invoke('link:open', url),

  // Read-only excerpt beside the panel; never takes focus from a drag.
  previewShow: (kind, id, row) => ipcRenderer.send('preview:show', kind, id, row),
  previewHide: () => ipcRenderer.send('preview:hide'),
  onPreview: (cb) => on('preview:content', cb),
  previewReady: (request, height) => ipcRenderer.send('preview:ready', request, height),

  // sticky
  stickyInit: () => ipcRenderer.invoke('sticky:init'),
  stickyDragStart: () => ipcRenderer.send('sticky:drag-start'),
  stickyDragMove: (dx, dy) => ipcRenderer.send('sticky:drag-move', dx, dy),
  stickyDragEnd: () => ipcRenderer.send('sticky:drag-end'),
  stickySetState: (state) => ipcRenderer.send('sticky:set-state', state),
  stickyFitContent: (height) => ipcRenderer.send('sticky:fit-content', height),
  stickyPrepareMorph: (next, rect, height) => ipcRenderer.invoke('sticky:morph-prepare', next, rect, height),
  stickyStartMorph: token => ipcRenderer.invoke('sticky:morph-start', token),
  stickyMorphProgress: (token, progress) => ipcRenderer.send('sticky:morph-progress', token, progress),
  onStickyMotionBusy: cb => on('sticky:motion-busy', cb),
  onStickyMotionIdle: cb => on('sticky:motion-idle', cb),
  stickyFinishMorph: token => ipcRenderer.invoke('sticky:morph-finish', token),
  stickyRead: () => ipcRenderer.invoke('sticky:read'),
  stickyClose: () => ipcRenderer.send('sticky:close'),
  stickySetIgnore: (ignore) => ipcRenderer.send('sticky:set-ignore', ignore),
  setReview: (id, due) => ipcRenderer.invoke('review:set', id, due),
  onStickyItem: cb => on('sticky:item', cb),
  onStickyError: cb => on('sticky:error', cb),
  onStickyState: (cb) => on('sticky:state', cb),

  // shared
  onSettings: (cb) => on('settings', cb),
});
