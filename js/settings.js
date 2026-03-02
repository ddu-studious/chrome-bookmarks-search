// 搜索引擎定义
const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q={query}' },
  baidu: { name: '百度', url: 'https://www.baidu.com/s?wd={query}' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q={query}' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={query}' }
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

// 默认设置
const DEFAULT_SETTINGS = {
  theme: 'system', // system, light, dark
  fontSize: 'medium', // small, medium, large
  lineHeight: 'normal', // compact, normal, relaxed
  animation: true, // true, false
  highContrast: false, // true, false
  showGroupsMode: false, // 是否显示分组搜索模式（官方 API 能力有限，默认关闭）
  groupChildClickRestoreAll: true, // 点击分组内子标签时是否整组恢复
  defaultSearchEngine: null // null = 自动检测(中文环境百度/其他Google), 或 google/baidu/bing/duckduckgo
};

// 获取当前设置
async function getSettings() {
  // 尝试从两个位置读取设置（兼容 options 页面和旧设置）
  const result = await chrome.storage.sync.get(['settings', 'optionsSettings']);
  
  // 优先使用 optionsSettings（来自 options 页面）
  if (result.optionsSettings) {
    return {
      ...DEFAULT_SETTINGS,
      theme: result.optionsSettings.theme || DEFAULT_SETTINGS.theme,
      fontSize: result.optionsSettings.fontSize || DEFAULT_SETTINGS.fontSize,
      animation: result.optionsSettings.animation !== undefined ? result.optionsSettings.animation : DEFAULT_SETTINGS.animation,
      highContrast: result.optionsSettings.highContrast !== undefined ? result.optionsSettings.highContrast : DEFAULT_SETTINGS.highContrast,
      lineHeight: DEFAULT_SETTINGS.lineHeight,
      showGroupsMode: result.optionsSettings.showGroupsMode !== undefined
        ? result.optionsSettings.showGroupsMode
        : DEFAULT_SETTINGS.showGroupsMode,
      groupChildClickRestoreAll: result.optionsSettings.groupChildClickRestoreAll !== undefined
        ? result.optionsSettings.groupChildClickRestoreAll
        : DEFAULT_SETTINGS.groupChildClickRestoreAll,
      defaultSearchEngine: result.optionsSettings.defaultSearchEngine !== undefined
        ? result.optionsSettings.defaultSearchEngine
        : DEFAULT_SETTINGS.defaultSearchEngine
    };
  }
  
  return { ...DEFAULT_SETTINGS, ...result.settings };
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

// 导出函数和常量
window.settings = {
  get: getSettings,
  save: saveSettings,
  init: initSettings
};
window.SEARCH_ENGINES = SEARCH_ENGINES;
window.URL_PATTERN = URL_PATTERN;
window.normalizeUrl = normalizeUrl;
window.getDefaultSearchEngine = getDefaultSearchEngine;
