// Background script for handling extension events
importScripts('js/intelligent-search.js');
importScripts('js/bookmark-health.js');
importScripts('ExtPay.js');
console.log('[BookmarkSearch] Background script loaded');

// ==================== ExtPay 初始化 ====================
const extpay = ExtPay('chrome-bookmarks-search');
extpay.startBackground();

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

const GROWTH_METRICS_KEY = 'growthMetrics';
const SHARE_RESULTS_LIMIT = 5;
const SEARCH_MODE_LABELS = {
  bookmarks: '书签',
  tabs: '标签页',
  groups: '分组',
  history: '历史记录',
  downloads: '下载记录',
  ai: 'AI 搜索'
};

function normalizeShareTitle(title, url) {
  const trimmed = String(title || '').trim();
  if (trimmed) {
    return trimmed.length > 72 ? `${trimmed.slice(0, 69)}...` : trimmed;
  }
  try {
    return new URL(url).hostname;
  } catch (_) {
    return url || '未命名结果';
  }
}

function sanitizeGrowthMetadata(metadata = {}) {
  const sanitized = {};

  if (metadata.mode && SEARCH_MODE_LABELS[metadata.mode]) {
    sanitized.mode = metadata.mode;
  }

  ['queryLength', 'totalResults', 'sharedResults'].forEach((key) => {
    const value = Number(metadata[key]);
    if (Number.isFinite(value) && value >= 0) {
      sanitized[key] = Math.min(value, 9999);
    }
  });

  return sanitized;
}

async function trackGrowthEvent(eventName, metadata = {}) {
  const stored = await chrome.storage.local.get(GROWTH_METRICS_KEY);
  const metrics = stored[GROWTH_METRICS_KEY] || { events: {}, updatedAt: null };
  const currentEvent = metrics.events[eventName] || { count: 0 };

  metrics.events[eventName] = {
    count: currentEvent.count + 1,
    lastTriggeredAt: Date.now(),
    lastMetadata: sanitizeGrowthMetadata(metadata)
  };
  metrics.updatedAt = Date.now();

  await chrome.storage.local.set({ [GROWTH_METRICS_KEY]: metrics });
  return metrics.events[eventName];
}

