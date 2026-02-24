// Background script for handling extension events
console.log('[BookmarkSearch] Background script loaded');

chrome.runtime.onInstalled.addListener(() => {
  console.log('[BookmarkSearch] Extension installed');
  // 延迟执行，确保 Service Worker 完全就绪
  setTimeout(() => syncAllGroups().catch(e => console.warn('[BookmarkSearch] Initial sync failed:', e.message)), 500);
});

// 书签使用状态常量
const BOOKMARK_STATUS = {
  NEVER_USED: 'never_used',
  RARELY_USED: 'rarely_used',
  DORMANT: 'dormant',
  ACTIVE: 'active'
};

// 分类阈值
const THRESHOLDS = {
  RARELY_USED_MAX: 2,
  DORMANT_DAYS: 180
};

// 获取URL的访问历史
async function getUrlStats(url) {
  return new Promise((resolve) => {
    chrome.history.getVisits({ url }, visits => {
      if (visits && visits.length > 0) {
        const lastVisit = visits[visits.length - 1].visitTime;
        resolve({
          count: visits.length,
          lastVisit: lastVisit
        });
      } else {
        resolve({ count: 0, lastVisit: null });
      }
    });
  });
}

// 书签分类函数
function categorizeBookmark(bookmark) {
  const { visitCount, lastVisit } = bookmark;
  const now = Date.now();

  if (!visitCount || visitCount === 0) {
    return BOOKMARK_STATUS.NEVER_USED;
  }

  if (visitCount <= THRESHOLDS.RARELY_USED_MAX) {
    return BOOKMARK_STATUS.RARELY_USED;
  }

  if (lastVisit) {
    const daysSinceLastVisit = (now - lastVisit) / (1000 * 60 * 60 * 24);
    if (daysSinceLastVisit > THRESHOLDS.DORMANT_DAYS) {
      return BOOKMARK_STATUS.DORMANT;
    }
  }

  return BOOKMARK_STATUS.ACTIVE;
}

// 加载书签数据
// 优化说明：
// 1. 书签本身不包含访问统计，需要从 history API 获取
// 2. 使用并发控制避免大量书签时的性能问题
// 3. 添加超时保护，避免单个请求阻塞整体
async function loadBookmarks() {
  const bookmarkTree = await chrome.bookmarks.getTree();
  const allBookmarks = [];

  function traverseBookmarks(node) {
    if (node.url) {
      allBookmarks.push(node);
    }
    if (node.children) {
      node.children.forEach(traverseBookmarks);
    }
  }

  bookmarkTree.forEach(traverseBookmarks);

  console.log('[BookmarkSearch] Found bookmarks:', allBookmarks.length);

  // 并发控制：分批处理，每批最多 50 个
  const BATCH_SIZE = 50;
  const bookmarksWithStats = [];

  for (let i = 0; i < allBookmarks.length; i += BATCH_SIZE) {
    const batch = allBookmarks.slice(i, i + BATCH_SIZE);
    const batchResults = await Promise.all(batch.map(async bookmark => {
      try {
        const stats = await getUrlStats(bookmark.url);
        const bookmarkData = {
          ...bookmark,
          visitCount: stats.count,
          lastVisit: stats.lastVisit
        };
        bookmarkData.usageStatus = categorizeBookmark(bookmarkData);
        return bookmarkData;
      } catch (error) {
        // 单个书签查询失败不影响整体
        console.warn('[BookmarkSearch] Failed to get stats for:', bookmark.url, error);
        return {
          ...bookmark,
          visitCount: 0,
          lastVisit: null,
          usageStatus: BOOKMARK_STATUS.NEVER_USED
        };
      }
    }));
    bookmarksWithStats.push(...batchResults);
  }

  // 按访问次数和最后访问时间排序
  const sorted = bookmarksWithStats.sort((a, b) => {
    if (b.visitCount !== a.visitCount) {
      return b.visitCount - a.visitCount;
    }
    return (b.lastVisit || 0) - (a.lastVisit || 0);
  });

  console.log('[BookmarkSearch] Bookmarks loaded with stats, top item:', 
    sorted[0]?.title, 'visits:', sorted[0]?.visitCount);

  return sorted;
}

