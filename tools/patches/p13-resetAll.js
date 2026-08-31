// P13: 数据初始化（安全清空）
const resetAllPools=async()=>{
if(!confirm('数据初始化：将删除所有合集并重置所有数据（包括成就、历史、点赞等），此操作不可恢复。'))return;
S.categories=[];
S.activeCategoryId=null;
S.currentVideo=null;
S.history=[];
S.achievements={
stats:{
totalPlays:0,totalCollections:0,totalResets:0,totalRefreshes:0,consecutiveDays:0,lastPlayDate:null,totalSeeks:0,categoryPlays:{
}
,totalLikes:0,totalDislikes:0,specialPlays:0,logoClickCount:0,nightPlays:0}
,unlocked:{
}
}
;
await persistAll();
renderTabs();
updateUI();
updateConnectionStatus();
$('videoContainer').classList.add('hidden');
$('emptyState').classList.remove('hidden');
updateVideoActionBar(null);
showToast('数据初始化完成','success')}
;
