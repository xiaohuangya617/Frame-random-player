const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('splashApi', {
  onUpdate: callback => {
    if (typeof callback !== 'function') return;
    ipcRenderer.on('splash:update', (_event, update) => callback(update));
  },
  ready: () => ipcRenderer.send('splash:ready')
});
