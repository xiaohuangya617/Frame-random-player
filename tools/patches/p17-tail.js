window.addEventListener('beforeunload',()=>{
const player=$('mainPlayer');
if(player&&!player.paused)player.pause()}
);

// ================= EXE 版新增功能 =================
const updateVideoActionBar=video=>{
const bar=$('videoActionBar');
if(!bar)return;
if(video&&video.path){
bar.classList.remove('hidden');
$('videoPathLabel').textContent=video.path;
$('videoPathLabel').title=video.path}
else{
bar.classList.add('hidden')}
}
;

const currentVideoInCategory=()=>{
if(!S.currentVideo)return null;
const category=S.categories.find(c=>c.id===S.activeCategoryId);
if(!category)return null;
return category.videos.find(v=>v.id===S.currentVideo.id)||null}
;

const splitFileName=name=>{
const idx=name.lastIndexOf('.');
return idx>0?{
base:name.slice(0,idx),ext:name.slice(idx)}
:{
base:name,ext:''}
}
;

// ---------- 重命名 ----------
const showRenameModal=()=>{
const video=currentVideoInCategory();
if(!video){
showToast('当前没有可操作的视频','warning');
return}
const{
base,ext}=splitFileName(video.name);
$('renameOldName').textContent=`当前文件名: ${video.name}   (${video.path})`;
const input=$('renameInput');
input.value=base;
updateRenamePreview();
S._lastModalOpen=Date.now();
const m=$('renameModal');
m.style.display='flex';
m.classList.remove('hidden');
setTimeout(()=>{
input.focus();
input.select()}
,50)}
;

const updateRenamePreview=()=>{
const input=$('renameInput'),preview=$('renamePreview');
if(!input||!preview)return;
const video=currentVideoInCategory();
if(!video)return;
const{
ext}=splitFileName(video.name);
const name=input.value.trim()+ext;
preview.textContent=name?`新文件名: ${name}`:'新文件名: (空)';
preview.style.color=name?'':'#ef4444'}
;
$('renameInput')&&($('renameInput').addEventListener('input',updateRenamePreview));
$('renameInput')&&($('renameInput').addEventListener('keydown',e=>{
if(e.key==='Enter')applyRename()}
));

const closeRenameModal=()=>{
const m=$('renameModal');
m.style.display='none';
m.classList.add('hidden')}
;

const applyRename=async()=>{
const video=currentVideoInCategory();
const category=S.categories.find(c=>c.id===S.activeCategoryId);
if(!video||!category)return;
const name=$('renameInput').value.trim();
if(!name){
showToast('文件名不能为空','warning');
return}
const{
ext}=splitFileName(video.name);
const newName=name+ext;
if(newName===video.name){
showToast('文件名未变化','warning');
closeRenameModal();
return}
closeRenameModal();
const res=await window.api.renameFile(video.path,newName);
if(!res.ok){
showToast(res.error||'重命名失败','error',5000);
return}
const keepTime=$('mainPlayer').currentTime;
const wasPlaying=!$('mainPlayer').paused;
video.name=newName;
video.path=res.newPath;
if(video.relPath)video.relPath=video.relPath.replace(/[^/\\]+$/,newName);
await saveCategoryToDB(category);
$('mainPlayer').src=await window.api.toFileUrl(video.path);
$('mainPlayer').currentTime=keepTime;
if(wasPlaying)$('mainPlayer').play().catch(()=>{
});
$('videoTitle').textContent=video.name;
updateVideoActionBar(video);
showToast(`已重命名为 "${newName}"`,'success')}
;

// ---------- 加前缀 ----------
const showPrefixModal=()=>{
const video=currentVideoInCategory();
if(!video){
showToast('当前没有可操作的视频','warning');
return}
$('prefixOldName').textContent=`当前文件名: ${video.name}   (${video.path})`;
$('prefixInput').value=S.settings.lastPrefix||'';
renderPrefixPresetOptions();
updatePrefixPreview();
S._lastModalOpen=Date.now();
const m=$('prefixModal');
m.style.display='flex';
m.classList.remove('hidden');
setTimeout(()=>{
$('prefixInput').focus()}
,50)}
;

const renderPrefixPresetOptions=()=>{
const sel=$('prefixPresetSelect');
if(!sel)return;
const current=sel.value;
sel.innerHTML='<option value="">（不使用预设，手动输入）</option>';
S.settings.prefixPresets.forEach((p,i)=>{
const opt=document.createElement('option');
opt.value=String(i);
opt.textContent=p;
sel.appendChild(opt)}
);
if(current!=='')sel.value=current}
;

