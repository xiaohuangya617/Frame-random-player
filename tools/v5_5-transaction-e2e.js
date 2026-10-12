const fs = require('fs');
const path = require('path');

for (const stream of [process.stdout, process.stderr]) {
  if (stream && stream.on) stream.on('error', err => {
    if (err.code !== 'EPIPE') process.exitCode = 1;
  });
}

module.exports = async ({ app, win, DATA_DIR }) => {
  const results = [];
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const js = code => win.webContents.executeJavaScript(code, true);
  const dataFile = path.join(DATA_DIR, 'data.json');
  const dataKey = path.resolve(dataFile).toLowerCase();
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail });
    (ok ? console.log : console.error)(`[${ok ? 'PASS' : 'FAIL'}] ${name}: ${detail}`);
  };
  const readData = () => JSON.parse(fs.readFileSync(dataFile, 'utf8'));
  const failFinalDataCommit = async action => {
    const realRename = fs.renameSync;
    fs.renameSync = (source, target) => {
      if (path.resolve(target).toLowerCase() === dataKey) {
        const error = new Error('合成 data.json 最终提交失败');
        error.code = 'EACCES';
        throw error;
      }
      return realRename(source, target);
    };
    try {
      return await action();
    } finally {
      fs.renameSync = realRename;
    }
  };

  try {
    for (let i = 0; i < 100; i++) {
      if (await js("typeof S!=='undefined'&&document.readyState==='complete'").catch(() => false)) break;
      await sleep(100);
    }
    await sleep(500);

    const media = path.join(DATA_DIR, 'media');
    fs.mkdirSync(media, { recursive: true });
    const originalPath = path.join(media, 'original.mp4');
    const renamedPath = path.join(media, 'renamed.mp4');
    fs.copyFileSync(path.join(process.cwd(), 'test-data', 'mov_bbb.mp4'), originalPath);
    process.env.RANDOMPLAYER_E2E_FOLDER = media;

    const baseline = await js(`(async()=>{
      window.__autoConfirm=true;
      const root=await window.api.pickFolder();
      const cat={id:'baseline-category',name:'原合集',type:'collection',roots:[root],videoMetas:[],videos:[],currentPool:[],order:0,permissionRestored:false};
      S.categories=[cat];S.activeCategoryId=cat.id;S.currentVideo=null;
      const scan=await loadVideosFromHandles(cat);
      const video=cat.videos[0];
      video.id='baseline-video';video.watchCount=7;video.likeCount=2;video.likeCountBaseline=1;video.tags=['KEEP'];video.watched=false;
      cat.currentPool=[video];S.currentVideo=video;S.history=[{name:video.name,category:cat.name,categoryId:cat.id,videoId:video.id,time:'12:34'}];
      S.achievements=normalizeAchievements({stats:{totalPlays:7,totalLikes:2,categoryPlays:{[cat.id]:7}},unlocked:{viewer1:true}});
      S.settings={prefixPresets:['[原] '],tags:['KEEP'],lastPrefix:'[原] '};S.strategy='liked';
      const saved=await persistAllNow();renderTabs();updateUI();
      return {scan:scan.ok,saved:saved.ok,name:video.name,path:video.path};
    })()`);
    check('事务测试基线保存成功', baseline.scan && baseline.saved && baseline.name === 'original.mp4', JSON.stringify(baseline));

    const renameResult = await failFinalDataCommit(() => js(`(async()=>{
      showRenameModal();$('prefixInput').value='';$('renameInput').value='renamed';
      await applyRename();
      const cat=S.categories[0],video=cat.videos[0];
      return {name:video.name,path:video.path,lastPrefix:S.settings.lastPrefix,current:S.currentVideo&&S.currentVideo.id,
        toast:$('toastContainer').textContent,fileTitle:$('videoTitle').textContent};
    })()`));
    const renameDisk = readData();
    const renameOk = fs.existsSync(originalPath) && !fs.existsSync(renamedPath) &&
      renameResult.name === 'original.mp4' && path.resolve(renameResult.path) === path.resolve(originalPath) &&
      renameResult.lastPrefix === '[原] ' && renameResult.current === 'baseline-video' &&
      renameDisk.categories[0].videos[0].name === 'original.mp4' &&
      renameResult.toast.includes('已恢复原文件名') && !renameResult.toast.includes('已重命名为');
    check('重命名提交失败会回滚文件、内存、提示和存档', renameOk, JSON.stringify(renameResult));

    const restoreBackup = path.join(DATA_DIR, 'restore-target.json');
    fs.writeFileSync(restoreBackup, JSON.stringify({
      version: 12,
      categories: [{
        id: 'restored-category', name: '恢复目标', type: 'collection', roots: [],
        videos: [{ id: 'restored-video', name: 'restored.mp4', path: 'X:\\restored.mp4', watched: true }], order: 0
      }],
      achievements: { stats: { totalPlays: 99 }, unlocked: { restored: true } },
      settings: { prefixPresets: ['[恢复] '], tags: ['RESTORED'], lastStrategy: 'short', lastPrefix: '[恢复] ' },
      meta: { categoryCount: 1, totalVideos: 1, backupTime: '2026-09-06T00:00:00.000Z' }
    }, null, 2), 'utf8');
    process.env.RANDOMPLAYER_E2E_BACKUP = restoreBackup;
    const beforeRestoreDisk = fs.readFileSync(dataFile, 'utf8');
    const restoreResult = await failFinalDataCommit(() => js(`(async()=>{
      const before=JSON.stringify({payload:buildPersistPayload(),active:S.activeCategoryId,current:S.currentVideo&&S.currentVideo.id,history:S.history});
      await restoreData();
      const after=JSON.stringify({payload:buildPersistPayload(),active:S.activeCategoryId,current:S.currentVideo&&S.currentVideo.id,history:S.history});
      return {same:before===after,category:S.categories[0]&&S.categories[0].id,active:S.activeCategoryId,
        current:S.currentVideo&&S.currentVideo.id,toast:$('toastContainer').textContent};
    })()`));
    const restoreDiskSame = fs.readFileSync(dataFile, 'utf8') === beforeRestoreDisk;
    check('恢复提交失败保持原运行态和磁盘存档', restoreResult.same && restoreDiskSame &&
      restoreResult.category === 'baseline-category' && restoreResult.active === 'baseline-category' &&
      restoreResult.current === 'baseline-video' && restoreResult.toast.includes('恢复失败，原数据保持不变'), JSON.stringify(restoreResult));

    const beforeResetDisk = fs.readFileSync(dataFile, 'utf8');
    const resetFailure = await failFinalDataCommit(() => js(`(async()=>{
      const before=JSON.stringify({payload:buildPersistPayload(),active:S.activeCategoryId,current:S.currentVideo&&S.currentVideo.id,history:S.history});
      await resetAllPools();
      const after=JSON.stringify({payload:buildPersistPayload(),active:S.activeCategoryId,current:S.currentVideo&&S.currentVideo.id,history:S.history});
      return {same:before===after,count:S.categories.length,current:S.currentVideo&&S.currentVideo.id,toast:$('toastContainer').textContent};
    })()`));
    const resetDiskSame = fs.readFileSync(dataFile, 'utf8') === beforeResetDisk;
    check('初始化提交失败保持原运行态且不显示成功', resetFailure.same && resetDiskSame &&
      resetFailure.count === 1 && resetFailure.current === 'baseline-video' &&
      resetFailure.toast.includes('数据初始化失败，原数据保持不变') && !resetFailure.toast.includes('数据初始化完成'), JSON.stringify(resetFailure));

    const resetSuccess = await js(`(async()=>{
      $('toastContainer').innerHTML='';
      await resetAllPools();
      return {count:S.categories.length,active:S.activeCategoryId,current:S.currentVideo,history:S.history.length,
        total:S.achievements.stats.totalPlays,toast:$('toastContainer').textContent};
    })()`);
    const resetDisk = readData();
    check('初始化提交成功后才切换为空状态', resetSuccess.count === 0 && resetSuccess.active === null &&
      resetSuccess.current === null && resetSuccess.history === 0 && resetSuccess.total === 0 &&
      resetDisk.categories.length === 0 && !fs.existsSync(dataFile + '.tmp') && resetSuccess.toast.includes('数据初始化完成'), JSON.stringify(resetSuccess));

    fs.writeFileSync(path.join(DATA_DIR, 'v5_5-transaction-result.json'), JSON.stringify(results, null, 2), 'utf8');
    const failed = results.filter(item => !item.ok).length;
    console.log(`5.5 事务专项结束: ${results.length - failed}/${results.length} 通过`);
    app.exit(failed ? 1 : 0);
  } catch (error) {
    console.error('[5.5 事务专项异常]', error.stack || error);
    try { fs.writeFileSync(path.join(DATA_DIR, 'v5_5-transaction-result.json'), JSON.stringify({ results, error: error.stack || String(error) }, null, 2)); } catch { /* 忽略 */ }
    app.exit(2);
  }
};
