/**
 * 设置页面脚本
 */

// 默认设置
const DEFAULT_SETTINGS = {
  theme: 'system',
  uiStyle: 'spotlight',
  fontSize: 'medium',
  fontFamily: 'system',
  animation: true,
  highContrast: false,
  defaultMode: 'bookmarks',
  defaultSort: 'smart',
  historyRange: 30,
  showStats: true,
  showGroupsMode: false,
  friendLinks: [
    { name: 'DeepSeek', url: 'https://www.deepseek.com' },
    { name: '爱奇艺', url: 'https://www.iqiyi.com' },
    { name: '哔哩哔哩', url: 'https://www.bilibili.com' },
    { name: 'YouTube', url: 'https://www.youtube.com' }
  ],
  defaultSearchEngine: null,
  searchWindowMode: 'window'
};

// 分页配置
const PAGE_SIZE = 10;
let currentPage = { bookmarks: 1, history: 1, downloads: 1 };
let allData = { bookmarks: [], history: [], downloads: [] };
let filteredData = { bookmarks: [], history: [], downloads: [] };
let currentFilter = 'all';
let editingItem = null;

// ==================== 初始化 ====================
document.addEventListener('DOMContentLoaded', async () => {
  await loadSettings();
  await applyTheme();
  await loadStats();
  bindNavigationEvents();
  bindSettingEvents();
  bindDataManagementEvents();
  bindModalEvents();
  bindAiSearchEvents();
  bindHealthCheckEvents();
  bindAutoHealthCheckEvents();
  bindAnalysisEvents();
  bindProEvents();
  handleHashChange();
  window.addEventListener('hashchange', handleHashChange);
  
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
    const result = await chrome.storage.sync.get('optionsSettings');
    const settings = result.optionsSettings || {};
    if (settings.theme === 'system' || !settings.theme) {
      await applyTheme();
    }
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === 'EMBEDDING_BUILD_PROGRESS') {
      updateOptBuildProgress(msg);
    }
    if (msg.type === 'SUMMARY_BATCH_PROGRESS') {
      updateOptSummaryProgress(msg);
    }
    if (msg.type === 'BOOKMARK_HEALTH_PROGRESS') {
      updateHealthProgress(msg);
    }
  });
});

// 应用主题到页面
async function applyTheme() {
  const result = await chrome.storage.sync.get('optionsSettings');
  const settings = result.optionsSettings || {};
  const theme = settings.theme || 'system';
  const root = document.documentElement;
  
  // 移除所有主题类
  root.classList.remove('dark-theme', 'light-theme');
  
  if (theme === 'dark') {
    root.classList.add('dark-theme');
  } else if (theme === 'light') {
    root.classList.add('light-theme');
  }
  // system 模式下不添加任何类，让 CSS media query 自动处理
}

// ==================== 导航 ====================
function handleHashChange() {
  const hash = window.location.hash.slice(1) || 'general';
  showSection(hash);
  
  if (hash === 'bookmarks') loadBookmarks();
  if (hash === 'history') loadHistory();
  if (hash === 'downloads') loadDownloads();
  if (hash === 'links') loadFriendLinks();
  if (hash === 'ai-search') refreshOptAiIndexStatus();
  if (hash === 'analysis') initAnalysisSection();
  if (hash === 'pro') refreshProStatus();
}

function showSection(sectionId) {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.classList.toggle('active', item.dataset.section === sectionId);
  });
  document.querySelectorAll('.content-section').forEach(section => {
    section.classList.toggle('active', section.id === sectionId);
  });
}

function bindNavigationEvents() {
  document.querySelectorAll('.nav-item').forEach(item => {
    item.addEventListener('click', (e) => {
      e.preventDefault();
      const section = item.dataset.section;
      window.location.hash = section;
    });
  });
}

// ==================== 设置加载/保存 ====================
async function loadSettings() {
  const result = await chrome.storage.sync.get(['optionsSettings', 'overlayFont']);
  const settings = { ...DEFAULT_SETTINGS, ...result.optionsSettings };
  
  // 如果有单独存储的字体设置，使用它
  if (result.overlayFont) {
    settings.fontFamily = result.overlayFont;
  }
  
  // 应用到表单
  document.getElementById('themeMode').value = settings.theme;
  document.getElementById('uiStyle').value = settings.uiStyle;
  document.getElementById('fontSize').value = settings.fontSize;
  document.getElementById('fontFamily').value = settings.fontFamily;
  document.getElementById('enableAnimation').checked = settings.animation;
  document.getElementById('highContrast').checked = settings.highContrast;
  document.getElementById('defaultMode').value = settings.defaultMode;
  document.getElementById('defaultSort').value = settings.defaultSort;
  document.getElementById('historyRange').value = settings.historyRange;
  document.getElementById('showStats').checked = settings.showStats;
  document.getElementById('showGroupsMode').checked = !!settings.showGroupsMode;
  
  // 搜索引擎
  const engineSelect = document.getElementById('defaultSearchEngine');
  if (engineSelect) {
    engineSelect.value = settings.defaultSearchEngine || 'auto';
  }
  
  // 搜索窗口模式
  const modeSelect = document.getElementById('searchWindowMode');
  if (modeSelect) {
    modeSelect.value = settings.searchWindowMode || 'window';
    updateSearchWindowModeHint(settings.searchWindowMode || 'window');
  }
  
  // 加载快捷键
  loadCurrentShortcut();
  
  // 加载弹出面板尺寸
  loadPopupDimensions();
}

async function loadCurrentShortcut() {
  try {
    const commands = await chrome.commands.getAll();
    const toggleCommand = commands.find(cmd => cmd.name === '_execute_action' || cmd.name === 'toggle_overlay');
    if (toggleCommand && toggleCommand.shortcut) {
      document.getElementById('currentShortcut').textContent = toggleCommand.shortcut;
    }
  } catch (e) {
    console.error('Failed to load shortcut:', e);
  }
}

async function saveSettings() {
  const fontFamily = document.getElementById('fontFamily').value;
  
  const settings = {
    theme: document.getElementById('themeMode').value,
    uiStyle: document.getElementById('uiStyle').value,
    fontSize: document.getElementById('fontSize').value,
    fontFamily: fontFamily,
    animation: document.getElementById('enableAnimation').checked,
    highContrast: document.getElementById('highContrast').checked,
    defaultMode: document.getElementById('defaultMode').value,
    defaultSort: document.getElementById('defaultSort').value,
    historyRange: parseInt(document.getElementById('historyRange').value),
    showStats: document.getElementById('showStats').checked,
    showGroupsMode: document.getElementById('showGroupsMode').checked,
    defaultSearchEngine: document.getElementById('defaultSearchEngine')?.value === 'auto' ? null : document.getElementById('defaultSearchEngine')?.value || null,
    searchWindowMode: document.getElementById('searchWindowMode')?.value || 'window'
  };
  
  // 保留已有的友情链接和 AI 配置
  const result = await chrome.storage.sync.get(['optionsSettings', 'settings']);
  const prevOptions = result.optionsSettings || {};
  settings.friendLinks = prevOptions.friendLinks || DEFAULT_SETTINGS.friendLinks;
  if (prevOptions.intelligentSearch) {
    settings.intelligentSearch = prevOptions.intelligentSearch;
  }
  
  await chrome.storage.sync.set({ optionsSettings: settings });
  
  // 同步到旧格式时保留 intelligentSearch
  const prevLegacy = result.settings || {};
  await chrome.storage.sync.set({
    settings: {
      theme: settings.theme,
      fontSize: settings.fontSize,
      lineHeight: 'normal',
      animation: settings.animation,
      highContrast: settings.highContrast,
      ...(prevLegacy.intelligentSearch ? { intelligentSearch: prevLegacy.intelligentSearch } : {})
    },
    overlayStyle: settings.uiStyle,
    overlayFont: fontFamily
  });
  
  // 立即应用主题到当前页面
  await applyTheme();
  
  showToast('设置已保存');
}

function updateSearchWindowModeHint(mode) {
  const hintWindow = document.getElementById('hintWindow');
  const hintPopup = document.getElementById('hintPopup');
  const sizeConfig = document.getElementById('popupSizeConfig');
  if (hintWindow) hintWindow.style.display = mode === 'window' ? '' : 'none';
  if (hintPopup) hintPopup.style.display = mode === 'popup' ? '' : 'none';
  if (sizeConfig) sizeConfig.style.display = mode === 'popup' ? '' : 'none';
}

// ==================== 弹出面板尺寸配置 ====================
const POPUP_DEFAULT_WIDTH = 480;
const POPUP_DEFAULT_HEIGHT = 600;
const POPUP_PREVIEW_SCALE_BASE = 0.38;
const POPUP_BROWSER_MAX_HEIGHT_FALLBACK = 600;

async function loadPopupDimensions() {
  const result = await chrome.storage.sync.get(['popupDimensions', 'popupMaxHeight']);
  const dims = result.popupDimensions || { width: POPUP_DEFAULT_WIDTH, height: POPUP_DEFAULT_HEIGHT };
  
  const widthSlider = document.getElementById('popupWidth');
  const heightSlider = document.getElementById('popupHeight');

  if (heightSlider) {
    const screenMax = window.screen.availHeight || 1200;
    const popupMax = typeof result.popupMaxHeight === 'number' && result.popupMaxHeight > 0
      ? Math.min(screenMax, result.popupMaxHeight)
      : Math.min(screenMax, POPUP_BROWSER_MAX_HEIGHT_FALLBACK);
    heightSlider.max = popupMax;
  }

  const safeWidth = Math.max(320, Math.min(800, dims.width));
  const maxHeight = parseInt(heightSlider?.max || (window.screen.availHeight || 1200), 10);
  const safeHeight = Math.max(300, Math.min(maxHeight, dims.height));

  if (widthSlider) widthSlider.value = safeWidth;
  if (heightSlider) heightSlider.value = safeHeight;
  
  updatePopupSizeDisplay(safeWidth, safeHeight);
  updatePopupPreview(safeWidth, safeHeight);
}