// 加载标签页数据
// 优化说明：
// 1. 按最近访问时间排序（当前活动标签页优先）
// 2. 添加统一的字段映射
async function loadTabs() {
  const tabs = await chrome.tabs.query({});
  
  // 按 lastAccessed 降序排列（最近访问的在前）
  // 注意：lastAccessed 可能为 undefined（某些情况下）
  const sorted = tabs.sort((a, b) => {
    // 活动标签页优先
    if (a.active && !b.active) return -1;
    if (!a.active && b.active) return 1;
    // 然后按最近访问时间
    return (b.lastAccessed || 0) - (a.lastAccessed || 0);
  });

  // 映射字段以保持一致性
  const processed = sorted.map(tab => ({
    ...tab,
    lastVisit: tab.lastAccessed,
    visitCount: 1 // 标签页没有访问次数概念
  }));

  console.log('[BookmarkSearch] Tabs loaded:', processed.length,
    'Active:', processed.find(t => t.active)?.title);

  return processed;
}

// 加载历史记录
// 优化说明：
// 1. chrome.history.search() 已经返回了 lastVisitTime 和 visitCount，无需重复查询
// 2. 直接使用 API 返回的数据，提升性能并避免数据不一致
// 3. 确保按 lastVisitTime 降序排列，最新访问的在最前
async function loadHistory() {
  const endTime = Date.now();
  const startTime = endTime - (30 * 24 * 60 * 60 * 1000); // 30天前

  return new Promise((resolve) => {
    chrome.history.search({
      text: '',
      startTime: startTime,
      endTime: endTime,
      maxResults: 1000
    }, (historyItems) => {
      // chrome.history.search 返回的 HistoryItem 已经包含：
      // - lastVisitTime: 最后访问时间（毫秒时间戳）
      // - visitCount: 访问次数
      // - typedCount: 用户主动输入 URL 的次数
      
      // 直接使用 API 返回的数据，映射为统一格式
      const historyWithStats = historyItems.map(item => ({
        ...item,
        // 保持字段命名一致性，同时保留原始字段
        lastVisit: item.lastVisitTime,
        // visitCount 已经存在，无需额外查询
      }));

      // 按最后访问时间降序排列（最新的在最前面）
      historyWithStats.sort((a, b) => (b.lastVisitTime || 0) - (a.lastVisitTime || 0));

      console.log('[BookmarkSearch] History loaded:', historyWithStats.length, 
        'Latest:', historyWithStats[0]?.title, 
        'Time:', historyWithStats[0]?.lastVisitTime ? new Date(historyWithStats[0].lastVisitTime).toLocaleString() : 'N/A');

      resolve(historyWithStats);
    });
  });
}

// 加载下载记录
// 优化说明：
// 1. 按开始时间降序排列（最新的在前）
// 2. 映射字段名以保持与其他模式的一致性
async function loadDownloads() {
  return new Promise((resolve) => {
    chrome.downloads.search({
      limit: 1000,
      orderBy: ['-startTime']
    }, downloads => {
      const processed = (downloads || []).map(item => ({
        ...item,
        // 统一字段名，便于 UI 显示
        title: item.filename ? item.filename.split('/').pop() : '未知文件',
        lastVisit: item.startTime ? new Date(item.startTime).getTime() : null,
        visitCount: 1 // 下载次数固定为 1
      }));
      
      console.log('[BookmarkSearch] Downloads loaded:', processed.length,
        'Latest:', processed[0]?.title);
      
      resolve(processed);
    });
  });
}

