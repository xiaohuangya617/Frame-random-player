// P15: 点赞/点踩清单导出 — 直接导出绝对路径
const exportLikedList=async()=>{
const paths=[];
S.categories.forEach(cat=>{
cat.videos.forEach(v=>{
if(v.likeCount>0&&v.path)paths.push(v.path)}
)}
);
if(paths.length===0){
showToast('没有点赞视频可导出','warning');
return}
const saved=await window.api.saveText(paths.join('\n'),`liked_videos_${new Date().toISOString().slice(0,10)}.txt`);
if(saved)showToast(`已导出 ${paths.length} 个视频路径`,'success')}
;
const exportDislikedList=async()=>{
const paths=[];
S.categories.forEach(cat=>{
cat.videos.forEach(v=>{
if(v.dislikeCount>0&&v.path)paths.push(v.path)}
)}
);
if(paths.length===0){
showToast('没有点踩视频可导出','warning');
return}
const saved=await window.api.saveText(paths.join('\n'),`disliked_videos_${new Date().toISOString().slice(0,10)}.txt`);
if(saved)showToast(`已导出 ${paths.length} 个视频路径`,'success')}
;