function updatePopupSizeDisplay(width, height) {
  const wVal = document.getElementById('popupWidthValue');
  const hVal = document.getElementById('popupHeightValue');
  const dims = document.getElementById('previewDimensions');
  if (wVal) wVal.textContent = width + 'px';
  if (hVal) hVal.textContent = height + 'px';
  if (dims) dims.textContent = width + ' × ' + height;
}

function updatePopupPreview(width, height) {
  const preview = document.getElementById('popupSizePreview');
  if (!preview) return;
  const scale = Math.min(300 / width, 240 / height, POPUP_PREVIEW_SCALE_BASE);
  preview.style.width = Math.round(width * scale) + 'px';
  preview.style.height = Math.round(height * scale) + 'px';
}

function savePopupDimensions(width, height) {
  chrome.storage.sync.get('popupMaxHeight', (result) => {
    const screenMax = window.screen.availHeight || 1200;
    const maxHeight = typeof result.popupMaxHeight === 'number' && result.popupMaxHeight > 0
      ? Math.min(screenMax, result.popupMaxHeight)
      : Math.min(screenMax, POPUP_BROWSER_MAX_HEIGHT_FALLBACK);
    const safeWidth = Math.max(320, Math.min(800, width));
    const safeHeight = Math.max(300, Math.min(maxHeight, height));
    chrome.storage.sync.set({ popupDimensions: { width: safeWidth, height: safeHeight } });
  });
}

function bindPopupSizeEvents() {
  const widthSlider = document.getElementById('popupWidth');
  const heightSlider = document.getElementById('popupHeight');
  const resetBtn = document.getElementById('popupSizeReset');

  function onSliderChange() {
    const w = parseInt(widthSlider.value);
    const h = parseInt(heightSlider.value);
    updatePopupSizeDisplay(w, h);
    updatePopupPreview(w, h);
    savePopupDimensions(w, h);
  }

  if (widthSlider) widthSlider.addEventListener('input', onSliderChange);
  if (heightSlider) heightSlider.addEventListener('input', onSliderChange);

  if (resetBtn) {
    resetBtn.addEventListener('click', () => {
      if (widthSlider) widthSlider.value = POPUP_DEFAULT_WIDTH;
      if (heightSlider) heightSlider.value = POPUP_DEFAULT_HEIGHT;
      updatePopupSizeDisplay(POPUP_DEFAULT_WIDTH, POPUP_DEFAULT_HEIGHT);
      updatePopupPreview(POPUP_DEFAULT_WIDTH, POPUP_DEFAULT_HEIGHT);
      savePopupDimensions(POPUP_DEFAULT_WIDTH, POPUP_DEFAULT_HEIGHT);
      showToast('已恢复默认尺寸');
    });
  }
}

