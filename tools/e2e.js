// E2E 测试脚本（由主进程 RANDOMPLAYER_TESTSCRIPT 钩子加载）
// 阶段1: 创建合集→播放→重命名→加前缀→预设→删除→备份→恢复→旧备份兼容→关联文件夹
// 阶段2: 重启后验证数据持久化
const fs = require('fs');
const path = require('path');

for (const stream of [process.stdout, process.stderr]) {
  if (stream && stream.on) stream.on('error', err => {
    if (err.code !== 'EPIPE') process.exitCode = 1;
  });
}

module.exports = async ({ app, win, DATA_DIR }) => {
  const results = { phase: process.env.RANDOMPLAYER_E2E_PHASE || '1', steps: [] };
  const shotDir = path.join(process.cwd(), 'test-shots');
  fs.mkdirSync(shotDir, { recursive: true });
  const pass = (name, detail) => { results.steps.push({ name, ok: true, detail }); console.log(`[PASS] ${name}: ${detail}`); };
  const fail = (name, detail) => { results.steps.push({ name, ok: false, detail }); console.error(`[FAIL] ${name}: ${detail}`); };
  const js = (code) => win.webContents.executeJavaScript(code, true).catch(err => {
    throw new Error(`JS执行失败 [${code.slice(0, 80)}...]: ${err.message}`);
  });
  const shot = async (name) => {
    try {
      const img = await win.webContents.capturePage();
      fs.writeFileSync(path.join(shotDir, name), img.toPNG());
      console.log(`[SHOT] ${name}`);
    } catch (e) { console.log('[SHOT失败]', name, e.message); }
  };
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const jstr = s => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
  // 通过主进程真实输入通道发送按键（会经过 before-input-event，与真实按键一致）
  const sendKey = (type, keyCode, modifiers) => win.webContents.sendInputEvent({ type, keyCode, modifiers: modifiers || [] });
  const pressCtrlD = () => {
    sendKey('keyDown', 'D', ['control']);
    sendKey('char', 'D', ['control']);
    sendKey('keyUp', 'D', ['control']);
  };
  const pressDelete = () => {
    sendKey('keyDown', 'Delete');
    sendKey('keyUp', 'Delete');
  };

  try {
    // 等待页面与数据加载
    for (let i = 0; i < 150; i++) {
      const ready = await js(`typeof S!=='undefined'&&typeof window.api!=='undefined'&&document.readyState==='complete'`).catch(() => false);
      if (ready) break;
      await sleep(200);
    }
    await sleep(1000);

    const startupBounds = win.getBounds();
    if (startupBounds.width === 1600 && startupBounds.height === 900) {
      pass('主窗口忽略旧尺寸并按默认大小启动', JSON.stringify(startupBounds));
    } else {
      fail('主窗口忽略旧尺寸并按默认大小启动', JSON.stringify(startupBounds));
    }

    // ============ 阶段2：重启持久化验证 ============
    if (process.env.RANDOMPLAYER_E2E_PHASE === '2') {
      const info = await js(`(async()=>{
        const cats=S.categories.map(c=>({name:c.name,roots:c.roots,videos:c.videos.map(v=>v.name),ready:c.permissionRestored}));
        return {cats,presets:S.settings.prefixPresets,strategy:S.strategy,dataDir:await window.api.getDataDir()};
      })()`);
      const cat = info.cats.find(c => c.name === '旧版合集');
      if (!cat) { fail('重启后合集存在', JSON.stringify(info.cats)); }
      else if (cat.roots.length < 1 || !cat.videos.includes('foo2.mp4')) {
        fail('重启后数据正确', JSON.stringify(cat));
      } else { pass('重启后数据正确(合集/视频/根目录)', JSON.stringify(cat)); }
      if (info.presets.includes('【动画】 ')) pass('重启后前缀预设保留', JSON.stringify(info.presets));
      else fail('重启后前缀预设保留', JSON.stringify(info.presets));
      if (info.strategy === 'default') pass('策略持久化', info.strategy);
      const raw = fs.readFileSync(path.join(DATA_DIR, 'data.json'), 'utf8');
      if (raw && JSON.parse(raw).version === 12) pass('data.json 格式正确', `version=12, ${(raw.length/1024).toFixed(1)}KB`);
      else fail('data.json 格式正确', 'version!=12');
      await shot('10-relaunch.png');
      const failCount = results.steps.filter(s => !s.ok).length;
      fs.writeFileSync(path.join(DATA_DIR, 'e2e-result.json'), JSON.stringify(results, null, 2), 'utf8');
      console.log(`阶段2结束: ${results.steps.length - failCount}/${results.steps.length} 通过`);
      app.exit(failCount ? 1 : 0);
      return;
    }

    // ============ 阶段1 ============
    // 重建测试数据（幂等：上一轮测试可能改/删了文件）
    const tdata = path.join(process.cwd(), 'test-data');
    for (const d of ['电影1', '电影1/sub', '剧集']) {
      fs.rmSync(path.join(tdata, d), { recursive: true, force: true });
      fs.mkdirSync(path.join(tdata, d), { recursive: true });
    }
    const sample = path.join(tdata, 'mov_bbb.mp4');
    fs.copyFileSync(sample, path.join(tdata, '电影1', 'foo1.mp4'));
    fs.copyFileSync(sample, path.join(tdata, '电影1', 'foo2.mp4'));
    fs.copyFileSync(sample, path.join(tdata, '电影1', 'sub', 'deep.mp4'));
    fs.writeFileSync(path.join(tdata, '剧集', 'bar.mkv'), Buffer.alloc(2048));

    // confirm 自动化（后续多个确认流程）
    await js(`window.__autoConfirm=true;0`);

    const folder = path.join(process.cwd(), 'test-data', '电影1');
    const sampleSize = fs.statSync(sample).size;

    // 构造"旧版本"目录（模拟用户旧版文件夹，与数据目录同级：数据目录父目录下的兄弟目录）
    const oldDir = path.join(path.dirname(path.dirname(DATA_DIR)), '随机播放器旧版测试');
    fs.rmSync(oldDir, { recursive: true, force: true });
    fs.mkdirSync(path.join(oldDir, 'data'), { recursive: true });
    fs.writeFileSync(path.join(oldDir, 'data', 'data.json'), JSON.stringify({
      version: 12,
      categories: [{
        id: 'oldcat1', name: '迁移合集', type: 'single', roots: [folder], order: 0,
        videos: [{
          id: 'oldv1', name: 'foo2.mp4', path: path.join(folder, 'foo2.mp4'),
          rootName: '电影1', relPath: 'foo2.mp4', size: sampleSize, watched: false,
          watchCount: 3, likeCount: 1, dislikeCount: 0,
          playTimestamps: [], likeTimestamps: [], seekTimestamps: []
        }]
      }],
      achievements: {
        stats: { totalPlays: 9, totalCollections: 1, totalResets: 0, totalRefreshes: 0, consecutiveDays: 0, lastPlayDate: null, totalSeeks: 0, categoryPlays: {}, totalLikes: 0, totalDislikes: 0, specialPlays: 0, logoClickCount: 0, nightPlays: 0 },
        unlocked: {}
      },
      settings: { prefixPresets: ['[旧] '], lastStrategy: 'default' },
      meta: { appVersion: '4.0', backupTime: '2026-08-01T00:00:00.000Z' }
    }, null, 2), 'utf8');

    // 主动触发一次迁移检测（页面加载时旧目录尚未创建；检测逻辑可重入）
    const detect = await js(`(async()=>{return await checkMigration()})()`);
    let migrateShown = await js(`!$('migrateModal').classList.contains('hidden')`).catch(() => false);
    if (detect && migrateShown) pass('检测到旧存档并弹出迁移窗口', '');
    else fail('检测到旧存档并弹出迁移窗口', JSON.stringify({ detect, migrateShown }));
    await shot('01b-migrate-modal.png');

    // 执行导入
    const migrated = await js(`(async()=>{
      await doImportMigration();
      await new Promise(r=>setTimeout(r,1500));
      const cat=S.categories[0];
      const v=cat?cat.videos.find(x=>x.name==='foo2.mp4'):null;
      return {n:S.categories.length,name:cat?cat.name:null,presets:S.settings.prefixPresets,watchCount:v?v.watchCount:0,videos:cat?cat.videos.length:0};
    })()`);
    if (migrated.n === 1 && migrated.name === '迁移合集' && migrated.presets.includes('[旧] ') && migrated.watchCount === 3 && migrated.videos >= 1) pass('旧存档导入(合集/记录/预设完整)', JSON.stringify(migrated));
    else fail('旧存档导入(合集/记录/预设完整)', JSON.stringify(migrated));
    await shot('01c-migrated.png');

    // 清空导入的数据，恢复干净状态继续后续流程
    await js(`(async()=>{await resetAllPools();return true})()`);
    await sleep(600);

    await shot('01-initial.png');
    // 创建合集
    process.env.RANDOMPLAYER_E2E_FOLDER = folder;
    const created = await js(`(async()=>{
      openCollectionCreator();
      S.tempCollectionPaths=[await window.api.pickFolder()];
      updateSelectedDirsList();
      $('collectionNameInput').value='测试合集';
      await createCollection();
      const cat=S.categories[0];
      return {n:S.categories.length,v:cat?cat.videos.length:0,names:cat?cat.videos.map(x=>x.name):[],ready:cat?cat.permissionRestored:false};
    })()`);
    delete process.env.RANDOMPLAYER_E2E_FOLDER;
    if (created.n === 1 && created.v >= 3 && created.ready) pass('创建合集+扫描', JSON.stringify(created.names));
    else fail('创建合集+扫描', JSON.stringify(created));
    await shot('02-collection.png');

    // header 按钮顺序与统一样式（4.5）
    const headerTest = await js(`(()=>{
      const btns=Array.from(document.querySelectorAll('header button'));
      const texts=btns.map(b=>b.textContent.trim());
      const normal=btns.filter(b=>b.id!=='resetAllBtn');
      const unified=normal.every(b=>b.className.includes('border-gray-600/60')&&b.className.includes('text-gray-300'));
      const reset=$('resetAllBtn');
      const danger=reset.className.includes('text-red-300')&&reset.className.includes('bg-red-900/30');
      const apiToast=!$('apiSettingsBtn');
      showHelpModal();
      const guideTitle=$('helpModal').querySelector('h3').textContent.trim();
      closeHelpModal();
      const actions=$('headerActions');
      return {texts,unified,danger,apiToast,guideTitle,fits:actions.scrollWidth<=actions.clientWidth};
    })()`);
    const expected=['⚙️ 策略变更','📋 浏览历史','👍 喜爱','📊 排行','💾📂 备份/恢复','❓ 指南','🏆 成就','🔄 初始化'];
    if (JSON.stringify(headerTest.texts) === JSON.stringify(expected) && headerTest.fits) pass('顶部按钮顺序且默认窗口完整露出', JSON.stringify(headerTest.texts));
    else fail('顶部按钮顺序且默认窗口完整露出', JSON.stringify(headerTest));
    if (headerTest.unified && headerTest.danger) pass('顶部普通按钮统一且初始化为红色危险样式', JSON.stringify({ unified: headerTest.unified, danger: headerTest.danger }));
    else fail('顶部普通按钮统一且初始化为红色危险样式', JSON.stringify(headerTest));
    const expectedGuideTitle = `随机播放器 ${app.getVersion().replace(/\.0$/, '')} 指南`;
    if (headerTest.apiToast && headerTest.guideTitle === expectedGuideTitle) pass('接口配置按钮已移除且指南标题正确', headerTest.guideTitle);
    else fail('接口配置占位提示和指南标题', JSON.stringify(headerTest));

    // 侧边栏按钮：补充/更新/重置顺序与命名（4.6/4.7）
    const asideTest = await js(`(()=>{
      const texts=Array.from(document.querySelectorAll('aside button')).map(b=>b.textContent.trim());
      return {hasSupplement:texts.includes('补充当前合集'),hasUpdate:texts.includes('更新当前合集'),noRefresh:!texts.includes('刷新当前合集'),
        hasVideoCreate:texts.includes('创建视频合集'),hasTagCreate:texts.includes('创建标签合集'),
        iReset:texts.indexOf('重置当前合集'),iSupplement:texts.indexOf('补充当前合集'),iUpdate:texts.indexOf('更新当前合集'),supplementBtnExists:!!$('supplementBtn')};
    })()`);
    if (asideTest.hasSupplement && asideTest.hasUpdate && asideTest.noRefresh && asideTest.supplementBtnExists && asideTest.hasVideoCreate && asideTest.hasTagCreate && asideTest.iReset >= 0 && asideTest.iSupplement > asideTest.iReset && asideTest.iUpdate > asideTest.iSupplement) pass('侧边栏按钮(补充/更新/创建)', JSON.stringify(asideTest));
    else fail('侧边栏按钮(补充/更新/创建)', JSON.stringify(asideTest));

    // 播放
    const played = await js(`(async()=>{
      const cat=S.categories[0];
      const v=cat.videos.find(x=>x.name==='foo1.mp4');
      S.currentVideo=v;
      await playVideo(v,{});
      await new Promise(r=>setTimeout(r,3000));
      return {name:v.name,paused:$('mainPlayer').paused,time:$('mainPlayer').currentTime,duration:$('mainPlayer').duration,barShown:!$('videoActionBar').classList.contains('hidden')};
    })()`);
    if (!played.paused && played.duration > 0 && played.barShown) pass('视频播放+操作栏显示', `t=${played.time.toFixed(1)}/${played.duration.toFixed(1)}`);
    else fail('视频播放+操作栏显示', JSON.stringify(played));
    const actionBarTest = await js(`(()=>{
      const buttons=Array.from($('videoActionBar').querySelectorAll('button'));
      const texts=buttons.map(button=>button.textContent.trim());
      $('subtitleBtn').click();
      const toastBox=$('toastContainer').getBoundingClientRect();
      const barBox=$('videoActionBar').getBoundingClientRect();
      return {texts,subtitleImplemented:!$('subtitleBtn').title.includes('暂未实装'),deleteLast:buttons.at(-1).id==='deleteVideoBtn',toastClearOfActions:toastBox.bottom<=barBox.top};
    })()`);
    const expectedActions=['🎬 字幕','📁 字幕目录','✏️ 命名','🏷️ 标签','📂 路径','🗑️ 删除'];
    if (JSON.stringify(actionBarTest.texts) === JSON.stringify(expectedActions) && actionBarTest.subtitleImplemented && actionBarTest.deleteLast && actionBarTest.toastClearOfActions) {
      pass('操作栏顺序和字幕入口', JSON.stringify(actionBarTest.texts));
    } else {
      fail('操作栏顺序和字幕入口', JSON.stringify(actionBarTest));
    }
    await shot('03-playing.png');

    // 重命名
    const renamed = await js(`(async()=>{
      const cat=S.categories[0];
      const v=cat.videos.find(x=>x.name==='foo1.mp4');
      S.currentVideo=v;
      showRenameModal();
      $('renameInput').value='精彩片段1';
      updateRenamePreview();
      await applyRename();
      await new Promise(r=>setTimeout(r,600));
      const p=$('mainPlayer');
      return {name:v.name,path:v.path,stillPlaying:!p.paused,time:p.currentTime};
    })()`);
    if (renamed.name === '精彩片段1.mp4' && fs.existsSync(renamed.path) && renamed.stillPlaying && renamed.time > 0) pass('重命名文件(改名后延续播放)', `path=${renamed.path} t=${renamed.time.toFixed(1)}`);
    else fail('重命名文件(改名后延续播放)', JSON.stringify(renamed));
    await shot('04-renamed.png');

    // 加前缀（4.7 合并弹窗：只填前缀）
    const prefixed = await js(`(async()=>{
      const cat=S.categories[0];
      const v=cat.videos.find(x=>x.name==='精彩片段1.mp4');
      S.currentVideo=v;
      showRenameModal();
      $('prefixInput').value='[TV] ';
      updateRenamePreview();
      await applyRename();
      await new Promise(r=>setTimeout(r,600));
      const p=$('mainPlayer');
      return {name:v.name,path:v.path,stillPlaying:!p.paused,time:p.currentTime};
    })()`);
    if (prefixed.name === '[TV] 精彩片段1.mp4' && fs.existsSync(prefixed.path) && prefixed.stillPlaying && prefixed.time > 0) pass('加前缀(改后延续播放)', `path=${prefixed.path} t=${prefixed.time.toFixed(1)}`);
    else fail('加前缀(改后延续播放)', JSON.stringify(prefixed));
    await shot('05-prefix.png');

    // 合并弹窗组合：前缀+新名称同时填写（4.7）
    const combined = await js(`(async()=>{
      const cat=S.categories[0];
      const v=cat.videos.find(x=>x.name==='deep.mp4');
      S.currentVideo=v;
      showRenameModal();
      $('prefixInput').value='【合集】';
      $('renameInput').value='第二集';
      updateRenamePreview();
      await applyRename();
      await new Promise(r=>setTimeout(r,600));
      return {name:v.name,path:v.path,stillPlaying:!$('mainPlayer').paused};
    })()`);
    if (combined.name === '【合集】第二集.mp4' && fs.existsSync(combined.path) && combined.stillPlaying) pass('重命名+前缀组合', combined.path);
    else fail('重命名+前缀组合', JSON.stringify(combined));
    await shot('05c-combined.png');

    // 预设添加
    const presetTest = await js(`(async()=>{
      $('prefixNewPreset').value='【动画】 ';
      await addPrefixPreset();
      return {has:S.settings.prefixPresets.includes('【动画】 '),presets:S.settings.prefixPresets};
    })()`);
    if (presetTest.has) pass('前缀预设添加', JSON.stringify(presetTest.presets));
    else fail('前缀预设添加', JSON.stringify(presetTest.presets));
    await shot('05b-presets.png');

    // 策略高亮（4.9）
    const strategyTest = await js(`(async()=>{
      showStrategyModal();
      await new Promise(r=>setTimeout(r,150));
      const defActive=document.querySelector('#strategyModal .strategy-option[data-strategy="default"]').classList.contains('active');
      closeStrategyModal();
      await selectStrategy('liked');
      showStrategyModal();
      await new Promise(r=>setTimeout(r,150));
      const likedActive=document.querySelector('#strategyModal .strategy-option[data-strategy="liked"]').classList.contains('active');
      const defActive2=document.querySelector('#strategyModal .strategy-option[data-strategy="default"]').classList.contains('active');
      closeStrategyModal();
      await selectStrategy('default');
      return {defActive,likedActive,defActive2};
    })()`);
    if (strategyTest.defActive && strategyTest.likedActive && !strategyTest.defActive2) pass('策略选中高亮', JSON.stringify(strategyTest));
    else fail('策略选中高亮', JSON.stringify(strategyTest));

    // 导出真实路径（4.9）：点赞后导出 txt 应为绝对路径
    process.env.RANDOMPLAYER_E2E_BACKUP = path.join(DATA_DIR, 'e2e-export-test.txt');
    await js(`(async()=>{
      const cat=S.categories[0];
      const v=cat.videos.find(x=>x.name==='foo2.mp4');
      if(v){v.watchCount=(v.watchCount||0)+1;v.likeCount=(v.likeCount||0)+1}
      await saveCategoryToDB(cat);
      await exportLikedList();
      return true;
    })()`);
    await sleep(700);
    const exportPath = path.join(DATA_DIR, 'e2e-export-test.txt');
    let exportOk = false;
    try {
      const content = fs.readFileSync(exportPath, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      exportOk = lines.length >= 1 && lines.every(l => l.includes(':') && l.includes('\\')) && content.includes('foo2.mp4');
      if (exportOk) pass('导出真实路径', `${lines.length} 行，首行: ${lines[0]}`);
      else fail('导出真实路径', JSON.stringify({ lines }));
    } catch (e) { fail('导出真实路径', e.message); }
    process.env.RANDOMPLAYER_E2E_BACKUP = '';

    // Ctrl+D 随机抽取快捷键（主进程输入通道；焦点在视频元素上时也必须生效）
    const hotkeyBeforePool = await js(`clearPlayer();_lastDrawAt=0;$('mainPlayer').focus();S.categories[0].currentPool.length`);
    win.webContents.focus();
    pressCtrlD();
    await sleep(1300);
    const hotkeyAfter = await js(`S.currentVideo?S.currentVideo.id:null`);
    const hotkeyAfterPool = await js(`S.categories[0].currentPool.length`);
    if (hotkeyAfterPool === hotkeyBeforePool - 1) pass('Ctrl+D 随机抽取快捷键(视频聚焦)', `pool ${hotkeyBeforePool} -> ${hotkeyAfterPool}, now=${hotkeyAfter}`);
    else fail('Ctrl+D 随机抽取快捷键(视频聚焦)', JSON.stringify({ hotkeyBeforePool, hotkeyAfterPool }));
    await shot('03b-ctrl-d.png');

    // 弹窗打开时按空格不应暂停/播放视频
    const spaceGuard = await js(`(async()=>{
      const p=$('mainPlayer');
      const wasPlaying=!p.paused;
      showStatsModal();
      await new Promise(r=>setTimeout(r,120));
      document.dispatchEvent(new KeyboardEvent('keydown',{key:' ',code:'Space',bubbles:true}));
      await new Promise(r=>setTimeout(r,250));
      const stillPlaying=!p.paused;
      closeStatsModal();
      return {wasPlaying,stillPlaying,guardOk:wasPlaying&&stillPlaying};
    })()`);
    if (spaceGuard.guardOk) pass('弹窗内空格拦截', JSON.stringify(spaceGuard));
    else fail('弹窗内空格拦截', JSON.stringify(spaceGuard));

    // Esc 关闭新功能弹窗
    const esc = await js(`(async()=>{
      showRenameModal();
      await new Promise(r=>setTimeout(r,150));
      const open1=!$('renameModal').classList.contains('hidden');
      document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
      await new Promise(r=>setTimeout(r,150));
      const closed=$('renameModal').classList.contains('hidden');
      return {open1,closed};
    })()`);
    if (esc.open1 && esc.closed) pass('Esc 关闭弹窗', JSON.stringify(esc));
    else fail('Esc 关闭弹窗', JSON.stringify(esc));

    // 输入框聚焦时按 Delete 不应触发删除（防误删）
    const typingGuard = await js(`(async()=>{
      showRenameModal();
      await new Promise(r=>setTimeout(r,200));
      $('renameInput').focus();
      return !$('renameModal').classList.contains('hidden');
    })()`);
    pressDelete();
    await sleep(400);
    const guardOk = await js(`$('deleteVideoModal').classList.contains('hidden')&&!$('renameModal').classList.contains('hidden')`);
    if (typingGuard && guardOk) pass('输入框内Delete不误触删除', '');
    else fail('输入框内Delete不误触删除', JSON.stringify({ typingGuard, guardOk }));

    // 输入框真实输入测试（sendInputEvent 字符事件，模拟真实打字）
    const typingTest = await js(`(async()=>{
      $('renameInput').value='';
      return document.activeElement===$('renameInput');
    })()`);
    sendKey('char', 'a');
    sendKey('char', 'b');
    sendKey('char', 'c');
    await sleep(300);
    const typed = await js(`$('renameInput').value`);
    if (typingTest && typed === 'abc') pass('输入框真实输入', `value="${typed}"`);
    else fail('输入框真实输入', JSON.stringify({ typingTest, typed }));
    // 输入框内 Delete 不被快捷键拦截（defaultPrevented=false，真实键盘可正常删字）
    const deleteNotBlocked = await js(`(async()=>{
      $('renameInput').focus();
      const evt=new KeyboardEvent('keydown',{key:'Delete',code:'Delete',bubbles:true,cancelable:true});
      $('renameInput').dispatchEvent(evt);
      return {prevented:evt.defaultPrevented,active:document.activeElement?document.activeElement.tagName:null};
    })()`);
    if (deleteNotBlocked.prevented === false) pass('输入框内Delete不被拦截', JSON.stringify(deleteNotBlocked));
    else fail('输入框内Delete不被拦截', JSON.stringify(deleteNotBlocked));
    await js(`closeRenameModal()`);

    // 页面通道 Delete（模拟主进程通道失效：直接派发 DOM 键盘事件，捕获监听兜底）
    const pageChannel = await js(`(async()=>{
      const diag={};
      diag.fnOk=typeof handleShortcutDelete==='function';
      diag.cv=!!S.currentVideo;
      diag.active=document.activeElement?document.activeElement.tagName:null;
      const evt=new KeyboardEvent('keydown',{key:'Delete',code:'Delete',bubbles:true,cancelable:true});
      window.dispatchEvent(evt);
      diag.prevented=evt.defaultPrevented;
      await new Promise(r=>setTimeout(r,300));
      diag.deleteModalOpen=!$('deleteVideoModal').classList.contains('hidden');
      return diag;
    })()`);
    if (pageChannel.deleteModalOpen) pass('页面通道Delete兜底', '确认弹窗已打开');
    else fail('页面通道Delete兜底', JSON.stringify(pageChannel));
    await js(`closeDeleteVideoModal()`);
    await sleep(600); // 等去重窗口过去

    // 双击视频不改变播放状态；单击仍可暂停/播放
    const dblTest = await js(`(async()=>{
      const p=$('mainPlayer');
      const before=!p.paused;
      let fullscreenRequested=false;
      const originalFullscreen=p.parentElement.requestFullscreen;
      p.parentElement.requestFullscreen=()=>{fullscreenRequested=true;return Promise.resolve()};
      p.dispatchEvent(new MouseEvent('dblclick',{bubbles:true}));
      await new Promise(r=>setTimeout(r,400));
      const afterDbl=!p.paused;
      p.parentElement.requestFullscreen=originalFullscreen;
      // 单击：250ms 后应切换暂停状态
      p.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      await new Promise(r=>setTimeout(r,400));
      const afterClick=!p.paused;
      // 再单击恢复播放
      p.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      await new Promise(r=>setTimeout(r,400));
      const afterClick2=!p.paused;
      return {before,afterDbl,afterClick,afterClick2,fullscreenRequested,dblOk:before===afterDbl&&fullscreenRequested,clickOk:afterClick===!before&&afterClick2===before};
    })()`);
    if (dblTest.dblOk && dblTest.clickOk) pass('双击不暂停+单击切换', JSON.stringify(dblTest));
    else fail('双击不暂停+单击切换', JSON.stringify(dblTest));

    // 删除（播放中按 Delete 打开确认弹窗，弹窗中再按 Delete 确认删除）
    const delPath = prefixed.path;
    await js(`(async()=>{
      const cat=S.categories[0];
      const v=cat.videos.find(x=>x.name==='[TV] 精彩片段1.mp4');
      S.currentVideo=v;
      await playVideo(v,{});
      await new Promise(r=>setTimeout(r,1200));
      return true;
    })()`);
    pressDelete();
    await sleep(500);
    const modalOpened = await js(`!$('deleteVideoModal').classList.contains('hidden')`);
    if (modalOpened) pass('播放中按Delete打开确认弹窗', '');
    else fail('播放中按Delete打开确认弹窗', '弹窗未打开');

    // 点击弹窗外（遮罩）不应关闭弹窗（4.2：弹窗必须主动关闭）
    const outsideClickGuard = await js(`(async()=>{
      const m=$('deleteVideoModal');
      m.dispatchEvent(new MouseEvent('click',{bubbles:true}));
      await new Promise(r=>setTimeout(r,200));
      return {stillOpen:!m.classList.contains('hidden')};
    })()`);
    if (outsideClickGuard.stillOpen) pass('点击弹窗外不关闭弹窗', '');
    else fail('点击弹窗外不关闭弹窗', JSON.stringify(outsideClickGuard));

    // 弹窗打开期间播放另一个视频（模拟自动切换）：删除目标应保持锁定，不删错对象（4.5）
    await js(`(async()=>{drawVideo();await new Promise(r=>setTimeout(r,700));return true})()`);

    pressDelete();
    await sleep(2500);
    const del = await js(`(async()=>{
      const cat=S.categories[0];
      return {removed:!cat.videos.some(x=>x.name==='[TV] 精彩片段1.mp4'),total:cat.videos.length,modalClosed:$('deleteVideoModal').classList.contains('hidden')};
    })()`);
    if (del.removed && !fs.existsSync(delPath) && del.total === 2 && del.modalClosed) pass('弹窗中按Delete确认删除(播放中)', JSON.stringify(del));
    else fail('弹窗中按Delete确认删除(播放中)', JSON.stringify(del));
    await shot('06-after-delete.png');

    // 连续快速点击抽取：CD 生效只抽一次，无播放失败（4.4 防竞态）
    await js(`(async()=>{await resetCurrentPool();clearPlayer();_lastDrawAt=0;return true})()`);
    await sleep(400);
    const cdTest = await js(`(async()=>{
      const p=$('mainPlayer'),cat=S.categories[0],trace=[],started=performance.now();
      const snap=label=>trace.push({label,at:Math.round(performance.now()-started),pool:cat.currentPool.length,current:S.currentVideo&&S.currentVideo.id,
        token:_playToken,lastDraw:_lastDrawAt,ended:p.ended,time:Number(p.currentTime.toFixed(3)),duration:Number.isFinite(p.duration)?Number(p.duration.toFixed(3)):null,
        stats:cat.videos.map(v=>({id:v.id,watched:v.watched,watchCount:v.watchCount}))});
      const onPlay=()=>snap('event:play'),onEnded=()=>snap('event:ended');
      p.addEventListener('play',onPlay);p.addEventListener('ended',onEnded);
      const beforeId=S.currentVideo?S.currentVideo.id:null;
      const beforePool=cat.currentPool.length;
      const realNow=Date.now,baseNow=realNow();let testNow=baseNow;
      Date.now=()=>testNow;
      try{
        snap('before');drawVideo();snap('draw:1');
        testNow=baseNow+120;snap('before:2');drawVideo();snap('draw:2');
        testNow=baseNow+240;snap('before:3');drawVideo();snap('draw:3')}
      finally{Date.now=realNow}
      for(let i=0;i<30&&cat.currentPool.length===beforePool;i++)await new Promise(r=>setTimeout(r,100));
      await new Promise(r=>setTimeout(r,400));
      snap('final');p.removeEventListener('play',onPlay);p.removeEventListener('ended',onEnded);
      return {beforeId,afterId:S.currentVideo?S.currentVideo.id:null,beforePool,afterPool:cat.currentPool.length,
        playerError:p.error?p.error.code:null,playing:!p.paused,trace};
    })()`);
    const cdOk = cdTest.afterPool === cdTest.beforePool - 1 && cdTest.playerError === null && cdTest.playing;
    const cdDetail = cdOk
      ? JSON.stringify({ beforeId: cdTest.beforeId, afterId: cdTest.afterId, beforePool: cdTest.beforePool, afterPool: cdTest.afterPool, playerError: cdTest.playerError, playing: cdTest.playing })
      : JSON.stringify(cdTest);
    if (cdOk) pass('连续抽取CD(只生效一次,无播放失败)', cdDetail);
    else fail('连续抽取CD(只生效一次,无播放失败)', cdDetail);
    await shot('06b-cd.png');

    // 备份（E2E 钩子绕过保存对话框）
    const backupPath = path.join(DATA_DIR, 'e2e-backup.json');
    process.env.RANDOMPLAYER_E2E_BACKUP = backupPath;
    await js(`(async()=>{await backupData();return true})()`);
    await sleep(600);
    let backupOk = false;
    try {
      const b = JSON.parse(fs.readFileSync(backupPath, 'utf8'));
      backupOk = b.categories.length === 1 && b.categories[0].videos.length === 2 && b.meta.categoryCount === 1;
      if (backupOk) pass('备份JSON(含设置)', `${b.categories[0].videos.length} 视频, presets=${(b.settings.prefixPresets||[]).length}`);
      else fail('备份JSON', JSON.stringify(b).slice(0, 200));
    } catch (e) { fail('备份JSON', e.message); }

    // 恢复（覆盖 confirm 以自动化）
    await js(`window.__autoConfirm=true;0`);
    const restored = await js(`(async()=>{
      await restoreData();
      await new Promise(r=>setTimeout(r,1200));
      const cat=S.categories[0];
      return {n:S.categories.length,v:cat?cat.videos.length:0,names:cat?cat.videos.map(x=>x.name):[],presets:S.settings.prefixPresets};
    })()`);
    if (restored.n === 1 && restored.v === 2 && restored.presets.includes('【动画】 ')) pass('恢复备份', JSON.stringify(restored.names));
    else fail('恢复备份', JSON.stringify(restored));
    await shot('07-restored.png');

    // 旧版备份兼容测试（HTML v3.1 格式：相对路径 + rootName，无 roots；多文件夹合集）
    const oldBackupPath = path.join(DATA_DIR, 'e2e-old-backup.json');
    const foo2 = fs.statSync(path.join(folder, 'foo2.mp4'));
    const tvdDir = path.join(tdata, '剧集');
    fs.mkdirSync(tvdDir, { recursive: true });
    fs.copyFileSync(sample, path.join(tvdDir, 'bar.mp4'));
    const barStat = fs.statSync(path.join(tvdDir, 'bar.mp4'));
    const oldBackup = {
      version: 11,
      categories: [{
        id: 'old1', name: '旧版合集', type: 'collection',
        videoMetas: [{
          id: 'ov1', name: 'foo2.mp4', path: 'foo2.mp4', rootName: '电影1',
          size: foo2.size, watched: false, watchCount: 1, likeCount: 0, dislikeCount: 0,
          playTimestamps: [], likeTimestamps: [], seekTimestamps: []
        }, {
          id: 'ov2', name: 'bar.mp4', path: 'bar.mp4', rootName: '剧集',
          size: barStat.size, watched: false, watchCount: 2, likeCount: 0, dislikeCount: 0,
          playTimestamps: [], likeTimestamps: [], seekTimestamps: []
        }]
      }],
      achievements: { stats: { totalPlays: 5, totalCollections: 1, totalResets: 0, totalRefreshes: 0, consecutiveDays: 0, lastPlayDate: null, totalSeeks: 0, categoryPlays: {}, totalLikes: 0, totalDislikes: 0, specialPlays: 0, logoClickCount: 0, nightPlays: 0 }, unlocked: {} },
      meta: { appVersion: '1.5', backupTime: '2026-01-01T00:00:00.000Z', categoryCount: 1, totalVideos: 2 }
    };
    fs.writeFileSync(oldBackupPath, JSON.stringify(oldBackup, null, 2), 'utf8');
    process.env.RANDOMPLAYER_E2E_BACKUP = oldBackupPath;
    const oldRestored = await js(`(async()=>{
      await restoreData();
      await new Promise(r=>setTimeout(r,800));
      const cat=S.categories[0];
      return {name:cat?cat.name:null,roots:cat?cat.roots:[],ready:cat?cat.permissionRestored:false,metas:cat?(cat.videoMetas||[]).length:0};
    })()`);
    if (oldRestored.name === '旧版合集' && oldRestored.roots.length === 0 && !oldRestored.ready && oldRestored.metas === 2) pass('旧版备份导入(待关联,多文件夹)', JSON.stringify(oldRestored));
    else fail('旧版备份导入(待关联,多文件夹)', JSON.stringify(oldRestored));
    await shot('08-old-backup.png');

    // 关联文件夹（E2E 钩子依次返回多个文件夹；多文件夹合集一次关联完成）
    delete process.env.RANDOMPLAYER_E2E_FOLDER;
    process.env.RANDOMPLAYER_E2E_FOLDERS = folder + ';' + tvdDir;
    process.env.RANDOMPLAYER_E2E_FOLDER_IDX = '0';
    const relinked = await js(`(async()=>{
      await relinkCategoryRoots();
      await new Promise(r=>setTimeout(r,800));
      const cat=S.categories[0];
      const foo=cat.videos.find(x=>x.name==='foo2.mp4');
      const bar=cat.videos.find(x=>x.name==='bar.mp4');
      return {roots:cat.roots,videos:cat.videos.map(x=>x.name),ready:cat.permissionRestored,fooCount:foo?foo.watchCount:0,barCount:bar?bar.watchCount:0};
    })()`);
    if (relinked.roots.length === 2 && relinked.videos.includes('foo2.mp4') && relinked.videos.includes('bar.mp4') && relinked.ready && relinked.fooCount === 1 && relinked.barCount === 2) pass('旧版备份→关联文件夹(多选+元数据保留)', JSON.stringify(relinked));
    else fail('旧版备份→关联文件夹(多选+元数据保留)', JSON.stringify(relinked));
    await shot('09-relinked.png');

    // 补充当前合集：追加新文件夹（4.6）
    const supDir = path.join(tdata, '补充集');
    fs.mkdirSync(supDir, { recursive: true });
    fs.copyFileSync(sample, path.join(supDir, 'extra.mp4'));
    delete process.env.RANDOMPLAYER_E2E_FOLDER;
    process.env.RANDOMPLAYER_E2E_FOLDERS = supDir;
    process.env.RANDOMPLAYER_E2E_FOLDER_IDX = '0';
    const sup = await js(`(async()=>{
      const cat=S.categories[0];
      const beforeV=cat.videos.length;
      const beforeRoots=cat.roots.length;
      await supplementCurrentCategory();
      await new Promise(r=>setTimeout(r,900));
      return {beforeV,beforeRoots,afterV:cat.videos.length,roots:cat.roots.length,hasExtra:cat.videos.some(v=>v.name==='extra.mp4'),pool:cat.currentPool.length};
    })()`);
    if (sup.afterV === sup.beforeV + 1 && sup.roots === sup.beforeRoots + 1 && sup.hasExtra) pass('补充当前合集(追加文件夹+合并视频)', JSON.stringify(sup));
    else fail('补充当前合集(追加文件夹+合并视频)', JSON.stringify(sup));
    await shot('09b-supplement.png');

    // 加标签 + 标签合集（4.7）：动态聚合验证
    const tagTest = await js(`(async()=>{
      try{
      const diag={types:S.categories.map(c=>c.type),names:S.categories.map(c=>c.name)};
      const cat=S.categories.find(c=>c.type!=='tags');
      if(!cat)return {diag,fatal:'no normal category'};
      const foo=cat.videos.find(x=>x.name==='foo2.mp4');
      const bar=cat.videos.find(x=>x.name==='bar.mp4');
      if(!foo||!bar)return {diag,fatal:'foo/bar missing',foo:!!foo,bar:!!bar};
      S.activeCategoryId=cat.id;
      // 给 foo 打 MAX
      S.currentVideo=foo;
      showTagsModal();
      Array.from(document.querySelectorAll('#tagsList button')).find(b=>b.textContent.includes('MAX')).click();
      await new Promise(r=>setTimeout(r,300));
      const fooTagged=(foo.tags||[]).includes('MAX');
      closeTagsModal();
      // 创建标签合集 MAX（勾选 MAX 标签）
      showTagCollectionModal();
      Array.from(document.querySelectorAll('#tagCollectionTags button')).find(b=>b.dataset.tag==='MAX').click();
      await new Promise(r=>setTimeout(r,200));
      await createTagCollection();
      await new Promise(r=>setTimeout(r,700));
      const tagCat=S.categories.find(c=>c.type==='tags');
      const hasFoo=tagCat?tagCat.videos.some(v=>v.name==='foo2.mp4'):false;
      // 动态跟随：给 bar 打 MAX → 自动进入标签合集
      S.activeCategoryId=cat.id;
      S.currentVideo=bar;
      showTagsModal();
      Array.from(document.querySelectorAll('#tagsList button')).find(b=>b.textContent.includes('MAX')).click();
      await new Promise(r=>setTimeout(r,500));
      const hasBarAfter=tagCat.videos.some(v=>v.name==='bar.mp4');
      // 动态跟随：取消 foo 的 MAX → 自动移出标签合集
      S.currentVideo=foo;
      showTagsModal();
      Array.from(document.querySelectorAll('#tagsList button')).find(b=>b.textContent.includes('MAX')).click();
      await new Promise(r=>setTimeout(r,500));
      const hasFooAfter=tagCat.videos.some(v=>v.name==='foo2.mp4');
      closeTagsModal();
      // 清理标签合集（恢复单合集状态，供后续初始化测试）
      S.categories=S.categories.filter(c=>c.type!=='tags');
      await persistAll();
      return {fooTagged,hasFoo,hasBarAfter,hasFooAfter,tagCatName:tagCat?tagCat.name:null};
      }catch(err){
      return {err:err.message,types:S.categories?S.categories.map(c=>c.type):'S.categories null',count:S.categories?S.categories.length:0};
      }
    })()`);
    if (tagTest.fooTagged && tagTest.hasFoo && tagTest.hasBarAfter && !tagTest.hasFooAfter) pass('加标签+标签合集(动态跟随)', JSON.stringify(tagTest));
    else fail('加标签+标签合集(动态跟随)', JSON.stringify(tagTest));
    await shot('09c-tags.png');

    // 标签预设改名（4.8：应用内输入对话框替代 prompt）
    const tagRename = await js(`(async()=>{
      window.__autoPrompt='URGENT';
      showTagsPresetsModal();
      await new Promise(r=>setTimeout(r,250));
      const renameBtn=Array.from(document.querySelectorAll('#tagsPresetList button')).find(b=>b.textContent==='改名');
      renameBtn.click();
      await new Promise(r=>setTimeout(r,500));
      const renamed=S.settings.tags.includes('URGENT');
      closeTagsPresetsModal();
      window.__autoPrompt=undefined;
      return {renamed,tags:S.settings.tags};
    })()`);
    if (tagRename.renamed) pass('标签预设改名(应用内对话框)', JSON.stringify(tagRename.tags));
    else fail('标签预设改名(应用内对话框)', JSON.stringify(tagRename));

    // 标签合集一致性 + 备份瘦身（5.0）
    const tagConsistency = await js(`(async()=>{
      const cat=S.categories.find(c=>c.type!=='tags');
      const extra=cat.videos.find(x=>x.name==='extra.mp4');
      S.activeCategoryId=cat.id;
      S.currentVideo=extra;
      showTagsModal();
      Array.from(document.querySelectorAll('#tagsList button')).find(b=>b.textContent.includes('HIGH')).click();
      await new Promise(r=>setTimeout(r,300));
      closeTagsModal();
      showTagCollectionModal();
      Array.from(document.querySelectorAll('#tagCollectionTags button')).find(b=>b.dataset.tag==='HIGH').click();
      await new Promise(r=>setTimeout(r,150));
      await createTagCollection();
      await new Promise(r=>setTimeout(r,500));
      const tagCat=S.categories.find(c=>c.type==='tags'&&c.name==='HIGH');
      const hasBeforeReal=tagCat?tagCat.videos.some(v=>v.name==='extra.mp4'):false;
      // 从普通合集删除 extra.mp4 → 标签合集应自动移除
      S.activeCategoryId=cat.id;
      S.currentVideo=extra;
      _deleteTargetId=extra.id;
      await doDeleteCurrentVideo();
      await new Promise(r=>setTimeout(r,1200));
      const hasAfter=tagCat.videos.some(v=>v.name==='extra.mp4');
      return {hasBeforeReal,hasAfter};
    })()`);
    let leanOk = false;
    if (tagConsistency.hasBeforeReal && !tagConsistency.hasAfter) {
      // 备份瘦身：标签合集 videos 应为空（主进程验证）
      process.env.RANDOMPLAYER_E2E_BACKUP = path.join(DATA_DIR, 'e2e-lean-backup.json');
      await js(`(async()=>{await backupData();return true})()`);
      await sleep(600);
      try {
        const lean = JSON.parse(fs.readFileSync(path.join(DATA_DIR, 'e2e-lean-backup.json'), 'utf8'));
        const leanTagsCat = lean.categories.find(c => c.type === 'tags');
        leanOk = leanTagsCat && leanTagsCat.videos.length === 0 && lean.categories.some(c => c.type !== 'tags' && c.videos.length > 0);
      } catch (e) { leanOk = false; }
      process.env.RANDOMPLAYER_E2E_BACKUP = '';
    }
    await js(`(async()=>{
      S.categories=S.categories.filter(c=>c.type!=='tags');
      await persistAll();
      return true;
    })()`);
    if (tagConsistency.hasBeforeReal && !tagConsistency.hasAfter && leanOk) pass('标签合集一致性+备份瘦身', JSON.stringify({ ...tagConsistency, leanOk }));
    else fail('标签合集一致性+备份瘦身', JSON.stringify({ ...tagConsistency, leanOk }));
    await shot('09e-consistency.png');

    // 删空标签预设后，输入框仍可正常输入（4.8 修复输入失效 bug）
    win.webContents.focus();
    const emptyTagsInput = await js(`(async()=>{
      window.__autoConfirm=true;
      showTagsPresetsModal();
      await new Promise(r=>setTimeout(r,250));
      for(let i=0;i<10;i++){
        const delBtns=Array.from(document.querySelectorAll('#tagsPresetList button')).filter(b=>b.textContent==='删除');
        if(delBtns.length===0)break;
        delBtns[0].click();
        await new Promise(r=>setTimeout(r,300));
      }
      closeTagsPresetsModal();
      const empty=(S.settings.tags||[]).length===0;
      const cat=S.categories.find(c=>c.type!=='tags');
      const v=cat.videos[0];
      S.currentVideo=v;
      showRenameModal();
      // 轮询等待输入框获得焦点（自动聚焦可能受时序影响）
      let focused=false;
      for(let i=0;i<12;i++){
        await new Promise(r=>setTimeout(r,100));
        $('renameInput').focus();
        if(document.activeElement===$('renameInput')){focused=true;break}
      }
      $('renameInput').value='';
      window.__autoConfirm=undefined;
      return {empty,focused};
    })()`);
    sendKey('char', 'x');
    sendKey('char', 'y');
    await sleep(400);
    const emptyTyped = await js(`(async()=>{
      const typed=$('renameInput').value;
      closeRenameModal();
      return typed;
    })()`);
    if (emptyTagsInput.empty && emptyTagsInput.focused && emptyTyped === 'xy') pass('删空标签后输入框正常', JSON.stringify({ ...emptyTagsInput, typed: emptyTyped }));
    else fail('删空标签后输入框正常', JSON.stringify({ ...emptyTagsInput, typed: emptyTyped }));
    await shot('09d-empty-tags.png');

    // 数据初始化：执行前自动备份 + 从自动备份恢复
    await js(`window.__autoConfirm=true;0`);
    const initTest = await js(`(async()=>{
      await resetAllPools();
      await new Promise(r=>setTimeout(r,600));
      return {cats:S.categories.length};
    })()`);
    const bakDir = path.join(DATA_DIR, 'backups');
    let bakFiles = [];
    try { bakFiles = fs.readdirSync(bakDir).filter(f => f.startsWith('自动备份_') && f.endsWith('.json')); } catch (e) { /* 忽略 */ }
    if (initTest.cats === 0 && bakFiles.length >= 1) pass('初始化前自动备份', `${bakFiles.length} 个备份文件`);
    else fail('初始化前自动备份', JSON.stringify({ cats: initTest.cats, bakFiles }));
    if (bakFiles.length >= 1) {
      process.env.RANDOMPLAYER_E2E_BACKUP = path.join(bakDir, bakFiles[bakFiles.length - 1]);
      const restored2 = await js(`(async()=>{
        await restoreData();
        await new Promise(r=>setTimeout(r,1200));
        const cat=S.categories[0];
        return {n:S.categories.length,name:cat?cat.name:null,roots:cat?cat.roots:[],videos:cat?cat.videos.length:0};
      })()`);
      if (restored2.n === 1 && restored2.name === '旧版合集' && restored2.roots.length >= 1 && restored2.videos > 0) pass('从自动备份恢复', JSON.stringify(restored2));
      else fail('从自动备份恢复', JSON.stringify(restored2));
    }
    await shot('09b-init-restore.png');

    const failCount = results.steps.filter(s => !s.ok).length;
    fs.writeFileSync(path.join(DATA_DIR, 'e2e-result.json'), JSON.stringify(results, null, 2), 'utf8');
    console.log(`阶段1结束: ${results.steps.length - failCount}/${results.steps.length} 通过`);
    try { fs.rmSync(oldDir, { recursive: true, force: true }); } catch (e) { /* 忽略 */ }
    app.exit(failCount ? 1 : 0);
  } catch (err) {
    console.error('[E2E异常]', err);
    fs.writeFileSync(path.join(DATA_DIR, 'e2e-result.json'), JSON.stringify(results, null, 2), 'utf8');
    app.exit(2);
  }
};
