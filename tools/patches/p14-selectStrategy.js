// P14: 策略选择 — 持久化上次策略
const selectStrategy=(strategy)=>{
S.strategy=strategy;
S.strategyCounter=0;
S.settings.lastStrategy=strategy;
persistAll().catch(()=>{
});
closeStrategyModal();
showToast(`已切换策略：${strategy==='default'?'默认设置':strategy==='liked'?'点赞加权':strategy==='short'?'短片优先':'长片优先'}`,'success')}
;
