const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('glass', {
  send: value => ipcRenderer.send('glass:ui', value),
  reveal: value => ipcRenderer.invoke('glass:reveal', value),
  listen: (name, fn) => {
    if (!['state', 'collect', 'motion', 'placement'].includes(name)) return;
    ipcRenderer.on(`glass:${name}`, (_event, value) => fn(value));
  },
});
