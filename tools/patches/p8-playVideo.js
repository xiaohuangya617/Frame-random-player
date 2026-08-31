// P8: playVideo — file:// 播放 + 操作栏联动
const playVideo=async(video,options={
}
)=>{
const category=S.categories.find(c=>c.id===S.activeCategoryId);
if(!category){
showToast('无法找到视频所属分类','error');
return}
const player=$('mainPlayer'),container=$('videoContainer'),emptyState=$('emptyState');
player.onerror=function(){
if(S._switching){
S._switching=!1;
return}
const err=player.error;
if(err&&err.code===err.MEDIA_ERR_SRC_NOT_SUPPORTED){
const exts=['mkv','avi','flv','mov','wmv','ts','m2ts'];
const ext=video.name.split('.').pop().toLowerCase();
if(exts.includes(ext)){
player._errorHandled=!0;
showToast('该视频格式('+ext.toUpperCase()+')播放器不支持直接播放，可尝试用格式工厂转为MP4','warning',8000)}
else {
player._errorHandled=!0;
showToast('视频无法播放，可能文件损坏或编码不兼容','error')}
}
}
;
if(player.src)player.removeAttribute('src');
try{
player.src=await window.api.toFileUrl(video.path)}
catch(err){
showToast('视频文件读取失败','error');
return}
$('videoTitle').textContent=video.name;
$('videoMeta').textContent=formatFileSize(video.size);
$('likeCount').textContent=video.likeCount||0;
$('dislikeCount').textContent=video.dislikeCount||0;
emptyState.classList.add('hidden');
container.classList.remove('hidden');
updateVideoActionBar(video);
video.watchCount=(video.watchCount||0)+1;
video.playTimestamps||(video.playTimestamps=[]);
video.playTimestamps.push(Date.now());
video.playTimestamps.length>100&&(video.playTimestamps=video.playTimestamps.slice(-100));
S.achievements.stats.totalPlays++;
S.achievements.stats.categoryPlays[category.id]||(S.achievements.stats.categoryPlays[category.id]=0);
S.achievements.stats.categoryPlays[category.id]++;
const today=new Date().toISOString().slice(0,10);
if(S.achievements.stats.lastPlayDate!==today){
const last=S.achievements.stats.lastPlayDate;
if(last){
const lastDate=new Date(last),yesterday=new Date;
yesterday.setDate(yesterday.getDate()-1);
lastDate.toISOString().slice(0,10)===yesterday.toISOString().slice(0,10)?S.achievements.stats.consecutiveDays++:S.achievements.stats.consecutiveDays=1}
else S.achievements.stats.consecutiveDays=1;
S.achievements.stats.lastPlayDate=today}
const hour=new Date().getHours();
hour>=0&&hour<=5&&S.achievements.stats.nightPlays++;
if(!options.specialPlay){
if(!video.watched){
video.watched=!0;
const index=category.currentPool.findIndex(v=>v.id===video.id);
index!==-1&&category.currentPool.splice(index,1)}
}
else S.achievements.stats.specialPlays++;
addToHistory(video,category.name,category.id,video.id);
saveCategoryToDB(category).catch(err=>console.warn('保存播放状态失败',err));
checkAchievements();
saveAchievementsToDB();
updateUI();
player.play().catch(e=>{
if(S._switching){
S._switching=!1;
return}
if(player._errorHandled){
player._errorHandled=!1;
return}
console.log('播放失败:',e);
showToast('播放失败，可能文件已损坏或格式不支持','error')}
)}
;
