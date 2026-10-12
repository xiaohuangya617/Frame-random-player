const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const electron = require('electron');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'random-player-5.4-tests-'));

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

function runElectron(name, script, dataDir, extraEnv = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const result = spawnSync(electron, ['--mute-audio', '.'], {
    cwd: projectRoot,
    encoding: 'utf8',
    maxBuffer: 20 * 1024 * 1024,
    windowsHide: true,
    env: {
      ...process.env,
      ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
      RANDOMPLAYER_DATA_DIR: dataDir,
      RANDOMPLAYER_TESTSCRIPT: path.join(__dirname, script),
      RANDOMPLAYER_NO_SPLASH: '1',
      ...extraEnv
    }
  });
  relay(result);
  const ok = result.status === 0;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name} (exit=${result.status})`);
  return ok;
}

const privateCollection = '私密合集_绝不显示_5_4';
const privateFolderName = 'private-folder-do-not-show-5-4';
const privateFolder = path.join(testRoot, privateFolderName);
const privateData = path.join(testRoot, 'privacy', 'data');
fs.mkdirSync(privateFolder, { recursive: true });
fs.mkdirSync(privateData, { recursive: true });
fs.writeFileSync(path.join(privateFolder, 'private-video-do-not-show.mp4'), Buffer.alloc(32));
fs.writeFileSync(path.join(privateData, 'data.json'), JSON.stringify({
  version: 12,
  categories: [{
    id: 'privacy-category',
    name: privateCollection,
    type: 'collection',
    roots: [privateFolder],
    videos: []
  }],
  achievements: { stats: {}, unlocked: {} },
  settings: {}
}, null, 2), 'utf8');

const uiData = path.join(testRoot, 'ui', 'data');
const core = runNode('核心数据保护测试', 'core-tests.js');
const ui = core && runElectron('5.4 文案与布局定向测试', 'v5_4-e2e.js', uiData);
const layout = core && ui && runElectron('界面布局审计', 'layout-audit.js', uiData);
const privacy = core && ui && layout && runElectron(
  '5.4 启动窗隐私测试',
  'splash-e2e.js',
  privateData,
  {
    RANDOMPLAYER_NO_SPLASH: '0',
    RANDOMPLAYER_TEST_SPLASH: '1',
    RANDOMPLAYER_SPLASH_HOLD_MS: '8000',
    RANDOMPLAYER_PRIVACY_SENTINELS: JSON.stringify([privateCollection, privateFolderName, privateFolder, 'private-video-do-not-show.mp4'])
  }
);
const timeout = core && ui && layout && privacy && runElectron(
  '5.4 启动窗超时兜底',
  'splash-timeout-e2e.js',
  path.join(testRoot, 'timeout', 'data'),
  {
    RANDOMPLAYER_NO_SPLASH: '0',
    RANDOMPLAYER_TEST_SPLASH: '1',
    RANDOMPLAYER_TEST_SPLASH_NO_READY: '1',
    RANDOMPLAYER_SPLASH_HOLD_MS: '0',
    RANDOMPLAYER_SPLASH_TIMEOUT_MS: '500'
  }
);
const fade = core && ui && layout && privacy && timeout && runElectron(
  '5.4 淡出淡入测试',
  'fade-e2e.js',
  path.join(testRoot, 'fade', 'data'),
  {
    RANDOMPLAYER_NO_SPLASH: '0',
    RANDOMPLAYER_TEST_SPLASH: '1',
    RANDOMPLAYER_TEST_FADE: '1',
    RANDOMPLAYER_SPLASH_HOLD_MS: '150',
    RANDOMPLAYER_SPLASH_TIMEOUT_MS: '5000',
    RANDOMPLAYER_FADE_MS: '400'
  }
);

if (core && ui && layout && privacy && timeout && fade) {
  fs.rmSync(testRoot, { recursive: true, force: true });
  console.log('5.4 定向测试全部通过');
  process.exit(0);
}

console.error(`5.4 定向测试失败，现场保留在: ${testRoot}`);
process.exit(1);