async function buildShareResultsPayload(request) {
  const query = String(request.query || '').trim();
  const mode = SEARCH_MODE_LABELS[request.mode] ? request.mode : 'bookmarks';
  const modeLabel = SEARCH_MODE_LABELS[mode];
  const shareableItems = (request.items || [])
    .filter(item => item && item.url)
    .slice(0, SHARE_RESULTS_LIMIT)
    .map(item => ({
      title: normalizeShareTitle(item.title || item.filename, item.url),
      url: item.url
    }));
  const totalResults = Math.max(Number(request.totalResults) || 0, shareableItems.length);
  const appName = chrome.runtime.getManifest().name || 'Chrome Bookmarks Search';
  const settingsResult = await chrome.storage.sync.get(['optionsSettings']);
  const shareAppUrl = String(settingsResult.optionsSettings?.shareAppUrl || '').trim();

  const lines = [];
  if (query) {
    lines.push(`我用 ${appName} 整理了「${query}」相关的 ${totalResults} 个结果，先分享前 ${shareableItems.length} 个：`);
  } else {
    lines.push(`我用 ${appName} 整理了 ${modeLabel} 里的 ${shareableItems.length} 个结果：`);
  }
  lines.push('');

  shareableItems.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.title}`);
    lines.push(item.url);
    if (index < shareableItems.length - 1) {
      lines.push('');
    }
  });

  lines.push('');
  lines.push('我是在浏览器里按 Alt+B 秒搜到这些链接的。');
  lines.push(`想试试的话，搜索「${appName}」即可。`);
  if (shareAppUrl) {
    lines.push(shareAppUrl);
  }

  return {
    title: query ? `分享「${query}」搜索结果` : `分享${modeLabel}搜索结果`,
    text: lines.join('\n'),
    sharedResults: shareableItems.length,
    totalResults
  };
}

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
          case 'ai': {
            const bookmarks = await loadBookmarks();
            const tabs = await loadTabs();
            const history = await loadHistory();
            const downloads = await loadDownloads();
            data = { bookmarks, tabs, history, downloads };
            break;
          }
        }
        console.log('[BookmarkSearch] Loaded data:', request.mode, request.mode === 'ai' ? 'multi-source' : data.length);
      } catch (error) {
        console.error('[BookmarkSearch] Error loading data:', error);
      }
      sendResponse({ data });
    })();
    return true;
  }

  // 历史记录建议（轻量查询，用于非 history 模式下的地址栏式提示）
  if (request.type === 'SUGGEST_HISTORY') {
    chrome.history.search({
      text: request.query || '',
      maxResults: request.maxResults || 5,
      startTime: Date.now() - (30 * 24 * 60 * 60 * 1000)
    }, (results) => {
      const suggestions = (results || []).map(item => ({
        title: item.title,
        url: item.url,
        lastVisit: item.lastVisitTime,
        visitCount: item.visitCount,
        _isSuggestion: true
      }));
      sendResponse({ suggestions });
    });
    return true;
  }

  // 打开结果
  if (request.type === 'OPEN_RESULT') {
    const { mode, item } = request;

    switch (mode) {
      case 'bookmarks':
      case 'history':
      case 'ai':
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

  // 在新标签页中打开 URL（供 content-script / search-window 使用）
  if (request.type === 'OPEN_URL') {
    chrome.tabs.create({ url: request.url });
    sendResponse({ success: true });
    return true;
  }

  // 获取设置（供 content-script 获取搜索引擎等配置）
  if (request.type === 'GET_SETTINGS') {
    chrome.storage.sync.get(['optionsSettings'], (result) => {
      sendResponse(result.optionsSettings || {});
    });
    return true;
  }

  // 打开设置页面
  if (request.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    sendResponse({ success: true });
    return true;
  }

  // 生成分享当前搜索结果的文案
  if (request.type === 'BUILD_SHARE_RESULTS_PAYLOAD') {
    (async () => {
      try {
        const payload = await buildShareResultsPayload(request);
        sendResponse({ success: true, payload });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  // 记录轻量增长事件
  if (request.type === 'TRACK_GROWTH_EVENT') {
    (async () => {
      try {
        const event = await trackGrowthEvent(request.eventName, request.metadata);
        sendResponse({ success: true, event });
      } catch (error) {
        sendResponse({ success: false, error: error.message });
      }
    })();
    return true;
  }

  if (request.type === 'GET_GROWTH_METRICS') {
    (async () => {
      const stored = await chrome.storage.local.get(GROWTH_METRICS_KEY);
      sendResponse({ success: true, metrics: stored[GROWTH_METRICS_KEY] || { events: {}, updatedAt: null } });
    })();
    return true;
  }

  // ==================== 智能搜索相关消息 ====================

  if (request.type === 'INTELLIGENT_SEARCH') {
    (async () => {
      try {
        const config = await getIntelligentSearchConfig();
        if (!config.enabled) {
          sendResponse({ ok: false, fallback: true, error: '智能搜索未启用' });
          return;
        }

        const bookmarks = await loadBookmarks();
        const history = await loadHistory();
        const tabs = await loadTabs();

        const result = await IntelligentSearch.unifiedSemanticSearch(
          request.query,
          { bookmarks, history, tabs },
          config,
          { limit: request.limit || 50, rerank: request.rerank }
        );
        sendResponse(result);
      } catch (e) {
        console.error('[BookmarkSearch] Intelligent search error:', e);
        sendResponse({ ok: false, fallback: true, error: e.message });
      }
    })();
    return true;
  }

  if (request.type === 'GET_INTELLIGENT_SEARCH_CONFIG') {
    (async () => {
      const config = await getIntelligentSearchConfig();
      const vectorCount = await IntelligentSearch.getVectorCount().catch(() => 0);
      const buildStatus = IntelligentSearch.getBuildStatus();
      sendResponse({ ok: true, data: { ...config, vectorCount, buildStatus } });
    })();
    return true;
  }

  if (request.type === 'SET_INTELLIGENT_SEARCH_CONFIG') {
    (async () => {
      try {
        await setIntelligentSearchConfig(request.config);
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.type === 'BUILD_EMBEDDING_INDEX') {
    (async () => {
      try {
        chrome.alarms.create('embeddingBuildResume', { periodInMinutes: 1 });
        const config = await getIntelligentSearchConfig();
        const bookmarks = await loadBookmarks();
        const result = await IntelligentSearch.buildEmbeddingIndex(bookmarks, config, broadcastBuildProgress);
        chrome.alarms.clear('embeddingBuildResume');
        await setIntelligentSearchConfig({ lastBuildProgress: 100 });
        sendResponse({ ok: true, ...result });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.type === 'RESUME_EMBEDDING_BUILD') {
    (async () => {
      try {
        const config = await getIntelligentSearchConfig();
        const result = await IntelligentSearch.resumeBuild(config, broadcastBuildProgress);
        sendResponse({ ok: true, ...result });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.type === 'PAUSE_EMBEDDING_BUILD') {
    IntelligentSearch.pauseEmbeddingBuild();
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'CLEAR_EMBEDDING_INDEX') {
    (async () => {
      try {
        await IntelligentSearch.clearBuildState();
        const db = await new Promise((resolve, reject) => {
          const req = indexedDB.open('IntelligentSearchIndex', 1);
          req.onsuccess = () => resolve(req.result);
          req.onerror = () => reject(req.error);
        });
        const tx = db.transaction(['vectors', 'queryCache'], 'readwrite');
        tx.objectStore('vectors').clear();
        tx.objectStore('queryCache').clear();
        await new Promise((resolve, reject) => {
          tx.oncomplete = resolve;
          tx.onerror = () => reject(tx.error);
        });
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.type === 'VERIFY_API_KEY') {
    (async () => {
      try {
        const result = await IntelligentSearch.verifyApiKey(request.config);
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, message: e.message });
      }
    })();
    return true;
  }

  if (request.type === 'EXTRACT_AND_SUMMARIZE') {
    (async () => {
      try {
        const config = await getIntelligentSearchConfig();
        const result = await IntelligentSearch.extractAndSummarize(request.bookmarkId, config);
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.type === 'BATCH_EXTRACT_SUMMARIES') {
    (async () => {
      try {
        const config = await getIntelligentSearchConfig();
        const bookmarks = await loadBookmarks();
        const ids = bookmarks.map(b => b.id).filter(Boolean);
        const result = await IntelligentSearch.batchExtractSummaries(ids, config, broadcastSummaryProgress);
        sendResponse({ ok: true, ...result });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.type === 'PAUSE_SUMMARY_BATCH') {
    IntelligentSearch.pauseSummaryBatch();
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'GET_SUMMARY_BATCH_STATUS') {
    sendResponse({ ok: true, ...IntelligentSearch.getSummaryBatchStatus() });
    return true;
  }

  if (request.type === 'GET_AI_RECOMMENDATIONS') {
    (async () => {
      try {
        const config = await getIntelligentSearchConfig();
        if (!config.enabled) {
          sendResponse({ ok: false, error: '智能搜索未启用' });
          return;
        }
        const bookmarks = await loadBookmarks();
        const result = await IntelligentSearch.getRecommendations(
          request.currentUrl,
          request.currentTitle,
          bookmarks,
          config,
          request.topK || 8
        );
        sendResponse(result);
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.type === 'GET_BOOKMARK_SUMMARY') {
    (async () => {
      try {
        const result = await IntelligentSearch.getBookmarkSummary(request.bookmarkId);
        sendResponse({ ok: true, data: result });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.type === 'GET_EMBEDDING_STATUS') {
    (async () => {
      try {
        const vectorCount = await IntelligentSearch.getVectorCount();
        const buildStatus = IntelligentSearch.getBuildStatus();
        const persistedState = await IntelligentSearch.loadBuildState();
        sendResponse({ ok: true, vectorCount, buildStatus, persistedState });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  // ==================== Pro 会员状态 ====================

  if (request.type === 'CHECK_PRO_STATUS') {
    (async () => {
      try {
        const user = await extpay.getUser();
        sendResponse({
          ok: true,
          paid: !!user.paid,
          paidAt: user.paidAt ? user.paidAt.toISOString() : null,
          installedAt: user.installedAt ? user.installedAt.toISOString() : null,
          trialStartedAt: user.trialStartedAt ? user.trialStartedAt.toISOString() : null
        });
      } catch (e) {
        console.warn('[BookmarkSearch] ExtPay getUser error:', e);
        sendResponse({ ok: false, error: String(e) });
      }
    })();
    return true;
  }

  if (request.type === 'OPEN_PAYMENT_PAGE') {
    extpay.openPaymentPage();
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'OPEN_TRIAL_PAGE') {
    extpay.openTrialPage('7 day');
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'OPEN_LOGIN_PAGE') {
    extpay.openLoginPage();
    sendResponse({ ok: true });
    return true;
  }

  // ==================== 书签健康检测 ====================

  if (request.type === 'BOOKMARK_HEALTH_CHECK') {
    (async () => {
      try {
        let bookmarks = await loadBookmarks();

        // Pro Feature Gating: 免费用户限制 50 个书签
        let isLimited = false;
        let totalBeforeLimit = bookmarks.length;
        try {
          const user = await extpay.getUser();
          if (!user.paid) {
            const FREE_LIMIT = 50;
            if (bookmarks.length > FREE_LIMIT) {
              isLimited = true;
              bookmarks = bookmarks.slice(0, FREE_LIMIT);
            }
          }
        } catch (e) {
          const FREE_LIMIT = 50;
          if (bookmarks.length > FREE_LIMIT) {
            isLimited = true;
            bookmarks = bookmarks.slice(0, FREE_LIMIT);
          }
        }

        const result = await BookmarkHealth.runBatchCheck(
          bookmarks,
          request.options || {},
          (progress) => {
            chrome.runtime.sendMessage({
              type: 'BOOKMARK_HEALTH_PROGRESS',
              ...progress
            }).catch(() => {});
          }
        );
        sendResponse({
          ok: true,
          ...result,
          isLimited,
          totalBookmarks: totalBeforeLimit,
          checkedCount: bookmarks.length
        });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  if (request.type === 'BOOKMARK_HEALTH_STATUS') {
    sendResponse({ ok: true, ...BookmarkHealth.getStatus() });
    return true;
  }

  if (request.type === 'BOOKMARK_HEALTH_PAUSE') {
    BookmarkHealth.pause();
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'BOOKMARK_HEALTH_RESUME') {
    BookmarkHealth.resume();
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'BOOKMARK_HEALTH_STOP') {
    BookmarkHealth.stop();
    sendResponse({ ok: true });
    return true;
  }

  if (request.type === 'BOOKMARK_HEALTH_RESULTS') {
    sendResponse({ ok: true, ...BookmarkHealth.getResults() });
    return true;
  }

  if (request.type === 'DELETE_BOOKMARKS_BATCH') {
    (async () => {
      try {
        const ids = request.ids || [];
        let deleted = 0;
        let errors = [];
        for (const id of ids) {
          try {
            await chrome.bookmarks.remove(id);
            deleted++;
          } catch (e) {
            errors.push({ id, error: e.message });
          }
        }
        sendResponse({ ok: true, deleted, errors });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  // ==================== 书签分析 ====================

  if (request.type === 'RUN_BOOKMARK_ANALYSIS') {
    (async () => {
      try {
        const user = await extpay.getUser().catch(() => null);
        if (!user?.paid) {
          sendResponse({ ok: false, error: 'Pro 专属功能' });
          return;
        }

        const bookmarks = await loadBookmarks();

        const urlMap = new Map();
        const domainMap = new Map();
        const folderMap = new Map();

        async function buildFolderPath(id) {
          if (folderMap.has(id)) return folderMap.get(id);
          try {
            const nodes = await chrome.bookmarks.get(id);
            if (!nodes || !nodes[0]) return '';
            const node = nodes[0];
            if (!node.parentId || node.parentId === '0') {
              folderMap.set(id, node.title || '');
              return node.title || '';
            }
            const parentPath = await buildFolderPath(node.parentId);
            const fullPath = parentPath ? parentPath + ' / ' + node.title : node.title;
            folderMap.set(id, fullPath);
            return fullPath;
          } catch { return ''; }
        }

        for (const bm of bookmarks) {
          if (!bm.url) continue;
          try {
            const parsed = new URL(bm.url);
            const normalizedUrl = parsed.origin + parsed.pathname.replace(/\/+$/, '') + parsed.search;

            if (!urlMap.has(normalizedUrl)) urlMap.set(normalizedUrl, []);
            urlMap.get(normalizedUrl).push(bm);

            const domain = parsed.hostname.replace(/^www\./, '');
            domainMap.set(domain, (domainMap.get(domain) || 0) + 1);
          } catch {}
        }

        const duplicates = [];
        for (const [url, items] of urlMap) {
          if (items.length < 2) continue;
          const enriched = [];
          for (const item of items) {
            const folderPath = item.parentId ? await buildFolderPath(item.parentId) : '';
            enriched.push({ id: item.id, title: item.title, url: item.url, folderPath });
          }
          duplicates.push({ url, items: enriched });
        }

        const domainStats = Array.from(domainMap.entries())
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([domain, count]) => ({ domain, count }));

        let trendData = [];
        try {
          const now = Date.now();
          const thirtyDaysAgo = now - 30 * 24 * 60 * 60 * 1000;
          const history = await new Promise(resolve => {
            chrome.history.search({ text: '', startTime: thirtyDaysAgo, maxResults: 10000 }, resolve);
          });

          const dayMap = new Map();
          for (let d = 0; d < 30; d++) {
            const date = new Date(now - d * 24 * 60 * 60 * 1000);
            const key = date.toISOString().slice(0, 10);
            dayMap.set(key, 0);
          }

          const bookmarkUrls = new Set(bookmarks.map(b => b.url).filter(Boolean));
          for (const item of history) {
            if (!bookmarkUrls.has(item.url)) continue;
            if (item.lastVisitTime) {
              const key = new Date(item.lastVisitTime).toISOString().slice(0, 10);
              if (dayMap.has(key)) dayMap.set(key, dayMap.get(key) + 1);
            }
          }

          trendData = Array.from(dayMap.entries())
            .sort((a, b) => a[0].localeCompare(b[0]))
            .map(([date, visits]) => ({ date: date.slice(5), visits }));
        } catch (e) {
          console.warn('[BookmarkSearch] Trend data error:', e);
        }

        let neverUsed = 0, dormant = 0;
        try {
          for (const bm of bookmarks) {
            if (!bm.url) continue;
            const visits = await new Promise(resolve => {
              chrome.history.getVisits({ url: bm.url }, v => resolve(v || []));
            });
            if (visits.length === 0) { neverUsed++; continue; }
            const lastVisit = Math.max(...visits.map(v => v.visitTime));
            if ((Date.now() - lastVisit) > 180 * 24 * 60 * 60 * 1000) dormant++;
          }
        } catch {}

        const duplicateCount = duplicates.reduce((sum, g) => sum + g.items.length, 0);

        sendResponse({
          ok: true,
          totalBookmarks: bookmarks.length,
          totalDomains: domainMap.size,
          duplicateGroups: duplicates.length,
          duplicateCount,
          neverUsed,
          dormant,
          duplicates,
          domainStats,
          trendData
        });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  // ==================== 自动健康检测定时器 ====================

  if (request.type === 'UPDATE_AUTO_HEALTH_ALARM') {
    (async () => {
      try {
        const result = await chrome.storage.sync.get('autoHealthCheck');
        const config = result.autoHealthCheck || { enabled: false, intervalDays: 30 };

        await chrome.alarms.clear('autoHealthCheck');
        if (config.enabled) {
          chrome.alarms.create('autoHealthCheck', {
            periodInMinutes: config.intervalDays * 24 * 60
          });
          console.log(`[BookmarkSearch] Auto health check alarm set: every ${config.intervalDays} days`);
        }
        sendResponse({ ok: true });
      } catch (e) {
        sendResponse({ ok: false, error: e.message });
      }
    })();
    return true;
  }

  // 以分组方式恢复已保存的标签页组
  // activateUrl: 可选，恢复后激活匹配此 URL 的标签页并展开分组
  if (request.type === 'RESTORE_GROUP') {
    (async () => {
      let requestSignature = '';
      try {
        const group = request.group;
        const activateUrl = request.activateUrl;
        const targetStableKey = makeGroupStableKey(group?.title, group?.color);
        const targetUrlSignature = buildGroupUrlSignature(group?.tabs || []);
        requestSignature = `${targetStableKey}::${targetUrlSignature}`;

        if (inFlightGroupRestoreMap.has(requestSignature)) {
          const inFlightResult = await inFlightGroupRestoreMap.get(requestSignature);
          sendResponse(inFlightResult);
          return;
        }

        const ensureNormalWindow = async () => {
          const normalWindows = await chrome.windows.getAll({ windowTypes: ['normal'] });
          if (normalWindows.length > 0) {
            const focused = normalWindows.find(w => w.focused);
            return (focused || normalWindows[0]).id;
          }
          const newWin = await chrome.windows.create({ type: 'normal' });
          return newWin.id;
        };

        let latestCreatedTabIds = [];

        const restoreIntoWindow = async (targetWindowId) => {
          const createdTabIds = [];
          let activateTabId = null;

          for (const tabInfo of (group.tabs || [])) {
            if (!tabInfo.url) continue;
            const tab = await chrome.tabs.create({
              url: tabInfo.url,
              active: false,
              windowId: targetWindowId
            });
            createdTabIds.push(tab.id);
            latestCreatedTabIds = [...createdTabIds];
            if (activateUrl && tabInfo.url === activateUrl) {
              activateTabId = tab.id;
            }
          }

          if (createdTabIds.length === 0) {
            return { createdTabIds: [], activateTabId: null };
          }

          const groupId = await chrome.tabs.group({
            tabIds: createdTabIds,
            createProperties: { windowId: targetWindowId }
          });

          await chrome.tabGroups.update(groupId, {
            title: group.title || '',
            color: group.color || 'grey',
            collapsed: !activateUrl
          });

          if (activateTabId) {
            await chrome.tabs.update(activateTabId, { active: true });
          }

          await chrome.windows.update(targetWindowId, { focused: true });
          latestCreatedTabIds = [...createdTabIds];
          return { createdTabIds, activateTabId };
        };

        const restoreTask = (async () => {
          // 优先复用“已打开且同组”的标签页分组，避免重复创建分组
          const openGroups = await chrome.tabGroups.query({});
          let matchedOpenGroup = null;
          for (const openGroup of openGroups) {
            const openTabs = await chrome.tabs.query({ groupId: openGroup.id });
            const openStableKey = makeGroupStableKey(openGroup.title, openGroup.color);
            const openSignature = buildGroupUrlSignature(openTabs);
            const sameByStableKey = !!targetStableKey && openStableKey === targetStableKey;
            const sameByTabSignature = !!targetUrlSignature && openSignature === targetUrlSignature;
            if (sameByStableKey || sameByTabSignature) {
              matchedOpenGroup = { group: openGroup, tabs: openTabs };
              break;
            }
          }

          if (matchedOpenGroup) {
            const { group: openGroup, tabs: openTabs } = matchedOpenGroup;
            let activateTabId = null;
            if (activateUrl) {
              const targetUrl = normalizeGroupTabUrl(activateUrl);
              const matchedTab = openTabs.find(t => normalizeGroupTabUrl(t.url) === targetUrl);
              activateTabId = matchedTab?.id || null;
            }
            if (activateTabId) {
              await chrome.tabs.update(activateTabId, { active: true });
            }
            await chrome.windows.update(openGroup.windowId, { focused: true });
            return { success: true, reused: true };
          }

          let targetWindowId = await ensureNormalWindow();

          try {
            latestCreatedTabIds = [];
            const restored = await restoreIntoWindow(targetWindowId);
            latestCreatedTabIds = restored.createdTabIds;
          } catch (firstErr) {
            const errMsg = String(firstErr?.message || '');
            const shouldRetryInFreshWindow = /Tabs can only be moved to and from normal windows/i.test(errMsg);

            if (!shouldRetryInFreshWindow) {
              throw firstErr;
            }

            // 清理第一次尝试创建但未成功分组的标签页，避免留下独立 tab
            if (latestCreatedTabIds.length > 0) {
              try {
                await chrome.tabs.remove(latestCreatedTabIds);
              } catch (_) {}
            }

            const freshWin = await chrome.windows.create({ type: 'normal' });
            targetWindowId = freshWin.id;
            latestCreatedTabIds = [];
            const restored = await restoreIntoWindow(targetWindowId);
            latestCreatedTabIds = restored.createdTabIds;
          }

          return { success: true, reused: false };
        })();

        inFlightGroupRestoreMap.set(requestSignature, restoreTask);
        const restoredResult = await restoreTask;
        sendResponse(restoredResult);
      } catch (e) {
        console.error('[BookmarkSearch] RESTORE_GROUP error:', e);
        sendResponse({ success: false, error: e.message });
      } finally {
        if (requestSignature) {
          inFlightGroupRestoreMap.delete(requestSignature);
        }
      }
    })();
    return true;
  }
});

// ==================== 构建进度广播 ====================
function broadcastBuildProgress(progress) {
  const msg = { type: 'EMBEDDING_BUILD_PROGRESS', ...progress };
  chrome.runtime.sendMessage(msg).catch(() => {});
  chrome.tabs.query({}, (tabs) => {
    (tabs || []).forEach(tab => {
      chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
    });
  });
}

function broadcastSummaryProgress(progress) {
  const msg = { type: 'SUMMARY_BATCH_PROGRESS', ...progress };
  chrome.runtime.sendMessage(msg).catch(() => {});
  chrome.tabs.query({}, (tabs) => {
    (tabs || []).forEach(tab => {
      chrome.tabs.sendMessage(tab.id, msg).catch(() => {});
    });
  });
}

// ==================== 智能搜索配置管理 ====================

async function getIntelligentSearchConfig() {
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

async function setIntelligentSearchConfig(newConfig) {
  const result = await chrome.storage.sync.get(['settings']);
  const settings = result.settings || {};
  settings.intelligentSearch = {
    ...(settings.intelligentSearch || {}),
    ...newConfig
  };
  await chrome.storage.sync.set({ settings });
}

// ==================== 标签页分组快照服务 ====================
const TAB_GROUP_STORAGE_KEY = 'tabGroupSnapshots';
const inFlightGroupRestoreMap = new Map();

function makeGroupStableKey(title, color) {
  return `${title || ''}_${color}`;
}

function normalizeGroupTabUrl(rawUrl) {
  if (!rawUrl) return '';
  try {
    const parsed = new URL(rawUrl);
    const pathname = (parsed.pathname || '/').replace(/\/+$/, '') || '/';
    return `${parsed.hostname.toLowerCase()}${pathname}${parsed.search}`;
  } catch (_) {
    return String(rawUrl);
  }
}

function buildGroupUrlSignature(tabInfos) {
  return (tabInfos || [])
    .map(t => normalizeGroupTabUrl(t.url))
    .filter(Boolean)
    .sort()
    .join('\n');
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
    const openSignatures = new Set(openGroupsWithTabs.map(g => buildGroupUrlSignature(g.tabs)));
    const closedGroups = Object.values(snapshots)
      .filter(s => {
        if (!s.tabs || s.tabs.length === 0) return false;
        if (openKeys.has(s.stableKey)) return false;
        const signature = buildGroupUrlSignature(s.tabs);
        return !openSignatures.has(signature);
      })
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

// 监听书签变化，更新 AI 索引
chrome.bookmarks.onCreated.addListener((id, bookmark) => {
  getIntelligentSearchConfig().then(config => {
    if (config.enabled && config.aiApiKey && bookmark.url) {
      IntelligentSearch.handleBookmarkCreated(bookmark, config);
    }
  }).catch(() => {});
});

chrome.bookmarks.onRemoved.addListener((id) => {
  IntelligentSearch.handleBookmarkRemoved(id).catch(() => {});
});

chrome.bookmarks.onChanged.addListener((id, changeInfo) => {
  chrome.bookmarks.get(id).then(([bookmark]) => {
    if (bookmark) {
      getIntelligentSearchConfig().then(config => {
        if (config.enabled && config.aiApiKey) {
          IntelligentSearch.handleBookmarkChanged(bookmark, config);
        }
      });
    }
  }).catch(() => {});
});

chrome.alarms.create('syncTabGroups', { periodInMinutes: 5 });
chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'syncTabGroups') syncAllGroups();
  if (alarm.name === 'autoHealthCheck') {
    try {
      const user = await extpay.getUser().catch(() => null);
      if (!user?.paid) return;
      console.log('[BookmarkSearch] Running auto health check...');
      const bookmarks = await loadBookmarks();
      const result = await BookmarkHealth.runBatchCheck(bookmarks, { concurrency: 3, timeout: 10000 }, () => {});
      const problemCount = (result.results || []).filter(r =>
        ['not_found', 'server_error', 'timeout', 'network_error', 'ssl_error'].includes(r.status)
      ).length;
      await chrome.storage.local.set({
        autoHealthLastRun: Date.now(),
        autoHealthLastResult: { summary: result.summary, problemCount, total: bookmarks.length }
      });
      if (problemCount > 0) {
        chrome.action.setBadgeText({ text: String(problemCount) });
        chrome.action.setBadgeBackgroundColor({ color: '#e53935' });
      }
      console.log(`[BookmarkSearch] Auto health check done: ${problemCount} problems found`);
    } catch (e) {
      console.warn('[BookmarkSearch] Auto health check failed:', e.message);
    }
  }
  if (alarm.name === 'embeddingBuildResume') {
    try {
      const persistedState = await IntelligentSearch.loadBuildState();
      if (persistedState && persistedState.status === 'running') {
        console.log('[BookmarkSearch] Alarm: resuming embedding build');
        const config = await getIntelligentSearchConfig();
        if (config.enabled && config.aiApiKey) {
          await IntelligentSearch.resumeBuild(config, broadcastBuildProgress);
        }
      }
    } catch (e) {
      console.warn('[BookmarkSearch] Alarm resume build failed:', e.message);
    }
  }
});

chrome.runtime.onStartup.addListener(async () => {
  syncAllGroups().catch(e => console.warn('[BookmarkSearch] Startup sync failed:', e.message));

  try {
    const user = await extpay.getUser().catch(() => null);
    if (user?.trialStartedAt && !user.paid) {
      const trialEnd = new Date(user.trialStartedAt.getTime() + 7 * 24 * 60 * 60 * 1000);
      const daysLeft = Math.ceil((trialEnd - Date.now()) / (24 * 60 * 60 * 1000));
      if (daysLeft <= 2 && daysLeft > 0) {
        chrome.action.setBadgeText({ text: `${daysLeft}d` });
        chrome.action.setBadgeBackgroundColor({ color: '#ff9800' });
      } else if (daysLeft <= 0) {
        chrome.action.setBadgeText({ text: '' });
      }
    }
  } catch (e) { console.warn('[BookmarkSearch] Trial check failed:', e.message); }

  try {
    const ahResult = await chrome.storage.sync.get('autoHealthCheck');
    const ahConfig = ahResult.autoHealthCheck || { enabled: false, intervalDays: 30 };
    if (ahConfig.enabled) {
      chrome.alarms.create('autoHealthCheck', { periodInMinutes: ahConfig.intervalDays * 24 * 60 });
    }
  } catch (e) { console.warn('[BookmarkSearch] Auto health alarm restore failed:', e.message); }
  try {
    const persistedState = await IntelligentSearch.loadBuildState();
    if (persistedState && persistedState.status === 'running') {
      console.log('[BookmarkSearch] Startup: found interrupted build, scheduling alarm to resume');
      chrome.alarms.create('embeddingBuildResume', { delayInMinutes: 0.1 });
    }
  } catch (e) {
    console.warn('[BookmarkSearch] Startup build check failed:', e.message);
  }
});

// ==================== 搜索窗口模式管理 ====================
let searchWindowId = null;

async function getSearchWindowMode() {
  const result = await chrome.storage.sync.get(['optionsSettings', 'settings']);
  const opts = result.optionsSettings || {};
  const legacy = result.settings || {};
  return opts.searchWindowMode || legacy.searchWindowMode || 'window';
}

async function applySearchWindowMode(mode) {
  if (mode === 'popup') {
    await chrome.action.setPopup({ popup: 'popup.html' });
  } else {
    await chrome.action.setPopup({ popup: '' });
  }
}

async function initSearchWindowMode() {
  const mode = await getSearchWindowMode();
  await applySearchWindowMode(mode);
}

initSearchWindowMode();

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'sync') return;
  const relevant = changes.optionsSettings || changes.settings;
  if (!relevant) return;

  const newVal = relevant.newValue || {};
  const oldVal = relevant.oldValue || {};
  const newMode = newVal.searchWindowMode;
  const oldMode = oldVal.searchWindowMode;

  if (newMode && newMode !== oldMode) {
    applySearchWindowMode(newMode);
  }
});

// ==================== 独立搜索窗口 ====================
async function openSearchWindow() {
  const currentWindow = await chrome.windows.getCurrent();
  const w = 640, h = 540;
  const left = Math.round(currentWindow.left + (currentWindow.width - w) / 2);
  const top = Math.round(currentWindow.top + (currentWindow.height - h) / 2);

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

chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === searchWindowId) {
    searchWindowId = null;
  }
});

async function toggleSearchWindow() {
  if (searchWindowId) {
    try {
      const win = await chrome.windows.get(searchWindowId);
      if (win.focused) {
        await chrome.windows.remove(searchWindowId);
        searchWindowId = null;
      } else {
        await chrome.windows.update(searchWindowId, { focused: true });
      }
      return;
    } catch (e) {
      searchWindowId = null;
    }
  }
  await openSearchWindow();
}

// action.onClicked 仅在未设置 popup 时触发（即 window 模式）
chrome.action.onClicked.addListener(() => toggleSearchWindow());

chrome.commands.onCommand.addListener(async (command) => {
  if (command === '_execute_action') {
    const mode = await getSearchWindowMode();
    if (mode === 'window') {
      toggleSearchWindow();
    }
  }
});
