// P3: 合集创建相关函数 — 句柄改为绝对路径
const openCollectionCreator=()=>{
S.tempCollectionPaths=[];
updateSelectedDirsList();
$('collectionNameInput').value='';
const m=$('collectionModal');
S._lastModalOpen=Date.now();
m.style.display='';
m.classList.remove('hidden');
m.classList.add('flex')}
;

const updateSelectedDirsList=()=>{
const listDiv=$('selectedDirsList'),countSpan=$('selectedDirCount'),paths=S.tempCollectionPaths;
countSpan.textContent=paths.length;
if(paths.length===0)listDiv.innerHTML='<p class="text-gray-500 italic">暂无目录</p>';
else{
let html='';
paths.forEach((p,idx)=>{
const name=p.split(/[\\/]+/).filter(Boolean).pop()||p;
html+=`<div class="flex justify-between items-center py-1 border-b border-gray-700 last:border-0"><span class="truncate">${name}</span><button onclick="removeCollectionDir(${idx})" class="text-red-400 hover:text-red-300 text-xs ml-2">✕</button></div>`});
listDiv.innerHTML=html}}
;

const addDirectoryToCollection=async()=>{
const dir=await window.api.pickFolder();
if(!dir)return;
if(S.tempCollectionPaths.includes(dir)){
showToast('该目录已存在，请勿重复添加','warning');
return}
S.tempCollectionPaths.push(dir);
updateSelectedDirsList()}
;

const removeCollectionDir=index=>{
S.tempCollectionPaths.splice(index,1);
updateSelectedDirsList()}
;

const clearCollectionDirs=()=>{
S.tempCollectionPaths=[];
updateSelectedDirsList()}
;

const createCollection=async()=>{
const name=$('collectionNameInput').value.trim();
if(!name){
showToast('请输入合集名称','warning');
return}
if(S.tempCollectionPaths.length===0){
showToast('请至少添加一个目录','warning');
return}
if(S.categories.some(c=>c.name===name)){
showToast('该名称已存在，请换一个','warning');
return}
const maxOrder=S.categories.reduce((max,cat)=>Math.max(max,cat.order||0),-1);
const newCategory={
id:Date.now().toString(),name:name,type:'collection',roots:[...S.tempCollectionPaths],videos:[],currentPool:[],order:maxOrder+1,persistent:!0,permissionRestored:!1}
;
showToast(`开始扫描合集 "${name}" 中的目录...`,'info',2000);
await loadVideosFromHandles(newCategory);
newCategory.permissionRestored=!0;
S.categories.push(newCategory);
S.activeCategoryId=newCategory.id;
S.achievements.stats.totalCollections++;
checkAchievements();
await saveAchievementsToDB();
await saveCategoryToDB(newCategory);
closeCollectionModal();
updateConnectionStatus();
renderTabs();
updateUI();
if(newCategory.videos.length>0)showToast(`合集创建成功，共 ${newCategory.videos.length} 个视频`,'success');
else showToast('合集中没有找到视频文件，可稍后点击「刷新当前合集」重新扫描','warning')}
;
