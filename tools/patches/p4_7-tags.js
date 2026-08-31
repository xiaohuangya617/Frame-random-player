// ================= 4.7 标签功能 =================
// ---------- 加标签（仅存存档，不改文件名） ----------
const showTagsModal=()=>{
S._lastModalOpen=Date.now();
const video=currentVideoInCategory();
if(!video){
showToast('当前没有可操作的视频','warning');
return}
$('tagsOldName').textContent=`当前视频: ${video.name}   (${video.path})`;
renderTagsList(video);
S._lastModalOpen=Date.now();
const m=$('tagsModal');
m.style.display='flex';
m.classList.remove('hidden')}
;

const renderTagsList=video=>{
const list=$('tagsList');
if(!list)return;
const tags=S.settings.tags||[];
if(tags.length===0){
list.innerHTML='<p class="text-gray-500 text-sm">暂无标签预设，请先添加</p>';
return}
list.innerHTML='';
tags.forEach(tag=>{
const has=(video.tags||[]).includes(tag);
const btn=document.createElement('button');
btn.className=`px-4 py-2 rounded-lg text-sm font-medium border transition-all ${has?'bg-purple-600 text-white border-purple-500 shadow-lg shadow-purple-500/30':'bg-gray-700/40 text-gray-300 border-gray-600/60 hover:bg-gray-700'}`;
btn.textContent=has?`${tag} ✓`:`${tag}`;
btn.onclick=()=>{
toggleVideoTag(video,tag);
renderTagsList(video)};
list.appendChild(btn)}
)
}
;

const toggleVideoTag=(video,tag)=>{
video.tags||(video.tags=[]);
const idx=video.tags.indexOf(tag);
if(idx===-1){
video.tags.push(tag);
showToast(`已添加标签 "${tag}"`,'success')}
else{
video.tags.splice(idx,1);
showToast(`已取消标签 "${tag}"`,'info')}
saveCategoryToDB(S.categories.find(c=>c.id===S.activeCategoryId));
syncTagCategories();
renderTabs();
updateUI()}
;

const closeTagsModal=()=>{
blurActive();
const m=$('tagsModal');
m.style.display='none';
m.classList.add('hidden')}
;

// ---------- 标签预设管理 ----------
const showTagsPresetsModal=()=>{
S._lastModalOpen=Date.now();
renderTagsPresetList();
S._lastModalOpen=Date.now();
const m=$('tagsPresetsModal');
m.style.display='flex';
m.classList.remove('hidden')}
;

const renderTagsPresetList=()=>{
const list=$('tagsPresetList');
if(!list)return;
if((S.settings.tags||[]).length===0){
list.innerHTML='<p class="text-gray-500 text-sm text-center py-3">暂无标签预设，请在下方添加</p>';
return}
list.innerHTML='';
S.settings.tags.forEach((t,i)=>{
const row=document.createElement('div');
row.className='flex items-center gap-2 bg-gray-900/50 rounded-lg px-3 py-2';
const span=document.createElement('span');
span.className='flex-1 text-sm text-gray-200 truncate';
span.textContent=t;
span.title=t;
const renameBtn=document.createElement('button');
renameBtn.className='px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded text-gray-200 transition-colors';
renameBtn.textContent='改名';
renameBtn.onclick=()=>{
const next=prompt('输入新的标签名：',t);
if(next&&next.trim()){
S.settings.tags[i]=next.trim();
persistAll();
renderTagsPresetList();
showToast('标签已更新','success')}
}
;
const delBtn=document.createElement('button');
delBtn.className='px-2 py-1 text-xs bg-red-900/40 hover:bg-red-900/70 rounded text-red-300 transition-colors';
delBtn.textContent='删除';
delBtn.onclick=()=>{
if(!confirm(`删除标签 "${t}"？已有该标签的视频将失去此标签。`))return;
S.settings.tags.splice(i,1);
persistAll();
syncTagCategories();
renderTagsPresetList();
showToast('标签已删除','success')}
;
row.appendChild(span);
row.appendChild(renameBtn);
row.appendChild(delBtn);
list.appendChild(row)}
)
}
;

