const fs = require('fs');
const path = require('path');

module.exports = async ({ app, win, splash, getSplashUpdates }) => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    if (!splash || splash.isDestroyed()) throw new Error('未创建启动窗');
    for (let i = 0; i < 50; i++) {
      if (splash.isDestroyed()) throw new Error('启动窗过早关闭');
      const ready = await splash.webContents.executeJavaScript(`document.readyState==='complete'`).catch(() => false);
      if (ready) break;
      await sleep(100);
    }
    await sleep(500);
    const report = await splash.webContents.executeJavaScript(`(()=>{
      const bar=document.querySelector('[role="progressbar"]'),logo=document.querySelector('.logo'),status=document.getElementById('status');
      return {
        title:document.title,status:status.textContent.trim(),progress:Number(bar.getAttribute('aria-valuenow')),
        logoReady:logo.complete&&logo.naturalWidth>0,overflowX:document.documentElement.scrollWidth>window.innerWidth,
        overflowY:document.documentElement.scrollHeight>window.innerHeight
      };
    })()`, true);
    const bounds = splash.getBounds();
    report.bounds = bounds;
    report.splashVisible = splash.isVisible();
    report.mainVisible = win.isVisible();
    const updates = typeof getSplashUpdates === 'function' ? getSplashUpdates() : [];
    report.updateLabels = updates.map(update => String(update.label || ''));
    const privacyTokens = (() => {
      try { return JSON.parse(process.env.RANDOMPLAYER_PRIVACY_SENTINELS || '[]'); } catch { return []; }
    })().filter(Boolean).map(String);
    const allowedStatus = /^(启动中|正在加载界面|正在读取数据|正在整理视频库|正在整理视频库（\d+\/\d+）|正在生成界面|界面就绪|启动遇到问题，正在打开主界面|数据目录不可写)$/;
    report.privacySafe = report.updateLabels.every(label => allowedStatus.test(label) && privacyTokens.every(token => !label.includes(token)));
    report.hasGenericScanProgress = report.updateLabels.some(label => /^正在整理视频库（\d+\/\d+）$/.test(label));
    const image = await splash.webContents.capturePage();
    const shotDir = path.join(process.cwd(), 'test-shots');
    fs.mkdirSync(shotDir, { recursive: true });
    fs.writeFileSync(path.join(shotDir, 'splash-5.4.png'), image.toPNG());
    const displayVersion = app.getVersion().replace(/\.0$/, '');
    const pass = report.title === `随机播放器 ${displayVersion}` && report.status && report.progress >= 20 && report.logoReady &&
      bounds.width === 380 && bounds.height === 170 && !report.overflowX && !report.overflowY &&
      !report.splashVisible && !report.mainVisible && report.privacySafe && report.hasGenericScanProgress;
    console.log(`[${pass ? 'PASS' : 'FAIL'}] 启动窗尺寸、通用进度、隐私与隐藏隔离: ${JSON.stringify(report)}`);
    app.exit(pass ? 0 : 1);
  } catch (error) {
    console.error('[启动窗专项异常]', error.stack || error);
    app.exit(2);
  }
};
