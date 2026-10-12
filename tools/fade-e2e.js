module.exports = async ({ app, win, splash }) => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    if (!splash || splash.isDestroyed()) throw new Error('未创建启动窗');
    const samples = [];
    for (let i = 0; i < 150; i++) {
      const splashDestroyed = splash.isDestroyed();
      samples.push({
        main: win.isDestroyed() ? null : win.getOpacity(),
        splash: splashDestroyed ? null : splash.getOpacity(),
        splashDestroyed
      });
      if (splashDestroyed) break;
      await sleep(20);
    }
    await sleep(80);
    const report = {
      splashDestroyed: splash.isDestroyed(),
      mainOpacity: win.isDestroyed() ? null : win.getOpacity(),
      mainVisible: win.isDestroyed() ? null : win.isVisible(),
      sawMainFade: samples.some(sample => sample.main > 0.02 && sample.main < 0.98),
      sawSplashFade: samples.some(sample => sample.splash > 0.02 && sample.splash < 0.98),
      sampleCount: samples.length
    };
    const pass = report.splashDestroyed && report.mainOpacity === 1 && report.mainVisible === false &&
      report.sawMainFade && report.sawSplashFade;
    console.log(`[${pass ? 'PASS' : 'FAIL'}] 启动窗淡出与主窗口淡入终态: ${JSON.stringify(report)}`);
    app.exit(pass ? 0 : 1);
  } catch (error) {
    console.error('[窗口淡化专项异常]', error.stack || error);
    app.exit(2);
  }
};
