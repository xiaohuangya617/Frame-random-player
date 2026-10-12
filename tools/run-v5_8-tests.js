const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const projectRoot = path.join(__dirname, '..');
const electron = require('electron');
const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'random-player-v58-'));
const dataDir = path.join(testRoot, 'data');
const browserData = path.join(testRoot, 'electron-user-data');
const subtitleDir = path.join(testRoot, 'subtitles');
const videoRoot = path.join(testRoot, 'video-root');
fs.mkdirSync(dataDir, { recursive: true });
fs.mkdirSync(subtitleDir, { recursive: true });
fs.mkdirSync(videoRoot, { recursive: true });

const result = spawnSync(electron, ['--disable-gpu', '--mute-audio', `--user-data-dir=${browserData}`, '.'], {
  cwd: projectRoot,
  encoding: 'utf8',
  maxBuffer: 20 * 1024 * 1024,
  windowsHide: true,
  env: {
    ...process.env,
    ELECTRON_DISABLE_SECURITY_WARNINGS: '1',
    RANDOMPLAYER_DATA_DIR: dataDir,
    RANDOMPLAYER_TESTSCRIPT: path.join(__dirname, 'v5_8-e2e.js'),
    RANDOMPLAYER_NO_SPLASH: '1',
    RANDOMPLAYER_E2E_SUBTITLE_FOLDER: subtitleDir,
    RANDOMPLAYER_E2E_FOLDER: videoRoot,
    RANDOMPLAYER_E2E_FOLDERS: videoRoot
  }
});

if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
if (result.status === 0) {
  try { fs.rmSync(testRoot, { recursive: true, force: true }); } catch { /* 系统后续清理 */ }
  console.log('5.8 专项测试通过');
  process.exit(0);
}
console.error(`5.8 专项测试失败，现场保留在: ${testRoot}`);
process.exit(result.status || 1);
