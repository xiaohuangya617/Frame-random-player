module.exports = async ({ app, win }) => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const js = code => win.webContents.executeJavaScript(code, true);
  try {
    for (let i = 0; i < 100; i++) {
      if (await js(`typeof S!=='undefined'&&document.readyState==='complete'`).catch(() => false)) break;
      await sleep(100);
    }
    await sleep(300);
    const report = await js(`(()=>{
      const header=Array.from(document.querySelectorAll('#headerActions button')).map(button=>button.textContent.trim());
      const expectedHeader=['🔌 接口配置','⚙️ 策略变更','📋 浏览历史','👍 喜爱','📊 排行','💾📂 备份/恢复','❓ 指南','🏆 成就','🔄 初始化'];
      const bar=$('videoActionBar'),container=$('videoContainer');
      bar.classList.remove('hidden');container.classList.remove('hidden');
      const actionButtons=Array.from(bar.querySelectorAll('button'));
      const expectedActions=['🎬 字幕','✏️ 命名','🏷️ 标签','📂 路径','🗑️ 删除'];
      const inViewport=element=>{const b=element.getBoundingClientRect();return b.left>=0&&b.top>=0&&b.right<=innerWidth&&b.bottom<=innerHeight};
      $('apiSettingsBtn').click();
      const result={
        versionTitle:document.title,
        header,headerOrder:JSON.stringify(header)===JSON.stringify(expectedHeader),
        headerFits:$('headerActions').scrollWidth<=$('headerActions').clientWidth,
        actionTexts:actionButtons.map(button=>button.textContent.trim()),
        actionOrder:JSON.stringify(actionButtons.map(button=>button.textContent.trim()))===JSON.stringify(expectedActions),
        actionsVisible:inViewport(bar)&&actionButtons.every(inViewport),
        deleteLast:actionButtons.at(-1).id==='deleteVideoBtn',
        apiToast:$('toastContainer').textContent.includes('接口配置暂未实装'),
        statsTitle:$('statsModal').querySelector('h3').textContent.trim(),
        likedTitle:$('likedModal').querySelector('h3').textContent.trim(),
        guideTitle:$('helpModal').querySelector('h3').textContent.trim(),
        changelogFirst:$('changelogModal').querySelector('.version').textContent.trim()
      };
      return result;
    })()`);
    report.bounds = win.getBounds();
    report.hidden = !win.isVisible();
    const displayVersion = app.getVersion().replace(/\.0$/, '');
    const pass = report.versionTitle === `随机播放器 ${displayVersion}` && report.headerOrder && report.headerFits &&
      report.actionOrder && report.actionsVisible && report.deleteLast && report.apiToast &&
      report.statsTitle === '排行' && report.likedTitle === '喜爱' &&
      report.guideTitle === `随机播放器 ${displayVersion} 指南` && report.changelogFirst === `版本 ${displayVersion}` &&
      report.bounds.width === 1600 && report.bounds.height === 900 && report.hidden;
    console.log(`[${pass ? 'PASS' : 'FAIL'}] 5.4 文案、顺序、弹窗标题与布局: ${JSON.stringify(report)}`);
    app.exit(pass ? 0 : 1);
  } catch (error) {
    console.error('[5.4 定向界面测试异常]', error.stack || error);
    app.exit(2);
  }
};
