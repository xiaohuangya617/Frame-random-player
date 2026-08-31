// 打包后恢复：electron-builder 重建 win-unpacked 会清掉其中 data（用户可能从该目录运行程序）。
// prepack 已备份 data 到 dist/_unpacked_data_backup_<ts>/，这里把最近的备份恢复回 win-unpacked/data，
// 保证用户继续使用 win-unpacked 目录时存档不丢。
const fs = require('fs');
const path = require('path');

function copyDirSync(src, dst) {
  fs.mkdirSync(dst, { recursive: true });
  for (const ent of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, ent.name);
    const d = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDirSync(s, d);
    else if (ent.isFile()) fs.copyFileSync(s, d);
  }
}

const distDir = path.join(__dirname, '..', 'dist');
const backups = fs.readdirSync(distDir)
  .filter(n => n.startsWith('_unpacked_data_backup_'))
  .map(n => path.join(distDir, n))
  .filter(d => fs.existsSync(path.join(d, 'data', 'data.json')))
  .sort();

if (backups.length === 0) {
  console.log('[恢复] 未找到打包前备份（win-unpacked 原本无 data），跳过');
  process.exit(0);
}

const latest = backups[backups.length - 1];
const target = path.join(distDir, 'win-unpacked', 'data');
try {
  copyDirSync(path.join(latest, 'data'), target);
  console.log(`[恢复] 已把存档恢复回 win-unpacked/data <- ${latest}`);
  console.log(`[恢复] 备份副本保留在 ${latest}（请勿删除，如需清理请先确认无用户数据）`);
} catch (err) {
  console.error('[恢复] 恢复失败:', err.message);
  process.exit(1);
}
process.exit(0);
