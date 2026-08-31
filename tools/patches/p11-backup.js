// P11: 备份 — 原生保存对话框
const backupData=async()=>{
S._lastModalOpen=Date.now();
try{
const backup=S.categories.map(cat=>({
id:cat.id,name:cat.name,type:cat.type||'single',roots:cat.roots||[],videos:cat.videos.map(v=>({
id:v.id,name:v.name,path:v.path||'',rootName:v.rootName||'',relPath:v.relPath||'',size:v.size,watched:v.watched,watchCount:v.watchCount||0,likeCount:v.likeCount||0,dislikeCount:v.dislikeCount||0,playTimestamps:v.playTimestamps||[],likeTimestamps:v.likeTimestamps||[],seekTimestamps:v.seekTimestamps||[]}
)),order:cat.order||0}
));
const backupPackage={
categories:backup,achievements:S.achievements,version:12,
meta:{
appVersion:'4.0',backupTime:new Date().toISOString(),categoryCount:backup.length,
totalVideos:backup.reduce((s,c)=>s+(c.videos?c.videos.length:0),0),
rootFolders:[...new Set(backup.map(c=>c.videos&&c.videos[0]?(c.videos[0].rootName||c.name):c.name))]}
};
const saved=await window.api.saveBackup(backupPackage,`播放备份_${new Date().toISOString().slice(0,10)}.json`);
if(saved)showToast(`备份已保存: ${saved}`,'success')}
catch(err){
console.error(err);
showToast('备份出错: '+err.message,'error')}
}
;
