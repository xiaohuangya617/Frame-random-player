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
      const r={};
      const cs=el=>el?getComputedStyle(el):null;
      r.viewport={w:window.innerWidth,h:window.innerHeight};
      r.bodyBg=cs(document.body).backgroundColor;
      r.bodyFont=cs(document.body).fontFamily;
      r.bodyOverflow=cs(document.body).overflow;
      const header=document.querySelector('header');
      r.header={display:cs(header).display,height:header?header.offsetHeight:0};
      const tabs=$('categoryTabs');
      r.tabs={count:tabs?tabs.children.length:0,display:cs(tabs).display};
      const aside=document.querySelector('aside');
      r.aside={w:aside?aside.offsetWidth:0,display:aside?cs(aside).display:'none'};
      const drawBtn=$('drawBtn');
      r.drawBtn={disabled:drawBtn?drawBtn.disabled:null,text:drawBtn?drawBtn.textContent.trim():null};
      const player=$('mainPlayer');
      r.player={w:player?player.offsetWidth:0,h:player?player.offsetHeight:0};
      const cc=$('customControls');
      r.controls={display:cc?cs(cc).display:'none',opacity:cc?cs(cc).opacity:null};
      const bar=$('videoActionBar');
      r.actionBar={hidden:bar?bar.classList.contains('hidden'):true,display:bar?cs(bar).display:'none',h:bar?bar.offsetHeight:0};
      r.buttons=[];['renameBtn','prefixBtn','deleteVideoBtn','revealBtn'].forEach(id=>{const el=$(id);r.buttons.push({id,exists:!!el,h:el?el.offsetHeight:0})});
      // 模态框测试：打开重命名弹窗检查布局
      if(S.currentVideo){showRenameModal();const m=$('renameModal');r.renameModal={display:cs(m).display,alignItems:cs(m).alignItems,w:m.offsetWidth};closeRenameModal();}
      // 弹出所有主要弹窗检查 display:flex
      const modals=['strategyModal','historyModal','likedModal','statsModal','achievementsModal','backupRestoreModal','helpModal'];
      const modalResults={};
      for(const id of modals){const fn='show'+id[0].toUpperCase()+id.slice(1);try{window[fn]();const m=$(id);modalResults[id]={display:cs(m).display,w:m?m.offsetWidth:0,h:m?m.offsetHeight:0};window['close'+id[0].toUpperCase()+id.slice(1)]();}catch(e){modalResults[id]={err:e.message}}}
      r.modals=modalResults;
      r.toastCount=$('toastContainer').children.length;
      return r;
    })()`);
    out.push(report);
    fs.writeFileSync(path.join(process.cwd(), 'test-shots', 'layout-audit.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log('[布局审计]', JSON.stringify(report, null, 1));
    app.exit(0);
  } catch (err) {
    console.error('[布局审计异常]', err);
    app.exit(2);
  }
};