const addTagsPreset=()=>{
const input=$('tagsNewPreset');
const val=input.value.trim();
if(!val){
showToast('请输入标签内容','warning');
return}
if((S.settings.tags||[]).includes(val)){
showToast('该标签已存在','warning');
return}
S.settings.tags||(S.settings.tags=[]);
S.settings.tags.push(val);
input.value='';
persistAll();
renderTagsPresetList();
showToast('标签已添加','success')}
;

const closeTagsPresetsModal=()=>{
blurActive();
const m=$('tagsPresetsModal');
m.style.display='none';
m.classList.add('hidden')}
;

// ---------- 标签合集（动态聚合） ----------
const showTagCollectionModal=()=>{
renderTagCollectionTags();
$('tagCollectionName').value='';
S._lastModalOpen=Date.now();
const m=$('tagCollectionModal');
m.style.display='flex';
m.classList.remove('hidden')}
;

const renderTagCollectionTags=()=>{
const wrap=$('tagCollectionTags');
if(!wrap)return;
const tags=S.settings.tags||[];
if(tags.length===0){
wrap.innerHTML='<p class="text-gray-500 text-sm">暂无标签预设，请先为视频添加标签</p>';
return}
wrap.innerHTML='';
tags.forEach(tag=>{
const btn=document.createElement('button');
btn.dataset.tag=tag;
btn.className='px-4 py-2 rounded-lg text-sm font-medium border transition-all bg-gray-700/40 text-gray-300 border-gray-600/60 hover:bg-gray-700';
btn.textContent=tag;
btn.onclick=()=>{
const on=btn.classList.toggle('tag-picked');
btn.className=on?'px-4 py-2 rounded-lg text-sm font-medium border transition-all bg-purple-600 text-white border-purple-500 shadow-lg shadow-purple-500/30':'px-4 py-2 rounded-lg text-sm font-medium border transition-all bg-gray-700/40 text-gray-300 border-gray-600/60 hover:bg-gray-700';
if(on){
const name=$('tagCollectionName');
if(!name.value.trim())name.value=tag}
};
wrap.appendChild(btn)}
)
}
;

const closeTagCollectionModal=()=>{
blurActive();
const m=$('tagCollectionModal');
m.style.display='none';
m.classList.add('hidden')}
;

// 按标签动态聚合标签合集（只从普通合集取视频，避免标签合集互相嵌套）
const syncTagCategories=()=>{
let changed=false;
S.categories.forEach(cat=>{
if(cat.type!=='tags')return;
const tags=cat.tags||[];
const pool=[],seen=new Set();
S.categories.forEach(other=>{
if(other===cat||other.type==='tags')return;
(other.videos||[]).forEach(v=>{
if(seen.has(v.id))return;
const vt=v.tags||[];
if(tags.some(t=>vt.includes(t))){
seen.add(v.id);
pool.push(v)}
});
});
cat.videos=pool;
cat.currentPool=pool.filter(v=>!v.watched);
changed=true});
return changed}
;

const createTagCollection=()=>{
const picked=Array.from(document.querySelectorAll('#tagCollectionTags .tag-picked')).map(b=>b.dataset.tag);
if(picked.length===0){
showToast('请至少勾选一个标签','warning');
return}
let name=$('tagCollectionName').value.trim();
if(!name){
name=picked.join('+')}
if(S.categories.some(c=>c.name===name)){
showToast('该名称已存在，请换一个','warning');
return}
const maxOrder=S.categories.reduce((max,cat)=>Math.max(max,cat.order||0),-1);
const newCategory={
id:'tag'+Date.now().toString(),name:name,type:'tags',tags:picked,roots:[],videos:[],currentPool:[],order:maxOrder+1,persistent:!0,permissionRestored:!0}
;
syncTagCategories();
// 统计新合集将包含的视频数
let count=0;
S.categories.forEach(other=>{
if(other.type==='tags')return;
(other.videos||[]).forEach(v=>{
const vt=v.tags||[];
if(picked.some(t=>vt.includes(t)))count++});
});
S.categories.push(newCategory);
S.activeCategoryId=newCategory.id;
syncTagCategories();
S.achievements.stats.totalCollections++;
checkAchievements();
saveAchievementsToDB();
saveCategoryToDB(newCategory);
closeTagCollectionModal();
updateConnectionStatus();
renderTabs();
updateUI();
switchCategory(newCategory.id);
showToast(`标签合集 "${name}" 已创建，包含 ${count} 个视频`,'success')}
;
