// P1: 存储层 — 用本地 JSON 存储替代 IndexedDB（保留原函数名，调用点不动）
// ===== 本地 JSON 数据存储（替代 IndexedDB）=====
const persistAll=()=>{
const payload={
version:12,
categories:S.categories.map(cat=>{
const metas=cat.videos.map(v=>({
id:v.id,name:v.name,path:v.path||'',rootName:v.rootName||'',relPath:v.relPath||'',size:v.size,watched:v.watched,watchDuration:0,lastWatchTime:null,watchCount:v.watchCount||0,likeCount:v.likeCount||0,dislikeCount:v.dislikeCount||0,playTimestamps:v.playTimestamps||[],likeTimestamps:v.likeTimestamps||[],seekTimestamps:v.seekTimestamps||[]}
));
return {
id:cat.id,name:cat.name,type:cat.type||'single',roots:cat.roots||[],videos:metas,order:cat.order||0}
}
),
achievements:S.achievements,
settings:{
prefixPresets:S.settings.prefixPresets||[],lastStrategy:S.strategy,lastPrefix:S.settings.lastPrefix||''}
}
;
return window.api.saveData(payload).catch(err=>{
console.warn('保存数据失败',err);
showToast('数据保存失败: '+err.message,'error',4000)}
);
}
;

const saveAchievementsToDB=()=>persistAll();
const saveCategoryToDB=()=>persistAll();
const deleteCategoryFromDB=id=>{
const idx=S.categories.findIndex(c=>c.id===id);
if(idx!==-1)S.categories.splice(idx,1);
return persistAll()}
;

const initDB=async()=>{
const data=await window.api.loadData();
if(data){
if(data.achievements&&data.achievements.stats)S.achievements=data.achievements;
if(data.settings){
if(Array.isArray(data.settings.prefixPresets)&&data.settings.prefixPresets.length>0)S.settings.prefixPresets=data.settings.prefixPresets;
if(data.settings.lastStrategy)S.strategy=data.settings.lastStrategy;
if(data.settings.lastPrefix)S.settings.lastPrefix=data.settings.lastPrefix}
}
return true}
;

const loadCategories=async()=>{
const data=await window.api.loadData();
const stored=data&&data.categories?data.categories:[];
S.categories=stored.map(item=>({
id:item.id,name:item.name,type:item.type||'single',roots:Array.isArray(item.roots)?item.roots:[],videoMetas:item.videos||item.videoMetas||[],videos:[],currentPool:[],order:item.order||0,persistent:!0,permissionRestored:!1}
)).sort((a,b)=>(a.order||0)-(b.order||0));
S.categories.length>0&&!S.activeCategoryId&&(S.activeCategoryId=S.categories[0].id);
// EXE 版：直接扫描根目录，无需授权
for(const cat of S.categories){
if(cat.roots&&cat.roots.length>0){
await loadVideosFromHandles(cat);
cat.permissionRestored=!0}
else cat.permissionRestored=!1}
return true}
;
