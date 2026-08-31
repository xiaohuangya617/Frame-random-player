// ================= 4.8 通用对话框（替代原生 confirm/prompt，避免焦点问题） =================
let _confirmResolve=null;
let _promptResolve=null;

const showConfirmDialog=(message,title='确认操作')=>new Promise(resolve=>{
// E2E 测试钩子：window.__autoConfirm 已设置时直接返回
if(window.__autoConfirm!==undefined){
resolve(!!window.__autoConfirm);
return}
_confirmResolve=resolve;
$('confirmDialogTitle').textContent=title;
$('confirmDialogMessage').textContent=message;
S._lastModalOpen=Date.now();
const m=$('confirmDialogModal');
m.style.display='flex';
m.classList.remove('hidden')}
;
const resolveConfirmDialog=val=>{
if(_confirmResolve){
_confirmResolve(val);
_confirmResolve=null}
blurActive();
const m=$('confirmDialogModal');
m.style.display='none';
m.classList.add('hidden')}
;
const confirmDialogOK=()=>resolveConfirmDialog(true);
const confirmDialogCancel=()=>resolveConfirmDialog(false);

const showPromptDialog=(message,defaultValue='',title='输入内容')=>new Promise(resolve=>{
// E2E 测试钩子：window.__autoPrompt 已设置时直接返回（null=取消）
if(window.__autoPrompt!==undefined){
resolve(window.__autoPrompt);
return}
_promptResolve=resolve;
$('promptDialogTitle').textContent=title;
$('promptDialogMessage').textContent=message;
const input=$('promptDialogInput');
input.value=defaultValue;
S._lastModalOpen=Date.now();
const m=$('promptDialogModal');
m.style.display='flex';
m.classList.remove('hidden');
setTimeout(()=>{
if(isModalVisible('promptDialogModal'))input.focus()}
,50)}
;
const resolvePromptDialog=val=>{
if(_promptResolve){
_promptResolve(val);
_promptResolve=null}
blurActive();
const m=$('promptDialogModal');
m.style.display='none';
m.classList.add('hidden')}
;
const promptDialogOK=()=>resolvePromptDialog($('promptDialogInput').value);
const promptDialogCancel=()=>resolvePromptDialog(null);
$('promptDialogInput')&&($('promptDialogInput').addEventListener('keydown',e=>{
if(e.key==='Enter')promptDialogOK()}
));
