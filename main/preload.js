// 随机播放器 EXE 版 - 预加载脚本（安全桥）
// 渲染进程只能通过 window.api 访问白名单能力
const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('api', {
  // 数据
  loadData: () => ipcRenderer.invoke('data:load'),
  saveData: (payload) => ipcRenderer.invoke('data:save', payload),
  saveDataSync: (payload) => ipcRenderer.sendSync('data:save-sync', payload),
  autoBackup: (payload) => ipcRenderer.invoke('data:autoBackup', payload),
  dataExists: () => ipcRenderer.invoke('app:dataExists'),
  findOldData: () => ipcRenderer.invoke('data:findOldData'),
  importData: (srcDir) => ipcRenderer.invoke('data:importData', srcDir),
  getDataDir: () => ipcRenderer.invoke('app:dataDir'),
  readText: (p) => ipcRenderer.invoke('fs:readText', p),

  // 对话框
  pickFolder: () => ipcRenderer.invoke('fs:pickFolder'),
  pickBackupFile: () => ipcRenderer.invoke('fs:pickBackupFile'),
  saveBackup: (payload, name) => ipcRenderer.invoke('fs:saveBackup', payload, name),
  saveText: (content, name) => ipcRenderer.invoke('fs:saveText', content, name),

  // 文件系统
  isDirectory: (p) => ipcRenderer.invoke('fs:isDirectory', p),
  scanFolder: (root) => ipcRenderer.invoke('fs:scanFolder', root),
  renameFile: (oldPath, newName) => ipcRenderer.invoke('fs:renameFile', oldPath, newName),
  trashFile: (p) => ipcRenderer.invoke('fs:trashFile', p),
  deletePermanently: (p) => ipcRenderer.invoke('fs:deletePermanently', p),
  revealFile: (p) => ipcRenderer.invoke('fs:revealFile', p),
  toFileUrl: (p) => ipcRenderer.invoke('fs:toFileUrl', p),
  // 拖拽文件 -> 绝对路径（Electron webUtils）
  getPathForFile: (file) => {
    try { return webUtils.getPathForFile(file); } catch { return null; }
  },
  // 全局快捷键订阅（draw=随机抽取, delete=删除）
  onShortcut: (action, cb) => {
    ipcRenderer.on(`shortcut:${action}`, () => cb());
  }
});
