// 4.7: 重命名 + 加前缀合并为一个弹窗（前缀可留空 / 新名称可留空 / 都填=前缀+新名）
const showRenameModal=()=>{
S._lastModalOpen=Date.now();
const video=currentVideoInCategory();
if(!video){
showToast('当前没有可操作的视频','warning');
return}
const{
base,ext}=splitFileName(video.name);
$('renameOldName').textContent=`当前文件名: ${video.name}   (${video.path})`;
renderPrefixPresetOptions();
$('prefixInput').value=S.settings.lastPrefix||'';
const input=$('renameInput');
input.value=base;
updateRenamePreview();
S._lastModalOpen=Date.now();
const m=$('renameModal');
m.style.display='flex';
m.classList.remove('hidden');
// 多次尝试聚焦输入框（窗口/输入法状态可能导致首次 focus 失败）
const focusInput=()=>{
if(!isModalVisible('renameModal'))return;
if(document.activeElement!==input)input.focus()}
;
setTimeout(focusInput,50);
setTimeout(focusInput,250);
setTimeout(()=>{
if(document.activeElement===input)input.select()}
,300)}
;

const updateRenamePreview=()=>{
const preview=$('renamePreview');
if(!preview)return;
const video=currentVideoInCategory();
if(!video)return;
const{
ext}=splitFileName(video.name);
const prefix=$('prefixInput').value.replace(/^\s+/,'');
const base=$('renameInput').value.trim();
let newName='';
if(prefix&&base)newName=prefix+base+ext;
else if(prefix)newName=prefix+video.name;
else if(base)newName=base+ext;
preview.textContent=newName?`新文件名: ${newName}`:'请填写前缀或新名称';
preview.style.color=newName?'':'#ef4444'}
;
['renameInput','prefixInput'].forEach(id=>{
$(id)&&($(id).addEventListener('input',updateRenamePreview));
$(id)&&($(id).addEventListener('keydown',e=>{
if(e.key==='Enter')applyRename()}
));
$(id)&&($(id).addEventListener('mousedown',function(){
if(document.activeElement!==this)this.focus()}
));
});

const closeRenameModal=()=>{
blurActive();
const m=$('renameModal');
m.style.display='none';
m.classList.add('hidden')}
;

// 文件操作前：暂停并释放播放器对文件的占用（等句柄释放，避免"文件占用中"）
const releasePlayerBeforeFileOp=async()=>{
const player=$('mainPlayer');
const state={
wasPlaying:!player.paused,keepTime:player.currentTime}
;
player.pause();
player.removeAttribute('src');
player.load();
await new Promise(r=>setTimeout(r,350));
return state}
;
// 文件操作后：按原状态恢复播放（延续进度与播放/暂停状态）
const resumePlayerAfterFileOp=async(filePath,state)=>{
const player=$('mainPlayer');
player.src=await window.api.toFileUrl(filePath);
player.currentTime=state.keepTime||0;
if(state.wasPlaying)player.play().catch(()=>{
})}
;

const applyRename=async()=>{
const video=currentVideoInCategory();
const category=S.categories.find(c=>c.id===S.activeCategoryId);
if(!video||!category)return;
const prefix=$('prefixInput').value.replace(/^\s+/,'');
const base=$('renameInput').value.trim();
const{
ext}=splitFileName(video.name);
let newName='';
if(prefix&&base)newName=prefix+base+ext;
else if(prefix)newName=prefix+video.name;
else if(base)newName=base+ext;
else{
showToast('请填写前缀或新名称','warning');
return}
if(newName===video.name){
showToast('文件名未变化','warning');
closeRenameModal();
return}
closeRenameModal();
if(prefix)S.settings.lastPrefix=prefix;
// 先释放播放器占用，再执行改名；改完自动恢复播放并延续进度
const playState=await releasePlayerBeforeFileOp();
const res=await window.api.renameFile(video.path,newName);
if(!res.ok){
await resumePlayerAfterFileOp(video.path,playState);
showToast(res.error||'操作失败','error',5000);
return}
video.name=newName;
video.path=res.newPath;
if(video.relPath)video.relPath=video.relPath.replace(/[^/\\]+$/,newName);
await saveCategoryToDB(category);
await resumePlayerAfterFileOp(video.path,playState);
$('videoTitle').textContent=video.name;
updateVideoActionBar(video);
showToast(`已重命名为 "${newName}"`,'success')}
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
updateRenamePreview()}
;
