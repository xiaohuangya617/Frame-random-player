// 打包产物冒烟测试：验证 exe 旁 data/ 自动创建、页面正常加载
const fs = require('fs');
const path = require('path');

module.exports = async ({ app, win, DATA_DIR }) => {
  try {
    if (!process.env.RANDOMPLAYER_SMOKE_DATA_DIR || path.resolve(process.env.RANDOMPLAYER_SMOKE_DATA_DIR) !== path.resolve(DATA_DIR)) {
      throw new Error('冒烟测试拒绝写入未明确标记的测试数据目录');
    }
    const exists = fs.existsSync(DATA_DIR) && fs.statSync(DATA_DIR).isDirectory();
    const ready = await win.webContents.executeJavaScript(`typeof S!=='undefined'&&typeof window.api!=='undefined'&&document.readyState==='complete'`).catch(() => false);
    const dir2 = await win.webContents.executeJavaScript(`window.api.getDataDir()`).catch(() => null);
    const migrationSource = process.env.RANDOMPLAYER_SMOKE_MIGRATION_SOURCE;
    if (migrationSource) {
      const options = await win.webContents.executeJavaScript(`window.api.findOldData()`).catch(() => []);
      const found = options.some(item => path.resolve(item.dir) === path.resolve(migrationSource));
      const imported = found
        ? await win.webContents.executeJavaScript(`window.api.importData(${JSON.stringify(migrationSource)})`).catch(error => ({ ok: false, error: error.message }))
        : { ok: false, error: '未发现合成旧存档' };
      const backupPath = imported && imported.backupPath;
      const rescuePreserved = !!backupPath &&
        fs.existsSync(path.join(backupPath, 'data.json.bak')) &&
        fs.existsSync(path.join(backupPath, 'backups', 'keep.json')) &&
        fs.existsSync(path.join(backupPath, 'window-state.json'));
      const importedData = fs.existsSync(path.join(DATA_DIR, 'data.json')) &&
        JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'data.json'), 'utf8')).categories[0].id === 'packaged-import';
      const sourcePreserved = fs.existsSync(path.join(migrationSource, 'data', 'data.json'));
      console.log(`[SMOKE-MIGRATION] found=${found} importOk=${!!imported.ok} rescue=${rescuePreserved} source=${sourcePreserved} data=${importedData} backup=${backupPath}`);
      app.exit(ready && dir2 === DATA_DIR && found && imported.ok && rescuePreserved && sourcePreserved && importedData ? 0 : 1);
      return;
    }
    // 触发一次保存，验证 data.json 真实可写
    const saved = await win.webContents.executeJavaScript(`window.api.saveData({version:12,categories:[],achievements:{stats:{},unlocked:{}},settings:{}}).then(()=>true).catch(()=>false)`).catch(() => false);
    await new Promise(r => setTimeout(r, 400));
    const dataFile = path.join(DATA_DIR, 'data.json');
    const dataCreated = fs.existsSync(dataFile) && JSON.parse(fs.readFileSync(dataFile, 'utf8')).version === 12;
    let shot = null;
    try {
      const img = await win.webContents.capturePage();
      const shotPath = path.join(process.cwd(), 'test-shots', 'smoke-packaged.png');
      fs.writeFileSync(shotPath, img.toPNG());
      shot = shotPath;
    } catch (e) { /* 忽略 */ }
    console.log(`[SMOKE] dataDir=${dir2} dirExists=${exists} pageReady=${ready} saveOk=${saved} dataJson=${dataCreated} shot=${shot}`);
    const pass = exists && ready && dir2 === DATA_DIR && saved && dataCreated;
    app.exit(pass ? 0 : 1);
  } catch (err) {
    console.error('[SMOKE异常]', err);
    app.exit(2);
  }
};