function bindSettingEvents() {
  document.querySelectorAll('.form-select, input[type="checkbox"]').forEach(el => {
    el.addEventListener('change', saveSettings);
  });
  
  const modeSelect = document.getElementById('searchWindowMode');
  if (modeSelect) {
    modeSelect.addEventListener('change', () => {
      updateSearchWindowModeHint(modeSelect.value);
    });
  }
  
  document.getElementById('editShortcutBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });

  bindPopupSizeEvents();
}

// ==================== 统计数据 ====================
async function loadStats() {
  try {
    // 书签
    const bookmarkTree = await chrome.bookmarks.getTree();
    let bookmarkCount = 0;
    function countBookmarks(node) {
      if (node.url) bookmarkCount++;
      if (node.children) node.children.forEach(countBookmarks);
    }
    bookmarkTree.forEach(countBookmarks);
    document.getElementById('statBookmarks').textContent = bookmarkCount;
    document.getElementById('bookmarksBadge').textContent = bookmarkCount;
    
    // 标签页
    const tabs = await chrome.tabs.query({});
    document.getElementById('statTabs').textContent = tabs.length;
    
    // 历史记录
    chrome.history.search({
      text: '',
      startTime: Date.now() - 30 * 24 * 60 * 60 * 1000,
      maxResults: 10000
    }, (results) => {
      document.getElementById('statHistory').textContent = results.length;
      document.getElementById('historyBadge').textContent = results.length;
    });
    
    // 下载
    chrome.downloads.search({ limit: 1000 }, (downloads) => {
      document.getElementById('statDownloads').textContent = downloads.length;
      document.getElementById('downloadsBadge').textContent = downloads.length;
    });
  } catch (e) {
    console.error('Failed to load stats:', e);
  }
}

// ==================== 书签管理 ====================
async function loadBookmarks() {
  const listBody = document.getElementById('bookmarkListBody');
  listBody.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  
  try {
    console.log('[Options] Loading bookmarks...');
    const bookmarkTree = await chrome.bookmarks.getTree();
    const bookmarks = [];
    
    function traverseBookmarks(node) {
      if (node.url) {
        bookmarks.push(node);
      }
      if (node.children) {
        node.children.forEach(traverseBookmarks);
      }
    }
    bookmarkTree.forEach(traverseBookmarks);
    console.log('[Options] Found', bookmarks.length, 'bookmarks');
    
    // 分批处理避免阻塞，同时捕获单个书签的错误
    const BATCH_SIZE = 50;
    const bookmarksWithStats = [];
    
    for (let i = 0; i < bookmarks.length; i += BATCH_SIZE) {
      const batch = bookmarks.slice(i, i + BATCH_SIZE);
      const batchResults = await Promise.all(batch.map(async bookmark => {
        try {
          const stats = await getUrlStats(bookmark.url);
          const data = {
            ...bookmark,
            visitCount: stats.count,
            lastVisit: stats.lastVisit
          };
          data.usageStatus = categorizeBookmark(data);
          return data;
        } catch (e) {
          console.warn('[Options] Failed to get stats for:', bookmark.url, e);
          return {
            ...bookmark,
            visitCount: 0,
            lastVisit: null,
            usageStatus: 'never_used'
          };
        }
      }));
      bookmarksWithStats.push(...batchResults);
    }
    
    console.log('[Options] Processed', bookmarksWithStats.length, 'bookmarks with stats');
    
    // 按访问次数排序
    bookmarksWithStats.sort((a, b) => (b.visitCount || 0) - (a.visitCount || 0));
    
    allData.bookmarks = bookmarksWithStats;
    applyBookmarkFilter();
  } catch (e) {
    console.error('[Options] Failed to load bookmarks:', e);
    listBody.innerHTML = `<div class="empty-state"><p>加载失败: ${escapeHtml(e.message)}</p></div>`;
  }
}

function applyBookmarkFilter() {
  if (currentFilter === 'all') {
    filteredData.bookmarks = allData.bookmarks;
  } else {
    filteredData.bookmarks = allData.bookmarks.filter(b => b.usageStatus === currentFilter);
  }
  currentPage.bookmarks = 1;
  renderBookmarkList();
}

function renderBookmarkList() {
  const data = filteredData.bookmarks;
  const start = (currentPage.bookmarks - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageData = data.slice(start, end);
  
  const listBody = document.getElementById('bookmarkListBody');
  
  if (pageData.length === 0) {
    listBody.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/>
        </svg>
        <h3>暂无书签</h3>
        <p>没有找到符合条件的书签</p>
      </div>
    `;
    document.getElementById('bookmarkPagination').innerHTML = '';
    return;
  }
  
  listBody.innerHTML = pageData.map(item => {
    const badge = getBadgeHtml(item);
    return `
      <div class="data-item" data-id="${item.id}">
        <div class="data-item-icon">
          <img src="${getFaviconUrl(item.url)}" data-hide-on-error="true">
        </div>
        <div class="data-item-content">
          <div class="data-item-title">${escapeHtml(item.title || '无标题')}</div>
          <div class="data-item-url">${escapeHtml(item.url)}</div>
        </div>
        <div class="data-item-visits">${badge}</div>
        <div class="data-item-time">${formatTime(item.lastVisit)}</div>
        <div class="data-item-actions">
          <button class="action-btn" title="打开" data-action="open">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
          </button>
          <button class="action-btn" title="编辑" data-action="edit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
          </button>
          <button class="action-btn danger" title="删除" data-action="delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');

  listBody.querySelectorAll('img[data-hide-on-error]').forEach(img => {
    img.addEventListener('error', function() { this.style.display = 'none'; }, { once: true });
  });
  
  renderPagination('bookmarks', data.length);
}

function getBadgeHtml(item) {
  if (item.visitCount > 0) {
    return `<span class="data-item-badge">${item.visitCount}次</span>`;
  }
  if (item.usageStatus === 'never_used') {
    return `<span class="data-item-badge warning">未使用</span>`;
  }
  return '-';
}

// ==================== 历史记录管理 ====================
async function loadHistory() {
  const listBody = document.getElementById('historyListBody');
  listBody.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  
  try {
    const result = await chrome.storage.sync.get('optionsSettings');
    const days = result.optionsSettings?.historyRange || 30;
    
    chrome.history.search({
      text: '',
      startTime: Date.now() - days * 24 * 60 * 60 * 1000,
      maxResults: 1000
    }, async (items) => {
      const historyWithStats = await Promise.all(items.map(async item => {
        const stats = await getUrlStats(item.url);
        return {
          ...item,
          visitCount: stats.count,
          lastVisit: stats.lastVisit || item.lastVisitTime
        };
      }));
      
      historyWithStats.sort((a, b) => (b.lastVisit || 0) - (a.lastVisit || 0));
      
      allData.history = historyWithStats;
      filteredData.history = historyWithStats;
      currentPage.history = 1;
      renderHistoryList();
    });
  } catch (e) {
    console.error('Failed to load history:', e);
  }
}

function renderHistoryList() {
  const data = filteredData.history;
  const start = (currentPage.history - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageData = data.slice(start, end);
  
  const listBody = document.getElementById('historyListBody');
  
  if (pageData.length === 0) {
    listBody.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="12" cy="12" r="10"/>
          <path d="M12 6v6l4 2"/>
        </svg>
        <h3>暂无历史记录</h3>
        <p>没有找到符合条件的历史记录</p>
      </div>
    `;
    document.getElementById('historyPagination').innerHTML = '';
    return;
  }
  
  listBody.innerHTML = pageData.map(item => `
    <div class="data-item" data-url="${escapeHtml(item.url)}">
      <div class="data-item-icon">
        <img src="${getFaviconUrl(item.url)}" data-hide-on-error="true">
      </div>
      <div class="data-item-content">
        <div class="data-item-title">${escapeHtml(item.title || '无标题')}</div>
        <div class="data-item-url">${escapeHtml(item.url)}</div>
      </div>
      <div class="data-item-visits"><span class="data-item-badge">${item.visitCount}次</span></div>
      <div class="data-item-time">${formatTime(item.lastVisit)}</div>
      <div class="data-item-actions">
        <button class="action-btn" title="打开" data-action="open">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M18 13v6a2 2 0 01-2 2H5a2 2 0 01-2-2V8a2 2 0 012-2h6M15 3h6v6M10 14L21 3"/></svg>
        </button>
        <button class="action-btn danger" title="删除" data-action="delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </div>
    </div>
  `).join('');

  listBody.querySelectorAll('img[data-hide-on-error]').forEach(img => {
    img.addEventListener('error', function() { this.style.display = 'none'; }, { once: true });
  });
  
  renderPagination('history', data.length);
}

// ==================== 下载管理 ====================
async function loadDownloads() {
  const listBody = document.getElementById('downloadListBody');
  listBody.innerHTML = '<div class="loading"><div class="spinner"></div></div>';
  
  try {
    chrome.downloads.search({ limit: 1000, orderBy: ['-startTime'] }, (items) => {
      allData.downloads = items;
      filteredData.downloads = items;
      currentPage.downloads = 1;
      renderDownloadList();
    });
  } catch (e) {
    console.error('Failed to load downloads:', e);
  }
}

function renderDownloadList() {
  const data = filteredData.downloads;
  const start = (currentPage.downloads - 1) * PAGE_SIZE;
  const end = start + PAGE_SIZE;
  const pageData = data.slice(start, end);
  
  const listBody = document.getElementById('downloadListBody');
  
  if (pageData.length === 0) {
    listBody.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>
        </svg>
        <h3>暂无下载</h3>
        <p>没有找到下载记录</p>
      </div>
    `;
    document.getElementById('downloadPagination').innerHTML = '';
    return;
  }
  
  listBody.innerHTML = pageData.map(item => {
    const filename = item.filename?.split('/').pop() || item.filename?.split('\\').pop() || '未知文件';
    return `
      <div class="data-item" data-id="${item.id}">
        <div class="data-item-icon">
          <svg viewBox="0 0 24 24" fill="currentColor" style="width:18px;height:18px;color:var(--text-secondary)"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8l-6-6zm4 18H6V4h7v5h5v11z"/></svg>
        </div>
        <div class="data-item-content">
          <div class="data-item-title">${escapeHtml(filename)}</div>
          <div class="data-item-url">${escapeHtml(item.url || '')}</div>
        </div>
        <div class="data-item-size">${formatFileSize(item.fileSize)}</div>
        <div class="data-item-time">${formatTime(item.startTime)}</div>
        <div class="data-item-actions">
          <button class="action-btn" title="打开" data-action="open">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z"/></svg>
          </button>
          <button class="action-btn danger" title="删除记录" data-action="delete">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
  
  renderPagination('downloads', data.length);
}

// ==================== 分页 ====================
function renderPagination(type, total) {
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const current = currentPage[type];
  const paginationIdMap = {
    bookmarks: 'bookmarkPagination',
    history: 'historyPagination',
    downloads: 'downloadPagination'
  };
  const containerId = paginationIdMap[type] || `${type}Pagination`;
  const container = document.getElementById(containerId);
  if (!container) return;
  
  if (totalPages <= 1) {
    container.innerHTML = '';
    return;
  }
  
  let html = `
    <button class="page-btn" ${current === 1 ? 'disabled' : ''} data-page="${current - 1}">←</button>
  `;
  
  for (let i = 1; i <= totalPages && i <= 5; i++) {
    html += `<button class="page-btn ${i === current ? 'active' : ''}" data-page="${i}">${i}</button>`;
  }
  
  if (totalPages > 5) {
    html += `<span class="page-info">...</span>`;
    html += `<button class="page-btn ${totalPages === current ? 'active' : ''}" data-page="${totalPages}">${totalPages}</button>`;
  }
  
  html += `
    <button class="page-btn" ${current === totalPages ? 'disabled' : ''} data-page="${current + 1}">→</button>
  `;
  
  container.innerHTML = html;
  
  // 绑定事件
  container.querySelectorAll('.page-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (btn.disabled) return;
      currentPage[type] = parseInt(btn.dataset.page);
      if (type === 'bookmarks') renderBookmarkList();
      if (type === 'history') renderHistoryList();
      if (type === 'downloads') renderDownloadList();
    });
  });
}

// ==================== 数据管理事件 ====================
function bindDataManagementEvents() {
  // 书签搜索
  document.getElementById('bookmarkSearch').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    if (query) {
      filteredData.bookmarks = allData.bookmarks.filter(b => 
        (b.title?.toLowerCase().includes(query) || b.url?.toLowerCase().includes(query)) &&
        (currentFilter === 'all' || b.usageStatus === currentFilter)
      );
    } else {
      applyBookmarkFilter();
      return;
    }
    currentPage.bookmarks = 1;
    renderBookmarkList();
  });
  
  // 书签筛选
  document.querySelectorAll('#bookmarks .filter-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('#bookmarks .filter-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      currentFilter = btn.dataset.filter;
      applyBookmarkFilter();
    });
  });
  
  // 历史搜索
  document.getElementById('historySearch').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    filteredData.history = query ? 
      allData.history.filter(h => h.title?.toLowerCase().includes(query) || h.url?.toLowerCase().includes(query)) :
      allData.history;
    currentPage.history = 1;
    renderHistoryList();
  });
  
  // 下载搜索
  document.getElementById('downloadSearch').addEventListener('input', (e) => {
    const query = e.target.value.toLowerCase();
    filteredData.downloads = query ?
      allData.downloads.filter(d => d.filename?.toLowerCase().includes(query) || d.url?.toLowerCase().includes(query)) :
      allData.downloads;
    currentPage.downloads = 1;
    renderDownloadList();
  });
  
  // 列表操作（事件委托）
  document.getElementById('bookmarkListBody').addEventListener('click', handleBookmarkAction);
  document.getElementById('historyListBody').addEventListener('click', handleHistoryAction);
  document.getElementById('downloadListBody').addEventListener('click', handleDownloadAction);
  
  // 清除历史
  document.getElementById('clearHistoryBtn').addEventListener('click', () => {
    if (confirm('确定要清除所有浏览历史吗？此操作不可撤销。')) {
      chrome.history.deleteAll(() => {
        showToast('历史记录已清除');
        loadHistory();
        loadStats();
      });
    }
  });
  
  // 打开下载文件夹
  document.getElementById('openDownloadsFolderBtn').addEventListener('click', () => {
    chrome.downloads.showDefaultFolder();
  });
}

function handleBookmarkAction(e) {
  const btn = e.target.closest('.action-btn');
  if (!btn) return;
  
  const item = btn.closest('.data-item');
  const id = item.dataset.id;
  const action = btn.dataset.action;
  const bookmark = allData.bookmarks.find(b => b.id === id);
  
  if (action === 'open') {
    chrome.tabs.create({ url: bookmark.url });
  } else if (action === 'edit') {
    showEditModal('bookmark', bookmark);
  } else if (action === 'delete') {
    if (confirm(`确定要删除书签 "${bookmark.title}" 吗？`)) {
      chrome.bookmarks.remove(id, () => {
        showToast('书签已删除');
        loadBookmarks();
        loadStats();
      });
    }
  }
}

function handleHistoryAction(e) {
  const btn = e.target.closest('.action-btn');
  if (!btn) return;
  
  const item = btn.closest('.data-item');
  const url = item.dataset.url;
  const action = btn.dataset.action;
  
  if (action === 'open') {
    chrome.tabs.create({ url });
  } else if (action === 'delete') {
    chrome.history.deleteUrl({ url }, () => {
      showToast('历史记录已删除');
      loadHistory();
      loadStats();
    });
  }
}

function handleDownloadAction(e) {
  const btn = e.target.closest('.action-btn');
  if (!btn) return;
  
  const item = btn.closest('.data-item');
  const id = parseInt(item.dataset.id);
  const action = btn.dataset.action;
  
  if (action === 'open') {
    chrome.downloads.show(id);
  } else if (action === 'delete') {
    chrome.downloads.erase({ id }, () => {
      showToast('下载记录已删除');
      loadDownloads();
      loadStats();
    });
  }
}

// ==================== 友情链接 ====================
async function loadFriendLinks() {
  const result = await chrome.storage.sync.get('optionsSettings');
  const links = result.optionsSettings?.friendLinks || DEFAULT_SETTINGS.friendLinks;
  
  const container = document.getElementById('linkList');
  container.innerHTML = links.map((link, index) => `
    <div class="link-item" data-index="${index}">
      <img class="link-favicon" src="${getFaviconUrl(link.url)}" data-hide-on-error="true">
      <div class="link-info">
        <div class="link-name">${escapeHtml(link.name)}</div>
        <div class="link-url">${escapeHtml(link.url)}</div>
      </div>
      <div class="link-actions">
        <button class="action-btn" title="编辑" data-action="edit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
        </button>
        <button class="action-btn danger" title="删除" data-action="delete">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
        </button>
      </div>
    </div>
  `).join('');

  container.querySelectorAll('img[data-hide-on-error]').forEach(img => {
    img.addEventListener('error', function() { this.style.display = 'none'; }, { once: true });
  });
  
  // 绑定事件
  container.querySelectorAll('.link-item').forEach(item => {
    item.querySelectorAll('.action-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const index = parseInt(item.dataset.index);
        const action = btn.dataset.action;
        
        if (action === 'edit') {
          const link = links[index];
          const newName = prompt('链接名称:', link.name);
          if (!newName) return;
          const newUrl = prompt('链接地址:', link.url);
          if (!newUrl) return;
          
          links[index] = { name: newName, url: newUrl };
          await saveFriendLinks(links);
          loadFriendLinks();
        } else if (action === 'delete') {
          if (confirm('确定要删除这个链接吗？')) {
            links.splice(index, 1);
            await saveFriendLinks(links);
            loadFriendLinks();
          }
        }
      });
    });
  });
}

async function saveFriendLinks(links) {
  const result = await chrome.storage.sync.get('optionsSettings');
  const settings = { ...DEFAULT_SETTINGS, ...result.optionsSettings, friendLinks: links };
  await chrome.storage.sync.set({ optionsSettings: settings });
  showToast('链接已保存');
}

// ==================== 弹窗 ====================
function bindModalEvents() {
  // 添加链接弹窗
  document.getElementById('addLinkBtn').addEventListener('click', () => {
    document.getElementById('addLinkModal').classList.add('show');
    document.getElementById('newLinkName').value = '';
    document.getElementById('newLinkUrl').value = '';
    document.getElementById('newLinkName').focus();
  });
  
  document.getElementById('addLinkModalClose').addEventListener('click', () => {
    document.getElementById('addLinkModal').classList.remove('show');
  });
  
  document.getElementById('addLinkModalCancel').addEventListener('click', () => {
    document.getElementById('addLinkModal').classList.remove('show');
  });
  
  document.getElementById('addLinkModalSave').addEventListener('click', async () => {
    const name = document.getElementById('newLinkName').value.trim();
    const url = document.getElementById('newLinkUrl').value.trim();
    
    if (!name || !url) {
      showToast('请填写完整信息');
      return;
    }
    
    try {
      new URL(url);
    } catch (e) {
      showToast('请输入有效的网址');
      return;
    }
    
    const result = await chrome.storage.sync.get('optionsSettings');
    const links = result.optionsSettings?.friendLinks || DEFAULT_SETTINGS.friendLinks;
    links.push({ name, url });
    await saveFriendLinks(links);
    
    document.getElementById('addLinkModal').classList.remove('show');
    loadFriendLinks();
  });
  
  // 编辑弹窗
  document.getElementById('editModalClose').addEventListener('click', () => {
    document.getElementById('editModal').classList.remove('show');
  });
  
  document.getElementById('editModalCancel').addEventListener('click', () => {
    document.getElementById('editModal').classList.remove('show');
  });
  
  document.getElementById('editModalSave').addEventListener('click', saveEditItem);
  
  // 点击背景关闭
  document.querySelectorAll('.modal-backdrop').forEach(backdrop => {
    backdrop.addEventListener('click', () => {
      backdrop.closest('.modal').classList.remove('show');
    });
  });
  
  // 关于页面链接
  document.getElementById('reportIssue').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: 'https://github.com/user/chrome-bookmarks-search/issues' });
  });
  
  document.getElementById('rateExtension').addEventListener('click', (e) => {
    e.preventDefault();
    showToast('感谢您的支持！');
  });
}

function showEditModal(type, item) {
  editingItem = { type, item };
  document.getElementById('editModalTitle').textContent = type === 'bookmark' ? '编辑书签' : '编辑';
  document.getElementById('editItemTitle').value = item.title || '';
  document.getElementById('editItemUrl').value = item.url || '';
  document.getElementById('editModal').classList.add('show');
  document.getElementById('editItemTitle').focus();
}

function saveEditItem() {
  if (!editingItem) return;
  
  const title = document.getElementById('editItemTitle').value.trim();
  const url = document.getElementById('editItemUrl').value.trim();
  
  if (!title || !url) {
    showToast('请填写完整信息');
    return;
  }
  
  if (editingItem.type === 'bookmark') {
    chrome.bookmarks.update(editingItem.item.id, { title, url }, () => {
      showToast('书签已更新');
      document.getElementById('editModal').classList.remove('show');
      loadBookmarks();
    });
  }
}

// ==================== 工具函数 ====================
async function getUrlStats(url) {
  return new Promise((resolve) => {
    try {
      // 验证 URL 有效性
      if (!url || !url.startsWith('http')) {
        resolve({ count: 0, lastVisit: null });
        return;
      }
      
      chrome.history.getVisits({ url }, (visits) => {
        // 检查 chrome.runtime.lastError
        if (chrome.runtime.lastError) {
          console.warn('getVisits error for', url, chrome.runtime.lastError);
          resolve({ count: 0, lastVisit: null });
          return;
        }
        
        if (visits && visits.length > 0) {
          const lastVisit = visits[visits.length - 1].visitTime;
          resolve({ count: visits.length, lastVisit });
        } else {
          resolve({ count: 0, lastVisit: null });
        }
      });
    } catch (e) {
      console.error('getUrlStats error:', e);
      resolve({ count: 0, lastVisit: null });
    }
  });
}

function categorizeBookmark(bookmark) {
  const { visitCount, lastVisit } = bookmark;
  const now = Date.now();
  
  if (!visitCount || visitCount === 0) return 'never_used';
  if (visitCount <= 2) return 'rarely_used';
  if (lastVisit && (now - lastVisit) / (1000 * 60 * 60 * 24) > 180) return 'dormant';
  return 'active';
}

function getFaviconUrl(url) {
  try {
    const hostname = new URL(url).hostname;
    return `https://www.google.com/s2/favicons?domain=${hostname}&sz=32`;
  } catch (e) {
    return '';
  }
}

function formatTime(timestamp) {
  if (!timestamp) return '-';
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;
  return date.toLocaleDateString();
}

function formatFileSize(bytes) {
  if (!bytes) return '-';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  if (bytes < 1024 * 1024 * 1024) return (bytes / 1024 / 1024).toFixed(1) + ' MB';
  return (bytes / 1024 / 1024 / 1024).toFixed(1) + ' GB';
}

function escapeHtml(text) {
  if (!text) return '';
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function showToast(message) {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.classList.add('show');
  setTimeout(() => toast.classList.remove('show'), 3000);
}

// ==================== AI 智能搜索设置 ====================

async function getAiConfig() {
  const result = await chrome.storage.sync.get(['settings', 'optionsSettings']);
  const fromSettings = result.settings?.intelligentSearch || {};
  const fromOptions = result.optionsSettings?.intelligentSearch || {};
  return {
    enabled: false,
    aiProvider: 'gemini',
    aiApiKey: '',
    aiBaseUrl: '',
    embeddingModel: '',
    chatModel: '',
    rerankEnabled: false,
    lastBuildProgress: 0,
    ...fromSettings,
    ...fromOptions
  };
}

async function saveAiConfig(updates) {
  const result = await chrome.storage.sync.get(['settings']);
  const settings = result.settings || {};
  settings.intelligentSearch = {
    ...(settings.intelligentSearch || {}),
    ...updates
  };
  await chrome.storage.sync.set({ settings });
}

function bindAiSearchEvents() {
  const enabledToggle = document.getElementById('optAiEnabled');
  const configCard = document.getElementById('optAiConfigCard');
  const indexCard = document.getElementById('optAiIndexCard');
  const advancedCard = document.getElementById('optAiAdvancedCard');
  const providerSelect = document.getElementById('optAiProvider');
  const apiKeyInput = document.getElementById('optAiApiKey');
  const baseUrlInput = document.getElementById('optAiBaseUrl');
  const baseUrlRow = document.getElementById('optAiBaseUrlRow');
  const verifyBtn = document.getElementById('optVerifyApiKeyBtn');
  const buildBtn = document.getElementById('optBuildIndexBtn');
  const resumeBtn = document.getElementById('optResumeIndexBtn');
  const pauseBtn = document.getElementById('optPauseIndexBtn');
  const clearBtn = document.getElementById('optClearIndexBtn');
  const rerankToggle = document.getElementById('optAiRerankEnabled');

  if (!enabledToggle) return;

  (async () => {
    const ai = await getAiConfig();
    enabledToggle.checked = ai.enabled;
    const showConfig = ai.enabled;
    if (configCard) configCard.style.display = showConfig ? '' : 'none';
    if (indexCard) indexCard.style.display = showConfig ? '' : 'none';
    if (advancedCard) advancedCard.style.display = showConfig ? '' : 'none';
    const summaryCardInit = document.getElementById('optAiSummaryCard');
    if (summaryCardInit) summaryCardInit.style.display = showConfig ? '' : 'none';
    if (providerSelect) providerSelect.value = ai.aiProvider || 'gemini';
    if (apiKeyInput) apiKeyInput.value = ai.aiApiKey || '';
    if (baseUrlInput) baseUrlInput.value = ai.aiBaseUrl || '';
    if (baseUrlRow) baseUrlRow.style.display = ai.aiProvider === 'custom' ? '' : 'none';
    if (rerankToggle) rerankToggle.checked = ai.rerankEnabled;
    refreshOptAiIndexStatus();
  })();

  const summaryCard = document.getElementById('optAiSummaryCard');

  enabledToggle.addEventListener('change', async () => {
    await saveAiConfig({ enabled: enabledToggle.checked });
    const show = enabledToggle.checked;
    if (configCard) configCard.style.display = show ? '' : 'none';
    if (indexCard) indexCard.style.display = show ? '' : 'none';
    if (advancedCard) advancedCard.style.display = show ? '' : 'none';
    if (summaryCard) summaryCard.style.display = show ? '' : 'none';
  });

  if (providerSelect) {
    providerSelect.addEventListener('change', async () => {
      await saveAiConfig({ aiProvider: providerSelect.value });
      if (baseUrlRow) baseUrlRow.style.display = providerSelect.value === 'custom' ? '' : 'none';
    });
  }

  if (apiKeyInput) {
    apiKeyInput.addEventListener('change', async () => {
      await saveAiConfig({ aiApiKey: apiKeyInput.value });
    });
    apiKeyInput.addEventListener('input', async () => {
      await saveAiConfig({ aiApiKey: apiKeyInput.value });
    });
  }

  if (baseUrlInput) {
    baseUrlInput.addEventListener('change', async () => {
      await saveAiConfig({ aiBaseUrl: baseUrlInput.value });
    });
  }

  if (rerankToggle) {
    rerankToggle.addEventListener('change', async () => {
      await saveAiConfig({ rerankEnabled: rerankToggle.checked });
    });
  }

  if (verifyBtn) {
    verifyBtn.addEventListener('click', async () => {
      verifyBtn.textContent = '验证中...';
      verifyBtn.disabled = true;

      const currentConfig = {
        enabled: enabledToggle?.checked || false,
        aiProvider: providerSelect?.value || 'gemini',
        aiApiKey: apiKeyInput?.value || '',
        aiBaseUrl: baseUrlInput?.value || '',
        rerankEnabled: rerankToggle?.checked || false
      };
      await saveAiConfig(currentConfig);

      chrome.runtime.sendMessage({ type: 'VERIFY_API_KEY', config: currentConfig }, (response) => {
        verifyBtn.disabled = false;
        if (response && response.ok) {
          verifyBtn.textContent = '验证成功';
          verifyBtn.classList.add('btn-success');
          showToast(response.message || 'API Key 验证成功');
        } else {
          verifyBtn.textContent = '验证失败';
          showToast('验证失败: ' + (response?.message || '未知错误'));
        }
        setTimeout(() => { verifyBtn.textContent = '验证'; verifyBtn.classList.remove('btn-success'); }, 3000);
      });
    });
  }

  function showOptBuildingUI() {
    if (buildBtn) buildBtn.style.display = 'none';
    if (resumeBtn) resumeBtn.style.display = 'none';
    if (pauseBtn) pauseBtn.style.display = '';
    if (clearBtn) clearBtn.style.display = 'none';
    const bar = document.getElementById('optAiProgressBar');
    if (bar) bar.style.display = '';
  }

  function showOptIdleUI() {
    if (pauseBtn) pauseBtn.style.display = 'none';
    refreshOptAiIndexStatus();
  }

  if (buildBtn) {
    buildBtn.addEventListener('click', () => {
      showOptBuildingUI();
      chrome.runtime.sendMessage({ type: 'BUILD_EMBEDDING_INDEX' }, () => {
        showOptIdleUI();
      });
    });
  }

  if (resumeBtn) {
    resumeBtn.addEventListener('click', () => {
      showOptBuildingUI();
      chrome.runtime.sendMessage({ type: 'RESUME_EMBEDDING_BUILD' }, () => {
        showOptIdleUI();
      });
    });
  }

  if (pauseBtn) {
    pauseBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'PAUSE_EMBEDDING_BUILD' });
      showOptIdleUI();
    });
  }

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (confirm('确定要清除所有已构建的向量索引吗？')) {
        chrome.runtime.sendMessage({ type: 'CLEAR_EMBEDDING_INDEX' }, () => {
          showOptIdleUI();
          showToast('向量索引已清除');
        });
      }
    });
  }

  const batchSummaryBtn = document.getElementById('optBatchSummaryBtn');
  const pauseSummaryBtn = document.getElementById('optPauseSummaryBtn');
  const summaryStatusEl = document.getElementById('optSummaryStatus');
  const summaryProgressBar = document.getElementById('optSummaryProgressBar');
  const summaryProgressFill = document.getElementById('optSummaryProgressFill');

  if (batchSummaryBtn) {
    batchSummaryBtn.addEventListener('click', () => {
      batchSummaryBtn.style.display = 'none';
      if (pauseSummaryBtn) pauseSummaryBtn.style.display = '';
      if (summaryProgressBar) summaryProgressBar.style.display = '';
      if (summaryStatusEl) summaryStatusEl.textContent = '正在提取中...';
      chrome.runtime.sendMessage({ type: 'BATCH_EXTRACT_SUMMARIES' }, (response) => {
        if (pauseSummaryBtn) pauseSummaryBtn.style.display = 'none';
        batchSummaryBtn.style.display = '';
        if (response?.ok) {
          const errCount = response.errors?.length || 0;
          if (summaryStatusEl) summaryStatusEl.textContent = `提取完成 (${response.progress} 项${errCount > 0 ? '，' + errCount + ' 个错误' : ''})`;
          showToast('批量摘要提取完成');
        } else {
          if (summaryStatusEl) summaryStatusEl.textContent = '提取出错: ' + (response?.error || '未知错误');
        }
        if (summaryProgressBar) summaryProgressBar.style.display = 'none';
      });
    });
  }

  if (pauseSummaryBtn) {
    pauseSummaryBtn.addEventListener('click', () => {
      chrome.runtime.sendMessage({ type: 'PAUSE_SUMMARY_BATCH' });
      if (pauseSummaryBtn) pauseSummaryBtn.style.display = 'none';
      if (batchSummaryBtn) batchSummaryBtn.style.display = '';
      if (summaryStatusEl) summaryStatusEl.textContent = '已暂停';
    });
  }
}