// 处理消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[BookmarkSearch] Received message:', request.type);
  
  // 获取数据
  if (request.type === 'GET_DATA') {
    (async () => {
      let data = [];
      try {
        switch (request.mode) {
          case 'bookmarks':
            data = await loadBookmarks();
            break;
          case 'tabs':
            data = await loadTabs();
            break;
          case 'groups':
            await syncAllGroups();
            data = await loadGroups();
            break;
          case 'history':
            data = await loadHistory();
            break;
          case 'downloads':
            data = await loadDownloads();
            break;
        }
        console.log('[BookmarkSearch] Loaded data:', request.mode, data.length);
      } catch (error) {
        console.error('[BookmarkSearch] Error loading data:', error);
      }
      sendResponse({ data });
    })();
    return true;
  }

  // 打开结果
  if (request.type === 'OPEN_RESULT') {
    const { mode, item } = request;

    switch (mode) {
      case 'bookmarks':
      case 'history':
        if (item.url) {
          chrome.tabs.create({ url: item.url });
        }
        break;
      case 'tabs':
        if (item.id) {
          chrome.tabs.update(item.id, { active: true });
          chrome.windows.update(item.windowId, { focused: true });
        }
        break;
      case 'downloads':
        if (item.id) {
          chrome.downloads.open(item.id);
        }
        break;
    }

    sendResponse({ success: true });
    return true;
  }

  // 保存样式设置
  if (request.type === 'SAVE_STYLE') {
    chrome.storage.sync.set({ overlayStyle: request.style });
    sendResponse({ success: true });
    return true;
  }

  // 获取样式设置
  if (request.type === 'GET_STYLE') {
    chrome.storage.sync.get('overlayStyle', (result) => {
      sendResponse({ style: result.overlayStyle || 'spotlight' });
    });
    return true;
  }

  // 保存字体设置
  if (request.type === 'SAVE_FONT') {
    chrome.storage.sync.set({ overlayFont: request.font });
    sendResponse({ success: true });
    return true;
  }

  // 获取字体设置
  if (request.type === 'GET_FONT') {
    chrome.storage.sync.get('overlayFont', (result) => {
      sendResponse({ font: result.overlayFont || 'system' });
    });
    return true;
  }

  // 旧的搜索书签接口
  if (request.type === 'SEARCH_BOOKMARKS') {
    chrome.bookmarks.search(request.query)
      .then(results => sendResponse({ success: true, results }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }

  // 在隐私窗口打开
  if (request.type === 'OPEN_INCOGNITO') {
    chrome.windows.create({
      url: request.url,
      incognito: true
    });
    sendResponse({ success: true });
    return true;
  }

  // 编辑书签
  if (request.type === 'EDIT_BOOKMARK') {
    chrome.bookmarks.update(request.id, {
      title: request.title,
      url: request.url
    }, () => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true });
      }
    });
    return true;
  }

  // 删除项目
  if (request.type === 'DELETE_ITEM') {
    const { mode, item } = request;
    
    try {
      if (mode === 'bookmarks') {
        chrome.bookmarks.remove(item.id, () => {
          sendResponse({ success: !chrome.runtime.lastError });
        });
      } else if (mode === 'history') {
        chrome.history.deleteUrl({ url: item.url }, () => {
          sendResponse({ success: !chrome.runtime.lastError });
        });
      } else if (mode === 'downloads') {
        chrome.downloads.erase({ id: item.id }, () => {
          sendResponse({ success: !chrome.runtime.lastError });
        });
      } else {
        sendResponse({ success: false, error: 'Unknown mode' });
      }
    } catch (error) {
      sendResponse({ success: false, error: error.message });
    }
    return true;
  }

  // 打开设置页面
  if (request.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return true;
  }
});

// ==================== 标签页分组快照服务 ====================
const TAB_GROUP_STORAGE_KEY = 'tabGroupSnapshots';

function makeGroupStableKey(title, color) {
  return `${title || ''}_${color}`;
}

async function saveGroupSnapshot(groupId) {
  try {
    const group = await chrome.tabGroups.get(groupId);
    const tabs = await chrome.tabs.query({ groupId });
    const stableKey = makeGroupStableKey(group.title, group.color);

    const snapshot = {
      stableKey,
      title: group.title || '',
      color: group.color,
      tabs: tabs.map(t => ({
        url: t.url,
        title: t.title,
        favIconUrl: t.favIconUrl,
        id: t.id,
        windowId: t.windowId
      })),
      isOpen: true,
      lastSeen: Date.now(),
      closedAt: null,
      createdAt: null
    };

    const data = await chrome.storage.local.get(TAB_GROUP_STORAGE_KEY);
    const snapshots = data[TAB_GROUP_STORAGE_KEY] || {};

    if (snapshots[stableKey]) {
      snapshot.createdAt = snapshots[stableKey].createdAt;
    } else {
      snapshot.createdAt = Date.now();
    }

    snapshots[stableKey] = snapshot;
    await chrome.storage.local.set({ [TAB_GROUP_STORAGE_KEY]: snapshots });
    console.log('[BookmarkSearch] Group snapshot saved:', stableKey, tabs.length, 'tabs');
  } catch (e) {
    // 分组可能已被关闭
  }
}

