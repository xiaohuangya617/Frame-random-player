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
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail });
    (ok ? console.log : console.error)(`[${ok ? 'PASS' : 'FAIL'}] ${name}: ${detail}`);
  };

  try {
    for (let i = 0; i < 100; i++) {
      if (await js("typeof S!=='undefined'&&document.readyState==='complete'").catch(() => false)) break;
      await sleep(100);
    }
    await sleep(500);
    await js('window.__autoConfirm=true;0');

    const debounce = await js(`(async()=>{
      const result=await Promise.race([
        Promise.all([persistAll(),persistAll(),persistAll()]).then(values=>({done:true,values})),
        new Promise(resolve=>setTimeout(()=>resolve({done:false}),2500))
      ]);
      return result;
    })()`);
    check('并发保存全部完成', debounce.done && debounce.values.every(v => v.ok), JSON.stringify(debounce));

    const bridge = await js(`(async()=>{
      const exists=typeof window.api.registerDroppedFolder==='function';
      const fabricated=exists?await window.api.registerDroppedFolder(new File(['x'],'fake-folder')):'missing';
      return {exists,fabricated};
    })()`);
    check('拖拽目录使用校验授权桥', bridge.exists && bridge.fabricated === null, JSON.stringify(bridge));

    const backupNames = await js(`(async()=>{
      const payload=buildBackupPackage(),a=await window.api.autoBackup(payload),b=await window.api.autoBackup(payload);
      return {a:a&&a.path,b:b&&b.path,ok:a&&a.ok&&b&&b.ok};
    })()`);
    check('连续自动备份不会覆盖同名文件', backupNames.ok && backupNames.a !== backupNames.b, JSON.stringify(backupNames));

    const media = path.join(DATA_DIR, 'media');
    fs.mkdirSync(media, { recursive: true });
    const sample = path.join(process.cwd(), 'test-data', 'mov_bbb.mp4');
    fs.copyFileSync(sample, path.join(media, 'good.mp4'));
    fs.writeFileSync(path.join(media, 'bad.mp4'), Buffer.alloc(2048));
    process.env.RANDOMPLAYER_E2E_FOLDER = media;

    const initial = await js(`(async()=>{
      const root=await window.api.pickFolder();
      const cat={id:'source',name:'稳定性测试',type:'collection',roots:[root],videoMetas:[],videos:[],currentPool:[],order:0,permissionRestored:false};
      S.categories=[cat];S.activeCategoryId=cat.id;S.currentVideo=null;
      const scan=await loadVideosFromHandles(cat);
      await persistAll();renderTabs();updateUI();
      return {ok:scan.ok,count:cat.videos.length,names:cat.videos.map(v=>v.name)};
    })()`);
    check('测试合集扫描成功', initial.ok && initial.count === 2, JSON.stringify(initial));

    const rescan = await js(`(async()=>{
      const cat=S.categories[0],good=cat.videos.find(v=>v.name==='good.mp4');
      const id=good.id;good.watchCount=7;good.likeCount=2;good.tags=['SAFE'];
      const result=await loadVideosFromHandles(cat);
      const next=cat.videos.find(v=>v.name==='good.mp4');
      return {ok:result.ok,sameId:next.id===id,watchCount:next.watchCount,likeCount:next.likeCount,tags:next.tags};
    })()`);
    check('重扫使用当前元数据而非启动快照', rescan.ok && rescan.sameId && rescan.watchCount === 7 && rescan.likeCount === 2 && rescan.tags.includes('SAFE'), JSON.stringify(rescan));

    const offline = media + '-offline';
    fs.renameSync(media, offline);
    const failedScan = await js(`(async()=>{
      const cat=S.categories[0],before=cat.videos.map(v=>({id:v.id,watchCount:v.watchCount}));
      const result=await loadVideosFromHandles(cat,{silent:true});
      return {ok:result.ok,before,after:cat.videos.map(v=>({id:v.id,watchCount:v.watchCount})),ready:cat.permissionRestored};
    })()`);
    fs.renameSync(offline, media);
    check('目录不可访问时保留原列表', !failedScan.ok && JSON.stringify(failedScan.before) === JSON.stringify(failedScan.after) && !failedScan.ready, JSON.stringify(failedScan));

    const stash = path.join(DATA_DIR, 'stash');
    fs.mkdirSync(stash, { recursive: true });
    for (const name of ['good.mp4', 'bad.mp4']) fs.renameSync(path.join(media, name), path.join(stash, name));
    const emptyScan = await js(`(async()=>{
      const cat=S.categories[0],before=cat.videos.length;
      const result=await loadVideosFromHandles(cat,{silent:true});
      return {ok:result.ok,empty:result.empty,before,after:cat.videos.length};
    })()`);
    for (const name of ['good.mp4', 'bad.mp4']) fs.renameSync(path.join(stash, name), path.join(media, name));
    check('启动式空扫描不覆盖旧列表', !emptyScan.ok && emptyScan.empty && emptyScan.before === emptyScan.after, JSON.stringify(emptyScan));

    await js(`(async()=>{const cat=S.categories[0];await loadVideosFromHandles(cat);S.activeCategoryId=cat.id;return true})()`);
    const failedPlay = await js(`(async()=>{
      const cat=S.categories[0],video=cat.videos.find(v=>v.name==='bad.mp4');
      S.currentVideo=video;const before={watch:video.watchCount,total:S.achievements.stats.totalPlays,pool:cat.currentPool.length};
      await playVideo(video,{});await new Promise(r=>setTimeout(r,300));
      return {before,after:{watch:video.watchCount,total:S.achievements.stats.totalPlays,pool:cat.currentPool.length},watched:video.watched,
        skipped:S.unplayableVideoKeys.has(videoKey(video)),stillInPool:cat.currentPool.some(item=>item.id===video.id),badId:video.id,current:S.currentVideo&&S.currentVideo.id};
    })()`);
    check('播放失败不记观看并从本次会话池自动跳过', failedPlay.before.watch === failedPlay.after.watch &&
      !failedPlay.watched && failedPlay.skipped && !failedPlay.stillInPool && failedPlay.current !== failedPlay.badId, JSON.stringify(failedPlay));

    const poolSync = await js(`(async()=>{
      const source=S.categories[0],video=source.videos.find(v=>v.name==='good.mp4');
      video.tags=['SAFE'];video.watched=false;source.currentPool=source.videos.filter(v=>!v.watched);
      const tag={id:'tag-safe',name:'SAFE',type:'tags',tags:['SAFE'],roots:[],videos:[],currentPool:[],order:1,permissionRestored:true};
      S.categories.push(tag);syncTagCategories();S.activeCategoryId=tag.id;S.currentVideo=video;
      const before=video.watchCount;await playVideo(video,{});
      return {watchDelta:video.watchCount-before,watched:video.watched,sourceHas:source.currentPool.some(v=>v.id===video.id),tagHas:tag.currentPool.some(v=>v.id===video.id)};
    })()`);
    check('成功播放后记账且标签池同步', poolSync.watchDelta === 1 && poolSync.watched && !poolSync.sourceHas && !poolSync.tagHas, JSON.stringify(poolSync));

    const persistedTag = await js(`(async()=>{
      await persistAll();const data=await window.api.loadData();const tag=data.categories.find(c=>c.id==='tag-safe');
      return {tags:tag&&tag.tags,videos:tag&&tag.videos.length};
    })()`);
    check('标签合集跨保存保留规则且不重复保存视频', persistedTag.tags.includes('SAFE') && persistedTag.videos === 0, JSON.stringify(persistedTag));

    const stats = await js(`(()=>{
      const now=Date.now(),path=S.categories[0].videos.find(v=>v.name==='good.mp4').path;
      const make=(id)=>({id,name:'same.mp4',path,size:1024,watched:false,watchCount:1,likeCount:0,dislikeCount:0,playTimestamps:[now],likeTimestamps:[],seekTimestamps:[],tags:[]});
      S.categories=[
        {id:'a',name:'A',type:'collection',videos:[make('v1')],currentPool:[],roots:[],permissionRestored:true},
        {id:'b',name:'B',type:'collection',videos:[make('v2')],currentPool:[],roots:[],permissionRestored:true}
      ];
      const top=getTopVideosByRange('week',10);
      return {length:top.length,score:top[0]&&top[0].score};
    })()`);
    check('排行按真实路径去重且纯播放有分', stats.length === 1 && stats.score > 0, JSON.stringify(stats));

    const tagsMigration = await js(`(async()=>{
      const video=S.categories[0].videos[0];video.tags=['SAFE'];
      const tag={id:'tag-rule',name:'规则',type:'tags',tags:['SAFE'],roots:[],videos:[],currentPool:[],permissionRestored:true};
      S.categories.push(tag);S.settings.tags=['SAFE'];S.activeCategoryId=S.categories[0].id;S.currentVideo=video;syncTagCategories();showTagsModal();
      window.__autoPrompt='RENAMED';showTagsPresetsModal();
      Array.from(document.querySelectorAll('#tagsPresetList button')).find(b=>b.textContent==='改名').click();
      for(let i=0;i<20&&!Array.from(document.querySelectorAll('#tagsPresetList div > span')).some(s=>s.textContent==='RENAMED');i++)await new Promise(r=>setTimeout(r,50));
      const renamed=video.tags.includes('RENAMED')&&tag.tags.includes('RENAMED');
      const underlyingRenamed=Array.from(document.querySelectorAll('#tagsList button')).some(b=>b.textContent.includes('RENAMED'));
      window.__autoPrompt=undefined;window.__autoConfirm=true;
      Array.from(document.querySelectorAll('#tagsPresetList button')).find(b=>b.textContent==='删除').click();
      for(let i=0;i<20&&S.settings.tags.includes('RENAMED');i++)await new Promise(r=>setTimeout(r,50));
      const removed=!video.tags.includes('RENAMED')&&!tag.tags.includes('RENAMED');
      const underlyingRemoved=$('tagsList').querySelectorAll('button').length===0;
      closeTagsPresetsModal();closeTagsModal();return {renamed,removed,underlyingRenamed,underlyingRemoved};
    })()`);
    check('标签预设变更同步数据和底层窗口', tagsMigration.renamed && tagsMigration.removed && tagsMigration.underlyingRenamed && tagsMigration.underlyingRemoved, JSON.stringify(tagsMigration));

    const escaped = await js(`(()=>{
      S.categories=[{id:'escape',name:'<img src=x onerror="window.__xss=1">',type:'collection',roots:[],videos:[],currentPool:[],permissionRestored:true}];
      S.activeCategoryId='escape';window.__xss=0;renderTabs();
      return {images:$('categoryTabs').querySelectorAll('img').length,xss:window.__xss,text:$('categoryTabs').textContent};
    })()`);
    check('合集名称按文本渲染不可注入脚本', escaped.images === 0 && escaped.xss === 0 && escaped.text.includes('<img'), JSON.stringify(escaped));

    const backupFile = path.join(DATA_DIR, 'unlinked-backup.json');
    fs.writeFileSync(backupFile, JSON.stringify({
      version: 12,
      categories: [{ id: 'unlinked', name: '未关联合集', type: 'collection', roots: [], videos: [{ id: 'uv', name: 'lost.mp4', path: 'lost.mp4', size: 1, watchCount: 4, likeCount: 1 }] }],
      achievements: { stats: { totalPlays: 4 }, unlocked: {} },
      settings: { prefixPresets: [], tags: [], lastPrefix: '[R] ' }
    }));
    process.env.RANDOMPLAYER_E2E_BACKUP = backupFile;
    const restored = await js(`(async()=>{
      window.__autoConfirm=true;await restoreData();
      const cat=S.categories[0],data=await window.api.loadData(),p=$('mainPlayer');
      return {videos:cat.videos.length,metas:cat.videoMetas.length,ready:cat.permissionRestored,saved:data.categories[0].videos.length,prefix:S.settings.lastPrefix,
        paused:p.paused,src:p.getAttribute('src'),current:S.currentVideo};
    })()`);
    check('离线备份恢复保留元数据并停止旧播放', restored.videos === 1 && restored.metas === 1 && !restored.ready && restored.saved === 1 && restored.prefix === '[R] ' && restored.paused && !restored.src && restored.current === null, JSON.stringify(restored));

    const backupDir = path.join(DATA_DIR, 'backups');
    const savedBackupDir = path.join(DATA_DIR, 'backups.saved');
    if (fs.existsSync(savedBackupDir)) fs.rmSync(savedBackupDir, { recursive: true, force: true });
    if (fs.existsSync(backupDir)) fs.renameSync(backupDir, savedBackupDir);
    fs.writeFileSync(backupDir, 'block-directory');
    const backupAbort = await js(`(async()=>{
      window.__autoConfirm=true;const before=S.categories.length;await resetAllPools();return {before,after:S.categories.length};
    })()`);
    fs.unlinkSync(backupDir);
    if (fs.existsSync(savedBackupDir)) fs.renameSync(savedBackupDir, backupDir);
    check('自动备份失败时初始化中止', backupAbort.before > 0 && backupAbort.after === backupAbort.before, JSON.stringify(backupAbort));

    const modalAndSeek = await js(`(async()=>{
      window.__autoConfirm=undefined;const pending=showConfirmDialog('测试取消');const closed=closeTopModal();const answer=await pending;
      window.__autoConfirm=true;
      const cat=S.categories[0],video=cat.videos[0];S.activeCategoryId=cat.id;S.currentVideo=video;
      const before=S.achievements.stats.totalSeeks;_userSeekPending=false;$('mainPlayer').dispatchEvent(new Event('seeked'));
      const afterProgram=S.achievements.stats.totalSeeks;_userSeekPending=true;$('mainPlayer').dispatchEvent(new Event('seeked'));
      const afterUser=S.achievements.stats.totalSeeks;
      return {closed,answer,before,afterProgram,afterUser};
    })()`);
    check('Esc 取消确认框且程序跳转不记拖拽', modalAndSeek.closed && modalAndSeek.answer === false && modalAndSeek.afterProgram === modalAndSeek.before && modalAndSeek.afterUser === modalAndSeek.before + 1, JSON.stringify(modalAndSeek));

    const relinkRollbackDir = path.join(DATA_DIR, 'empty-relink');
    fs.mkdirSync(relinkRollbackDir, { recursive: true });
    process.env.RANDOMPLAYER_E2E_FOLDERS = relinkRollbackDir;
    process.env.RANDOMPLAYER_E2E_FOLDER_IDX = '0';
    const relinkRollback = await js(`(async()=>{
      const tag={id:'relink-tag',name:'标签合集',type:'tags',tags:['X'],roots:[],videos:[],currentPool:[],permissionRestored:true};
      const cat={id:'relink',name:'待关联',type:'collection',roots:[],videoMetas:[normalizeVideoMeta({id:'old',name:'old.mp4',path:'old.mp4'})],videos:[normalizeVideoMeta({id:'old',name:'old.mp4',path:'old.mp4'})],currentPool:[],permissionRestored:false};
      S.categories=[tag,cat];S.activeCategoryId=cat.id;window.__autoConfirm=false;
      await relinkCategoryRoots();window.__autoConfirm=true;
      return {roots:cat.roots,videos:cat.videos.length,ready:cat.permissionRestored,tagRoots:tag.roots};
    })()`);
    delete process.env.RANDOMPLAYER_E2E_FOLDERS;
    delete process.env.RANDOMPLAYER_E2E_FOLDER_IDX;
    check('关联失败可重试且不会误处理标签合集', relinkRollback.roots.length === 0 && relinkRollback.videos === 1 && !relinkRollback.ready && relinkRollback.tagRoots.length === 0, JSON.stringify(relinkRollback));

    const malformedVideo = await js(`(()=>normalizeVideoMeta({id:0,name:7,path:8,size:-1,watchCount:-3,likeCount:'bad',likeCountBaseline:9,dislikeCount:Infinity,playTimestamps:[1,'bad',2],tags:['A',7,'A']}))()`);
    check('损坏的视频元数据会被安全归一化', malformedVideo.id === '0' && malformedVideo.name === '未命名视频' && malformedVideo.path === '' && malformedVideo.size === 0 && malformedVideo.watchCount === 0 && malformedVideo.likeCount === 0 && malformedVideo.likeCountBaseline === 0 && malformedVideo.dislikeCount === 0 && JSON.stringify(malformedVideo.playTimestamps) === '[1,2]' && JSON.stringify(malformedVideo.tags) === '["A"]', JSON.stringify(malformedVideo));

    const interactionGuards = await js(`(()=>{
      _lastShortcutTime.draw=0;_lastShortcutTime.delete=0;
      const drawFirst=_shortcutGuard('draw'),deleteFirst=_shortcutGuard('delete'),drawRepeat=_shortcutGuard('draw');
      return {drawFirst,deleteFirst,drawRepeat};
    })()`);
    check('不同快捷键不再互相吞键', interactionGuards.drawFirst && interactionGuards.deleteFirst && !interactionGuards.drawRepeat, JSON.stringify(interactionGuards));

    const autoContinue = await js(`(()=>{
      const saved={categories:S.categories,active:S.activeCategoryId,current:S.currentVideo};
      const allowedPath=${JSON.stringify(path.join(media, 'good.mp4'))};
      const first=normalizeVideoMeta({id:'short-a',name:'a.mp4',path:allowedPath}),second=normalizeVideoMeta({id:'short-b',name:'b.mp4',path:allowedPath});
      const cat={id:'short',name:'短片',type:'collection',roots:[],videos:[first,second],currentPool:[first,second],permissionRestored:true};
      S.categories=[cat];S.activeCategoryId=cat.id;S.currentVideo=first;_lastDrawAt=Date.now();
      drawVideo({bypassCooldown:true});const next=S.currentVideo&&S.currentVideo.id;
      clearPlayer();S.categories=saved.categories;S.activeCategoryId=saved.active;S.currentVideo=saved.current;
      return {next};
    })()`);
    check('极短视频结束仍会自动续播', autoContinue.next === 'short-b', JSON.stringify(autoContinue));

    const endedGuard = await js(`(()=>({
      natural:isNaturalMediaEnd({ended:true,duration:.2,currentTime:.2}),
      switching:isNaturalMediaEnd({ended:true,duration:10,currentTime:1}),
      unloaded:isNaturalMediaEnd({ended:true,duration:NaN,currentTime:0})
    }))()`);
    check('仅真实播放到末尾触发自动续播', endedGuard.natural && !endedGuard.switching && !endedGuard.unloaded, JSON.stringify(endedGuard));

    const tagCurrent = await js(`(()=>{
      const saved={categories:S.categories,active:S.activeCategoryId,current:S.currentVideo};
      const video=normalizeVideoMeta({id:'tag-video',name:'tag.mp4',path:'tag.mp4',tags:['ONLY']});
      const source={id:'source-tag',name:'源',type:'collection',roots:[],videos:[video],currentPool:[video],permissionRestored:true};
      const tag={id:'tag-current',name:'标签',type:'tags',tags:['ONLY'],roots:[],videos:[],currentPool:[],permissionRestored:true};
      S.categories=[source,tag];S.activeCategoryId=tag.id;syncTagCategories();S.currentVideo=video;
      video.tags=[];syncTagCategories();const result={count:tag.videos.length,current:S.currentVideo};
      S.categories=saved.categories;S.activeCategoryId=saved.active;S.currentVideo=saved.current;return result;
    })()`);
    check('标签规则移除当前视频时清理播放器状态', tagCurrent.count === 0 && tagCurrent.current === null, JSON.stringify(tagCurrent));

    const localDate = await js(`localDateKey(new Date(2026,0,2,0,30,0))`);
    check('连续观看按本地日期记账', localDate === '2026-01-02', localDate);

    const crossCategoryDelete = await js(`(async()=>{
      clearPlayer();
      const path=${JSON.stringify(path.join(media, 'good.mp4'))};
      const first=normalizeVideoMeta({id:'delete-a',name:'good.mp4',path,tags:['ONLY']}),duplicate=normalizeVideoMeta({id:'delete-b',name:'good.mp4',path,tags:['ONLY']});
      const a={id:'delete-source-a',name:'A',type:'collection',roots:[],videos:[first],videoMetas:[first],currentPool:[first],permissionRestored:true};
      const b={id:'delete-source-b',name:'B',type:'collection',roots:[],videos:[duplicate],videoMetas:[duplicate],currentPool:[duplicate],permissionRestored:true};
      const tag={id:'delete-tag',name:'ONLY',type:'tags',tags:['ONLY'],roots:[],videos:[],currentPool:[],permissionRestored:true};
      S.categories=[a,b,tag];S.activeCategoryId=tag.id;syncTagCategories();S.currentVideo=tag.videos[0];
      await finishDelete(S.currentVideo,tag,'已完成测试清理');
      return {a:a.videos.length,b:b.videos.length,tag:tag.videos.length,current:S.currentVideo};
    })()`);
    check('标签合集删除会清理所有源合集记录', crossCategoryDelete.a === 0 && crossCategoryDelete.b === 0 && crossCategoryDelete.tag === 0 && crossCategoryDelete.current === null, JSON.stringify(crossCategoryDelete));

    const modalClosing = await js(`(()=>{
      const modals=Array.from(document.querySelectorAll('[id$="Modal"]')),failed=[];
      modals.forEach(m=>{m.style.display='none';m.classList.add('hidden')});
      for(const modal of modals){
        modal.style.display='flex';modal.classList.remove('hidden');
        const handled=closeTopModal();
        if(!handled||isModalVisible(modal.id))failed.push(modal.id);
        modal.style.display='none';modal.classList.add('hidden')}
      return {count:modals.length,failed};
    })()`);
    check('Esc 关闭逻辑覆盖全部弹窗', modalClosing.count > 10 && modalClosing.failed.length === 0, JSON.stringify(modalClosing));

    const imeGuard = await js(`(async()=>{
      window.__autoPrompt=undefined;let settled=false,value='pending';
      const pending=showPromptDialog('组合输入测试').then(result=>{settled=true;value=result});
      const input=$('promptDialogInput');input.value='正在输入';
      input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',code:'Enter',isComposing:true,bubbles:true}));
      await Promise.resolve();const ignored=!settled&&isModalVisible('promptDialogModal');
      promptDialogCancel();await pending;window.__autoPrompt=undefined;
      return {ignored,value,closed:!isModalVisible('promptDialogModal')};
    })()`);
    check('IME 组合输入期间 Enter 不会误提交', imeGuard.ignored && imeGuard.value === null && imeGuard.closed, JSON.stringify(imeGuard));

    const forbiddenFile = path.join(DATA_DIR, 'unregistered.txt');
    fs.writeFileSync(forbiddenFile, 'private');
    const permissionGuard = await js(`(async()=>{
      const path=${JSON.stringify(forbiddenFile)};
      const read=await window.api.readText(path),removed=await window.api.deletePermanently(path);
      const url=await window.api.toFileUrl(path);
      return {read,removed,urlAllowed:!!url};
    })()`);
    check('未授权路径不可读取、播放或永久删除', permissionGuard.read === null && permissionGuard.removed && !permissionGuard.removed.ok && !permissionGuard.urlAllowed && fs.existsSync(forbiddenFile), JSON.stringify(permissionGuard));

    const controlVisibility = await js(`(()=>{
      const tag={id:'visibility-tag',name:'标签',type:'tags',tags:[],roots:[],videos:[],currentPool:[],permissionRestored:true};
      const unlinked={id:'visibility-normal',name:'待关联',type:'collection',roots:[],videos:[],currentPool:[],permissionRestored:false};
      S.categories=[tag,unlinked];S.activeCategoryId=tag.id;updateUI();
      const hidden=$('supplementBtn').style.display==='none'&&$('refreshBtn').style.display==='none';
      S.activeCategoryId=unlinked.id;updateUI();
      return {hidden,restored:$('supplementBtn').style.display!=='none'&&$('refreshBtn').style.display!=='none'};
    })()`);
    check('离开标签合集后恢复普通合集操作按钮', controlVisibility.hidden && controlVisibility.restored, JSON.stringify(controlVisibility));

    const renameLock = await js(`(()=>{
      const path=${JSON.stringify(path.join(media, 'good.mp4'))};
      const first=normalizeVideoMeta({id:'rename-a',name:'a.mp4',path}),second=normalizeVideoMeta({id:'rename-b',name:'b.mp4',path});
      const cat={id:'rename-cat',name:'命名',type:'collection',roots:[],videos:[first,second],currentPool:[first,second],permissionRestored:true};
      S.categories=[cat];S.activeCategoryId=cat.id;S.currentVideo=first;showRenameModal();S.currentVideo=second;
      const locked=lockedRenameVideo();closeRenameModal();return {id:locked&&locked.video.id};
    })()`);
    check('重命名弹窗锁定打开时的视频', renameLock.id === 'rename-a', JSON.stringify(renameLock));

    const activeCategoryDelete = await js(`(async()=>{
      clearPlayer();const root=await window.api.pickFolder(),scan=await window.api.scanFolder(root),path=scan.files.find(file=>file.name==='good.mp4').path;
      const first=normalizeVideoMeta({id:'active-a',name:'a.mp4',path}),second=normalizeVideoMeta({id:'active-b',name:'b.mp4',path});
      const a={id:'active-cat-a',name:'A',type:'collection',roots:[],videos:[first],currentPool:[first],permissionRestored:true};
      const b={id:'active-cat-b',name:'B',type:'collection',roots:[],videos:[second],currentPool:[second],permissionRestored:true};
      S.categories=[a,b];S.activeCategoryId=a.id;S.currentVideo=first;$('mainPlayer').src=await window.api.toFileUrl(path);await $('mainPlayer').play();const wasPlaying=!$('mainPlayer').paused;window.__autoConfirm=true;
      await deleteCurrentCategory();const p=$('mainPlayer');
      return {wasPlaying,count:S.categories.length,active:S.activeCategoryId,current:S.currentVideo,paused:p.paused,src:p.getAttribute('src')};
    })()`);
    check('删除活动合集会停止播放并切换到剩余合集', activeCategoryDelete.wasPlaying && activeCategoryDelete.count === 1 && activeCategoryDelete.active === 'active-cat-b' && activeCategoryDelete.current === null && activeCategoryDelete.paused && !activeCategoryDelete.src, JSON.stringify(activeCategoryDelete));

    const resetLikeBaseline = await js(`(async()=>{
      const video=normalizeVideoMeta({id:'stats-video',name:'stats.mp4',path:${JSON.stringify(path.join(media, 'good.mp4'))},watchCount:4,likeCount:3,
        playTimestamps:[Date.now()],likeTimestamps:[Date.now()],seekTimestamps:[Date.now()]});
      const cat={id:'stats-cat',name:'统计',type:'collection',roots:[],videos:[video],currentPool:[video],permissionRestored:true};
      S.categories=[cat];S.activeCategoryId=cat.id;S.currentVideo=video;S.achievements=normalizeAchievements({stats:{totalPlays:4,totalLikes:3},unlocked:{}});window.__autoConfirm=true;
      await resetStatistics();const afterReset={watch:video.watchCount,likes:video.likeCount,baseline:video.likeCountBaseline};
      commitPlayStats(video,cat,{specialPlay:false});likeCurrentVideo();const afterOne=video.likeCount;likeCurrentVideo();await persistAll();
      return {afterReset,afterOne,afterTwo:video.likeCount};
    })()`);
    check('重置统计后点赞上限从新播放次数重新计算', resetLikeBaseline.afterReset.watch === 0 && resetLikeBaseline.afterReset.likes === 3 && resetLikeBaseline.afterReset.baseline === 3 && resetLikeBaseline.afterOne === 4 && resetLikeBaseline.afterTwo === 4, JSON.stringify(resetLikeBaseline));

    const initializationStop = await js(`(async()=>{
      const root=await window.api.pickFolder(),scan=await window.api.scanFolder(root),path=scan.files.find(file=>file.name==='good.mp4').path,video=normalizeVideoMeta({id:'reset-video',name:'good.mp4',path});
      const cat={id:'reset-cat',name:'初始化',type:'collection',roots:[],videos:[video],currentPool:[video],permissionRestored:true};
      S.categories=[cat];S.activeCategoryId=cat.id;S.currentVideo=video;const p=$('mainPlayer');p.src=await window.api.toFileUrl(path);await p.play();const wasPlaying=!p.paused;window.__autoConfirm=true;
      await resetAllPools();return {wasPlaying,paused:p.paused,src:p.getAttribute('src'),current:S.currentVideo,count:S.categories.length};
    })()`);
    check('数据初始化会停止并释放播放器', initializationStop.wasPlaying && initializationStop.paused && !initializationStop.src && initializationStop.current === null && initializationStop.count === 0, JSON.stringify(initializationStop));

    const revokedRoot = path.join(DATA_DIR, 'revoked-root');
    fs.mkdirSync(revokedRoot, { recursive: true });
    fs.copyFileSync(sample, path.join(revokedRoot, 'revoked.mp4'));
    process.env.RANDOMPLAYER_E2E_FOLDER = revokedRoot;
    const revokedPermissions = await js(`(async()=>{
      const root=await window.api.pickFolder();
      const cat={id:'revoked',name:'待删除',type:'collection',roots:[root],videoMetas:[],videos:[],currentPool:[],permissionRestored:false};
      S.categories=[cat];S.activeCategoryId=cat.id;
      const firstScan=await loadVideosFromHandles(cat),path=cat.videos[0]&&cat.videos[0].path;
      await persistAll();const before=await window.api.toFileUrl(path);
      S.categories=[];S.activeCategoryId=null;await persistAll();
      const after=await window.api.toFileUrl(path),secondScan=await window.api.scanFolder(root);
      return {firstScan:firstScan.ok,before:!!before,after:!!after,secondScan:secondScan.ok};
    })()`);
    check('删除合集后回收文件与目录授权', revokedPermissions.firstScan && revokedPermissions.before && !revokedPermissions.after && !revokedPermissions.secondScan, JSON.stringify(revokedPermissions));

    fs.writeFileSync(path.join(DATA_DIR, 'stability-result.json'), JSON.stringify(results, null, 2));
    const failed = results.filter(item => !item.ok).length;
    console.log(`稳定性专项结束: ${results.length - failed}/${results.length} 通过`);
    app.exit(failed ? 1 : 0);
  } catch (err) {
    console.error('[稳定性专项异常]', err.stack || err);
    try { fs.writeFileSync(path.join(DATA_DIR, 'stability-result.json'), JSON.stringify({ results, error: err.stack || String(err) }, null, 2)); } catch { /* 忽略 */ }
    app.exit(2);
  }
};