function refreshOptAiIndexStatus() {
  chrome.runtime.sendMessage({ type: 'GET_EMBEDDING_STATUS' }, (response) => {
    const statusEl = document.getElementById('optAiIndexStatus');
    const buildBtn = document.getElementById('optBuildIndexBtn');
    const resumeBtn = document.getElementById('optResumeIndexBtn');
    const clearBtn = document.getElementById('optClearIndexBtn');
    const progressBar = document.getElementById('optAiProgressBar');
    const progressFill = document.getElementById('optAiProgressFill');
    if (!statusEl) return;

    if (response && response.ok) {
      const { vectorCount, buildStatus, persistedState } = response;
      if (buildStatus.running) {
        statusEl.textContent = `构建中 ${buildStatus.progress}/${buildStatus.total}`;
        if (buildBtn) buildBtn.style.display = 'none';
        if (resumeBtn) resumeBtn.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'none';
      } else if (persistedState && (persistedState.status === 'paused' || persistedState.status === 'error' || persistedState.status === 'running')) {
        const done = persistedState.processedIds?.length || 0;
        const total = persistedState.total || 0;
        statusEl.textContent = persistedState.status === 'error'
          ? `构建出错 (${done}/${total}): ${persistedState.error || '未知错误'}`
          : `已暂停 ${done}/${total}`;
        if (buildBtn) buildBtn.style.display = 'none';
        if (resumeBtn) resumeBtn.style.display = '';
        if (clearBtn) clearBtn.style.display = '';
        if (progressBar) { progressBar.style.display = ''; }
        if (progressFill && total > 0) progressFill.style.width = (done / total * 100) + '%';
      } else if (vectorCount > 0) {
        statusEl.textContent = `已索引 ${vectorCount} 项`;
        if (buildBtn) { buildBtn.style.display = ''; buildBtn.textContent = '重建索引'; }
        if (resumeBtn) resumeBtn.style.display = 'none';
        if (clearBtn) clearBtn.style.display = '';
        if (progressBar) progressBar.style.display = 'none';
      } else {
        statusEl.textContent = '未构建';
        if (buildBtn) { buildBtn.style.display = ''; buildBtn.textContent = '构建索引'; }
        if (resumeBtn) resumeBtn.style.display = 'none';
        if (clearBtn) clearBtn.style.display = 'none';
        if (progressBar) progressBar.style.display = 'none';
      }
    }
  });
}

