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
  getAppVersion: () => ipcRenderer.invoke('app:version'),
  reportBootStage: (label, progress) => ipcRenderer.send('boot:stage', { label, progress }),
  reportBootCategory: (done, total) => ipcRenderer.send('boot:category', { done, total }),
  reportBootDone: (error = '') => ipcRenderer.send('boot:done', { error }),
  readText: (p) => ipcRenderer.invoke('fs:readText', p),
  pickSubtitleFolder: () => ipcRenderer.invoke('fs:pickSubtitleFolder'),
  setSubtitleFolder: (folder) => ipcRenderer.invoke('fs:setSubtitleFolder', folder),
  readSubtitle: (videoName) => ipcRenderer.invoke('fs:readSubtitle', videoName),

  // 对话框
  pickFolder: () => ipcRenderer.invoke('fs:pickFolder'),
  pickBackupFile: () => ipcRenderer.invoke('fs:pickBackupFile'),
  saveBackup: (payload, name) => ipcRenderer.invoke('fs:saveBackup', payload, name),
  saveText: (content, name) => ipcRenderer.invoke('fs:saveText', content, name),

  // 文件系统
  scanFolder: (root) => ipcRenderer.invoke('fs:scanFolder', root),
  renameFile: (oldPath, newName) => ipcRenderer.invoke('fs:renameFile', oldPath, newName),
  trashFile: (p) => ipcRenderer.invoke('fs:trashFile', p),
  deletePermanently: (p) => ipcRenderer.invoke('fs:deletePermanently', p),
  revealFile: (p) => ipcRenderer.invoke('fs:revealFile', p),
  toFileUrl: (p) => ipcRenderer.invoke('fs:toFileUrl', p),
  // 拖拽文件夹 -> 在隔离环境中取绝对路径，并交由主进程校验、授权。
  registerDroppedFolder: async (file) => {
    try {
      const p = webUtils.getPathForFile(file);
      return p ? ipcRenderer.invoke('fs:registerDroppedFolder', p) : null;
    } catch {
      return null;
    }
  },
  // 全局快捷键订阅（draw=随机抽取, delete=删除）
  onShortcut: (action, cb) => {
    ipcRenderer.on(`shortcut:${action}`, () => cb());
  }
});
