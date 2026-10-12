const fs = require('fs');
const path = require('path');

module.exports = async ({ app, win, DATA_DIR }) => {
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const js = code => win.webContents.executeJavaScript(code, true);
  const results = [];
  const check = (name, ok, detail) => {
    results.push({ name, ok: !!ok, detail });
    (ok ? console.log : console.error)(`[${ok ? 'PASS' : 'FAIL'}] ${name}: ${detail}`);
  };
  try {
    for (let i = 0; i < 100; i++) {
      if (await js("typeof S!=='undefined'&&document.readyState==='complete").catch(() => false)) break;
      await sleep(100);
    }
    await sleep(200);

    const subtitleDir = process.env.RANDOMPLAYER_E2E_SUBTITLE_FOLDER;
    const videoRoot = process.env.RANDOMPLAYER_E2E_FOLDER;
    fs.mkdirSync(subtitleDir, { recursive: true });
    fs.mkdirSync(videoRoot, { recursive: true });
    fs.writeFileSync(path.join(subtitleDir, '字幕 A.srt'), '1\n00:00:01,000 --> 00:00:03,000\n第一行字幕\n\n2\n00:00:04,000 --> 00:00:05,000\n第二行字幕\n', 'utf8');
    // 用真实 GB18030 字节写入一份字幕，验证主进程的编码回退路径。
    const gb18030Sample = Buffer.from([
      0x31, 0x0a,
      0x30, 0x30, 0x3a, 0x30, 0x30, 0x3a, 0x30, 0x31, 0x2c, 0x30, 0x30, 0x30,
      0x20, 0x2d, 0x2d, 0x3e, 0x20,
      0x30, 0x30, 0x3a, 0x30, 0x30, 0x3a, 0x30, 0x33, 0x2c, 0x30, 0x30, 0x30, 0x0a,
      0xd6, 0xd0, 0xce, 0xc4, 0x0a
    ]);
    fs.writeFileSync(path.join(subtitleDir, '字幕 GB.srt'), gb18030Sample);
    fs.writeFileSync(path.join(videoRoot, 'relinked.mp4'), 'not-a-real-video', 'utf8');

    const folder = await js('(async()=>window.api.pickSubtitleFolder())()');
    check('字幕目录选择并受控返回', path.resolve(folder) === path.resolve(subtitleDir), String(folder));

    const subtitle = await js(`(async()=>{
      const video=normalizeVideoMeta({id:'subtitle-video',name:'字幕 A.mp4',path:${JSON.stringify(path.join(videoRoot,'字幕 A.mp4'))},size:10});
      const category={id:'subtitle-category',name:'字幕测试',type:'collection',roots:[],videos:[video],videoMetas:[video],currentPool:[video],order:0,permissionRestored:true};
      S.categories=[category];S.activeCategoryId=category.id;S.currentVideo=video;S.settings.subtitleDir=${JSON.stringify(subtitleDir)};S.settings.subtitleEnabled=true;
      renderTabs();updateUI();updateVideoActionBar(video);
      await loadSubtitleForVideo(video,_playToken);
      const loaded={status:$('subtitleStatus').textContent,track:!!_subtitleTrackElement,highlight:$('subtitleBtn').getAttribute('aria-pressed')};
      S.settings.subtitleEnabled=false;updateSubtitleVisibility();
      const off={status:$('subtitleStatus').textContent,highlight:$('subtitleBtn').getAttribute('aria-pressed'),mode:_subtitleTrackElement&&_subtitleTrackElement.track?_subtitleTrackElement.track.mode:null};
      await persistAllNow();
      const saved=await window.api.loadData();
      clearSubtitleTrack();
      return {loaded,off,saved:saved.settings};
    })()`);
    check('SRT 同名匹配并加载字幕', subtitle.loaded.status === '已加载' && subtitle.loaded.track && subtitle.loaded.highlight === 'true', JSON.stringify(subtitle.loaded));
    check('字幕关闭只改变显示开关', subtitle.off.status === '已加载' && subtitle.off.highlight === 'false' && subtitle.off.mode === 'hidden', JSON.stringify(subtitle.off));
    check('字幕开关写入存档', subtitle.saved.subtitleEnabled === false && path.resolve(subtitle.saved.subtitleDir) === path.resolve(subtitleDir), JSON.stringify(subtitle.saved));

    const gb18030 = await js(`(async()=>window.api.readSubtitle('字幕 GB.mp4'))()`);
    check('GB18030 字幕编码读取', gb18030.ok === true && gb18030.text.includes('中文'), JSON.stringify(gb18030));

    const collection = await js(`(async()=>{
      const make=(id,permission,root)=>({id,name:id,type:'collection',roots:root?[root]:[],videos:[normalizeVideoMeta({id:id+'-v',name:id+'.mp4',path:root?root+'\\\\'+id+'.mp4':root||'',size:1})],videoMetas:[],currentPool:[],order:0,permissionRestored:permission});
      const good=make('Good',true,${JSON.stringify(videoRoot)});good.videoMetas=good.videos;good.currentPool=buildCurrentPool(good.videos);
      const missing=make('Missing',false,${JSON.stringify(path.join(DATA_DIR,'missing-root'))});missing.videoMetas=missing.videos;missing.currentPool=buildCurrentPool(missing.videos);
      S.settings.subtitleEnabled=false;S.categories=[good,missing];S.activeCategoryId=good.id;S.currentVideo=null;renderTabs();updateUI();
      document.querySelector('[data-category-id="Missing"]').click();
      const selected={active:S.activeCategoryId,deleteDisabled:$('deleteBtn').disabled};
      window.__autoConfirm=true;
      await refreshCurrentCategory();
      const retry={active:S.activeCategoryId,permission:missing.permissionRestored,oldVideos:missing.videos.length,toast:$('toastContainer').textContent};
      return {selected,retry};
    })()`);
    check('失效合集可选中并允许删除', collection.selected.active === 'Missing' && collection.selected.deleteDisabled === false, JSON.stringify(collection.selected));
    check('失效合集重试扫描保留旧记录', collection.retry.permission === false && collection.retry.oldVideos === 1, JSON.stringify(collection.retry));

    const relink = await js(`(async()=>{
      const missing=S.categories.find(c=>c.id==='Missing');
      missing.roots=[];missing.permissionRestored=false;
      await refreshCurrentCategory();
      return {permission:missing.permissionRestored,roots:missing.roots.slice(),videos:missing.videos.map(v=>v.name)};
    })().catch(error=>({error:String(error)}))`);
    check('失效合集可重新关联并恢复扫描', relink.permission === true && relink.roots.length === 1 && relink.videos.includes('relinked.mp4'), JSON.stringify(relink));

    const gestures = await js(`(async()=>{
      const p=$('mainPlayer');let paused=false,full=0;
      Object.defineProperty(p,'paused',{configurable:true,get:()=>paused});
      p.play=()=>{paused=false;return Promise.resolve()};p.pause=()=>{paused=true};
      const parent=p.parentElement;const oldRect=p.getBoundingClientRect;const oldReq=parent.requestFullscreen;
      p.getBoundingClientRect=()=>({top:100,height:400});
      parent.requestFullscreen=()=>{full++;return Promise.resolve()};
      p.dispatchEvent(new MouseEvent('click',{bubbles:true,clientY:150}));await new Promise(r=>setTimeout(r,300));
      const upperClick=paused;
      p.dispatchEvent(new MouseEvent('click',{bubbles:true,clientY:450}));await new Promise(r=>setTimeout(r,300));
      const lowerClick=paused;
      p.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientY:150}));
      const upperDbl=full;
      p.dispatchEvent(new MouseEvent('dblclick',{bubbles:true,clientY:450}));
      const lowerDbl=full;
      p.getBoundingClientRect=oldRect;parent.requestFullscreen=oldReq;
      return {upperClick,lowerClick,upperDbl,lowerDbl};
    })()`);
    check('视频上下半区点击行为', gestures.upperClick === true && gestures.lowerClick === true && gestures.upperDbl === 1 && gestures.lowerDbl === 1, JSON.stringify(gestures));

    fs.writeFileSync(path.join(DATA_DIR, 'v5_8-result.json'), JSON.stringify(results, null, 2), 'utf8');
    const failed = results.filter(item => !item.ok).length;
    console.log(`5.8 专项测试结束: ${results.length - failed}/${results.length} 通过`);
    app.exit(failed ? 1 : 0);
  } catch (error) {
    console.error('[5.8 专项测试异常]', error.stack || error);
    app.exit(2);
  }
};