function updateOptBuildProgress(msg) {
  const progressBar = document.getElementById('optAiProgressBar');
  const progressFill = document.getElementById('optAiProgressFill');
  const statusEl = document.getElementById('optAiIndexStatus');

  if (msg.type === 'progress' || msg.type === 'EMBEDDING_BUILD_PROGRESS') {
    const pct = msg.total > 0 ? (msg.progress / msg.total * 100) : 0;
    if (progressBar) progressBar.style.display = '';
    if (progressFill) progressFill.style.width = pct + '%';
    if (statusEl) statusEl.textContent = `构建中 ${msg.progress}/${msg.total}`;
  }
  if (msg.type === 'complete') {
    if (progressBar) progressBar.style.display = 'none';
    if (statusEl) statusEl.textContent = `已索引 ${msg.total} 项`;
    showToast('向量索引构建完成');
    refreshOptAiIndexStatus();
  }
  if (msg.type === 'error') {
    if (progressBar) progressBar.style.display = 'none';
    if (statusEl) statusEl.textContent = `构建出错: ${msg.error}`;
    showToast('构建出错: ' + msg.error);
  }
  if (msg.type === 'paused') {
    if (statusEl) statusEl.textContent = `已暂停 ${msg.progress}/${msg.total}`;
  }
}

function updateOptSummaryProgress(msg) {
  const progressBar = document.getElementById('optSummaryProgressBar');
  const progressFill = document.getElementById('optSummaryProgressFill');
  const statusEl = document.getElementById('optSummaryStatus');

  if (msg.type === 'progress') {
    const pct = msg.total > 0 ? (msg.progress / msg.total * 100) : 0;
    if (progressBar) progressBar.style.display = '';
    if (progressFill) progressFill.style.width = pct + '%';
    if (statusEl) statusEl.textContent = `提取中 ${msg.progress}/${msg.total}${msg.errors > 0 ? ` (${msg.errors} 个错误)` : ''}`;
  }
  if (msg.type === 'complete') {
    if (progressBar) progressBar.style.display = 'none';
    if (statusEl) statusEl.textContent = `提取完成 ${msg.total} 项${msg.errors > 0 ? ` (${msg.errors} 个错误)` : ''}`;
  }
  if (msg.type === 'paused') {
    if (statusEl) statusEl.textContent = `已暂停 ${msg.progress}/${msg.total}`;
  }
}

