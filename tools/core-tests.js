const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const dataStore = require('../main/dataStore');
const fileOps = require('../main/fileOps');
const migration = require('../main/migration');

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'random-player-core-'));
let passed = 0;
let total = 0;

function test(name, fn) {
  total++;
  return Promise.resolve().then(fn).then(() => {
    passed++;
    console.log(`[PASS] ${name}`);
  });
}

(async () => {
  await test('存档归一化保留标签、前缀并补齐成就字段', () => {
    const dir = path.join(root, 'store');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'data.json'), JSON.stringify({
      categories: [{ id: 7, type: 'tags', roots: ['C:\\valid', null, 42], tags: ['A'], videos: [null, { id: 'v' }] }],
      settings: { prefixPresets: [], tags: ['A'], lastPrefix: '[X] ', lastStrategy: 'invalid' },
      achievements: { stats: { totalPlays: 3, totalLikes: 'bad', categoryPlays: { cat: '4', bad: 'x' } }, unlocked: {} }
    }));
    const data = dataStore.loadData(dir);
    assert.deepStrictEqual(data.categories[0].tags, ['A']);
    assert.strictEqual(data.categories[0].id, '7');
    assert.deepStrictEqual(data.categories[0].roots, ['C:\\valid']);
    assert.strictEqual(data.categories[0].videos.length, 1);
    assert.strictEqual(data.settings.lastPrefix, '[X] ');
    assert.strictEqual(data.settings.lastStrategy, 'default');
    assert.strictEqual(data.achievements.stats.totalPlays, 3);
    assert.strictEqual(data.achievements.stats.totalLikes, 0);
    assert.deepStrictEqual(data.achievements.stats.categoryPlays, { cat: 4, bad: 0 });
  });

  await test('主存档损坏时从备用存档恢复并发出警告', () => {
    const dir = path.join(root, 'recover');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'data.json'), '{broken');
    fs.writeFileSync(path.join(dir, 'data.json.bak'), JSON.stringify({ categories: [{ id: 'ok', tags: ['B'] }] }));
    const data = dataStore.loadData(dir);
    assert.strictEqual(data.categories[0].id, 'ok');
    assert.match(data._loadWarning, /备用|bak/);
    dataStore.saveData(dir, data);
    const backup = JSON.parse(fs.readFileSync(path.join(dir, 'data.json.bak'), 'utf8'));
    assert.strictEqual(backup.categories[0].id, 'ok');
  });

  await test('扫描成功、空目录和扫描失败三种状态可区分', async () => {
    const media = path.join(root, 'media');
    fs.mkdirSync(path.join(media, 'sub'), { recursive: true });
    fs.writeFileSync(path.join(media, 'a.mp4'), 'a');
    fs.writeFileSync(path.join(media, 'sub', 'b.txt'), 'b');
    const ok = await fileOps.scanFolder(media);
    const emptyDir = path.join(root, 'empty');
    fs.mkdirSync(emptyDir);
    const empty = await fileOps.scanFolder(emptyDir);
    const missing = await fileOps.scanFolder(path.join(root, 'missing'));
    assert.strictEqual(ok.ok, true);
    assert.strictEqual(ok.files.length, 1);
    assert.deepStrictEqual({ ok: empty.ok, count: empty.files.length }, { ok: true, count: 0 });
    assert.strictEqual(missing.ok, false);
    assert.ok(missing.errors.length > 0);
  });

  await test('扫描识别主流视频容器并排除非视频文件', async () => {
    const media = path.join(root, 'formats');
    fs.mkdirSync(media, { recursive: true });
    for (const name of ['ok.mp4', 'ok.m4v', 'video.mkv', 'video.avi', 'video.ts', 'skip.txt']) {
      fs.writeFileSync(path.join(media, name), name);
    }
    const result = await fileOps.scanFolder(media);
    assert.strictEqual(result.ok, true);
    assert.deepStrictEqual(result.files.map(file => file.name).sort(), ['ok.m4v', 'ok.mp4', 'video.avi', 'video.mkv', 'video.ts']);
  });

  await test('宽目录树扫描的文件系统并发不超过固定上限', async () => {
    const media = path.join(root, 'wide-tree');
    fs.mkdirSync(media, { recursive: true });
    for (let i = 0; i < 24; i++) fs.mkdirSync(path.join(media, `dir-${i}`));
    const originalReaddir = fs.promises.readdir;
    let active = 0;
    let peak = 0;
    fs.promises.readdir = async (...args) => {
      active++;
      peak = Math.max(peak, active);
      try {
        await new Promise(resolve => setImmediate(resolve));
        return await originalReaddir(...args);
      } finally {
        active--;
      }
    };
    try {
      const result = await fileOps.scanFolder(media);
      assert.strictEqual(result.ok, true);
      assert.ok(peak > 1);
      assert.ok(peak <= fileOps.SCAN_CONCURRENCY, `peak=${peak}`);
    } finally {
      fs.promises.readdir = originalReaddir;
    }
  });

  await test('旧存档复制中途失败不会改变正式目录且允许重试', () => {
    const source = path.join(root, 'migration-source');
    const target = path.join(root, 'migration-target');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(source, 'data.json'), JSON.stringify({ version: 12, categories: [] }));
    fs.writeFileSync(path.join(source, 'window-state.json'), '{"width":1600,"height":900}');
    fs.writeFileSync(path.join(target, 'window-state.json'), 'original');
    let copies = 0;
    const failingFs = {
      ...fs,
      copyFileSync(src, dst) {
        copies++;
        if (copies === 2) throw new Error('synthetic copy failure');
        return fs.copyFileSync(src, dst);
      }
    };
    assert.throws(() => migration.importDataAtomically(source, target, failingFs), /synthetic copy failure/);
    assert.strictEqual(fs.existsSync(path.join(target, 'data.json')), false);
    assert.strictEqual(fs.readFileSync(path.join(target, 'window-state.json'), 'utf8'), 'original');
    migration.importDataAtomically(source, target);
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(target, 'data.json'), 'utf8')).version, 12);
  });

  await test('旧存档最终切换失败会恢复原目录', () => {
    const source = path.join(root, 'migration-switch-source');
    const target = path.join(root, 'migration-switch-target');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(source, 'data.json'), JSON.stringify({ version: 12, categories: [] }));
    fs.writeFileSync(path.join(target, 'window-state.json'), 'original');
    let failed = false;
    const failingFs = {
      ...fs,
      renameSync(src, dst) {
        if (!failed && path.basename(src).startsWith('.random-player-import-stage-') && path.resolve(dst) === path.resolve(target)) {
          failed = true;
          throw new Error('synthetic switch failure');
        }
        return fs.renameSync(src, dst);
      }
    };
    assert.throws(() => migration.importDataAtomically(source, target, failingFs), /synthetic switch failure/);
    assert.strictEqual(fs.existsSync(path.join(target, 'data.json')), false);
    assert.strictEqual(fs.readFileSync(path.join(target, 'window-state.json'), 'utf8'), 'original');
  });

  await test('旧存档成功导入会完整保留当前目录的救援资料', () => {
    const source = path.join(root, 'migration-rescue-source');
    const target = path.join(root, 'migration-rescue-target');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(path.join(target, 'backups'), { recursive: true });
    fs.writeFileSync(path.join(source, 'data.json'), JSON.stringify({ version: 12, categories: [{ id: 'imported' }] }));
    fs.writeFileSync(path.join(target, 'data.json.bak'), JSON.stringify({ version: 12, categories: [{ id: 'rescue' }] }));
    fs.writeFileSync(path.join(target, 'backups', 'keep.json'), 'rescue-backup');
    fs.writeFileSync(path.join(target, 'window-state.json'), 'window-state');
    const result = migration.importDataAtomically(source, target);
    assert.ok(result.backupPath);
    assert.strictEqual(path.dirname(result.backupPath), path.dirname(target));
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(target, 'data.json'), 'utf8')).categories[0].id, 'imported');
    assert.strictEqual(JSON.parse(fs.readFileSync(path.join(result.backupPath, 'data.json.bak'), 'utf8')).categories[0].id, 'rescue');
    assert.strictEqual(fs.readFileSync(path.join(result.backupPath, 'backups', 'keep.json'), 'utf8'), 'rescue-backup');
    assert.strictEqual(fs.readFileSync(path.join(result.backupPath, 'window-state.json'), 'utf8'), 'window-state');
  });

  await test('旧存档导入不会为真正空的数据目录制造恢复副本', () => {
    const source = path.join(root, 'migration-empty-source');
    const target = path.join(root, 'migration-empty-target');
    fs.mkdirSync(source, { recursive: true });
    fs.mkdirSync(target, { recursive: true });
    fs.writeFileSync(path.join(source, 'data.json'), JSON.stringify({ version: 12, categories: [] }));
    const beforeBackups = fs.readdirSync(path.dirname(target)).filter(name => name.startsWith('data-before-import-')).length;
    const result = migration.importDataAtomically(source, target);
    assert.strictEqual(result.backupPath, null);
    assert.strictEqual(fs.existsSync(path.join(target, 'data.json')), true);
    const afterBackups = fs.readdirSync(path.dirname(target)).filter(name => name.startsWith('data-before-import-')).length;
    assert.strictEqual(afterBackups, beforeBackups);
  });

  await test('仅大小写改名可完成且原文件不存在会拒绝', () => {
    const dir = path.join(root, 'rename');
    fs.mkdirSync(dir, { recursive: true });
    const oldPath = path.join(dir, 'Video.MP4');
    fs.writeFileSync(oldPath, 'video');
    const result = fileOps.renameFile(oldPath, 'video.mp4');
    assert.strictEqual(result.ok, true);
    assert.strictEqual(fs.existsSync(result.newPath), true);
    assert.strictEqual(fileOps.renameFile(path.join(dir, 'missing.mp4'), 'next.mp4').ok, false);
  });

  await test('全新环境没有 dist 时打包保护钩子正常跳过', () => {
    const fakeRoot = path.join(root, 'pack-hooks');
    const toolsDir = path.join(fakeRoot, 'tools');
    fs.mkdirSync(toolsDir, { recursive: true });
    for (const name of ['backup-unpacked-data.js', 'restore-unpacked-data.js']) {
      const target = path.join(toolsDir, name);
      fs.copyFileSync(path.join(__dirname, name), target);
      const run = spawnSync(process.execPath, [target], { encoding: 'utf8' });
      assert.strictEqual(run.status, 0, run.stderr);
    }
  });

  await test('不可写的数据路径会被启动自检识别', () => {
    const blocker = path.join(root, 'not-a-directory');
    fs.writeFileSync(blocker, 'blocked');
    assert.strictEqual(dataStore.ensureWritable(blocker), false);
  });

  await test('损坏的窗口尺寸不会阻止应用启动', () => {
    const dir = path.join(root, 'window-state');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'window-state.json'), JSON.stringify({ width: -1, height: 'bad' }));
    assert.deepStrictEqual(dataStore.getWindowBounds(dir), {});
    fs.writeFileSync(path.join(dir, 'window-state.json'), JSON.stringify({ width: 1600.4, height: 900.4 }));
    assert.deepStrictEqual(dataStore.getWindowBounds(dir), { width: 1600, height: 900 });
  });

  await test('构建依赖已固定并生成锁文件', () => {
    const pkg = require('../package.json');
    assert.strictEqual(pkg.devDependencies.electron, '41.10.7');
    assert.strictEqual(pkg.devDependencies['electron-builder'], '26.15.3');
    assert.strictEqual(pkg.devDependencies.tailwindcss, '3.4.17');
    const lockPath = path.join(__dirname, '..', 'package-lock.json');
    assert.strictEqual(fs.existsSync(lockPath), true);
    const lock = JSON.parse(fs.readFileSync(lockPath, 'utf8'));
    assert.strictEqual(lock.version, pkg.version);
    assert.strictEqual(lock.packages[''].version, pkg.version);
  });

  console.log(`核心测试结束: ${passed}/${total} 通过`);
})().catch(err => {
  console.error('[FAIL]', err.stack || err);
  process.exitCode = 1;
}).finally(() => {
  try { fs.rmSync(root, { recursive: true, force: true }); } catch { /* 临时目录由系统后续清理 */ }
});
