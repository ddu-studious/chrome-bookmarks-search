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
  friendLinks: [
    { name: 'Codeium', url: 'https://www.codeium.com' },
    { name: 'DeepSeek', url: 'https://www.deepseek.com' },
    { name: '爱奇艺', url: 'https://www.iqiyi.com' },
    { name: '哔哩哔哩', url: 'https://www.bilibili.com' },
    { name: 'YouTube', url: 'https://www.youtube.com' }
  ]
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
  await applyTheme(); // 应用主题设置
  await loadStats();
  bindNavigationEvents();
  bindSettingEvents();
  bindDataManagementEvents();
  bindModalEvents();
  handleHashChange();
  window.addEventListener('hashchange', handleHashChange);
  
  // 监听系统主题变化
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', async () => {
    const result = await chrome.storage.sync.get('optionsSettings');
    const settings = result.optionsSettings || {};
    if (settings.theme === 'system' || !settings.theme) {
      await applyTheme();
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
  
  // 加载对应数据
  if (hash === 'bookmarks') loadBookmarks();
  if (hash === 'history') loadHistory();
  if (hash === 'downloads') loadDownloads();
  if (hash === 'links') loadFriendLinks();
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
  
  // 加载快捷键
  loadCurrentShortcut();
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
    showStats: document.getElementById('showStats').checked
  };
  
  // 保存友情链接
  const result = await chrome.storage.sync.get('optionsSettings');
  settings.friendLinks = result.optionsSettings?.friendLinks || DEFAULT_SETTINGS.friendLinks;
  
  await chrome.storage.sync.set({ optionsSettings: settings });
  
  // 同步到旧格式（包括字体设置）
  await chrome.storage.sync.set({
    settings: {
      theme: settings.theme,
      fontSize: settings.fontSize,
      lineHeight: 'normal',
      animation: settings.animation,
      highContrast: settings.highContrast
    },
    overlayStyle: settings.uiStyle,
    overlayFont: fontFamily
  });
  
  // 立即应用主题到当前页面
  await applyTheme();
  
  showToast('设置已保存');
}

function bindSettingEvents() {
  // 设置变更自动保存
  document.querySelectorAll('.form-select, input[type="checkbox"]').forEach(el => {
    el.addEventListener('change', saveSettings);
  });
  
  // 修改快捷键
  document.getElementById('editShortcutBtn').addEventListener('click', () => {
    chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
  });
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
