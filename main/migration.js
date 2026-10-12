const fs = require('fs');
const path = require('path');

const TEMP_PREFIX = '.random-player-import-';

function copyDirSync(src, dst, fileSystem = fs) {
  fileSystem.mkdirSync(dst, { recursive: true });
  const entries = fileSystem.readdirSync(src, { withFileTypes: true })
    .slice()
    .sort((a, b) => a.name.localeCompare(b.name));
  for (const ent of entries) {
    const source = path.join(src, ent.name);
    const target = path.join(dst, ent.name);
    if (ent.isDirectory()) copyDirSync(source, target, fileSystem);
    else if (ent.isFile()) fileSystem.copyFileSync(source, target);
  }
}

function validateStagedData(stageDir, fileSystem = fs) {
  const file = path.join(stageDir, 'data.json');
  const parsed = JSON.parse(fileSystem.readFileSync(file, 'utf8'));
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('旧存档 data.json 格式无效');
  }
}

function safeRemoveTemp(target, dataDir, fileSystem = fs) {
  const parent = path.dirname(path.resolve(dataDir));
  const resolved = path.resolve(target);
  if (path.dirname(resolved) !== parent || !path.basename(resolved).startsWith(TEMP_PREFIX)) return;
  try { fileSystem.rmSync(resolved, { recursive: true, force: true }); } catch { /* 系统后续可清理临时目录 */ }
}

function createRecoveryPath(dataDir, fileSystem = fs) {
  const parent = path.dirname(path.resolve(dataDir));
  const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 17);
  const stem = `data-before-import-${stamp}`;
  let candidate = path.join(parent, stem);
  let suffix = 1;
  while (fileSystem.existsSync(candidate)) candidate = path.join(parent, `${stem}-${suffix++}`);
  return candidate;
}

function importDataAtomically(sourceDataDir, dataDir, fileSystem = fs) {
  const parent = path.dirname(path.resolve(dataDir));
  const token = `${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const stage = path.join(parent, `${TEMP_PREFIX}stage-${token}`);
  const targetExists = fileSystem.existsSync(dataDir);
  const preservePrevious = targetExists && fileSystem.readdirSync(dataDir).length > 0;
  const previous = preservePrevious
    ? createRecoveryPath(dataDir, fileSystem)
    : path.join(parent, `${TEMP_PREFIX}previous-${token}`);
  let previousMoved = false;

  try {
    copyDirSync(sourceDataDir, stage, fileSystem);
    validateStagedData(stage, fileSystem);
    if (targetExists) {
      fileSystem.renameSync(dataDir, previous);
      previousMoved = true;
    }
    fileSystem.renameSync(stage, dataDir);
    if (previousMoved && !preservePrevious) safeRemoveTemp(previous, dataDir, fileSystem);
    return { backupPath: preservePrevious ? previous : null };
  } catch (err) {
    safeRemoveTemp(stage, dataDir, fileSystem);
    if (previousMoved && !fileSystem.existsSync(dataDir) && fileSystem.existsSync(previous)) {
      try {
        fileSystem.renameSync(previous, dataDir);
        previousMoved = false;
      } catch (rollbackError) {
        throw new Error(`${err.message}; 原数据目录恢复失败: ${rollbackError.message}`);
      }
    }
    throw err;
  }
}

module.exports = { copyDirSync, importDataAtomically, validateStagedData, createRecoveryPath };