async function handleGroupRemoved(group) {
  const stableKey = makeGroupStableKey(group.title, group.color);
  const data = await chrome.storage.local.get(TAB_GROUP_STORAGE_KEY);
  const snapshots = data[TAB_GROUP_STORAGE_KEY] || {};

  if (snapshots[stableKey]) {
    snapshots[stableKey].isOpen = false;
    snapshots[stableKey].closedAt = Date.now();
    await chrome.storage.local.set({ [TAB_GROUP_STORAGE_KEY]: snapshots });
    console.log('[BookmarkSearch] Group marked closed:', stableKey);
  }
}

async function syncAllGroups() {
  try {
    if (!chrome.tabGroups) {
      console.warn('[BookmarkSearch] tabGroups API not available');
      return;
    }
    const openGroups = await chrome.tabGroups.query({});
    const stored = await chrome.storage.local.get(TAB_GROUP_STORAGE_KEY);
    const snapshots = stored[TAB_GROUP_STORAGE_KEY] || {};

    const openKeys = new Set();
    for (const group of openGroups) {
      await saveGroupSnapshot(group.id);
      openKeys.add(makeGroupStableKey(group.title, group.color));
    }

    for (const key of Object.keys(snapshots)) {
      if (!openKeys.has(key) && snapshots[key].isOpen) {
        snapshots[key].isOpen = false;
        snapshots[key].closedAt = Date.now();
      }
    }

    await chrome.storage.local.set({ [TAB_GROUP_STORAGE_KEY]: snapshots });
    console.log('[BookmarkSearch] Full group sync complete:', openGroups.length, 'open groups');
  } catch (e) {
    console.warn('[BookmarkSearch] Group sync failed:', e.message);
  }
}

// 加载所有分组数据（供 GET_DATA 调用）
async function loadGroups() {
  try {
    const openGroups = await chrome.tabGroups.query({});
    const openGroupsWithTabs = await Promise.all(
      openGroups.map(async group => {
        const tabs = await chrome.tabs.query({ groupId: group.id });
        return {
          stableKey: makeGroupStableKey(group.title, group.color),
          title: group.title || '',
          color: group.color,
          tabs: tabs.map(t => ({
            id: t.id, url: t.url, title: t.title,
            favIconUrl: t.favIconUrl, windowId: t.windowId
          })),
          isOpen: true,
          groupId: group.id,
          windowId: group.windowId
        };
      })
    );

    const stored = await chrome.storage.local.get(TAB_GROUP_STORAGE_KEY);
    const snapshots = stored[TAB_GROUP_STORAGE_KEY] || {};

    const openKeys = new Set(openGroupsWithTabs.map(g => g.stableKey));
    const closedGroups = Object.values(snapshots)
      .filter(s => !openKeys.has(s.stableKey) && s.tabs && s.tabs.length > 0)
      .map(s => ({ ...s, isOpen: false }));

    const allGroups = [...openGroupsWithTabs, ...closedGroups];
    console.log('[BookmarkSearch] Groups loaded:', allGroups.length, '(open:', openGroupsWithTabs.length, ', saved:', closedGroups.length, ')');
    return allGroups;
  } catch (e) {
    console.error('[BookmarkSearch] loadGroups error:', e);
    return [];
  }
}

if (chrome.tabGroups) {
  chrome.tabGroups.onCreated.addListener(g => saveGroupSnapshot(g.id));
  chrome.tabGroups.onUpdated.addListener(g => saveGroupSnapshot(g.id));
  chrome.tabGroups.onRemoved.addListener(handleGroupRemoved);
}

chrome.alarms.create('syncTabGroups', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name === 'syncTabGroups') syncAllGroups();
});

chrome.runtime.onStartup.addListener(() => {
  syncAllGroups().catch(e => console.warn('[BookmarkSearch] Startup sync failed:', e.message));
});

// 注入并打开浮层的核心函数
async function injectAndToggleOverlay(tabId) {
  console.log('[BookmarkSearch] Attempting to toggle overlay in tab:', tabId);
  
  try {
    // 先尝试发送消息
    const response = await chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_OVERLAY' });
    console.log('[BookmarkSearch] Message sent successfully, response:', response);
  } catch (error) {
    console.log('[BookmarkSearch] Content script not ready, injecting...', error.message);
    
    // 注入 content script
    try {
      await chrome.scripting.executeScript({
        target: { tabId: tabId },
        files: ['js/search-parser.js', 'js/smart-sort.js', 'js/content-script.js']
      });
      console.log('[BookmarkSearch] Content script injected');
      
      // 等待一小段时间后发送消息
      await new Promise(resolve => setTimeout(resolve, 150));
      
      try {
        const response = await chrome.tabs.sendMessage(tabId, { type: 'TOGGLE_OVERLAY' });
        console.log('[BookmarkSearch] Message sent after injection, response:', response);
      } catch (msgError) {
        console.error('[BookmarkSearch] Failed to send message after injection:', msgError);
      }
    } catch (injectError) {
      console.error('[BookmarkSearch] Failed to inject content script:', injectError);
    }
  }
}

