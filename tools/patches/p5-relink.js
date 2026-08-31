// P5: 关联文件夹（替代原"存档授权"）
const relinkCategoryRoots=async()=>{
const targets=S.categories.filter(c=>!(c.roots&&c.roots.length>0)||!c.permissionRestored);
if(targets.length===0){
showToast('所有合集都已关联文件夹','info');
closeBackupRestoreModal();
return}
showToast(`需要为 ${targets.length} 个合集关联文件夹（可取消跳过）`,'info',6000);
let successCount=0;
for(const cat of targets){
showToast(`为合集 "${cat.name}" 选择文件夹（可多次选择添加多个，取消结束）`,'info',9000);
const dirs=[];
while(true){
const dir=await window.api.pickFolder();
if(!dir)break;
if(dirs.includes(dir))break;
dirs.push(dir)}
if(dirs.length===0){
showToast(`已跳过 "${cat.name}"`,'warning');
continue}
cat.roots=dirs;
await loadVideosFromHandles(cat);
cat.permissionRestored=!0;
await saveCategoryToDB(cat);
if(cat.videos.length>0)successCount++;
else showToast(`"${cat.name}" 未找到视频文件，可稍后重新关联`,'warning')}
updateConnectionStatus();
renderTabs();
updateUI();
closeBackupRestoreModal();
showToast(`关联完成，成功 ${successCount}/${targets.length} 个合集`,'success')}
;
