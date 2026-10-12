// 随机播放器 EXE 版 - 数据存储（JSON 原子写入 + 自动备份）
const fs = require('fs');
const path = require('path');

const DATA_VERSION = 12;

const DEFAULT_SETTINGS = {
  prefixPresets: ['[TV] ', '[收藏] '],
  tags: ['MAX', 'HIGH', 'LOW'],
  lastStrategy: 'default',
  lastPrefix: '',
  subtitleDir: '',
  subtitleEnabled: true
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
    settings: {
      ...DEFAULT_SETTINGS,
      prefixPresets: [...DEFAULT_SETTINGS.prefixPresets],
      tags: [...DEFAULT_SETTINGS.tags]
    }
  };
}

function normalizeAchievements(value) {
  const def = defaultAchievements();
  const input = value && typeof value === 'object' ? value : {};
  const stats = input.stats && typeof input.stats === 'object' ? input.stats : {};
  const count = value => {
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.floor(number) : 0;
  };
  const categoryPlays = Object.fromEntries(
    Object.entries(stats.categoryPlays && typeof stats.categoryPlays === 'object' ? stats.categoryPlays : {})
      .map(([key, value]) => [key, count(value)])
  );
  const normalizedStats = {};
  for (const key of Object.keys(def.stats)) {
    if (key === 'categoryPlays') normalizedStats[key] = categoryPlays;
    else if (key === 'lastPlayDate') normalizedStats[key] = typeof stats[key] === 'string' ? stats[key] : null;
    else normalizedStats[key] = count(stats[key]);
  }
  return {
    stats: normalizedStats,
    unlocked: input.unlocked && typeof input.unlocked === 'object' ? { ...input.unlocked } : {}
  };
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function dataFile(dir) { return path.join(dir, 'data.json'); }
function bakFile(dir) { return path.join(dir, 'data.json.bak'); }
function stateFile(dir) { return path.join(dir, 'window-state.json'); }

function normalize(data) {
  data = data && typeof data === 'object' ? data : {};
  const def = defaultData();
  const allowedStrategies = new Set(['default', 'liked', 'short', 'long']);
  const rawStrategy = data.settings && data.settings.lastStrategy;
  const out = {
    version: DATA_VERSION,
    categories: Array.isArray(data.categories) ? data.categories : [],
    achievements: normalizeAchievements(data.achievements || def.achievements),
    settings: {
      prefixPresets: Array.isArray(data.settings && data.settings.prefixPresets)
        ? data.settings.prefixPresets.filter(p => typeof p === 'string')
        : [...DEFAULT_SETTINGS.prefixPresets],
      tags: Array.isArray(data.settings && data.settings.tags)
        ? data.settings.tags.filter(t => typeof t === 'string')
        : [...DEFAULT_SETTINGS.tags],
      lastStrategy: allowedStrategies.has(rawStrategy) ? rawStrategy : 'default',
      lastPrefix: typeof (data.settings && data.settings.lastPrefix) === 'string'
        ? data.settings.lastPrefix
        : '',
      subtitleDir: typeof (data.settings && data.settings.subtitleDir) === 'string'
        ? data.settings.subtitleDir
        : '',
      subtitleEnabled: data.settings && typeof data.settings.subtitleEnabled === 'boolean'
        ? data.settings.subtitleEnabled
        : true
    }
  };
  // 规范化每个合集
  out.categories = out.categories.filter(c => c && typeof c === 'object').map(c => ({
    id: c.id == null ? Date.now().toString() + Math.random().toString(36).slice(2, 6) : String(c.id),
    name: typeof c.name === 'string' && c.name ? c.name : '未命名合集',
    type: ['single', 'collection', 'tags'].includes(c.type) ? c.type : 'single',
    roots: Array.isArray(c.roots) ? c.roots.filter(root => typeof root === 'string' && root.trim()) : [],
    tags: Array.isArray(c.tags) ? c.tags.filter(t => typeof t === 'string') : [],
    videos: (Array.isArray(c.videos) ? c.videos : (Array.isArray(c.videoMetas) ? c.videoMetas : []))
      .filter(video => video && typeof video === 'object'),
    order: Number.isFinite(Number(c.order)) ? Number(c.order) : 0
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
          const recovered = normalize(JSON.parse(fs.readFileSync(bakFile(dir), 'utf8')));
          recovered._loadWarning = '主存档损坏，已从 data.json.bak 恢复';
          return recovered;
        } catch (e2) { /* 忽略 */ }
      }
      const fresh = defaultData();
      fresh._loadWarning = '主存档和备用存档均无法读取，已进入空数据保护模式';
      return fresh;
    }
  }
  return defaultData();
}

function saveData(dir, payload) {
  ensureDir(dir);
  const file = dataFile(dir);
  const tmp = file + '.tmp';
  const json = JSON.stringify(normalize(payload), null, 2);
  fs.writeFileSync(tmp, json, 'utf8');
  if (fs.existsSync(file)) {
    // 只用可解析的主存档轮换 .bak，避免损坏主文件覆盖最后一份健康备份。
    try {
      JSON.parse(fs.readFileSync(file, 'utf8'));
      fs.copyFileSync(file, bakFile(dir));
    } catch (e) { /* 保留现有备用存档 */ }
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
    const state = JSON.parse(fs.readFileSync(stateFile(dir), 'utf8'));
    const width = Number(state && state.width);
    const height = Number(state && state.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1060 || height < 700 || width > 10000 || height > 10000) return {};
    return { width: Math.round(width), height: Math.round(height) };
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