// 检查是否可以注入的页面
function canInjectIntoTab(tab) {
  if (!tab || !tab.url) return false;
  
  const url = tab.url;
  // 不能注入的页面
  if (url.startsWith('chrome://') ||
      url.startsWith('chrome-extension://') ||
      url.startsWith('edge://') ||
      url.startsWith('about:') ||
      url.startsWith('moz-extension://') ||
      url.startsWith('file://') ||
      url === 'about:blank') {
    return false;
  }
  return true;
}

// ==================== 独立搜索窗口管理 ====================
// 用于在 chrome:// 等不可注入页面上提供搜索功能
let searchWindowId = null;

/**
 * 打开独立搜索窗口（居中显示于当前窗口）
 * 窗口类型为 popup（无地址栏、无标签栏），接近 Spotlight 体验
 */
async function openSearchWindow() {
  const currentWindow = await chrome.windows.getCurrent();
  const w = 640, h = 540;
  const left = Math.round(currentWindow.left + (currentWindow.width - w) / 2);
  const top = Math.round(currentWindow.top + (currentWindow.height - h) / 2);

  console.log('[BookmarkSearch] Opening search window (centered)');

  const win = await chrome.windows.create({
    url: 'search-window.html',
    type: 'popup',
    width: w,
    height: h,
    left: left,
    top: top,
    focused: true
  });

  searchWindowId = win.id;
}

// 监听窗口关闭，清理搜索窗口引用
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === searchWindowId) {
    searchWindowId = null;
    console.log('[BookmarkSearch] Search window closed');
  }
});

/**
 * 统一入口：判断当前页面环境，路由到最佳搜索体验
 * 
 * 路由逻辑：
 * 1. 如果独立搜索窗口已打开 → 关闭它（toggle off）
 *    - 如果当前标签页可注入 → 继续在当前页打开浮层
 *    - 如果当前标签页不可注入 → 仅关闭窗口（toggle off）
 * 2. 当前标签页可注入 → 注入 Content Script 浮层（最佳 Spotlight 体验）
 * 3. 当前标签页不可注入 → 打开独立搜索窗口（优雅降级）
 */
async function ensureOverlayVisibleFromAnyPage(tab) {
  // 如果独立搜索窗口已打开，先关闭它
  if (searchWindowId) {
    try {
      await chrome.windows.get(searchWindowId);
      await chrome.windows.remove(searchWindowId);
      searchWindowId = null;
      console.log('[BookmarkSearch] Closed existing search window');

      // 如果当前标签页不可注入，仅关闭窗口（toggle off）
      if (!tab || !canInjectIntoTab(tab)) {
        return;
      }
      // 当前标签页可注入，继续往下走，在当前页打开浮层
    } catch (e) {
      // 窗口已被用户手动关闭
      searchWindowId = null;
    }
  }

  // 可注入页面 → Content Script 浮层（最佳体验）
  if (tab && canInjectIntoTab(tab)) {
    await injectAndToggleOverlay(tab.id);
    return;
  }

  // 不可注入页面 → 独立搜索窗口（优雅降级，无跳转）
  console.log('[BookmarkSearch] Cannot inject into this page:', tab?.url, '→ opening search window');
  await openSearchWindow();
}

// 点击扩展图标
chrome.action.onClicked.addListener(async (tab) => {
  console.log('[BookmarkSearch] Action clicked, tab:', tab.id, tab.url);
  await ensureOverlayVisibleFromAnyPage(tab);
});

// 监听快捷键
chrome.commands.onCommand.addListener(async (command) => {
  console.log('[BookmarkSearch] Command received:', command);
  
  // 只处理 _execute_action 命令
  if (command === '_execute_action') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    console.log('[BookmarkSearch] Current tab:', tab?.id, tab?.url);

    await ensureOverlayVisibleFromAnyPage(tab);
  }
});
