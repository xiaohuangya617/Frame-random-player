// 随机播放器 EXE 版 - 主进程
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const { pathToFileURL } = require('url');
const dataStore = require('./dataStore');
const fileOps = require('./fileOps');
const migration = require('./migration');

// 单实例锁：防止多开导致数据冲突
// 开发/测试模式（设置了 RANDOMPLAYER_DATA_DIR）跳过锁，避免与正式运行实例互相干扰
const DEV_TEST_MODE = !!process.env.RANDOMPLAYER_DATA_DIR;
const AUTOMATED_TEST_MODE = DEV_TEST_MODE && !!process.env.RANDOMPLAYER_TESTSCRIPT;
if (AUTOMATED_TEST_MODE) app.disableHardwareAcceleration();
const gotLock = DEV_TEST_MODE ? true : app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  let mainWindow = null;
  let splashWindow = null;
  let splashOpenedAt = 0;
  let splashTimeout = null;
  let splashCloseTimer = null;
  let fadeTimer = null;
  let transitionStarted = false;
  let bootFinished = false;
  let latestSplashUpdate = { label: '启动中', progress: 0 };
  const splashUpdateHistory = [];

  const SPLASH_DISABLED = process.env.RANDOMPLAYER_NO_SPLASH === '1' ||
    (AUTOMATED_TEST_MODE && process.env.RANDOMPLAYER_TEST_SPLASH !== '1');
  const envMs = (name, fallback) => {
    const value = Number.parseInt(process.env[name] || '', 10);
    return Number.isFinite(value) && value >= 0 ? value : fallback;
  };
  const SPLASH_HOLD_MS = envMs('RANDOMPLAYER_SPLASH_HOLD_MS', 1200);
  const SPLASH_TIMEOUT_MS = Math.max(SPLASH_HOLD_MS, envMs('RANDOMPLAYER_SPLASH_TIMEOUT_MS', 60000));
  const WINDOW_FADE_MS = Math.min(2000, envMs('RANDOMPLAYER_FADE_MS', 280));
  const TEST_FADE_MODE = AUTOMATED_TEST_MODE && process.env.RANDOMPLAYER_TEST_FADE === '1';
  const BOOT_STAGE_LABELS = new Set(['正在加载界面', '正在读取数据', '正在整理视频库', '正在生成界面']);

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
  const allowedRoots = new Set();
  const pendingRoots = new Set();
  const allowedFiles = new Set();
  const readableTextFiles = new Set();
  let subtitleDirectory = '';
  const migrationDirs = new Set();

  const pathKey = p => {
    try { return path.resolve(String(p)).toLowerCase(); } catch { return ''; }
  };
  const registerRoot = (root, pending = false) => {
    if (typeof root !== 'string' || !root.trim()) return;
    (pending ? pendingRoots : allowedRoots).add(pathKey(root));
  };
  const registerRootsFromData = (data, pending = false) => {
    for (const category of (data && Array.isArray(data.categories) ? data.categories : [])) {
      for (const root of (Array.isArray(category.roots) ? category.roots : [])) registerRoot(root, pending);
    }
  };
  const reconcilePermissionsFromData = data => {
    const listedRoots = new Set();
    const listedFiles = new Set();
    for (const category of (data && Array.isArray(data.categories) ? data.categories : [])) {
      for (const root of (Array.isArray(category.roots) ? category.roots : [])) {
        if (typeof root === 'string' && root.trim()) listedRoots.add(pathKey(root));
      }
      for (const video of (Array.isArray(category.videos) ? category.videos : [])) {
        if (video && typeof video.path === 'string' && video.path) listedFiles.add(pathKey(video.path));
      }
    }
    for (const root of [...allowedRoots]) {
      if (!listedRoots.has(root)) allowedRoots.delete(root);
    }
    for (const root of listedRoots) {
      if (pendingRoots.has(root)) {
        pendingRoots.delete(root);
        allowedRoots.add(root);
      }
    }
    for (const file of [...allowedFiles]) {
      if (!listedFiles.has(file)) allowedFiles.delete(file);
    }
    const configuredSubtitleDir = data && data.settings && typeof data.settings.subtitleDir === 'string'
      ? data.settings.subtitleDir.trim() : '';
    subtitleDirectory = configuredSubtitleDir ? path.resolve(configuredSubtitleDir) : '';
  };
  const isAllowedRoot = root => {
    const key = pathKey(root);
    return allowedRoots.has(key) || pendingRoots.has(key);
  };
  const isAllowedFile = file => {
    const key = pathKey(file);
    return allowedFiles.has(key);
  };
  const registerBackup = file => {
    if (!file) return null;
    readableTextFiles.add(pathKey(file));
    try { registerRootsFromData(JSON.parse(fs.readFileSync(file, 'utf8')), true); } catch { /* 格式校验由渲染层负责 */ }
    return file;
  };

  const sendSplashUpdate = update => {
    latestSplashUpdate = update;
    if (AUTOMATED_TEST_MODE) {
      splashUpdateHistory.push({ ...update });
      if (splashUpdateHistory.length > 50) splashUpdateHistory.shift();
    }
    if (!splashWindow || splashWindow.isDestroyed() || splashWindow.webContents.isDestroyed()) return;
    splashWindow.webContents.send('splash:update', update);
  };

  const setWindowOpacity = (win, opacity) => {
    if (!win || win.isDestroyed()) return false;
    try {
      win.setOpacity(Math.max(0, Math.min(1, opacity)));
      return true;
    } catch {
      return false;
    }
  };

  const showMainWindow = () => {
    if (!mainWindow || mainWindow.isDestroyed()) return;
    setWindowOpacity(mainWindow, 1);
    if (AUTOMATED_TEST_MODE) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  };

  const finishWindowTransition = outgoingSplash => {
    if (fadeTimer) {
      clearInterval(fadeTimer);
      fadeTimer = null;
    }
    setWindowOpacity(mainWindow, 1);
    if (outgoingSplash && !outgoingSplash.isDestroyed()) outgoingSplash.destroy();
    if (splashWindow === outgoingSplash) splashWindow = null;
    showMainWindow();
  };

  const transitionToMainWindow = () => {
    if (transitionStarted) return;
    transitionStarted = true;
    const outgoingSplash = splashWindow;
    const canFade = WINDOW_FADE_MS > 0 && outgoingSplash && !outgoingSplash.isDestroyed() &&
      mainWindow && !mainWindow.isDestroyed() && (!AUTOMATED_TEST_MODE || TEST_FADE_MODE);
    if (!canFade) {
      finishWindowTransition(outgoingSplash);
      return;
    }
    if (!setWindowOpacity(mainWindow, 0) || !setWindowOpacity(outgoingSplash, 1)) {
      finishWindowTransition(outgoingSplash);
      return;
    }
    if (!AUTOMATED_TEST_MODE) mainWindow.showInactive();
    const startedAt = Date.now();
    const tick = () => {
      const progress = Math.min(1, (Date.now() - startedAt) / WINDOW_FADE_MS);
      const eased = 0.5 - Math.cos(Math.PI * progress) / 2;
      setWindowOpacity(mainWindow, eased);
      setWindowOpacity(outgoingSplash, 1 - eased);
      if (progress >= 1 || !mainWindow || mainWindow.isDestroyed()) finishWindowTransition(outgoingSplash);
    };
    fadeTimer = setInterval(tick, 16);
    tick();
  };

  const closeSplashAfterHold = (force = false) => {
    if (splashCloseTimer) return;
    if (!force && splashWindow && !splashOpenedAt) return;
    if (splashTimeout) {
      clearTimeout(splashTimeout);
      splashTimeout = null;
    }
    const remaining = force ? 0 : Math.max(0, SPLASH_HOLD_MS - (Date.now() - splashOpenedAt));
    splashCloseTimer = setTimeout(() => {
      splashCloseTimer = null;
      transitionToMainWindow();
    }, remaining);
  };

  const finishBoot = (result = {}) => {
    if (bootFinished) {
      if (result.force === true) closeSplashAfterHold(true);
      return;
    }
    bootFinished = true;
    if (result.error) {
      sendSplashUpdate({ label: '启动遇到问题，正在打开主界面', progress: 100, error: true });
    } else {
      sendSplashUpdate({ label: '界面就绪', progress: 100 });
    }
    closeSplashAfterHold(result.force === true);
  };

  function createSplashWindow() {
    if (SPLASH_DISABLED) return;
    splashOpenedAt = 0;
    transitionStarted = false;
    bootFinished = false;
    latestSplashUpdate = { label: '启动中', progress: 0 };
    splashUpdateHistory.length = 0;
    if (AUTOMATED_TEST_MODE) splashUpdateHistory.push({ ...latestSplashUpdate });
    splashWindow = new BrowserWindow({
      width: 380,
      height: 170,
      frame: false,
      thickFrame: false,
      resizable: false,
      movable: true,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      alwaysOnTop: true,
      focusable: false,
      skipTaskbar: true,
      show: false,
      center: true,
      backgroundColor: '#111827',
      webPreferences: {
        preload: path.join(__dirname, 'splash-preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    });
    splashWindow.loadFile(path.join(__dirname, '..', 'renderer', 'splash.html'));
    splashWindow.once('ready-to-show', () => {
      if (!splashWindow || splashWindow.isDestroyed()) return;
      if (process.env.RANDOMPLAYER_TEST_SPLASH_NO_READY === '1') return;
      splashOpenedAt = Date.now();
      if (!AUTOMATED_TEST_MODE) splashWindow.showInactive();
      splashWindow.webContents.send('splash:update', latestSplashUpdate.progress > 0 ? latestSplashUpdate : { label: '启动中', progress: 10 });
      if (bootFinished) closeSplashAfterHold();
    });
    splashWindow.webContents.once('did-fail-load', () => finishBoot({ error: '启动界面加载失败', force: true }));
    splashWindow.on('closed', () => { splashWindow = null; });
    splashTimeout = setTimeout(() => finishBoot({ error: '启动超时，已进入主界面', force: true }), SPLASH_TIMEOUT_MS);
  }

  const isMainSender = event => mainWindow && !mainWindow.isDestroyed() && event.sender === mainWindow.webContents;
  ipcMain.on('boot:stage', (event, stage) => {
    if (!isMainSender(event) || !stage || typeof stage !== 'object') return;
    const label = BOOT_STAGE_LABELS.has(stage.label) ? stage.label : '启动中';
    const progress = Math.max(0, Math.min(100, Number(stage.progress) || 0));
    sendSplashUpdate({ label, progress });
  });
  ipcMain.on('boot:category', (event, stage) => {
    if (!isMainSender(event) || !stage || typeof stage !== 'object') return;
    const done = Math.max(0, Math.floor(Number(stage.done) || 0));
    const total = Math.max(1, Math.floor(Number(stage.total) || 1));
    const progress = Math.min(90, 35 + Math.round(55 * Math.min(done, total) / total));
    sendSplashUpdate({ label: `正在整理视频库（${Math.min(done, total)}/${total}）`, progress });
  });
  ipcMain.on('boot:done', (event, result) => {
    if (!isMainSender(event)) return;
    const message = result && typeof result.error === 'string' ? result.error.slice(0, 120) : '';
    finishBoot(message ? { error: true } : {});
  });
  ipcMain.on('splash:ready', event => {
    if (!splashWindow || splashWindow.isDestroyed() || event.sender !== splashWindow.webContents) return;
    splashWindow.webContents.send('splash:update', latestSplashUpdate.progress > 0 ? latestSplashUpdate : { label: '启动中', progress: 10 });
  });

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1600,
      height: 900,
      minWidth: 1060,
      minHeight: 700,
      title: '随机播放器 5.8.1',
      icon: path.join(__dirname, '..', 'assets', 'icon.ico'),
      show: !AUTOMATED_TEST_MODE && !splashWindow,
      autoHideMenuBar: true,
      backgroundColor: '#111827',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        spellcheck: false
      }
    });
    setWindowOpacity(mainWindow, splashWindow ? 0 : 1);

    mainWindow.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
    mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    mainWindow.webContents.on('will-navigate', (event, url) => {
      if (url !== mainWindow.webContents.getURL()) event.preventDefault();
    });

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

    mainWindow.on('closed', () => { mainWindow = null; });

    // 测试钩子：RANDOMPLAYER_TESTSCRIPT 指向的模块在页面加载完成后执行
    mainWindow.webContents.once('did-finish-load', () => {
      sendSplashUpdate({ label: '正在加载界面', progress: 20 });
      const testScript = process.env.RANDOMPLAYER_TESTSCRIPT;
      const packagedSmoke = app.isPackaged && process.env.RANDOMPLAYER_PACKAGED_SMOKE === '1' && path.basename(testScript || '') === 'smoke.js';
      if (testScript && AUTOMATED_TEST_MODE && (!app.isPackaged || packagedSmoke)) {
        try {
          Promise.resolve(require(path.resolve(testScript))({
            app,
            win: mainWindow,
            splash: splashWindow,
            DATA_DIR,
            getSplashUpdates: () => splashUpdateHistory.map(update => ({ ...update }))
          })).catch(err => {
            console.error('测试脚本执行失败:', err);
            app.exit(1);
          });
        } catch (err) {
          console.error('测试脚本执行失败:', err);
          app.exit(1);
        }
      }
    });
  }

  // ---------- IPC ----------
  ipcMain.handle('data:load', () => {
    const data = dataStore.loadData(DATA_DIR);
    registerRootsFromData(data);
    const configuredSubtitleDir = data.settings && typeof data.settings.subtitleDir === 'string'
      ? data.settings.subtitleDir.trim() : '';
    subtitleDirectory = configuredSubtitleDir ? path.resolve(configuredSubtitleDir) : '';
    return data;
  });
  ipcMain.handle('data:save', (e, payload) => {
    const result = dataStore.saveData(DATA_DIR, payload);
    if (result && result.ok) reconcilePermissionsFromData(payload);
    return result;
  });
  // 退出前同步落盘（beforeunload 阶段 IPC invoke 不可靠，用 sendSync）
  ipcMain.on('data:save-sync', (e, payload) => {
    try {
      e.returnValue = dataStore.saveData(DATA_DIR, payload);
      if (e.returnValue && e.returnValue.ok) reconcilePermissionsFromData(payload);
    } catch (err) {
      e.returnValue = { ok: false, error: err.message };
    }
  });
  ipcMain.handle('app:dataDir', () => DATA_DIR);
  ipcMain.handle('app:version', () => app.getVersion());
  // 覆盖性操作（初始化/恢复）前的自动备份，写入 data/backups/
  ipcMain.handle('data:autoBackup', (e, payload) => {
    try {
      const dir = path.join(DATA_DIR, 'backups');
      fs.mkdirSync(dir, { recursive: true });
      const stamp = new Date().toISOString().replace(/[:.T]/g, '-').replace('Z', '');
      let file = path.join(dir, `自动备份_${stamp}.json`);
      let suffix = 1;
      while (fs.existsSync(file)) file = path.join(dir, `自动备份_${stamp}_${suffix++}.json`);
      fs.writeFileSync(file, JSON.stringify(payload, null, 2), 'utf8');
      return { ok: true, path: file };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('app:dataExists', () => fs.existsSync(path.join(DATA_DIR, 'data.json')));

  // 发现旧版本存档：扫描数据目录父目录下，其他"随机播放器*"文件夹中的 data/data.json
  // （打包后数据目录父目录 = 各版本文件夹所在目录，如 随机播放器4.0 与 随机播放器4.1 同级）
  ipcMain.handle('data:findOldData', () => {
    const currentVersionDir = path.dirname(DATA_DIR);
    const parent = path.dirname(currentVersionDir);
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
      if (path.resolve(dir) === path.resolve(currentVersionDir)) continue;
      const dataFile = path.join(dir, 'data', 'data.json');
      if (!fs.existsSync(dataFile)) continue;
      try {
        const parsed = JSON.parse(fs.readFileSync(dataFile, 'utf8'));
        migrationDirs.add(pathKey(dir));
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
      if (!migrationDirs.has(pathKey(srcDir))) return { ok: false, error: '源存档未经过迁移扫描确认' };
      if (!srcDir || !fs.existsSync(path.join(srcDir, 'data', 'data.json'))) {
        return { ok: false, error: '源存档不存在' };
      }
      if (fs.existsSync(path.join(DATA_DIR, 'data.json'))) {
        return { ok: false, error: '当前数据目录已有存档' };
      }
      const imported = migration.importDataAtomically(path.join(srcDir, 'data'), DATA_DIR);
      registerRootsFromData(dataStore.loadData(DATA_DIR));
      return { ok: true, path: DATA_DIR, backupPath: imported.backupPath || null };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });

  ipcMain.handle('fs:readText', (e, p) => {
    if (!readableTextFiles.has(pathKey(p))) return null;
    try { return fs.readFileSync(p, 'utf8'); } catch { return null; }
  });

  ipcMain.handle('fs:pickSubtitleFolder', async () => {
    const configured = process.env.RANDOMPLAYER_E2E_SUBTITLE_FOLDER;
    if (configured) {
      subtitleDirectory = path.resolve(configured);
      return subtitleDirectory;
    }
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择字幕文件夹（只读取本层 .srt 文件）',
      properties: ['openDirectory']
    });
    if (r.canceled || !r.filePaths.length) return null;
    subtitleDirectory = path.resolve(r.filePaths[0]);
    return subtitleDirectory;
  });

  ipcMain.handle('fs:setSubtitleFolder', (e, folder) => {
    subtitleDirectory = typeof folder === 'string' && folder.trim() ? path.resolve(folder.trim()) : '';
    return subtitleDirectory;
  });

  ipcMain.handle('fs:readSubtitle', (e, videoName) => {
    if (!subtitleDirectory || typeof videoName !== 'string' || !videoName.trim()) {
      return { ok: false, status: 'no-directory' };
    }
    const name = path.basename(videoName);
    if (name !== videoName || name === '.' || name === '..') {
      return { ok: false, status: 'invalid-name' };
    }
    const stem = path.basename(name, path.extname(name));
    if (!stem) return { ok: false, status: 'invalid-name' };
    const candidate = path.join(subtitleDirectory, `${stem}.srt`);
    if (path.dirname(candidate).toLowerCase() !== path.resolve(subtitleDirectory).toLowerCase()) {
      return { ok: false, status: 'invalid-name' };
    }
    try {
      if (!fs.existsSync(candidate) || !fs.statSync(candidate).isFile()) {
        return { ok: false, status: 'not-found' };
      }
      const bytes = fs.readFileSync(candidate);
      let text;
      try {
        text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
      } catch {
        try { text = new TextDecoder('gb18030').decode(bytes); }
        catch { text = bytes.toString('utf8'); }
      }
      return { ok: true, text };
    } catch (err) {
      return { ok: false, status: 'read-error', error: err.message };
    }
  });

  ipcMain.handle('fs:pickFolder', async () => {
    const accept = p => {
      if (p) registerRoot(p, true);
      return p || null;
    };
    // E2E 钩子：可模拟依次选择多个文件夹（分号分隔，耗尽后返回 null）
    if (process.env.RANDOMPLAYER_E2E_FOLDERS) {
      const list = process.env.RANDOMPLAYER_E2E_FOLDERS.split(';').filter(Boolean);
      const idx = parseInt(process.env.RANDOMPLAYER_E2E_FOLDER_IDX || '0', 10);
      if (idx >= list.length) return null;
      process.env.RANDOMPLAYER_E2E_FOLDER_IDX = String(idx + 1);
      return accept(list[idx]);
    }
    if (process.env.RANDOMPLAYER_E2E_FOLDER) return accept(process.env.RANDOMPLAYER_E2E_FOLDER);
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择视频文件夹',
      properties: ['openDirectory']
    });
    return r.canceled || !r.filePaths.length ? null : accept(r.filePaths[0]);
  });

  ipcMain.handle('fs:registerDroppedFolder', (e, p) => {
    try {
      if (typeof p !== 'string' || !fs.statSync(p).isDirectory()) return null;
      registerRoot(p, true);
      return p;
    } catch {
      return null;
    }
  });

  ipcMain.handle('fs:pickBackupFile', async () => {
    if (process.env.RANDOMPLAYER_E2E_BACKUP) return registerBackup(process.env.RANDOMPLAYER_E2E_BACKUP);
    const r = await dialog.showOpenDialog(mainWindow, {
      title: '选择备份文件',
      filters: [{ name: 'JSON 备份', extensions: ['json'] }],
      properties: ['openFile']
    });
    return r.canceled || !r.filePaths.length ? null : registerBackup(r.filePaths[0]);
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

  ipcMain.handle('fs:scanFolder', async (e, root) => {
    if (!isAllowedRoot(root)) return { ok: false, files: [], errors: [{ path: root, error: '未授权目录' }] };
    const result = await fileOps.scanFolder(root);
    for (const file of result.files) allowedFiles.add(pathKey(file.path));
    return result;
  });
  ipcMain.handle('fs:renameFile', (e, oldPath, newName) => {
    if (!isAllowedFile(oldPath)) return { ok: false, error: '文件不在已授权的合集目录中' };
    const result = fileOps.renameFile(oldPath, newName);
    if (result.ok) {
      allowedFiles.delete(pathKey(oldPath));
      allowedFiles.add(pathKey(result.newPath));
    }
    return result;
  });
  // 移入系统回收站：失败自动延迟重试一次（文件句柄释放需要时间）
  ipcMain.handle('fs:trashFile', async (e, p) => {
    if (!isAllowedFile(p)) return { ok: false, error: '文件不在已授权的合集目录中' };
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
    if (r.ok) allowedFiles.delete(pathKey(p));
    return r;
  });
  // 永久删除（兜底：系统回收站不可用时由用户确认后调用）
  ipcMain.handle('fs:deletePermanently', (e, p) => {
    if (!isAllowedFile(p)) return { ok: false, error: '文件不在已授权的合集目录中' };
    try {
      fs.unlinkSync(p);
      allowedFiles.delete(pathKey(p));
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err.message };
    }
  });
  ipcMain.handle('fs:revealFile', (e, p) => {
    if (!isAllowedFile(p)) return false;
    shell.showItemInFolder(p);
    return true;
  });
  ipcMain.handle('fs:toFileUrl', (e, p) => {
    if (!isAllowedFile(p)) return null;
    return pathToFileURL(p).href;
  });

  app.whenReady().then(() => {
    createSplashWindow();
    // 启动时检测数据目录可写性
    const writable = dataStore.ensureWritable(DATA_DIR);
    console.log(`[数据目录] ${DATA_DIR} (可写: ${writable})`);
    if (!writable) {
      sendSplashUpdate({ label: '数据目录不可写', progress: 100, error: true });
      setTimeout(() => {
        dialog.showErrorBox('数据目录不可写', `随机播放器无法写入数据目录：\n${DATA_DIR}\n\n请检查磁盘、目录权限或只读状态。`);
        app.quit();
      }, splashWindow ? 800 : 0);
      return;
    }
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('window-all-closed', () => {
    if (fadeTimer) clearInterval(fadeTimer);
    app.quit();
  });
}
