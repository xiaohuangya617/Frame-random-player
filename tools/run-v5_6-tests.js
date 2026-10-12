const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const electron = require('electron');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'random-player-5.6-tests-'));

function relay(result) {
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
}

function runNode(name, script) {
  const result = spawnSync(process.execPath, [path.join(__dirname, script)], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true
  });
  relay(result);
  const ok = result.status === 0;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name} (exit=${result.status})`);
  return ok;
}

function runElectron(name, script, dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const browserData = path.join(path.dirname(dataDir), 'electron-user-data');
  const result = spawnSync(electron, ['--disable-gpu', '--mute-audio', `--user-data-dir=${browserData}`, '.'], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      RANDOMPLAYER_DATA_DIR: dataDir,
      RANDOMPLAYER_TESTSCRIPT: path.join(__dirname, script),
      RANDOMPLAYER_NO_SPLASH: '1'
    }
  });
  relay(result);
  const ok = result.status === 0;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name} (exit=${result.status})`);
  return ok;
}

const core = runNode('核心数据保护测试', 'core-tests.js');
const previous = core && runElectron(
  '5.5 保存事务与故障回滚专项',
  'v5_5-transaction-e2e.js',
  path.join(testRoot, 'v5-5-transaction', 'data')
);
const persistence = core && previous && runElectron(
  '5.6 持久化失败回滚矩阵',
  'v5_6-persistence-e2e.js',
  path.join(testRoot, 'v5-6-persistence', 'data')
);

if (core && previous && persistence) {
  fs.rmSync(testRoot, { recursive: true, force: true });
  console.log('5.6 定向测试全部通过');
  process.exit(0);
}

console.error(`5.6 定向测试失败，现场保留在: ${testRoot}`);
process.exit(1);
