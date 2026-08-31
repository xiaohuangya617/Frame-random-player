// 打包产物冒烟测试：验证 exe 旁 data/ 自动创建、页面正常加载
const fs = require('fs');
const path = require('path');

module.exports = async ({ app, win, DATA_DIR }) => {
  try {
    const exists = fs.existsSync(DATA_DIR) && fs.statSync(DATA_DIR).isDirectory();
    const ready = await win.webContents.executeJavaScript(`typeof S!=='undefined'&&typeof window.api!=='undefined'&&document.readyState==='complete'`).catch(() => false);
    const dir2 = await win.webContents.executeJavaScript(`window.api.getDataDir()`).catch(() => null);
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
