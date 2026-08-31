// 用替换文件的内容替换 起始标记(含) 到 结束标记(不含) 之间的文本
// 用法: node tools/splice.js <file> <startMarker> <endMarker> <replacementFile>
const fs = require('fs');
const [,, file, startMarker, endMarker, replFile] = process.argv;
if (!file || !startMarker || !endMarker || !replFile) {
  console.error('用法: node tools/splice.js <file> <startMarker> <endMarker> <replacementFile>');
  process.exit(1);
}
let src = fs.readFileSync(file, 'utf8');
const start = src.indexOf(startMarker);
if (start === -1) { console.error(`未找到起始标记: ${startMarker.slice(0, 60)}...`); process.exit(1); }
const end = src.indexOf(endMarker, start + startMarker.length);
if (end === -1) { console.error(`未找到结束标记: ${endMarker.slice(0, 60)}...`); process.exit(1); }
const repl = fs.readFileSync(replFile, 'utf8');
fs.writeFileSync(file, src.slice(0, start) + repl + src.slice(end), 'utf8');
console.log(`✓ 已替换 [${start}..${end}] (${(end - start) / 1024 | 0} KB -> ${(repl.length / 1024).toFixed(1)} KB)`);
