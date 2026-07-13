// 搜索引擎定义
const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q={query}' },
  baidu: { name: '百度', url: 'https://www.baidu.com/s?wd={query}' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q={query}' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={query}' }
};

// 多平台快捷搜索注册表
const SEARCH_PLATFORMS = {
  g: { name: 'Google', url: 'https://www.google.com/search?q={query}', icon: 'google' },
  bd: { name: '百度', url: 'https://www.baidu.com/s?wd={query}', icon: 'baidu' },
  gh: { name: 'GitHub', url: 'https://github.com/search?q={query}&type=repositories', icon: 'github' },
  so: { name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q={query}', icon: 'stackoverflow' },
  zh: { name: '知乎', url: 'https://www.zhihu.com/search?type=content&q={query}', icon: 'zhihu' },
  bl: { name: '哔哩哔哩', url: 'https://search.bilibili.com/all?keyword={query}', icon: 'bilibili' },
  yt: { name: 'YouTube', url: 'https://www.youtube.com/results?search_query={query}', icon: 'youtube' },
  npm: { name: 'NPM', url: 'https://www.npmjs.com/search?q={query}', icon: 'npm' },
  mdn: { name: 'MDN', url: 'https://developer.mozilla.org/search?q={query}', icon: 'mdn' },
  x: { name: 'Twitter/X', url: 'https://x.com/search?q={query}', icon: 'x' },
  rd: { name: 'Reddit', url: 'https://www.reddit.com/search/?q={query}', icon: 'reddit' },
  ph: { name: 'Product Hunt', url: 'https://www.producthunt.com/search?q={query}', icon: 'producthunt' }
};

const URL_PATTERN = /^(https?:\/\/|www\.)|(\w+\.(?:com|cn|org|net|io|dev|edu|gov|app|me|co)\b)/i;

function normalizeUrl(input) {
  if (/^https?:\/\//.test(input)) return input;
  if (input.startsWith('www.')) return 'https://' + input;
  if (URL_PATTERN.test(input)) return 'https://' + input;
  return null;
}

function getDefaultSearchEngine() {
  const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return lang.startsWith('zh') ? 'baidu' : 'google';
}

// DOMAIN_CATEGORIES 和 DEFAULT_TAG_PALETTE 已迁移到 js/bookmark-organizer.js 和 js/bookmark-tags.js
// 通过 <script> 或 importScripts 先加载这两个文件即可获取

// 默认设置
const DEFAULT_SETTINGS = {
  theme: 'system', // system, light, dark
  fontSize: 'medium', // small, medium, large
  lineHeight: 'normal', // compact, normal, relaxed
  animation: true, // true, false
  highContrast: false, // true, false
  showGroupsMode: false, // 是否显示分组搜索模式（官方 API 能力有限，默认关闭）
  groupChildClickRestoreAll: true, // 点击分组内子标签时是否整组恢复
  defaultSearchEngine: null, // null = 自动检测(中文环境百度/其他Google), 或 google/baidu/bing/duckduckgo
  defaultMode: 'bookmarks', // 扩展打开时的默认搜索模式
  searchWindowMode: 'window', // window = 独立搜索窗口, popup = 弹出面板
  searchPlatforms: {
    enabled: true,
    prefixEnabled: true,
    showInResults: true,
    enabledPlatforms: ['g', 'bd', 'gh', 'so', 'zh', 'bl', 'yt', 'npm', 'mdn'],
    customPlatforms: []
  },
  intelligentSearch: {
    enabled: false,
    aiProvider: 'gemini', // gemini, openai, siliconflow, custom
    aiApiKey: '',
    aiBaseUrl: '',
    embeddingModel: '',
    chatModel: '',
    rerankEnabled: false,
    lastBuildProgress: 0
  }
};

// 获取当前设置
async function getSettings() {
  const result = await chrome.storage.sync.get(['settings', 'optionsSettings']);
  
  const source = result.optionsSettings || result.settings || {};
  const merged = { ...DEFAULT_SETTINGS };

  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key === 'intelligentSearch') {
      const fromSettings = result.settings?.intelligentSearch || {};
      const fromOptions = result.optionsSettings?.intelligentSearch || {};
      merged.intelligentSearch = {
        ...DEFAULT_SETTINGS.intelligentSearch,
        ...fromSettings,
        ...fromOptions
      };
    } else if (key === 'searchPlatforms') {
      const fromSettings = result.settings?.searchPlatforms || {};
      const fromOptions = result.optionsSettings?.searchPlatforms || {};
      merged.searchPlatforms = {
        ...DEFAULT_SETTINGS.searchPlatforms,
        ...fromSettings,
        ...fromOptions
      };
    } else if (source[key] !== undefined) {
      merged[key] = source[key];
    }
  }

  if (typeof window !== 'undefined') {
    window.__BOOKMARK_SEARCH_SETTINGS = merged;
  }

  return merged;
}

// 保存设置
async function saveSettings(settings) {
  await chrome.storage.sync.set({ settings });
  applySettings(settings);
}

// 应用设置到界面
function applySettings(settings) {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  // 应用主题
  const isDark = settings.theme === 'dark' || 
                 (settings.theme === 'system' && prefersDark);
  
  root.classList.toggle('dark-theme', isDark);
  root.classList.toggle('high-contrast', settings.highContrast);
  
  // 应用字体大小
  root.style.setProperty('--font-size-base', {
    small: '12px',
    medium: '14px',
    large: '16px'
  }[settings.fontSize]);
  
  // 应用行高
  root.style.setProperty('--line-height-base', {
    compact: '1.3',
    normal: '1.5',
    relaxed: '1.7'
  }[settings.lineHeight]);
  
  // 应用动画
  root.style.setProperty('--transition-duration', 
    settings.animation ? '0.3s' : '0s');
}

// 监听系统主题变化
function watchSystemTheme() {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', async () => {
    const settings = await getSettings();
    if (settings.theme === 'system') {
      applySettings(settings);
    }
  });
}

// 初始化设置
async function initSettings() {
  const settings = await getSettings();
  applySettings(settings);
  watchSystemTheme();
}

// BookmarkTags 已迁移到 js/bookmark-tags.js
// BookmarkOrganizer 已迁移到 js/bookmark-organizer.js

// 导出函数和常量
window.settings = {
  get: getSettings,
  save: saveSettings,
  init: initSettings
};
window.SEARCH_ENGINES = SEARCH_ENGINES;
window.SEARCH_PLATFORMS = SEARCH_PLATFORMS;
window.URL_PATTERN = URL_PATTERN;
window.normalizeUrl = normalizeUrl;
window.getDefaultSearchEngine = getDefaultSearchEngine;
// DOMAIN_CATEGORIES, DEFAULT_TAG_PALETTE, BookmarkTags, BookmarkOrganizer
// 由 js/bookmark-tags.js 和 js/bookmark-organizer.js 导出
