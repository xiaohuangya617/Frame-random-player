// 打包前保护：如果 dist/win-unpacked/data 存在（用户可能从该目录运行过程序），
// 先把 data 完整备份到 dist/_unpacked_data_backup_<时间戳>/，防止 electron-builder 重建目录时清掉用户存档。
// 兜底：若 win-unpacked/data 意外缺失，先从最近一次打包备份自动恢复（保证下次构建不丢存档）。
// 注意：不用 fs.cpSync（Node 22 在 Windows 上复制含中文文件名的目录会崩溃 0xC0000409），用手动递归复制。
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
const unpackedData = path.join(distDir, 'win-unpacked', 'data');

if (!fs.existsSync(distDir)) {
  console.log('[备份] dist 不存在，首次打包无需保护旧产物');
  process.exit(0);
}

// 兜底：win-unpacked/data 缺失但从最近备份恢复
if (!fs.existsSync(path.join(unpackedData, 'data.json'))) {
  const backups = fs.readdirSync(distDir)
    .filter(n => n.startsWith('_unpacked_data_backup_'))
    .map(n => path.join(distDir, n))
    .filter(d => fs.existsSync(path.join(d, 'data', 'data.json')))
    .sort();
  if (backups.length > 0) {
    const latest = backups[backups.length - 1];
    try {
      copyDirSync(path.join(latest, 'data'), unpackedData);
      console.log(`[备份] win-unpacked/data 缺失，已从最近备份自动恢复 <- ${path.basename(latest)}`);
    } catch (e) { console.error('[备份] 自动恢复失败:', e.message); }
  }
}

if (!fs.existsSync(unpackedData)) {
  console.log('[备份] win-unpacked/data 不存在，无需备份');
  process.exit(0);
}

const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
const target = path.join(distDir, `_unpacked_data_backup_${stamp}`);
try {
  copyDirSync(unpackedData, path.join(target, 'data'));
  console.log(`[备份] 已备份 win-unpacked/data -> ${target}`);
  console.log('[备份] 打包完成后请检查该备份，确认无用户数据后再自行删除');
} catch (err) {
  console.error('[备份] 备份失败:', err.message);
  process.exit(1);
}
process.exit(0);
