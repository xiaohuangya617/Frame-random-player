// 版本升级工具（替代 PowerShell 字符串替换，避免 PS5.1 的 GB2312 编码/转义陷阱）
// 用法: node tools/bump-version.js <新版本>  例如: node tools/bump-version.js 5.3 或 5.3.0
// 自动同步: package.json / main.js 窗口标题 / renderer/index.html(标题、h1、帮助、README 行) / README.md
const fs = require('fs');
const path = require('path');

const newVer = (process.argv[2] || '').trim();
if (!/^\d+\.\d+(\.\d+)?$/.test(newVer)) {
  console.error('用法: node tools/bump-version.js <新版本>   例: node tools/bump-version.js 5.3');
  process.exit(1);
}
const fullVer = newVer.split('.').length === 2 ? newVer + '.0' : newVer;
const display = fullVer.split('.').slice(0, 2).join('.'); // 界面显示用 "5.3"

const root = path.join(__dirname, '..');
const read = p => fs.readFileSync(path.join(root, p), 'utf8');
const write = (p, c) => fs.writeFileSync(path.join(root, p), c, 'utf8');

// 1. package.json
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf8'));
const oldVer = pkg.version;
const oldDisplay = oldVer.split('.').slice(0, 2).join('.');
pkg.version = fullVer;
write('package.json', JSON.stringify(pkg, null, 2) + '\n');

// 2. main.js 窗口标题
let mainJs = read('main/main.js');
mainJs = mainJs.replace(new RegExp(`随机播放器 ${oldDisplay.replace('.', '\\.')}（桌面版）`, 'g'), `随机播放器 ${display}（桌面版）`);
write('main/main.js', mainJs);

// 3. renderer/index.html：title / h1 / 帮助标题
let html = read('renderer/index.html');
html = html.replace(new RegExp(`随机播放器 ${oldDisplay.replace('.', '\\.')}（桌面版）`, 'g'), `随机播放器 ${display}（桌面版）`);
write('renderer/index.html', html);

// 4. README.md：标题与版本行
let readme = read('README.md');
readme = readme.replace(new RegExp(`随机播放器 ${oldDisplay.replace('.', '\\.')}（桌面版）`, 'g'), `随机播放器 ${display}（桌面版）`);
readme = readme.replace(`- 版本：${oldDisplay}（基于`, `- 版本：${display}（基于`);
write('README.md', readme);

console.log(`✓ 版本已从 ${oldVer} 升级到 ${fullVer}（界面显示 ${display}）`);
console.log('  请记得：在 renderer/index.html 的更新日志顶部手动添加对应版本条目。');
