// P7: 合集加载（替代原"授权"流程）
const attemptCategoryAuth=async category=>{
if(!category.roots||category.roots.length===0){
showToast(`请为合集 "${category.name}" 选择视频文件夹`,'info',5000);
const dir=await window.api.pickFolder();
if(!dir){
showToast('已取消选择文件夹','warning');
return}
category.roots=[dir]}
showToast(`正在扫描 "${category.name}" ...`,'info');
await loadVideosFromHandles(category);
category.permissionRestored=!0;
await saveCategoryToDB(category);
renderTabs();
updateUI();
updateConnectionStatus();
switchCategory(category.id);
if(category.videos.length>0)showToast(`合集 "${category.name}" 已加载，共 ${category.videos.length} 个视频`,'success');
else showToast('该文件夹中没有找到视频文件，可点击「刷新当前合集」重新扫描','warning')}
;
