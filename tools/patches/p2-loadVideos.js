// P2: 扫描视频 — 绝对路径扫描 + 元数据匹配
const loadVideosFromHandles=async(category)=>{
const videos=[],savedMetas=category.videoMetas||[],exactMap=new Map,fallbackMap=new Map;
savedMetas.forEach(meta=>{
if(meta.path&&meta.path.includes(':'))exactMap.set(meta.path,meta);
const fk=`${meta.name}|${meta.size}`;
if(!fallbackMap.has(fk))fallbackMap.set(fk,meta)}
);
for(const root of (category.roots||[])){
let found=[];
try{
found=await window.api.scanFolder(root)}
catch(err){
showToast(`无法扫描目录 ${root}: ${err.message}`,'warning')}
const rootName=root.split(/[\\/]+/).filter(Boolean).pop()||root;
found.forEach(f=>{
let saved=exactMap.get(f.path);
if(!saved){
const fk=`${f.name}|${f.size}`;
saved=fallbackMap.get(fk)}
if(!saved){
saved=savedMetas.find(m=>m.relPath&&m.relPath===f.relPath&&m.name===f.name)}
videos.push({
id:saved?saved.id:Math.random().toString(36).substr(2,9),
name:f.name,path:f.path,relPath:f.relPath,rootName:rootName,
size:f.size,watched:saved?saved.watched:!1,
watchCount:saved?saved.watchCount||0:0,
likeCount:saved?saved.likeCount||0:0,
dislikeCount:saved?saved.dislikeCount||0:0,
playTimestamps:saved?saved.playTimestamps||[]:[],
likeTimestamps:saved?saved.likeTimestamps||[]:[],
seekTimestamps:saved?saved.seekTimestamps||[]:[]
}
)}
);
}
category.videos=videos;
category._matchCount=videos.length;
category.currentPool=category.videos.filter(v=>!v.watched)}
;
