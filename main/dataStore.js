// 随机播放器 EXE 版 - 数据存储（JSON 原子写入 + 自动备份）
const fs = require('fs');
const path = require('path');

const DATA_VERSION = 12;

const DEFAULT_SETTINGS = {
  prefixPresets: ['[TV] ', '[收藏] '],
  tags: ['MAX', 'HIGH', 'LOW'],
  lastStrategy: 'default'
};

function defaultAchievements() {
  return {
    stats: {
      totalPlays: 0, totalCollections: 0, totalResets: 0, totalRefreshes: 0,
      consecutiveDays: 0, lastPlayDate: null, totalSeeks: 0, categoryPlays: {},
      totalLikes: 0, totalDislikes: 0, specialPlays: 0, logoClickCount: 0, nightPlays: 0
    },
    unlocked: {}
  };
}

function defaultData() {
  return {
    version: DATA_VERSION,
    categories: [],
    achievements: defaultAchievements(),
    settings: { ...DEFAULT_SETTINGS, prefixPresets: [...DEFAULT_SETTINGS.prefixPresets] }
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function dataFile(dir) { return path.join(dir, 'data.json'); }
function bakFile(dir) { return path.join(dir, 'data.json.bak'); }
function stateFile(dir) { return path.join(dir, 'window-state.json'); }

function normalize(data) {
  const def = defaultData();
  const out = {
    version: DATA_VERSION,
    categories: Array.isArray(data.categories) ? data.categories : [],
    achievements: data.achievements && data.achievements.stats ? data.achievements : def.achievements,
    settings: {
      prefixPresets: Array.isArray(data.settings && data.settings.prefixPresets)
        ? data.settings.prefixPresets.filter(p => typeof p === 'string')
        : [...DEFAULT_SETTINGS.prefixPresets],
      tags: Array.isArray(data.settings && data.settings.tags)
        ? data.settings.tags.filter(t => typeof t === 'string')
        : [...DEFAULT_SETTINGS.tags],
      lastStrategy: (data.settings && data.settings.lastStrategy) || 'default'
    }
  };
  // 规范化每个合集
  out.categories = out.categories.map(c => ({
    id: c.id || Date.now().toString() + Math.random().toString(36).slice(2, 6),
    name: c.name || '未命名合集',
    type: c.type || 'single',
    roots: Array.isArray(c.roots) ? c.roots : [],
    videos: Array.isArray(c.videos) ? c.videos : (Array.isArray(c.videoMetas) ? c.videoMetas : []),
    order: c.order || 0
  }));
  return out;
}

function loadData(dir) {
  ensureDir(dir);
  const file = dataFile(dir);
  if (fs.existsSync(file)) {
    try {
      return normalize(JSON.parse(fs.readFileSync(file, 'utf8')));
    } catch (e) {
      // 主文件损坏：尝试 .bak
      if (fs.existsSync(bakFile(dir))) {
        try {
          return normalize(JSON.parse(fs.readFileSync(bakFile(dir), 'utf8')));
        } catch (e2) { /* 忽略 */ }
      }
    }
  }
  return defaultData();
}

function saveData(dir, payload) {
  ensureDir(dir);
  const file = dataFile(dir);
  const tmp = file + '.tmp';
  const json = JSON.stringify(payload, null, 2);
  fs.writeFileSync(tmp, json, 'utf8');
  if (fs.existsSync(file)) {
    // 轮换备份（最多保留一份 .bak）
    try { fs.copyFileSync(file, bakFile(dir)); } catch (e) { /* 忽略 */ }
  }
  fs.renameSync(tmp, file);
  return { ok: true };
}

function ensureWritable(dir) {
  try {
    ensureDir(dir);
    const probe = path.join(dir, '.write-test');
    fs.writeFileSync(probe, 'ok', 'utf8');
    fs.unlinkSync(probe);
    return true;
  } catch {
    return false;
  }
}

function getWindowBounds(dir) {
  try {
    ensureDir(dir);
    return JSON.parse(fs.readFileSync(stateFile(dir), 'utf8'));
  } catch {
    return {};
  }
}

function saveWindowBounds(dir, bounds) {
  try {
    ensureDir(dir);
    fs.writeFileSync(stateFile(dir), JSON.stringify({ width: bounds.width, height: bounds.height }), 'utf8');
  } catch { /* 忽略 */ }
}

module.exports = { loadData, saveData, ensureWritable, getWindowBounds, saveWindowBounds, defaultData };
