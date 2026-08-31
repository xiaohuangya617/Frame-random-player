// P12: 恢复 — 原生打开对话框
const restoreData=async()=>{
const file=await window.api.pickBackupFile();
if(!file)return;
try{
const text=await window.api.readText(file);
const backupPackage=JSON.parse(text);
if(!backupPackage.categories||!Array.isArray(backupPackage.categories)){
showToast('备份文件格式错误','error');
return}
const meta=backupPackage.meta||{};
const summary=meta.categoryCount?`\n合集数: ${meta.categoryCount}\n视频总数: ${meta.totalVideos||'?'}\n备份时间: ${(meta.backupTime||'').slice(0,16)}`:'';
const confirmed=confirm(`即将恢复备份数据，当前数据将被覆盖！${summary}\n\n确定恢复？`);
if(!confirmed)return;
S.categories=backupPackage.categories.map(item=>({
id:item.id,name:item.name,type:item.type||'single',roots:Array.isArray(item.roots)?item.roots:[],videoMetas:item.videos||item.videoMetas||[],videos:[],currentPool:[],order:item.order||0,persistent:!0,permissionRestored:!1}
));
if(backupPackage.achievements&&backupPackage.achievements.stats)S.achievements=backupPackage.achievements;
else S.achievements={
stats:{
totalPlays:0,totalCollections:0,totalResets:0,totalRefreshes:0,consecutiveDays:0,lastPlayDate:null,totalSeeks:0,categoryPlays:{
}
,totalLikes:0,totalDislikes:0,specialPlays:0,logoClickCount:0,nightPlays:0}
,unlocked:{
}
}
;
S.history=[];
S.currentVideo=null;
await persistAll();
for(const cat of S.categories){
if(cat.roots&&cat.roots.length>0){
await loadVideosFromHandles(cat);
cat.permissionRestored=!0}
else cat.permissionRestored=!1}
await persistAll();
$('videoContainer').classList.add('hidden');
$('emptyState').classList.remove('hidden');
updateVideoActionBar(null);
updateConnectionStatus();
renderTabs();
updateUI();
if(!$('backupRestoreModal').classList.contains('hidden'))closeBackupRestoreModal();
showToast('数据恢复成功！未关联文件夹的合集请点击「关联文件夹」','success',6000)}
catch(err){
console.error(err);
showToast('恢复失败: '+err.message,'error')}
}
;