// ==================== 书签健康检测 ====================

let healthStartTime = null;
let healthTimerInterval = null;
let healthResults = [];

function bindHealthCheckEvents() {
  const startBtn = document.getElementById('healthStartBtn');
  const pauseBtn = document.getElementById('healthPauseBtn');
  const stopBtn = document.getElementById('healthStopBtn');
  const filterSelect = document.getElementById('healthFilterSelect');
  const selectAllBtn = document.getElementById('healthSelectAllBtn');
  const deleteSelectedBtn = document.getElementById('healthDeleteSelectedBtn');
  const exportCsvBtn = document.getElementById('healthExportCsvBtn');

  if (startBtn) startBtn.addEventListener('click', startHealthCheck);
  if (pauseBtn) pauseBtn.addEventListener('click', toggleHealthPause);
  if (stopBtn) stopBtn.addEventListener('click', stopHealthCheck);
  if (filterSelect) filterSelect.addEventListener('change', () => renderHealthResults());
  if (selectAllBtn) selectAllBtn.addEventListener('click', toggleSelectAllHealth);
  if (deleteSelectedBtn) deleteSelectedBtn.addEventListener('click', deleteSelectedHealthBookmarks);
  if (exportCsvBtn) exportCsvBtn.addEventListener('click', exportHealthCsv);
}

async function startHealthCheck() {
  const startBtn = document.getElementById('healthStartBtn');
  const pauseBtn = document.getElementById('healthPauseBtn');
  const stopBtn = document.getElementById('healthStopBtn');
  const progressCard = document.getElementById('healthProgressCard');

  startBtn.disabled = true;
  startBtn.textContent = '检测中...';
  pauseBtn.disabled = false;
  pauseBtn.textContent = '暂停';
  stopBtn.disabled = false;
  progressCard.style.display = '';

  healthStartTime = Date.now();
  healthTimerInterval = setInterval(updateHealthTimer, 1000);
  updateHealthTimer();

  const concurrency = parseInt(document.getElementById('healthConcurrency').value) || 5;
  const timeout = parseInt(document.getElementById('healthTimeout').value) || 8000;

  try {
    const resp = await chrome.runtime.sendMessage({
      type: 'BOOKMARK_HEALTH_CHECK',
      options: { concurrency, timeout }
    });

    if (resp?.ok) {
      healthResults = resp.results || [];
      renderHealthSummary(resp.summary);
      renderHealthResults();
      if (resp.isLimited) {
        showHealthLimitNotice(resp.checkedCount, resp.totalBookmarks);
      }
    } else {
      showToast('检测失败: ' + (resp?.error || '未知错误'));
    }
  } catch (e) {
    showToast('检测出错: ' + e.message);
  } finally {
    clearInterval(healthTimerInterval);
    startBtn.disabled = false;
    startBtn.textContent = '开始检测';
    pauseBtn.disabled = true;
    stopBtn.disabled = true;
  }
}

function updateHealthProgress(msg) {
  const bar = document.getElementById('healthProgressBar');
  const badge = document.getElementById('healthProgressBadge');
  const currentUrl = document.getElementById('healthCurrentUrl');
  const progressCard = document.getElementById('healthProgressCard');
  const phaseLabel = document.getElementById('healthPhaseLabel');

  if (progressCard) progressCard.style.display = '';

  if (msg.type === 'phase_change') {
    if (bar) bar.style.width = '0%';
    if (badge) badge.textContent = `0/${msg.total}`;
    if (phaseLabel) {
      phaseLabel.textContent = msg.phase === 'tab_verify' ? '阶段 2/2：浏览器验证' : '阶段 1/2：快速预筛';
      phaseLabel.className = 'health-phase-label' + (msg.phase === 'tab_verify' ? ' phase-verify' : '');
    }
    if (currentUrl) currentUrl.innerHTML = escapeHtml(msg.message || '');
    return;
  }

  if (msg.type === 'progress' || msg.type === 'complete') {
    const pct = msg.total > 0 ? (msg.progress / msg.total * 100) : 0;
    if (bar) bar.style.width = pct + '%';
    if (badge) badge.textContent = `${msg.progress}/${msg.total}`;
    if (phaseLabel) {
      if (msg.phase === 'tab_verify') {
        phaseLabel.textContent = '阶段 2/2：浏览器验证';
        phaseLabel.className = 'health-phase-label phase-verify';
      } else {
        phaseLabel.textContent = '阶段 1/2：快速预筛';
        phaseLabel.className = 'health-phase-label';
      }
    }
    if (currentUrl && msg.current) {
      const statusIcon = getStatusIcon(msg.current.status);
      currentUrl.innerHTML = `${statusIcon} ${escapeHtml(msg.current.title || msg.current.url)}`;
    }
  }

  if (msg.type === 'complete' && msg.phase === 'done') {
    if (currentUrl) currentUrl.textContent = '检测完成';
    if (phaseLabel) { phaseLabel.textContent = '完成'; phaseLabel.className = 'health-phase-label phase-done'; }
  }
}

function updateHealthTimer() {
  const el = document.getElementById('healthTimeElapsed');
  if (!el || !healthStartTime) return;
  const elapsed = Math.floor((Date.now() - healthStartTime) / 1000);
  const min = Math.floor(elapsed / 60);
  const sec = elapsed % 60;
  el.textContent = `${min}:${sec.toString().padStart(2, '0')}`;
}

async function toggleHealthPause() {
  const pauseBtn = document.getElementById('healthPauseBtn');
  if (pauseBtn.textContent === '暂停') {
    await chrome.runtime.sendMessage({ type: 'BOOKMARK_HEALTH_PAUSE' });
    pauseBtn.textContent = '继续';
  } else {
    await chrome.runtime.sendMessage({ type: 'BOOKMARK_HEALTH_RESUME' });
    pauseBtn.textContent = '暂停';
  }
}

async function stopHealthCheck() {
  await chrome.runtime.sendMessage({ type: 'BOOKMARK_HEALTH_STOP' });
  clearInterval(healthTimerInterval);
  document.getElementById('healthStartBtn').disabled = false;
  document.getElementById('healthStartBtn').textContent = '开始检测';
  document.getElementById('healthPauseBtn').disabled = true;
  document.getElementById('healthStopBtn').disabled = true;

  const resp = await chrome.runtime.sendMessage({ type: 'BOOKMARK_HEALTH_RESULTS' });
  if (resp?.ok) {
    healthResults = resp.results || [];
    renderHealthSummary(resp.summary);
    renderHealthResults();
  }
}

function getStatusIcon(status) {
  const map = {
    ok: '<span class="health-icon health-ok" title="正常">&#10004;</span>',
    redirect: '<span class="health-icon health-redirect" title="重定向">&#8594;</span>',
    not_found: '<span class="health-icon health-error" title="404 未找到">&#10008;</span>',
    server_error: '<span class="health-icon health-error" title="服务器错误">&#9888;</span>',
    timeout: '<span class="health-icon health-warn" title="超时">&#9201;</span>',
    network_error: '<span class="health-icon health-error" title="网络错误">&#9889;</span>',
    ssl_error: '<span class="health-icon health-error" title="SSL 错误">&#128274;</span>',
    skipped: '<span class="health-icon health-skip" title="已跳过">&#8212;</span>'
  };
  return map[status] || '';
}

function renderHealthSummary(summary) {
  const card = document.getElementById('healthSummaryCard');
  const grid = document.getElementById('healthSummaryGrid');
  if (!card || !grid || !summary) return;
  card.style.display = '';

  const items = [
    { label: '正常', value: summary.ok, cls: 'health-stat-ok' },
    { label: '重定向', value: summary.redirect, cls: 'health-stat-redirect' },
    { label: '404 未找到', value: summary.not_found, cls: 'health-stat-error' },
    { label: '服务器错误', value: summary.server_error, cls: 'health-stat-error' },
    { label: '超时', value: summary.timeout, cls: 'health-stat-warn' },
    { label: '网络错误', value: summary.network_error, cls: 'health-stat-error' },
    { label: 'SSL 错误', value: summary.ssl_error, cls: 'health-stat-error' },
    { label: '已跳过', value: summary.skipped, cls: 'health-stat-skip' }
  ];

  grid.innerHTML = items.map(item => `
    <div class="health-stat-item ${item.cls}">
      <div class="health-stat-value">${item.value}</div>
      <div class="health-stat-label">${item.label}</div>
    </div>
  `).join('');
}

const SEVERITY_GROUPS = [
  {
    key: 'dead',
    label: '确定失效',
    desc: '经浏览器验证，页面确实不存在，建议删除',
    icon: '&#10008;',
    cls: 'health-group-dead',
    statuses: ['not_found']
  },
  {
    key: 'server',
    label: '服务器问题',
    desc: '服务端返回错误，可能是临时故障',
    icon: '&#9888;',
    cls: 'health-group-server',
    statuses: ['server_error']
  },
  {
    key: 'connection',
    label: '连接问题',
    desc: '超时或网络不可达，建议稍后重试',
    icon: '&#9889;',
    cls: 'health-group-connection',
    statuses: ['timeout', 'network_error', 'ssl_error']
  }
];

function renderHealthResults() {
  const card = document.getElementById('healthResultsCard');
  const list = document.getElementById('healthResultsList');
  const filter = document.getElementById('healthFilterSelect')?.value || 'all_problems';
  if (!card || !list) return;

  const problemStatuses = ['not_found', 'server_error', 'timeout', 'network_error', 'ssl_error'];
  let filtered;
  if (filter === 'all_problems') {
    filtered = healthResults.filter(r => problemStatuses.includes(r.status));
  } else {
    filtered = healthResults.filter(r => r.status === filter);
  }

  if (filtered.length === 0) {
    card.style.display = healthResults.length > 0 ? '' : 'none';
    list.innerHTML = '<div class="health-empty">没有发现问题书签</div>';
    return;
  }

  card.style.display = '';

  let html = '';
  for (const group of SEVERITY_GROUPS) {
    const groupItems = filtered.filter(r => group.statuses.includes(r.status));
    if (groupItems.length === 0) continue;

    html += `
      <div class="health-group ${group.cls}">
        <div class="health-group-header" data-group="${group.key}">
          <div class="health-group-title">
            <span class="health-group-icon">${group.icon}</span>
            <span>${group.label}</span>
            <span class="health-group-count">${groupItems.length}</span>
          </div>
          <div class="health-group-desc">${group.desc}</div>
          <svg class="health-group-chevron" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="16" height="16"><path d="M6 9l6 6 6-6"/></svg>
        </div>
        <div class="health-group-body">
          ${groupItems.map(r => renderHealthResultItem(r)).join('')}
        </div>
      </div>
    `;
  }

  list.innerHTML = html;
  bindHealthResultEvents(list);
}

