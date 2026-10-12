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
  const diskText = () => fs.readFileSync(dataFile, 'utf8');
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
    const supplement = path.join(DATA_DIR, 'supplement');
    const createRoot = path.join(DATA_DIR, 'create-root');
    for (const dir of [media, supplement, createRoot]) fs.mkdirSync(dir, { recursive: true });
    const sample = path.join(process.cwd(), 'test-data', 'mov_bbb.mp4');
    fs.copyFileSync(sample, path.join(media, 'baseline.mp4'));
    fs.copyFileSync(sample, path.join(supplement, 'supplement.mp4'));
    fs.copyFileSync(sample, path.join(createRoot, 'create.mp4'));
    process.env.RANDOMPLAYER_E2E_FOLDER = media;

    const baseline = await js(`(async()=>{
      window.__autoConfirm=true;
      const root=await window.api.pickFolder();
      const cat={id:'v56-category',name:'5.6基线',type:'collection',roots:[root],videoMetas:[],videos:[],currentPool:[],order:0,permissionRestored:false};
      S.categories=[cat];S.activeCategoryId=cat.id;
      const scan=await loadVideosFromHandles(cat);
      const video=cat.videos[0];
      video.id='v56-video';video.watched=true;video.watchCount=7;video.likeCount=2;video.likeCountBaseline=1;
      video.playTimestamps=[1000];video.likeTimestamps=[2000];video.seekTimestamps=[3000];video.tags=['KEEP'];
      rebuildAllPools();S.currentVideo=video;S.history=[{name:video.name,category:cat.name,categoryId:cat.id,videoId:video.id,time:'12:34'}];
      S.achievements=normalizeAchievements({stats:{totalPlays:7,totalCollections:1,totalResets:2,totalRefreshes:3,categoryPlays:{[cat.id]:7}},unlocked:{}});
      S.settings={prefixPresets:['[原] '],tags:['KEEP','NEW'],lastPrefix:'[原] '};S.strategy='default';S.strategyCounter=1;
      const saved=await persistAllNow();renderTabs();updateUI();
      return {scan:scan.ok,saved:saved.ok,count:S.categories.length,videoCount:cat.videos.length};
    })()`);
    check('5.6 故障矩阵基线保存成功', baseline.scan && baseline.saved && baseline.count === 1 && baseline.videoCount === 1, JSON.stringify(baseline));
    const baselineDisk = diskText();

    const deleted = await failFinalDataCommit(() => js(`(async()=>{
      $('toastContainer').innerHTML='';await deleteCurrentCategory();
      return {count:S.categories.length,active:S.activeCategoryId,current:S.currentVideo&&S.currentVideo.id,toast:$('toastContainer').textContent};
    })()`));
    check('删除合集提交失败回滚内存、播放器和提示', deleted.count === 1 && deleted.active === 'v56-category' &&
      deleted.current === 'v56-video' && deleted.toast.includes('合集删除失败，原状态已恢复') &&
      !deleted.toast.includes('已删除') && diskText() === baselineDisk, JSON.stringify(deleted));

    const reset = await failFinalDataCommit(() => js(`(async()=>{
      $('toastContainer').innerHTML='';await resetCurrentPool();const cat=S.categories[0],video=cat.videos[0];
      return {watched:video.watched,pool:cat.currentPool.length,resets:S.achievements.stats.totalResets,toast:$('toastContainer').textContent};
    })()`));
    check('重置合集提交失败回滚观看池、统计和提示', reset.watched && reset.pool === 0 && reset.resets === 2 &&
      reset.toast.includes('当前合集重置失败，原状态已恢复') && !reset.toast.includes('当前合集已重置') &&
      diskText() === baselineDisk, JSON.stringify(reset));

    fs.copyFileSync(sample, path.join(media, 'refresh-added.mp4'));
    const refreshed = await failFinalDataCommit(() => js(`(async()=>{
      $('toastContainer').innerHTML='';await refreshCurrentCategory();const cat=S.categories[0];
      return {videos:cat.videos.map(video=>video.name),refreshes:S.achievements.stats.totalRefreshes,toast:$('toastContainer').textContent};
    })()`));
    fs.unlinkSync(path.join(media, 'refresh-added.mp4'));
    check('更新合集提交失败回滚扫描结果、统计和提示', refreshed.videos.length === 1 &&
      refreshed.videos[0] === 'baseline.mp4' && refreshed.refreshes === 3 &&
      refreshed.toast.includes('更新合集保存失败，原状态已恢复') && !refreshed.toast.includes('更新完成') &&
      diskText() === baselineDisk, JSON.stringify(refreshed));

    delete process.env.RANDOMPLAYER_E2E_FOLDER;
    process.env.RANDOMPLAYER_E2E_FOLDERS = supplement;
    process.env.RANDOMPLAYER_E2E_FOLDER_IDX = '0';
    const supplemented = await failFinalDataCommit(() => js(`(async()=>{
      $('toastContainer').innerHTML='';await supplementCurrentCategory();const cat=S.categories[0];
      return {roots:cat.roots.length,videos:cat.videos.map(video=>video.name),toast:$('toastContainer').textContent};
    })()`));
    delete process.env.RANDOMPLAYER_E2E_FOLDERS;
    delete process.env.RANDOMPLAYER_E2E_FOLDER_IDX;
    check('补充合集提交失败回滚目录、视频和提示', supplemented.roots === 1 && supplemented.videos.length === 1 &&
      supplemented.videos[0] === 'baseline.mp4' && supplemented.toast.includes('补充合集保存失败，原状态已恢复') &&
      !supplemented.toast.includes('已补充') && diskText() === baselineDisk, JSON.stringify(supplemented));

    process.env.RANDOMPLAYER_E2E_FOLDER = createRoot;
    const created = await failFinalDataCommit(() => js(`(async()=>{
      $('toastContainer').innerHTML='';openCollectionCreator();S.tempCollectionPaths=[await window.api.pickFolder()];
      updateSelectedDirsList();$('collectionNameInput').value='不应创建';await createCollection();
      const result={count:S.categories.length,active:S.activeCategoryId,current:S.currentVideo&&S.currentVideo.id,
        collections:S.achievements.stats.totalCollections,modal:!$('collectionModal').classList.contains('hidden'),toast:$('toastContainer').textContent};
      closeCollectionModal();return result;
    })()`));
    delete process.env.RANDOMPLAYER_E2E_FOLDER;
    check('创建合集提交失败回滚合集、统计和提示', created.count === 1 && created.active === 'v56-category' &&
      created.current === 'v56-video' && created.collections === 1 && created.modal &&
      created.toast.includes('合集创建失败，原状态已恢复') && !created.toast.includes('合集创建成功') &&
      diskText() === baselineDisk, JSON.stringify(created));

    const statistics = await failFinalDataCommit(() => js(`(async()=>{
      $('toastContainer').innerHTML='';await resetStatistics();const video=S.categories[0].videos[0];
      return {watch:video.watchCount,baseline:video.likeCountBaseline,plays:video.playTimestamps.length,
        likes:video.likeTimestamps.length,seeks:video.seekTimestamps.length,history:S.history.length,
        total:S.achievements.stats.totalPlays,toast:$('toastContainer').textContent};
    })()`));
    check('统计重置提交失败回滚视频、历史、总计和提示', statistics.watch === 7 && statistics.baseline === 1 &&
      statistics.plays === 1 && statistics.likes === 1 && statistics.seeks === 1 && statistics.history === 1 &&
      statistics.total === 7 && statistics.toast.includes('统计重置失败，原状态已恢复') &&
      !statistics.toast.includes('统计已重置') && diskText() === baselineDisk, JSON.stringify(statistics));

    const strategy = await failFinalDataCommit(() => js(`(async()=>{
      $('toastContainer').innerHTML='';await selectStrategy('liked');
      return {strategy:S.strategy,counter:S.strategyCounter,last:S.settings.lastStrategy,toast:$('toastContainer').textContent};
    })()`));
    check('策略提交失败回滚并取消成功提示', strategy.strategy === 'default' && strategy.counter === 1 &&
      strategy.last === undefined && strategy.toast.includes('策略变更保存失败，原状态已恢复') &&
      !strategy.toast.includes('已切换策略') && diskText() === baselineDisk, JSON.stringify(strategy));

    const prefix = await failFinalDataCommit(() => js(`(async()=>{
      $('toastContainer').innerHTML='';$('prefixNewPreset').value='[失败] ';await addPrefixPreset();
      return {presets:[...S.settings.prefixPresets],input:$('prefixNewPreset').value,toast:$('toastContainer').textContent};
    })()`));
    check('前缀预设提交失败回滚并保留输入', prefix.presets.length === 1 && prefix.presets[0] === '[原] ' &&
      prefix.input === '[失败] ' && prefix.toast.includes('预设添加保存失败，原状态已恢复') &&
      !prefix.toast.includes('预设已添加') && diskText() === baselineDisk, JSON.stringify(prefix));

    const tag = await failFinalDataCommit(() => js(`(async()=>{
      $('toastContainer').innerHTML='';const video=S.categories[0].videos[0];await toggleVideoTag(video,'NEW');
      return {tags:[...video.tags],toast:$('toastContainer').textContent};
    })()`));
    check('视频标签提交失败回滚并取消成功提示', tag.tags.length === 1 && tag.tags[0] === 'KEEP' &&
      tag.toast.includes('视频标签保存失败，原状态已恢复') && !tag.toast.includes('已添加标签') &&
      diskText() === baselineDisk, JSON.stringify(tag));

    fs.writeFileSync(path.join(DATA_DIR, 'v5_6-persistence-result.json'), JSON.stringify(results, null, 2), 'utf8');
    const failed = results.filter(item => !item.ok).length;
    console.log(`5.6 持久化故障专项结束: ${results.length - failed}/${results.length} 通过`);
    app.exit(failed ? 1 : 0);
  } catch (error) {
    console.error('[5.6 持久化故障专项异常]', error.stack || error);
    try {
      fs.writeFileSync(path.join(DATA_DIR, 'v5_6-persistence-result.json'), JSON.stringify({ results, error: error.stack || String(error) }, null, 2));
    } catch { /* 忽略 */ }
    app.exit(2);
  }
};