const useSelectedPreset=()=>{
const sel=$('prefixPresetSelect');
if(sel.value===''){
showToast('请先选择预设','warning');
return}
$('prefixInput').value=S.settings.prefixPresets[Number(sel.value)];
updatePrefixPreview()}
;

const updatePrefixPreview=()=>{
const video=currentVideoInCategory();
const input=$('prefixInput'),preview=$('prefixPreview');
if(!video||!input||!preview)return;
const prefix=input.value;
preview.textContent=prefix?`新文件名: ${prefix}${video.name}`:'输入前缀后显示预览'}
;
$('prefixInput')&&($('prefixInput').addEventListener('input',updatePrefixPreview));
$('prefixInput')&&($('prefixInput').addEventListener('keydown',e=>{
if(e.key==='Enter')applyPrefix()}
));

const closePrefixModal=()=>{
const m=$('prefixModal');
m.style.display='none';
m.classList.add('hidden')}
;

const applyPrefix=async()=>{
const video=currentVideoInCategory();
const category=S.categories.find(c=>c.id===S.activeCategoryId);
if(!video||!category)return;
const prefix=$('prefixInput').value.trim();
if(!prefix){
showToast('请输入前缀内容','warning');
return}
const newName=prefix+video.name;
closePrefixModal();
const res=await window.api.renameFile(video.path,newName);
if(!res.ok){
showToast(res.error||'加前缀失败','error',5000);
return}
S.settings.lastPrefix=prefix;
const keepTime=$('mainPlayer').currentTime;
const wasPlaying=!$('mainPlayer').paused;
video.name=newName;
video.path=res.newPath;
if(video.relPath)video.relPath=video.relPath.replace(/[^/\\]+$/,newName);
await saveCategoryToDB(category);
$('mainPlayer').src=await window.api.toFileUrl(video.path);
$('mainPlayer').currentTime=keepTime;
if(wasPlaying)$('mainPlayer').play().catch(()=>{
});
$('videoTitle').textContent=video.name;
updateVideoActionBar(video);
showToast(`已加前缀，新文件名: "${newName}"`,'success')}
;

// ---------- 前缀预设管理 ----------
const showPrefixPresetsModal=()=>{
renderPrefixPresetList();
S._lastModalOpen=Date.now();
const m=$('prefixPresetsModal');
m.style.display='flex';
m.classList.remove('hidden')}
;

const renderPrefixPresetList=()=>{
const list=$('prefixPresetList');
if(!list)return;
if(S.settings.prefixPresets.length===0){
list.innerHTML='<p class="text-gray-500 text-sm text-center py-3">暂无预设，请在下方添加</p>';
return}
list.innerHTML='';
S.settings.prefixPresets.forEach((p,i)=>{
const row=document.createElement('div');
row.className='flex items-center gap-2 bg-gray-900/50 rounded-lg px-3 py-2';
const span=document.createElement('span');
span.className='flex-1 text-sm text-gray-200 truncate';
span.textContent=p;
span.title=p;
const renameBtn=document.createElement('button');
renameBtn.className='px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-200 transition-colors';
renameBtn.textContent='改名';
renameBtn.onclick=()=>{
const next=prompt('输入新的预设内容：',p);
if(next&&next.trim()){
S.settings.prefixPresets[i]=next.trim();
persistAll();
renderPrefixPresetList();
renderPrefixPresetOptions();
showToast('预设已更新','success')}
}
;
const delBtn=document.createElement('button');
delBtn.className='px-2 py-1 text-xs bg-red-900/40 hover:bg-red-900/70 rounded text-red-300 transition-colors';
delBtn.textContent='删除';
delBtn.onclick=()=>{
if(!confirm(`删除预设 "${p}"？`))return;
S.settings.prefixPresets.splice(i,1);
persistAll();
renderPrefixPresetList();
renderPrefixPresetOptions();
showToast('预设已删除','success')}
;
row.appendChild(span);
row.appendChild(renameBtn);
row.appendChild(delBtn);
list.appendChild(row)}
)
}
;

const addPrefixPreset=()=>{
const input=$('prefixNewPreset');
const val=input.value.trim();
if(!val){
showToast('请输入预设内容','warning');
return}
if(S.settings.prefixPresets.includes(val)){
showToast('该预设已存在','warning');
return}
S.settings.prefixPresets.push(val);
input.value='';
persistAll();
renderPrefixPresetList();
renderPrefixPresetOptions();
showToast('预设已添加','success')}
;