function renderHealthResultItem(r) {
  const statusLabel = {
    not_found: 'HTTP ' + (r.httpStatus || 404),
    server_error: 'HTTP ' + (r.httpStatus || 500),
    timeout: '连接超时',
    network_error: '网络不可达',
    ssl_error: 'SSL 证书错误'
  }[r.status] || '';

  const verifiedBadge = r.tabVerified
    ? '<span class="health-verified-badge" title="已通过浏览器环境验证">已验证</span>'
    : '';

  return `
    <div class="health-result-item" data-id="${r.id}">
      <label class="health-checkbox-label">
        <input type="checkbox" class="health-checkbox" data-bookmark-id="${r.id}">
      </label>
      <div class="health-result-status">${getStatusIcon(r.status)}</div>
      <div class="health-result-content">
        <div class="health-result-title-row">
          <a class="health-result-title health-link" href="${escapeHtml(r.url)}" target="_blank" rel="noopener" title="在新标签页中打开">${escapeHtml(r.title || '无标题')}</a>
          ${verifiedBadge}
        </div>
        <a class="health-result-url health-link" href="${escapeHtml(r.url)}" target="_blank" rel="noopener">${escapeHtml(r.url)}</a>
        <div class="health-result-detail">
          <span class="health-status-badge">${statusLabel}</span>
          ${r.error ? `<span>· ${escapeHtml(r.error)}</span>` : ''}
          ${r.redirected ? `<span>· 重定向到 ${escapeHtml(r.finalUrl || '')}</span>` : ''}
        </div>
      </div>
      <button class="btn btn-sm btn-danger health-delete-single" data-bookmark-id="${r.id}" title="删除此书签">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
      </button>
    </div>
  `;
}

function bindHealthResultEvents(list) {
  list.querySelectorAll('.health-group-header').forEach(header => {
    header.addEventListener('click', () => {
      const group = header.closest('.health-group');
      group.classList.toggle('collapsed');
    });
  });

  list.querySelectorAll('.health-link').forEach(link => {
    link.addEventListener('click', (e) => {
      e.stopPropagation();
    });
  });

  list.querySelectorAll('.health-delete-single').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const id = btn.dataset.bookmarkId;
      if (!confirm('确定要删除这个书签吗？')) return;
      const resp = await chrome.runtime.sendMessage({ type: 'DELETE_BOOKMARKS_BATCH', ids: [id] });
      if (resp?.ok) {
        healthResults = healthResults.filter(r => r.id !== id);
        renderHealthResults();
        showToast('已删除');
      } else {
        showToast('删除失败: ' + (resp?.error || '未知错误'));
      }
    });
  });

  list.querySelectorAll('.health-checkbox').forEach(cb => {
    cb.addEventListener('change', updateDeleteSelectedState);
  });
}

function toggleSelectAllHealth() {
  const checkboxes = document.querySelectorAll('#healthResultsList .health-checkbox');
  const allChecked = Array.from(checkboxes).every(cb => cb.checked);
  checkboxes.forEach(cb => { cb.checked = !allChecked; });
  updateDeleteSelectedState();
}

function updateDeleteSelectedState() {
  const checked = document.querySelectorAll('#healthResultsList .health-checkbox:checked');
  const deleteBtn = document.getElementById('healthDeleteSelectedBtn');
  if (deleteBtn) {
    deleteBtn.disabled = checked.length === 0;
    deleteBtn.textContent = checked.length > 0 ? `删除选中 (${checked.length})` : '删除选中';
  }
}

async function deleteSelectedHealthBookmarks() {
  const checked = document.querySelectorAll('#healthResultsList .health-checkbox:checked');
  const ids = Array.from(checked).map(cb => cb.dataset.bookmarkId);
  if (ids.length === 0) return;

  if (!confirm(`确定要删除选中的 ${ids.length} 个书签吗？此操作不可撤销。`)) return;

  const resp = await chrome.runtime.sendMessage({ type: 'DELETE_BOOKMARKS_BATCH', ids });
  if (resp?.ok) {
    const deletedSet = new Set(ids);
    healthResults = healthResults.filter(r => !deletedSet.has(r.id));
    renderHealthResults();
    showToast(`已删除 ${resp.deleted} 个书签`);
    const badge = document.getElementById('bookmarksBadge');
    if (badge) {
      const current = parseInt(badge.textContent) || 0;
      badge.textContent = Math.max(0, current - resp.deleted);
    }
  } else {
    showToast('批量删除失败: ' + (resp?.error || '未知错误'));
  }
}

function showHealthLimitNotice(checked, total) {
  const card = document.getElementById('healthSummaryCard');
  if (!card) return;
  const existing = card.querySelector('.health-limit-notice');
  if (existing) existing.remove();

  const notice = document.createElement('div');
  notice.className = 'health-limit-notice';
  notice.innerHTML = `
    <div class="health-limit-content">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18">
        <circle cx="12" cy="12" r="10"/>
        <path d="M12 8v4M12 16h.01"/>
      </svg>
      <span>免费版仅检测了前 ${checked} 个书签（共 ${total} 个）。<strong>升级 Pro</strong> 解锁无限制检测。</span>
      <button class="btn btn-sm btn-pro-upgrade" onclick="window.ProModule && window.ProModule.openPaymentPage()">升级 Pro</button>
    </div>
  `;
  card.appendChild(notice);
}

// ==================== Pro 会员管理 ====================

let currentProStatus = null;

function bindProEvents() {
  const upgradeBtn = document.getElementById('proUpgradeBtn');
  const trialBtn = document.getElementById('proTrialBtn');
  const restoreBtn = document.getElementById('proRestoreBtn');

  if (upgradeBtn) {
    upgradeBtn.addEventListener('click', () => {
      if (window.ProModule) window.ProModule.openPaymentPage();
    });
  }

  if (trialBtn) {
    trialBtn.addEventListener('click', () => {
      if (window.ProModule) window.ProModule.openTrialPage();
    });
  }

  if (restoreBtn) {
    restoreBtn.addEventListener('click', async () => {
      if (window.ProModule) window.ProModule.openLoginPage();
    });
  }

  refreshProStatus();
}

async function refreshProStatus() {
  if (!window.ProModule) return;

  try {
    const status = await window.ProModule.checkProAccess();
    currentProStatus = status;
    updateProUI(status);
  } catch (e) {
    console.warn('[Options] Failed to get Pro status:', e);
  }
}

function updateProUI(status) {
  const statusCard = document.getElementById('proStatusCard');
  const activeCard = document.getElementById('proActiveCard');
  const pricingSection = document.getElementById('proPricingSection');
  const navBadge = document.getElementById('proNavBadge');
  const statusTitle = document.getElementById('proStatusTitle');
  const statusDesc = document.getElementById('proStatusDesc');
  const activeDesc = document.getElementById('proActiveDesc');

  if (status.isPro) {
    if (statusCard) statusCard.style.display = 'none';
    if (activeCard) activeCard.style.display = '';
    if (pricingSection) pricingSection.style.display = 'none';
    if (navBadge) {
      navBadge.style.display = '';
      navBadge.textContent = 'Pro';
    }
    if (activeDesc && status.paidAt) {
      const paidDate = new Date(status.paidAt).toLocaleDateString();
      activeDesc.textContent = `自 ${paidDate} 起激活`;
    }
  } else {
    if (statusCard) statusCard.style.display = '';
    if (activeCard) activeCard.style.display = 'none';
    if (pricingSection) pricingSection.style.display = '';
    if (navBadge) navBadge.style.display = 'none';

    if (status.trialStartedAt) {
      const trialStart = new Date(status.trialStartedAt);
      const trialEnd = new Date(trialStart.getTime() + 7 * 24 * 60 * 60 * 1000);
      const now = new Date();
      if (now < trialEnd) {
        const daysLeft = Math.ceil((trialEnd - now) / (24 * 60 * 60 * 1000));
        if (statusTitle) statusTitle.textContent = '试用中';
        if (statusDesc) statusDesc.textContent = `免费试用还剩 ${daysLeft} 天`;
      } else {
        if (statusTitle) statusTitle.textContent = '试用已结束';
        if (statusDesc) statusDesc.textContent = '升级 Pro 继续使用高级功能';
      }
    }
  }
}

// ==================== CSV 导出 ====================

