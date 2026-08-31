// 按 steps.json 依次执行 splice
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const file = 'renderer/index.html';
const steps = JSON.parse(fs.readFileSync(path.join(__dirname, 'patches', 'steps.json'), 'utf8'));
const spliceJs = path.join(__dirname, 'splice.js');

for (const [patch, startMarker, endMarker] of steps) {
  const repl = path.join(__dirname, 'patches', patch);
  try {
    execFileSync(process.execPath, [spliceJs, file, startMarker, endMarker, repl], { stdio: 'inherit' });
  } catch (e) {
    console.error(`!! 补丁失败: ${patch}`);
    process.exit(1);
  }
}
console.log('全部补丁应用完成');
