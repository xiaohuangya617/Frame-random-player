const status = document.getElementById('status');
const percent = document.getElementById('percent');
const progress = document.getElementById('progress');
const progressbar = document.querySelector('[role="progressbar"]');

window.splashApi.onUpdate(update => {
  if (!update || typeof update !== 'object') return;
  const value = Math.max(0, Math.min(100, Number(update.progress) || 0));
  status.textContent = typeof update.label === 'string' && update.label ? update.label : '加载中';
  percent.textContent = `${Math.round(value)}%`;
  progress.style.width = `${value}%`;
  progressbar.setAttribute('aria-valuenow', String(Math.round(value)));
  document.body.classList.toggle('error', update.error === true);
});

window.splashApi.ready();