async function exportHealthCsv() {
  if (!healthResults || healthResults.length === 0) {
    showToast('没有可导出的检测结果');
    return;
  }

  const isPro = currentProStatus?.isPro;
  if (!isPro) {
    showToast('CSV 导出是 Pro 专属功能');
    if (window.ProModule) window.ProModule.openPaymentPage();
    return;
  }

  const BOM = '\uFEFF';
  const headers = ['标题', '网址', '状态', 'HTTP 状态码', '错误信息', '重定向', '最终网址', '浏览器验证'];
  const statusLabels = {
    ok: '正常', redirect: '重定向', not_found: '未找到',
    server_error: '服务器错误', timeout: '超时',
    network_error: '网络错误', ssl_error: 'SSL错误', skipped: '已跳过'
  };

  const rows = healthResults.map(r => [
    csvEscape(r.title || ''),
    csvEscape(r.url || ''),
    statusLabels[r.status] || r.status,
    r.httpStatus || '',
    csvEscape(r.error || ''),
    r.redirected ? '是' : '否',
    csvEscape(r.finalUrl || ''),
    r.tabVerified ? '是' : '否'
  ]);

  const csv = BOM + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `bookmark-health-${new Date().toISOString().slice(0, 10)}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
  showToast('CSV 导出成功');
}

function csvEscape(str) {
  if (!str) return '';
  str = String(str);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

// ==================== 定期自动健康检测 ====================

function bindAutoHealthCheckEvents() {
  const enabledToggle = document.getElementById('autoHealthEnabled');
  const intervalSelect = document.getElementById('autoHealthInterval');

  if (!enabledToggle) return;

  loadAutoHealthSettings();

  enabledToggle.addEventListener('change', async () => {
    const isPro = currentProStatus?.isPro;
    if (!isPro && enabledToggle.checked) {
      enabledToggle.checked = false;
      showToast('定期自动检测是 Pro 专属功能');
      if (window.ProModule) window.ProModule.openPaymentPage();
      return;
    }
    await saveAutoHealthSettings();
    await chrome.runtime.sendMessage({ type: 'UPDATE_AUTO_HEALTH_ALARM' });
  });

  if (intervalSelect) {
    intervalSelect.addEventListener('change', async () => {
      await saveAutoHealthSettings();
      await chrome.runtime.sendMessage({ type: 'UPDATE_AUTO_HEALTH_ALARM' });
    });
  }
}

async function loadAutoHealthSettings() {
  try {
    const result = await chrome.storage.sync.get('autoHealthCheck');
    const config = result.autoHealthCheck || { enabled: false, intervalDays: 30 };
    const enabledToggle = document.getElementById('autoHealthEnabled');
    const intervalSelect = document.getElementById('autoHealthInterval');
    const intervalRow = document.getElementById('autoHealthIntervalRow');
    const lastRunRow = document.getElementById('autoHealthLastRunRow');

    if (enabledToggle) enabledToggle.checked = config.enabled;
    if (intervalSelect) intervalSelect.value = String(config.intervalDays || 30);
    if (intervalRow) intervalRow.style.display = config.enabled ? '' : 'none';
    if (lastRunRow) lastRunRow.style.display = config.enabled ? '' : 'none';

    const local = await chrome.storage.local.get('autoHealthLastRun');
    const lastRunText = document.getElementById('autoHealthLastRunText');
    if (lastRunText && local.autoHealthLastRun) {
      lastRunText.textContent = new Date(local.autoHealthLastRun).toLocaleString();
    }
  } catch (e) {
    console.warn('[Options] loadAutoHealthSettings error:', e);
  }
}

async function saveAutoHealthSettings() {
  const enabled = document.getElementById('autoHealthEnabled')?.checked || false;
  const intervalDays = parseInt(document.getElementById('autoHealthInterval')?.value) || 30;
  const intervalRow = document.getElementById('autoHealthIntervalRow');
  const lastRunRow = document.getElementById('autoHealthLastRunRow');

  if (intervalRow) intervalRow.style.display = enabled ? '' : 'none';
  if (lastRunRow) lastRunRow.style.display = enabled ? '' : 'none';

  await chrome.storage.sync.set({ autoHealthCheck: { enabled, intervalDays } });
}

// ==================== 书签分析 ====================

let analysisData = null;

function bindAnalysisEvents() {
  const runBtn = document.getElementById('runAnalysisBtn');
  const upgradeBtn = document.getElementById('analysisUpgradeBtn');
  const trialBtn = document.getElementById('analysisTrialBtn');

  if (runBtn) runBtn.addEventListener('click', runAnalysis);
  if (upgradeBtn) upgradeBtn.addEventListener('click', () => {
    if (window.ProModule) window.ProModule.openPaymentPage();
  });
  if (trialBtn) trialBtn.addEventListener('click', () => {
    if (window.ProModule) window.ProModule.openTrialPage();
  });
}

async function initAnalysisSection() {
  if (!window.ProModule) return;

  try {
    if (!currentProStatus) {
      currentProStatus = await window.ProModule.checkProAccess();
    }
  } catch (e) {}

  const isPro = currentProStatus?.isPro;
  const actionCard = document.getElementById('analysisActionCard');
  const resultsDiv = document.getElementById('analysisResults');
  const proGate = document.getElementById('analysisProGate');

  if (isPro) {
    if (actionCard) actionCard.style.display = '';
    if (proGate) proGate.style.display = 'none';
    if (resultsDiv) resultsDiv.style.display = analysisData ? '' : 'none';
  } else {
    if (actionCard) actionCard.style.display = 'none';
    if (proGate) proGate.style.display = '';
    if (resultsDiv) resultsDiv.style.display = 'none';
  }
}

async function runAnalysis() {
  const runBtn = document.getElementById('runAnalysisBtn');
  const resultsDiv = document.getElementById('analysisResults');
  if (runBtn) { runBtn.disabled = true; runBtn.textContent = '分析中...'; }

  try {
    const resp = await chrome.runtime.sendMessage({ type: 'RUN_BOOKMARK_ANALYSIS' });
    if (resp?.ok) {
      analysisData = resp;
      if (resultsDiv) resultsDiv.style.display = '';
      renderAnalysisOverview(resp);
      renderDuplicates(resp.duplicates);
      renderDomainChart(resp.domainStats);
      renderTrendChart(resp.trendData);
    } else {
      showToast('分析失败: ' + (resp?.error || '未知错误'));
    }
  } catch (e) {
    showToast('分析出错: ' + e.message);
  } finally {
    if (runBtn) { runBtn.disabled = false; runBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="18" height="18"><path d="M18 20V10M12 20V4M6 20v-6"/></svg> 开始分析'; }
  }
}

function renderAnalysisOverview(data) {
  const grid = document.getElementById('analysisOverviewGrid');
  if (!grid) return;

  grid.innerHTML = `
    <div class="analysis-stat"><div class="analysis-stat-value">${data.totalBookmarks}</div><div class="analysis-stat-label">书签总数</div></div>
    <div class="analysis-stat"><div class="analysis-stat-value">${data.totalDomains}</div><div class="analysis-stat-label">涉及域名</div></div>
    <div class="analysis-stat analysis-stat-warn"><div class="analysis-stat-value">${data.duplicateGroups}</div><div class="analysis-stat-label">重复组</div></div>
    <div class="analysis-stat analysis-stat-warn"><div class="analysis-stat-value">${data.duplicateCount}</div><div class="analysis-stat-label">重复书签</div></div>
    <div class="analysis-stat"><div class="analysis-stat-value">${data.neverUsed}</div><div class="analysis-stat-label">从未访问</div></div>
    <div class="analysis-stat"><div class="analysis-stat-value">${data.dormant}</div><div class="analysis-stat-label">休眠 (>180天)</div></div>
  `;
}

function renderDuplicates(duplicates) {
  const list = document.getElementById('analysisDuplicatesList');
  const badge = document.getElementById('duplicateCount');
  if (!list) return;
  if (badge) badge.textContent = (duplicates || []).length;

  if (!duplicates || duplicates.length === 0) {
    list.innerHTML = '<div class="health-empty">没有发现重复书签</div>';
    return;
  }

  list.innerHTML = duplicates.map(group => `
    <div class="duplicate-group">
      <div class="duplicate-url">${escapeHtml(group.url)}</div>
      <div class="duplicate-items">
        ${group.items.map(item => `
          <div class="duplicate-item">
            <span class="duplicate-title">${escapeHtml(item.title || '无标题')}</span>
            <span class="duplicate-path">${escapeHtml(item.folderPath || '')}</span>
            <button class="btn btn-sm btn-danger duplicate-delete" data-id="${item.id}" title="删除此书签">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="12" height="12"><path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg>
            </button>
          </div>
        `).join('')}
      </div>
    </div>
  `).join('');

  list.querySelectorAll('.duplicate-delete').forEach(btn => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.id;
      if (!confirm('确定要删除这个重复书签吗？')) return;
      const resp = await chrome.runtime.sendMessage({ type: 'DELETE_BOOKMARKS_BATCH', ids: [id] });
      if (resp?.ok) {
        btn.closest('.duplicate-item').remove();
        showToast('已删除');
      }
    });
  });
}

function renderDomainChart(domainStats) {
  const container = document.getElementById('analysisDomainChart');
  if (!container || !domainStats || domainStats.length === 0) return;

  const maxCount = domainStats[0]?.count || 1;

  container.innerHTML = domainStats.map(d => `
    <div class="domain-bar-row">
      <div class="domain-bar-label" title="${escapeHtml(d.domain)}">${escapeHtml(d.domain)}</div>
      <div class="domain-bar-track">
        <div class="domain-bar-fill" style="width:${(d.count / maxCount * 100).toFixed(1)}%"></div>
      </div>
      <div class="domain-bar-count">${d.count}</div>
    </div>
  `).join('');
}

function renderTrendChart(trendData) {
  const container = document.getElementById('analysisTrendChart');
  if (!container || !trendData || trendData.length === 0) {
    if (container) container.innerHTML = '<div class="health-empty">暂无访问数据</div>';
    return;
  }

  const maxVisits = Math.max(...trendData.map(d => d.visits), 1);
  const barWidth = Math.max(100 / trendData.length, 2);

  container.innerHTML = `
    <div class="trend-chart">
      <div class="trend-bars">
        ${trendData.map(d => `
          <div class="trend-bar-col" style="width:${barWidth}%" title="${d.date}: ${d.visits} 次访问">
            <div class="trend-bar" style="height:${(d.visits / maxVisits * 100).toFixed(1)}%"></div>
          </div>
        `).join('')}
      </div>
      <div class="trend-labels">
        <span>${trendData[0]?.date || ''}</span>
        <span>${trendData[Math.floor(trendData.length / 2)]?.date || ''}</span>
        <span>${trendData[trendData.length - 1]?.date || ''}</span>
      </div>
    </div>
  `;
}
