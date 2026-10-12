const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const electron = require('electron');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'random-player-tests-'));

function runElectron(name, script, dataDir, extraEnv = {}) {
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
      RANDOMPLAYER_NO_SPLASH: '1',
      ...extraEnv
    }
  });
  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  const ok = result.status === 0;
  console.log(`[${ok ? 'PASS' : 'FAIL'}] ${name} (exit=${result.status})`);
  return ok;
}

const e2eData = path.join(testRoot, 'e2e', 'current-version', 'data');
fs.mkdirSync(e2eData, { recursive: true });
fs.writeFileSync(path.join(e2eData, 'window-state.json'), JSON.stringify({ width: 1100, height: 720 }), 'utf8');
const phase1 = runElectron('既有 E2E 阶段1', 'e2e.js', e2eData, { RANDOMPLAYER_E2E_PHASE: '1' });
const phase2 = phase1 && runElectron('既有 E2E 阶段2', 'e2e.js', e2eData, { RANDOMPLAYER_E2E_PHASE: '2' });
const stability = phase1 && phase2 && runElectron(
  '5.2 稳定性专项',
  'stability-e2e.js',
  path.join(testRoot, 'stability', 'current-version', 'data')
);
const transaction = phase1 && phase2 && stability && runElectron(
  '5.5 保存事务与故障回滚专项',
  'v5_5-transaction-e2e.js',
  path.join(testRoot, 'transaction', 'current-version', 'data')
);
const persistence = phase1 && phase2 && stability && transaction && runElectron(
  '5.6 持久化失败回滚矩阵',
  'v5_6-persistence-e2e.js',
  path.join(testRoot, 'persistence', 'current-version', 'data')
);
const resilience = phase1 && phase2 && stability && transaction && persistence && runElectron(
  '5.7 连续事务与稳定性专项',
  'v5_7-resilience-e2e.js',
  path.join(testRoot, 'resilience', 'current-version', 'data')
);
const layout = phase1 && phase2 && stability && transaction && persistence && resilience && runElectron('界面布局审计', 'layout-audit.js', e2eData);
const splash = phase1 && phase2 && stability && transaction && persistence && resilience && layout && runElectron(
  '5.4 启动窗与隐私专项',
  'splash-e2e.js',
  path.join(testRoot, 'splash', 'current-version', 'data'),
  { RANDOMPLAYER_NO_SPLASH: '0', RANDOMPLAYER_TEST_SPLASH: '1', RANDOMPLAYER_SPLASH_HOLD_MS: '8000' }
);
const splashTimeout = phase1 && phase2 && stability && transaction && persistence && resilience && layout && splash && runElectron(
  '5.4 启动窗超时兜底',
  'splash-timeout-e2e.js',
  path.join(testRoot, 'splash-timeout', 'current-version', 'data'),
  {
    RANDOMPLAYER_NO_SPLASH: '0',
    RANDOMPLAYER_TEST_SPLASH: '1',
    RANDOMPLAYER_TEST_SPLASH_NO_READY: '1',
    RANDOMPLAYER_SPLASH_HOLD_MS: '0',
    RANDOMPLAYER_SPLASH_TIMEOUT_MS: '500'
  }
);
const fade = phase1 && phase2 && stability && transaction && persistence && resilience && layout && splash && splashTimeout && runElectron(
  '5.4 窗口淡化专项',
  'fade-e2e.js',
  path.join(testRoot, 'fade', 'current-version', 'data'),
  {
    RANDOMPLAYER_NO_SPLASH: '0',
    RANDOMPLAYER_TEST_SPLASH: '1',
    RANDOMPLAYER_TEST_FADE: '1',
    RANDOMPLAYER_SPLASH_HOLD_MS: '150',
    RANDOMPLAYER_SPLASH_TIMEOUT_MS: '5000',
    RANDOMPLAYER_FADE_MS: '400'
  }
);

if (phase1 && phase2 && stability && transaction && persistence && resilience && layout && splash && splashTimeout && fade) {
  fs.rmSync(testRoot, { recursive: true, force: true });
  console.log('全部集成测试通过');
  process.exit(0);
}

console.error(`测试失败，现场保留在: ${testRoot}`);
process.exit(1);
