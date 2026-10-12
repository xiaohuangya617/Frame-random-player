module.exports = async ({ app, win, splash }) => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  try {
    if (!splash || splash.isDestroyed()) throw new Error('启动窗未创建或过早关闭');
    await sleep(1200);
    const report = {
      splashDestroyed: splash.isDestroyed(),
      mainHiddenDuringTest: !win.isVisible()
    };
    const pass = report.splashDestroyed && report.mainHiddenDuringTest;
    console.log(`[${pass ? 'PASS' : 'FAIL'}] 启动窗无 ready 信号时由超时兜底关闭: ${JSON.stringify(report)}`);
    app.exit(pass ? 0 : 1);
  } catch (error) {
    console.error('[启动窗超时专项异常]', error.stack || error);
    app.exit(2);
  }
};
