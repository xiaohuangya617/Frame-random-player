// 随机播放器 EXE 版 - 主进程
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const dataStore = require('./dataStore');
const fileOps = require('./fileOps');

// 单实例锁：防止多开导致数据冲突
// 开发/测试模式（设置了 RANDOMPLAYER_DATA_DIR）跳过锁，避免与正式运行实例互相干扰
const DEV_TEST_MODE = !!process.env.RANDOMPLAYER_DATA_DIR;
const gotLock = DEV_TEST_MODE ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;

  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  /**
   * 数据根目录解析（便携设计：数据随 exe 走）
   * 优先级:
   *  1. 环境变量 RANDOMPLAYER_DATA_DIR（开发/测试用）
   *  2. 打包后: exe 所在目录/data（兼容单文件便携版的 PORTABLE_EXECUTABLE_DIR）
   *  3. 开发模式: 工程目录/dev-data
   */
  function resolveDataDir() {
    if (process.env.RANDOMPLAYER_DATA_DIR) return process.env.RANDOMPLAYER_DATA_DIR;
    if (app.isPackaged) {
      const base = process.env.PORTABLE_EXECUTABLE_DIR || path.dirname(process.execPath);
      return path.join(base, 'data');
    }
    return path.join(process.cwd(), 'dev-data');
  }
  const DATA_DIR = resolveDataDir();

  function createWindow() {
    const bounds = dataStore.getWindowBounds(DATA_DIR);
    mainWindow = new BrowserWindow({
      width: bounds.width || 1600,
      height: bounds.height || 900,
      minWidth: 1060,
      minHeight: 700,
      title: '随机播放器 5.2（桌面版）',
      icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
      autoHideMenuBar: true,
      backgroundColor: '#111827',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        spellcheck: false
      }
    });

    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));

    // 全局快捷键（窗口内）第一通道：before-input-event 通知渲染端（不吞键，避免影响输入框）
    // 第二通道在渲染端（页面级 keydown 捕获），双通道 + 去重，任何输入法/焦点状态都生效
    mainWindow.webContents.on('before-input-event', (event, input) => {
      if (input.type !== 'keyDown') return;
      const key = (input.key || '').toLowerCase();
      // Ctrl+D 随机抽取
      if ((input.control || input.meta) && (input.code === 'KeyD' || key === 'd')) {
        mainWindow.webContents.send('shortcut:draw');
        return;
      }
      // Delete 删除
      if (input.code === 'Delete' || key === 'delete' || key === 'del') {
        mainWindow.webContents.send('shortcut:delete');
        return;
      }
    });

    mainWindow.on('close', () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        dataStore.saveWindowBounds(DATA_DIR, mainWindow.getBounds());
      }
    });
    mainWindow.on('closed', () => { mainWindow = null; });

    // 测试钩子：RANDOMPLAYER_TESTSCRIPT 指向的模块在页面加载完成后执行
    mainWindow.webContents.once('did-finish-load', () => {
      const testScript = process.env.RANDOMPLAYER_TESTSCRIPT;
      if (testScript) {
        try {
          require(path.resolve(testScript))({ app, win: mainWindow, DATA_DIR });
        } catch (err) {
          console.error('测试脚本执行失败:', err);
          app.exit(1);
        }
      }
    });
  }

  // ---------- IPC ----------
  ipcMain.handle('data:load', () => dataStore.loadData(DATA_DIR));
  ipcMain.handle('data:save', (e, payload) => dataStore.saveData(DATA_DIR, payload));
  // 退出前同步落盘（beforeunload 阶段 IPC invoke 不可靠，用 sendSync）
  ipcMain.on('data:save-sync', (e, payload) => {
    try {
      e.returnValue = dataStore.saveData(DATA_DIR, payload);
    } catch (err) {
      e.returnValue = { ok: false, error: err.message };
    }
  });
  ipcMain.handle('app:dataDir', () => DATA_DIR);
  // 覆盖性操作（初始化/恢复）前的自动备份，写入 data/backups/
  ipcMain.handle('data:autoBackup', (e, payload) => {
    try {
      const dir = path.join(DATA_DIR, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
      const file = path.join(dir, `自动备份_${stamp}.json`);
      fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
      return { ok: true, path: file };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('app:dataExists', () => fs.existsSync(path.join(DATA_DIR, 'data.json')));

  // 手动递归复制（不用 fs.cpSync：Node 22 在 Windows 上复制含中文文件名的目录会崩溃）
  function copyDirSync(src, dst) {
    fs.mkdirSync(dst, { recursive: true });
    for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
      const s = path.join(src, ent.name);
      const d = path.join(dst, ent.name);
      if (ent.isDirectory()) copyDirSync(s, d);
      else if (ent.isFile()) fs.copyFileSync(s, d);
    }
  }

  // 发现旧版本存档：扫描数据目录父目录下，其他"随机播放器*"文件夹中的 data/data.json
  // （打包后数据目录父目录 = 各版本文件夹所在目录，如 随机播放器4.0 与 随机播放器4.1 同级）
  ipcMain.handle('data:findOldData', () => {
    const parent = path.dirname(DATA_DIR);
    const results = [];
    let entries = [];
    try {
      entries = fs.readdirSync(parent, { withFileTypes: true });
    } catch {
      return results;
    }
    for (const ent of entries) {
      if (!ent.isDirectory()) continue;
      if (!ent.name.includes('随机播放器') && !ent.name.includes('RandomPlayer')) continue;
      const dir = path.join(parent, ent.name);
      if (path.resolve(dir) === path.resolve(path.dirname(DATA_DIR))) continue;
      const dataFile = path.join(dir, 'data', 'data.json');
      if (!fs.existsSync(dataFile)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        results.push({
          dir,
          name: ent.name,
          categoryCount: Array.isArray(parsed.categories) ? parsed.categories.length : 0,
          version: parsed.version || '?',
          backupTime: (parsed.meta && parsed.meta.backupTime) || ''
        });
      } catch {
        // 损坏的存档跳过
      }
    }
    return results;
  });

  // 导入旧存档：把 srcDir/data 复制到当前数据目录（目标已有存档则拒绝）
  ipcMain.handle('data:importData', (e, srcDir) => {
    try {
      if (!srcDir || !fs.existsSync(path.join(srcDir, 'data', 'data.json'))) {
        return { ok: false, error: '源存档不存在' };
      }
      if (fs.existsSync(path.join(DATA_DIR, 'data.json'))) {
        return { ok: false, error: '当前数据目录已有存档' };
      }
      fs.mkdirSync(DATA_DIR, { recursive: true });
      copyDirSync(path.join(srcDir, 'data'), DATA_DIR);
      return { ok: true, path: DATA_DIR };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('fs:isDirectory', (e, p) => {
    try { return fs.statSync(p).isDirectory(); } catch { return false; }
  });
  ipcMain.handle('fs:readText', (e, p) => {
    try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
  });

  ipcMain.handle('fs:pickFolder', async () => {
    // E2E 钩子：可模拟依次选择多个文件夹（分号分隔，耗尽后返回 null）
    if (process.env.RANDOMPLAYER_E2E_FOLDERS) {
      const list = process.env.RANDOMPLAYER_E2E_FOLDERS.split(';').filter(Boolean);
      const idx = parseInt(process.env.RANDOMPLAYER_E2E_FOLDER_IDX || '0', 10);
      if (idx >= list.length) return null;
      process.env.RANDOMPLAYER_E2E_FOLDER_IDX = String(idx + 1);
      return list[idx];
    }
    if (process.env.RANDOMPLAYER_E2E_FOLDER) return process.env.RANDOMPLAYER_E2E_FOLDER;
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择视频文件夹',
      properties: ['openDirectory']
    });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  });

  ipcMain.handle('fs:pickBackupFile', async () => {
    if (process.env.RANDOMPLAYER_E2E_BACKUP) return process.env.RANDOMPLAYER_E2E_BACKUP;
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择备份文件',
      filters: [{ name: 'JSON 备份', extensions: ['json'] }],
      properties: ['openFile']
    });
    return r.canceled || !r.filePaths.length ? null : r.filePaths[0];
  });

  ipcMain.handle('fs:saveBackup', async (e, payload, defaultName) => {
    if (process.env.RANDOMPLAYER_E2E_BACKUP) {
      const p = process.env.RANDOMPLAYER_E2E_BACKUP;
      fs.writeFileSync(p, JSON.stringify(payload, null, 2), 'utf8');
      return p;
    }
    const defDir = path.join(DATA_DIR, 'backups');
    fs.mkdirSync(defDir, { recursive: true });
    const r = await dialog.showSaveDialog(mainWindow, {
      title: '保存备份',
      defaultPath: path.join(defDir, defaultName),
      filters: [{ name: 'JSON 备份', extensions: ['json'] }]
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, JSON.stringify(payload, null, 2), 'utf8');
    return r.filePath;
  });

  ipcMain.handle('fs:saveText', async (e, content, defaultName) => {
    if (process.env.RANDOMPLAYER_E2E_BACKUP) {
      const p = process.env.RANDOMPLAYER_E2E_BACKUP.replace(/\.json$/i, '.txt');
      fs.writeFileSync(p, content, 'utf8');
      return p;
    }
    const r = await dialog.showSaveDialog(mainWindow, {
      title: '保存文件',
      defaultPath: path.join(DATA_DIR, defaultName),
      filters: [{ name: '文本文件', extensions: ['txt'] }]
    });
    if (r.canceled || !r.filePath) return null;
    fs.writeFileSync(r.filePath, content, 'utf8');
    return r.filePath;
  });

  ipcMain.handle('fs:scanFolder', (e, root) => fileOps.scanFolder(root));
  ipcMain.handle('fs:renameFile', (e, oldPath, newName) => fileOps.renameFile(oldPath, newName));
  // 移入系统回收站：失败自动延迟重试一次（文件句柄释放需要时间）
  ipcMain.handle('fs:trashFile', async (e, p) => {
    const attempt = async () => {
      try {
        await shell.trashItem(p);
        return { ok: true };
      } catch (err) {
        return { ok: false, error: err.message };
      }
    };
    let r = await attempt();
    if (!r.ok) {
      await new Promise(res => setTimeout(res, 400));
      r = await attempt();
    }
    return r;
  });
  // 永久删除（兜底：系统回收站不可用时由用户确认后调用）
  ipcMain.handle('fs:deletePermanently', (e, p) => {
    try {
      fs.unlinkSync(p);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('fs:revealFile', (e, p) => { shell.showItemInFolder(p); });
  ipcMain.handle('fs:toFileUrl', (e, p) => pathToFileURL(p).href);

  app.whenReady().then(() => {
    // 启动时检测数据目录可写性
    const writable = dataStore.ensureWritable(DATA_DIR);
    console.log(`[数据目录] ${DATA_DIR} (可写: ${writable})`);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    app.quit();
  });
}
