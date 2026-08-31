// P9: 切换合集 — 隐藏操作栏
const switchCategory=id=>{
S.activeCategoryId=id;
S.currentVideo=null;
S.strategyCounter=0;
S._switching=!0;
updateVideoActionBar(null);
const player=$('mainPlayer');
player.onerror=null;
player.pause();
if(player.src){
player.removeAttribute('src');
player.load()}
$('videoContainer').classList.add('hidden');
$('emptyState').classList.remove('hidden');
renderTabs();
updateUI()}
;
