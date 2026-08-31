// 随机播放器 EXE 版 - 文件操作（扫描 / 重命名 / 校验）
const fs = require('fs');
const path = require('path');

const SUPPORTED_EXTS = new Set([
  'mp4', 'webm', 'ogg', 'mov', 'mkv', 'avi', 'flv', 'm4v', 'wmv', '3gp', 'ts', 'm2ts', 'mts'
]);

const INVALID_CHARS = /[<>:"/\\|?*\u0000-\u001f]/;
const RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;

/**
 * 递归扫描文件夹中的视频文件（异步，避免大目录阻塞主进程）
 * @returns Promise<[{name, path, relPath, size}]>
 */
async function scanFolder(root, out = [], relPrefix = '') {
  let entries;
  try {
    entries = await fs.promises.readdir(root, { withFileTypes: true });
  } catch {
    return out; // 无权限/不存在的目录跳过
  }
  const subDirs = [];
  for (const ent of entries) {
    const full = path.join(root, ent.name);
    if (ent.isDirectory()) {
      subDirs.push({ full, rel: relPrefix ? relPrefix + '/' + ent.name : ent.name });
    } else if (ent.isFile()) {
      const ext = path.extname(ent.name).slice(1).toLowerCase();
      if (SUPPORTED_EXTS.has(ext)) {
        let size = 0;
        try { size = (await fs.promises.stat(full)).size; } catch { /* 忽略 */ }
        out.push({
          name: ent.name,
          path: full,
          relPath: relPrefix ? relPrefix + '/' + ent.name : ent.name,
          size
        });
      }
    }
  }
  await Promise.all(subDirs.map(d => scanFolder(d.full, out, d.rel)));
  return out;
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
  if (fs.existsSync(target)) return { ok: false, error: '同目录下已存在同名文件' };

  try {
    fs.renameSync(oldPath, target);
    return { ok: true, newPath: target };
  } catch (err) {
    const reason = (err.code === 'EPERM' || err.code === 'EACCES' || err.code === 'EBUSY')
      ? '文件可能正被其他程序占用'
      : err.message;
    return { ok: false, error: `重命名失败：${reason}` };
  }
}

module.exports = { scanFolder, renameFile, SUPPORTED_EXTS };
