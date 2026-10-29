'use strict';
const {contextBridge,ipcRenderer}=require('electron');
const methods=['status','rendererReady','rendererQuitReady','recallReady','recallResult','recallTitles','settingsGet','settingsSet','connectionStatus','connectionChoose','connectionRetry','connectionInstall','connectionOpen','codexStatus','codexInstall'];
const api=Object.fromEntries(methods.map(method=>[method,(...args)=>ipcRenderer.invoke(`mengcang:${method}`,...args)]));
api.subscribe=callback=>{const listener=(_event,data)=>callback(data);ipcRenderer.on('mengcang:event',listener);return()=>ipcRenderer.removeListener('mengcang:event',listener);};
contextBridge.exposeInMainWorld('mengcang',Object.freeze(api));
