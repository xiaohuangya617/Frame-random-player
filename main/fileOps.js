// 随机播放器 EXE 版 - 文件操作（扫描 / 重命名 / 校验）
const fs = require('fs');
const path = require('path');

const SUPPORTED_EXTS = new Set([
  'mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi', 'flv', 'm4v', 'wmv', '3gp', 'ts', 'm2ts', 'mts'
]);
const SCAN_CONCURRENCY = 8;

const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * 递归扫描文件夹中的视频文件（异步，避免大目录阻塞主进程）
 * @returns Promise<{ok:boolean, files:Array, errors:Array}>
 */
async function scanFolder(root) {
  const files = [];
  const errors = [];
  const queue = [{ current: root, relPrefix: '' }];

  while (queue.length > 0) {
    const batch = queue.splice(0, SCAN_CONCURRENCY);
    const discovered = await Promise.all(batch.map(async ({ current, relPrefix }) => {
      let entries;
      try {
        entries = await fs.promises.readdir(current, { withFileTypes: true });
      } catch (err) {
        errors.push({ path: current, error: err.code || err.message });
        return [];
      }
      const subDirs = [];
      for (const ent of entries) {
        const full = path.join(current, ent.name);
        if (ent.isDirectory()) {
          subDirs.push({ current: full, relPrefix: relPrefix ? relPrefix + '/' + ent.name : ent.name });
        } else if (ent.isFile()) {
          const ext = path.extname(ent.name).slice(1).toLowerCase();
          if (SUPPORTED_EXTS.has(ext)) {
            try {
              const size = (await fs.promises.stat(full)).size;
              files.push({
                name: ent.name,
                path: full,
                relPath: relPrefix ? relPrefix + '/' + ent.name : ent.name,
                size
              });
            } catch (err) {
              errors.push({ path: full, error: err.code || err.message });
            }
          }
        }
      }
      return subDirs;
    }));
    discovered.forEach(subDirs => queue.push(...subDirs));
  }
  return { ok: errors.length === 0, files, errors };
}

/**
 * 重命名文件（严格校验）
 * @param oldPath 原绝对路径
 * @param newName 新文件名（必须包含与原文件相同的扩展名）
 * @returns {ok, newPath?, error?}
 */
function renameFile(oldPath, newName) {
  if (typeof newName !== 'string') return { ok: false, error: '文件名无效' };
  const name = newName.trim();
  const oldExt = path.extname(oldPath);

  if (!name) return { ok: false, error: '文件名不能为空' };
  if (name.includes('/') || name.includes('\\')) return { ok: false, error: '文件名不能包含路径分隔符' };
  if (INVALID_CHARS.test(name)) return { ok: false, error: '文件名包含非法字符（\\ / : * ? " < > | 等）' };
  const stem = name.split('.')[0];
  if (RESERVED.test(stem)) return { ok: false, error: '不能使用系统保留名称（如 CON、PRN、AUX、NUL、COM1 等）' };
  if (/[. ]$/.test(name)) return { ok: false, error: '文件名不能以点或空格结尾' };
  if (name.length > 180) return { ok: false, error: '文件名过长' };

  const newExt = path.extname(name);
  if (newExt.toLowerCase() !== oldExt.toLowerCase()) {
    return { ok: false, error: `扩展名不可修改，已自动保留 .${oldExt.slice(1)}` };
  }

  const target = path.join(path.dirname(oldPath), name);
  if (path.resolve(target) === path.resolve(oldPath)) return { ok: false, error: '文件名未变化' };
  if (!fs.existsSync(oldPath)) return { ok: false, error: '原文件不存在，可能已被移动或删除' };
  const caseOnly = path.resolve(target).toLowerCase() === path.resolve(oldPath).toLowerCase();
  if (fs.existsSync(target) && !caseOnly) return { ok: false, error: '同目录下已存在同名文件' };

  try {
    if (caseOnly) {
      const temp = path.join(path.dirname(oldPath), `.__randomplayer_rename_${process.pid}_${Date.now()}${oldExt}`);
      fs.renameSync(oldPath, temp);
      try {
        fs.renameSync(temp, target);
      } catch (err) {
        try { fs.renameSync(temp, oldPath); } catch { /* 尽力回滚 */ }
        throw err;
      }
    } else {
      fs.renameSync(oldPath, target);
    }
    return { ok: true, newPath: target };
  } catch (err) {
    const reason = (err.code === 'EPERM' || err.code === 'EACCES' || err.code === 'EBUSY')
      ? '文件可能正被其他程序占用'
      : err.message;
    return { ok: false, error: `重命名失败：${reason}` };
  }
}

module.exports = { scanFolder, renameFile, SUPPORTED_EXTS, SCAN_CONCURRENCY };
