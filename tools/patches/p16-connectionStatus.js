// P16: 连接状态 — 显示数据目录就绪
const updateConnectionStatus=()=>{
const status=$('connectionStatus');
if(!status)return;
status.innerHTML='<span class="w-2 h-2 rounded-full bg-green-400"></span><span class="text-green-400">数据目录就绪</span>';
status.style.cursor='pointer';
status.onclick=()=>{
window.api.getDataDir().then(dir=>showToast('数据目录: '+dir,'info',6000)).catch(()=>{
})};
window.api.getDataDir().then(dir=>{
status.title='数据目录: '+dir}
).catch(()=>{
})}
;
