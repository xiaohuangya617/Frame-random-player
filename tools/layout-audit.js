// UI 布局审计：验证关键元素的可见性与计算样式
const fs = require('fs');
const path = require('path');

module.exports = async ({ app, win }) => {
  const out = [];
  const js = (code) => win.webContents.executeJavaScript(code, true);
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  try {
    for (let i = 0; i < 100; i++) {
      const ready = await js(`typeof S!=='undefined'&&document.readyState==='complete'`).catch(() => false);
      if (ready) break;
      await sleep(200);
    }
    await sleep(1200);
    const report = await js(`(()=>{
      const r={ready:true};
      const cs=el=>el?getComputedStyle(el):null;
      const box=el=>{if(!el)return null;const b=el.getBoundingClientRect();return{
        left:b.left,top:b.top,right:b.right,bottom:b.bottom,w:b.width,h:b.height,
        inViewport:b.left>=0&&b.top>=0&&b.right<=window.innerWidth&&b.bottom<=window.innerHeight
      }};
      r.viewport={w:window.innerWidth,h:window.innerHeight};
      r.bodyBg=cs(document.body).backgroundColor;
      r.bodyFont=cs(document.body).fontFamily;
      r.bodyOverflow=cs(document.body).overflow;
      const header=document.querySelector('header');
      r.header={display:cs(header).display,height:header?header.offsetHeight:0};
      const headerActions=$('headerActions');
      r.headerActions={w:headerActions?headerActions.clientWidth:0,scrollW:headerActions?headerActions.scrollWidth:0,
        buttons:headerActions?Array.from(headerActions.querySelectorAll('button')).map(button=>button.textContent.trim()):[]};
      const tabs=$('categoryTabs');
      r.tabs={count:tabs?tabs.children.length:0,display:cs(tabs).display};
      const aside=document.querySelector('aside');
      r.aside={w:aside?aside.offsetWidth:0,display:aside?cs(aside).display:'none'};
      const drawBtn=$('drawBtn');
      r.drawBtn={disabled:drawBtn?drawBtn.disabled:null,text:drawBtn?drawBtn.textContent.trim():null};
      const videoContainer=$('videoContainer');
      const player=$('mainPlayer');
      const cc=$('customControls');
      const bar=$('videoActionBar');
      const videoWasHidden=videoContainer?videoContainer.classList.contains('hidden'):true;
      const barWasHidden=bar?bar.classList.contains('hidden'):true;
      if(videoContainer)videoContainer.classList.remove('hidden');
      if(bar)bar.classList.remove('hidden');
      r.player={w:player?player.offsetWidth:0,h:player?player.offsetHeight:0};
      r.controls={display:cc?cs(cc).display:'none',opacity:cc?cs(cc).opacity:null};
      r.actionBar={display:bar?cs(bar).display:'none',h:bar?bar.offsetHeight:0,box:box(bar)};
      r.actionButtons=bar?Array.from(bar.querySelectorAll('button')).map(button=>({text:button.textContent.trim(),w:button.offsetWidth,h:button.offsetHeight,box:box(button)})):[];
      r.activeOverflow={x:document.documentElement.scrollWidth>window.innerWidth,y:document.documentElement.scrollHeight>window.innerHeight};
      if(videoContainer&&videoWasHidden)videoContainer.classList.add('hidden');
      if(bar&&barWasHidden)bar.classList.add('hidden');
      r.emptyOverflow={x:document.documentElement.scrollWidth>window.innerWidth,y:document.documentElement.scrollHeight>window.innerHeight};
      // 模态框测试：打开重命名弹窗检查布局
      if(S.currentVideo){showRenameModal();const m=$('renameModal');r.renameModal={display:cs(m).display,alignItems:cs(m).alignItems,w:m.offsetWidth};closeRenameModal();}
      // 弹出所有主要弹窗检查 display:flex
      const modals=[
        ['strategyModal',showStrategyModal,closeStrategyModal],['historyModal',showHistoryModal,closeHistoryModal],
        ['likedModal',showLikedModal,closeLikedModal],['statsModal',showStatsModal,closeStatsModal],
        ['achievementsModal',showAchievementsModal,closeAchievementsModal],['backupRestoreModal',showBackupRestoreModal,closeBackupRestoreModal],
        ['helpModal',showHelpModal,closeHelpModal]
      ];
      const modalResults={};
      for(const [id,show,close] of modals){try{show();const m=$(id);modalResults[id]={display:cs(m).display,w:m?m.offsetWidth:0,h:m?m.offsetHeight:0};close();}catch(e){modalResults[id]={err:e.message}}}
      r.modals=modalResults;
      r.toastCount=$('toastContainer').children.length;
      r.pass=r.viewport.w>=1060&&r.viewport.h>=700&&r.header.height>0&&r.aside.w>0&&r.player.w>0&&r.player.h>0&&
        r.headerActions.scrollW<=r.headerActions.w&&r.actionBar.display==='flex'&&r.actionBar.h>0&&r.actionButtons.length===6&&
        r.actionButtons.map(button=>button.text).join('|')==='🎬 字幕|📁 字幕目录|✏️ 命名|🏷️ 标签|📂 路径|🗑️ 删除'&&
        r.actionBar.box&&r.actionBar.box.inViewport&&
        r.actionButtons.every(button=>button.w>0&&button.h>0&&button.box&&button.box.inViewport)&&
        !r.activeOverflow.x&&!r.emptyOverflow.x&&Object.values(r.modals).every(modal=>!modal.err&&modal.display==='flex'&&modal.w>0&&modal.h>0);
      return r;
    })()`);
    report.windowVisible = win.isVisible();
    report.pass = report.pass && !report.windowVisible;
    out.push(report);
    fs.writeFileSync(path.join(process.cwd(), 'test-shots', 'layout-audit.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log('[布局审计]', JSON.stringify(report, null, 1));
    app.exit(report.pass ? 0 : 1);
  } catch (err) {
    console.error('[布局审计异常]', err);
    app.exit(2);
  }
};