const closePrefixPresetsModal=()=>{
const m=$('prefixPresetsModal');
m.style.display='none';
m.classList.add('hidden')}
;

// ---------- 删除（系统回收站） ----------
const confirmDeleteCurrentVideo=()=>{
const video=currentVideoInCategory();
if(!video){
showToast('当前没有可操作的视频','warning');
return}
$('deleteVideoName').textContent=video.name;
$('deleteVideoPath').textContent=video.path;
S._lastModalOpen=Date.now();
const m=$('deleteVideoModal');
m.style.display='flex';
m.classList.remove('hidden')}
;

const closeDeleteVideoModal=()=>{
const m=$('deleteVideoModal');
m.style.display='none';
m.classList.add('hidden')}
;

const doDeleteCurrentVideo=async()=>{
const video=currentVideoInCategory();
const category=S.categories.find(c=>c.id===S.activeCategoryId);
if(!video||!category)return;
closeDeleteVideoModal();
const res=await window.api.trashFile(video.path);
if(!res.ok){
showToast('删除失败: '+(res.error||'文件可能被占用或已不存在'),'error',5000);
return}
const idx=category.videos.findIndex(v=>v.id===video.id);
if(idx!==-1)category.videos.splice(idx,1);
category.currentPool=category.videos.filter(v=>!v.watched);
await saveCategoryToDB(category);
const player=$('mainPlayer');
player.pause();
player.removeAttribute('src');
player.load();
S.currentVideo=null;
$('videoContainer').classList.add('hidden');
$('emptyState').classList.remove('hidden');
updateVideoActionBar(null);
renderTabs();
updateUI();
showToast(`"${video.name}" 已移入系统回收站`,'success');
if(category.currentPool.length>0){
setTimeout(()=>drawVideo(),600)}
}
;

// ---------- 打开所在文件夹 ----------
const revealCurrentVideo=()=>{
const video=currentVideoInCategory();
if(!video){
showToast('当前没有可操作的视频','warning');
return}
window.api.revealFile(video.path)}
;

// ================= 启动流程 =================
document.addEventListener('DOMContentLoaded',async()=>{
await initDB();
await loadCategories();
updateConnectionStatus();
renderTabs();
updateUI();
updateVideoActionBar(null);
document.addEventListener('keydown',handleKeyPress);
const player=$('mainPlayer');
player.addEventListener('ended',onVideoEnded);
setupGlobalClick();
setupVideoSeekListener();
setupCustomControls()}
);

const dragOverlay=$('dragOverlay');
document.addEventListener('dragover',e=>{
e.preventDefault();
if(e.target.closest('#categoryTabs')) return;
dragOverlay.classList.add('active')}
);
document.addEventListener('dragleave',e=>{
if(e.target.closest('#categoryTabs'))return;
if(!e.relatedTarget){
dragOverlay.classList.remove('active')}
else if(e.relatedTarget instanceof Element&&!e.relatedTarget.closest){
dragOverlay.classList.remove('active')}
}
);
document.addEventListener('drop',async e=>{
e.preventDefault();
dragOverlay.classList.remove('active');
if(e.target.closest('#categoryTabs')) return;
const items=e.dataTransfer.items,paths=[];
let failedCount=0;
const promises=[];
for(let i=0;
i<items.length;
i++){
const item=items[i];
if(item.kind==='file'){
promises.push((async()=>{
const file=item.getAsFile();
const p=file?window.api.getPathForFile(file):null;
if(p){
const isDir=await window.api.isDirectory(p);
if(isDir)paths.push(p);
else console.warn('拖拽项不是文件夹:',p)}
else failedCount++}
)().catch(err=>{
console.warn('无法获取文件夹路径:',err);
failedCount++}
))}
}
await Promise.all(promises);
if(paths.length>0){
failedCount>0&&showToast(`成功获取 ${paths.length} 个文件夹，${failedCount} 个失败`,'warning');
S.tempCollectionPaths=paths;
updateSelectedDirsList();
let baseName='拖拽合集',finalName=baseName,counter=1;
while(S.categories.some(c=>c.name===finalName))finalName=`${baseName} ${counter++}`;
$('collectionNameInput').value=finalName;
S._lastModalOpen=Date.now();
$('collectionModal').style.display='';
$('collectionModal').classList.remove('hidden');
$('collectionModal').classList.add('flex')}
else showToast('未检测到有效的文件夹，请拖拽文件夹','warning')}
);
