// 将压缩版 HTML 格式化为可读文件（仅用于开发维护，语义不变）
// 用法: node tools/unminify.js <输入html> <输出html>
// 规则:
//  - HTML 区域: 每个 '>' 后换行
//  - JS 区域: 每个 ';' '{' '}' 后换行（跳过注释与字符串）
//  - CSS 区域: 每个 '}' 后换行（跳过注释与字符串）
const fs = require('fs');
const path = require('path');

const [,, inFile, outFile] = process.argv;
if (!inFile || !outFile) {
  console.error('用法: node tools/unminify.js <输入html> <输出html>');
  process.exit(1);
}

const src = fs.readFileSync(inFile, 'utf8');

// 将 src 切成三种区域: html / script / style
function segment(src) {
  const parts = [];
  let i = 0;
  const len = src.length;
  let curType = 'html';
  const push = (type, text) => {
    if (!text) return;
    if (parts.length && parts[parts.length - 1].type === type) {
      parts[parts.length - 1].text += text;
    } else {
      parts.push({ type, text });
    }
  };
  const TAG_RE = /<script[\s>]|<style[\s>]|<\/script>|<\/style>/gi;
  let m;
  while ((m = TAG_RE.exec(src)) !== null) {
    const tag = m[0].toLowerCase();
    const tagStart = m.index;
    const isOpen = tag.startsWith('<script') || tag.startsWith('<style');
    if (isOpen) {
      push(curType, src.slice(i, tagStart));
      push(curType, tag); // 开标签本身
      const close = tag.startsWith('<script') ? '</script>' : '</style>';
      const end = src.indexOf(close, tagStart + tag.length);
      if (end === -1) {
        push(curType, src.slice(tagStart + tag.length));
        i = len;
        break;
      }
      const inner = src.slice(tagStart + tag.length, end);
      push(tag.startsWith('<script') ? 'script' : 'style', inner);
      push(curType, close);
      i = end + close.length;
      TAG_RE.lastIndex = i; // 关键：跳过已消费的闭合标签，避免重复匹配
    } else {
      push(curType, src.slice(i, tagStart));
      push(curType, tag);
      i = tagStart + tag.length;
    }
  }
  if (i < len) push(curType, src.slice(i));
  return parts;
}

// 在 JS 中, 在 ';' '{' '}' 后插入换行, 跳过字符串/注释/模板串
function formatJs(code) {
  let out = '';
  let i = 0;
  const len = code.length;
  while (i < len) {
    const ch = code[i];
    if (ch === '/' && code[i + 1] === '/') {
      const nl = code.indexOf('\n', i);
      if (nl === -1) { out += code.slice(i); break; }
      out += code.slice(i, nl + 1);
      i = nl + 1;
      continue;
    }
    if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      if (end === -1) { out += code.slice(i); break; }
      const c = code.slice(i, end + 2);
      // 注释内换行保持
      out += c;
      i = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      let j = i + 1;
      while (j < len) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === quote) { j++; break; }
        j++;
      }
      out += code.slice(i, j);
      i = j;
      continue;
    }
    if (ch === ';' || ch === '{' || ch === '}') {
      out += ch + '\n';
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function formatCss(code) {
  let out = '';
  let i = 0;
  const len = code.length;
  while (i < len) {
    const ch = code[i];
    if (ch === '/' && code[i + 1] === '*') {
      const end = code.indexOf('*/', i + 2);
      if (end === -1) { out += code.slice(i); break; }
      out += code.slice(i, end + 2) + '\n';
      i = end + 2;
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let j = i + 1;
      while (j < len) {
        if (code[j] === '\\') { j += 2; continue; }
        if (code[j] === quote) { j++; break; }
        j++;
      }
      out += code.slice(i, j);
      i = j;
      continue;
    }
    if (ch === '}') {
      out += ch + '\n';
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function formatHtml(code) {
  // 在 '>' 后换行, 但跳过属性值中的 '>' (引号内)
  let out = '';
  let i = 0;
  const len = code.length;
  let inQuote = null;
  while (i < len) {
    const ch = code[i];
    if (inQuote) {
      out += ch;
      if (ch === inQuote) inQuote = null;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      out += ch;
      i++;
      continue;
    }
    if (ch === '>') {
      out += '>\n';
      i++;
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

const parts = segment(src);
let out = '';
for (const p of parts) {
  if (p.type === 'html') out += formatHtml(p.text);
  else if (p.type === 'script') out += formatJs(p.text);
  else out += formatCss(p.text);
}

fs.writeFileSync(outFile, out, 'utf8');
console.log(`已生成: ${outFile} (${(out.length / 1024).toFixed(1)} KB)`);
