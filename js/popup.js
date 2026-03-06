document.addEventListener('DOMContentLoaded', async function() {
  const searchInput = document.getElementById('searchInput');
  const resultsContainer = document.getElementById('results');
  const totalCountElement = document.getElementById('totalCount');
  const searchStatsElement = document.getElementById('searchStats');
  const modeLabel = document.getElementById('modeLabel');
  const tabBtns = document.querySelectorAll('.tab-btn');
  
  let selectedIndex = -1;
  let currentResults = [];
  let currentMode = 'bookmarks';
  let allBookmarks = [];
  let allTabs = [];
  let allGroups = [];
  let allHistory = [];
  let allDownloads = [];
  let allAiData = {};
  let visitCounts = new Map();
  let searchDebounceTimer = null;
  let aiSearchDebounceTimer = null;
  
  // 书签使用状态常量
  const BOOKMARK_STATUS = {
    NEVER_USED: 'never_used',
    RARELY_USED: 'rarely_used',
    DORMANT: 'dormant',
    ACTIVE: 'active'
  };
  
  // 分类阈值
  const THRESHOLDS = {
    RARELY_USED_MAX: 2,        // 访问次数 <= 2 视为很少使用
    DORMANT_DAYS: 180          // 180天未访问视为休眠
  };
  
  // 当前筛选状态
  let currentFilter = 'all';

  // 格式化时间
  function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    
    if (diff < 60000) { // 1分钟内
      return '刚刚';
    } else if (diff < 3600000) { // 1小时内
      return `${Math.floor(diff / 60000)}分钟前`;
    } else if (diff < 86400000) { // 1天内
      return `${Math.floor(diff / 3600000)}小时前`;
    } else if (diff < 604800000) { // 1周内
      return `${Math.floor(diff / 86400000)}天前`;
    } else {
      return date.toLocaleDateString();
    }
  }
  
  // 格式化添加日期（用于书签添加时间）
  function formatAddedDate(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    
    if (days < 1) {
      return '今天';
    } else if (days < 7) {
      return `${days}天前`;
    } else if (days < 30) {
      return `${Math.floor(days / 7)}周前`;
    } else if (days < 365) {
      return `${Math.floor(days / 30)}个月前`;
    } else {
      const years = Math.floor(days / 365);
      return years === 1 ? '1年前' : `${years}年前`;
    }
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
    
    // 从未使用
    if (!visitCount || visitCount === 0) {
      return BOOKMARK_STATUS.NEVER_USED;
    }
    
    // 很少使用
    if (visitCount <= THRESHOLDS.RARELY_USED_MAX) {
      return BOOKMARK_STATUS.RARELY_USED;
    }
    
    // 休眠（超过180天未访问）
    if (lastVisit) {
      const daysSinceLastVisit = (now - lastVisit) / (1000 * 60 * 60 * 24);
      if (daysSinceLastVisit > THRESHOLDS.DORMANT_DAYS) {
        return BOOKMARK_STATUS.DORMANT;
      }
    }
    
    // 活跃
    return BOOKMARK_STATUS.ACTIVE;
  }
  
  // 按使用状态筛选书签
  function filterByUsageStatus(bookmarks, filter) {
    if (filter === 'all') return bookmarks;
    return bookmarks.filter(b => b.usageStatus === filter);
  }
  
  // 更新筛选器计数
  function updateFilterCounts() {
    const counts = {
      never_used: 0,
      rarely_used: 0,
      dormant: 0
    };
    
    allBookmarks.forEach(b => {
      if (counts.hasOwnProperty(b.usageStatus)) {
        counts[b.usageStatus]++;
      }
    });
    
    // 更新 UI
    const neverUsedBtn = document.querySelector('[data-filter="never_used"] .filter-count');
    const rarelyUsedBtn = document.querySelector('[data-filter="rarely_used"] .filter-count');
    const dormantBtn = document.querySelector('[data-filter="dormant"] .filter-count');
    
    if (neverUsedBtn) neverUsedBtn.textContent = counts.never_used;
    if (rarelyUsedBtn) rarelyUsedBtn.textContent = counts.rarely_used;
    if (dormantBtn) dormantBtn.textContent = counts.dormant;
  }
  
  // 更新筛选器显示状态
  function updateFiltersVisibility() {
    const filtersContainer = document.getElementById('bookmarkFilters');
    if (filtersContainer) {
      filtersContainer.style.display = currentMode === 'bookmarks' ? 'flex' : 'none';
    }
  }
  
  // 初始化筛选器
  function initBookmarkFilters() {
    const filterBtns = document.querySelectorAll('.filter-btn');
    
    filterBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const filter = btn.dataset.filter;
        
        // 更新 UI
        filterBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // 更新筛选状态
        currentFilter = filter;
        
        // 重新搜索以应用筛选
        const searchInput = document.getElementById('searchInput');
        search(searchInput.value);
      });
    });
  }

  // 加载书签数据
  async function loadBookmarks() {
    const bookmarkTree = await chrome.bookmarks.getTree();
    allBookmarks = [];
    
    function traverseBookmarks(node) {
      if (node.url) {
        allBookmarks.push(node);
      }
      if (node.children) {
        node.children.forEach(traverseBookmarks);
      }
    }
    
    bookmarkTree.forEach(traverseBookmarks);
    
    // 获取所有书签的访问统计并分类
    const statsPromises = allBookmarks.map(async bookmark => {
      const stats = await getUrlStats(bookmark.url);
      const bookmarkData = {
        ...bookmark,
        visitCount: stats.count,
        lastVisit: stats.lastVisit
      };
      // 添加使用状态分类
      bookmarkData.usageStatus = categorizeBookmark(bookmarkData);
      return bookmarkData;
    });
    
    // 等待所有统计数据加载完成
    const bookmarksWithStats = await Promise.all(statsPromises);
    
    // 按访问次数和最后访问时间排序
    allBookmarks = bookmarksWithStats.sort((a, b) => {
      if (b.visitCount !== a.visitCount) {
        return b.visitCount - a.visitCount;
      }
      return (b.lastVisit || 0) - (a.lastVisit || 0);
    });

    // 更新筛选器计数
    updateFilterCounts();
    
    totalCountElement.textContent = allBookmarks.length;
    if (currentMode === 'bookmarks') {
      // 应用当前筛选器
      const filteredBookmarks = filterByUsageStatus(allBookmarks, currentFilter);
      displayResults(filteredBookmarks);
    }
  }

  // 加载标签页数据
  function loadTabs() {
    chrome.tabs.query({}).then(tabs => {
      allTabs = tabs;
      totalCountElement.textContent = tabs.length;
      if (currentMode === 'tabs') {
        displayResults(tabs);
      }
    });
  }

  // 加载历史记录
  async function loadHistory() {
    const endTime = new Date().getTime();
    const startTime = endTime - (30 * 24 * 60 * 60 * 1000); // 最近30天的历史记录
    
    chrome.history.search({
      text: '',
      startTime: startTime,
      endTime: endTime,
      maxResults: 1000
    }, async (historyItems) => {
      // 按访问时间倒序排序
      historyItems.sort((a, b) => b.lastVisitTime - a.lastVisitTime);

      // 获取每个历史记录的访问次数
      const historyWithStats = await Promise.all(historyItems.map(async item => {
        const stats = await getUrlStats(item.url);
        return {
          ...item,
          visitCount: stats.count,
          lastVisit: stats.lastVisit
        };
      }));

      allHistory = historyWithStats;
      totalCountElement.textContent = allHistory.length;
      if (currentMode === 'history') {
        displayResults(allHistory);
      }
    });
  }

  // 加载下载记录
  async function loadDownloads() {
    chrome.downloads.search({
      limit: 1000,
      orderBy: ['-startTime']  // 使用 Chrome API 内置的排序功能，-表示倒序
    }, downloads => {
      allDownloads = downloads;
      totalCountElement.textContent = downloads.length;
      if (currentMode === 'downloads') {
        displayResults(downloads);
      }
    });
  }

  // 分组颜色映射（CSS 变量名）
  const GROUP_COLORS = {
    grey: '#5f6368', blue: '#1a73e8', red: '#d93025',
    yellow: '#f9ab00', green: '#188038', pink: '#d01884',
    purple: '#a142f4', cyan: '#007b83', orange: '#e8710a'
  };

  async function shouldRestoreWholeGroupOnChildClick() {
    try {
      const currentSettings = await window.settings.get();
      return currentSettings.groupChildClickRestoreAll !== false;
    } catch (_) {
      return true;
    }
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

  function showToast(message) {
    let toast = document.getElementById('popupToast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'popupToast';
      toast.style.cssText = `
        position: fixed;
        left: 50%;
        bottom: 16px;
        transform: translateX(-50%);
        background: rgba(32,33,36,0.92);
        color: #fff;
        padding: 8px 12px;
        border-radius: 8px;
        font-size: 12px;
        z-index: 9999;
        opacity: 0;
        transition: opacity 0.2s ease;
        pointer-events: none;
        max-width: 90%;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      `;
      document.body.appendChild(toast);
    }

    toast.textContent = message;
    toast.style.opacity = '1';
    setTimeout(() => {
      toast.style.opacity = '0';
    }, 2600);
  }

  // 加载分组数据
  async function loadGroups() {
    try {
      const openGroups = await chrome.tabGroups.query({});
      const openGroupsWithTabs = await Promise.all(
        openGroups.map(async group => {
          const tabs = await chrome.tabs.query({ groupId: group.id });
          return {
            stableKey: `${group.title || ''}_${group.color}`,
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

      const data = await chrome.storage.local.get('tabGroupSnapshots');
      const snapshots = data.tabGroupSnapshots || {};

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

      allGroups = [...openGroupsWithTabs, ...closedGroups];
      totalCountElement.textContent = allGroups.length;

      if (currentMode === 'groups') {
        displayGroupResults(allGroups);
      }
    } catch (e) {
      console.error('[BookmarkSearch] loadGroups error:', e);
      allGroups = [];
      if (currentMode === 'groups') {
        displayGroupResults([]);
      }
    }
  }

  // 分组穿透搜索
  function searchGroups(query, groups) {
    if (!query || !query.trim()) return groups;
    const keywords = query.toLowerCase().split(/\s+/).filter(Boolean);

    return groups.map(group => {
      const titleText = (group.title || '').toLowerCase();
      const titleMatch = keywords.every(kw => titleText.includes(kw));
      if (titleMatch) return { ...group };

      const matchedTabs = group.tabs.filter(tab => {
        const tabTitle = (tab.title || '').toLowerCase();
        const tabUrl = (tab.url || '').toLowerCase();
        return keywords.every(kw => tabTitle.includes(kw) || tabUrl.includes(kw));
      });
      if (matchedTabs.length > 0) return { ...group, tabs: matchedTabs };
      return null;
    }).filter(Boolean);
  }

  // 显示分组结果（树状 UI）
  function displayGroupResults(groups) {
    const resultsList = document.getElementById('resultsList');
    if (!resultsList) return;
    resultsList.innerHTML = '';
    currentResults = groups;

    if (groups.length === 0) {
      resultsList.innerHTML = `
        <div class="groups-empty-state">
          <div class="empty-icon">📂</div>
          <div class="empty-text">没有找到标签页分组</div>
          <div class="empty-hint">在 Chrome 中创建标签页分组后，这里会自动记录</div>
        </div>`;
      selectedIndex = -1;
      return;
    }

    const isSearching = document.getElementById('searchInput').value.trim().length > 0;
    const savedCount = groups.filter(g => !g.isOpen).length;
    const openCount = groups.filter(g => g.isOpen).length;

    if (!isSearching && openCount > 0 && savedCount === 0) {
      chrome.storage.local.get('groupsColdStartDismissed', (res) => {
        if (res.groupsColdStartDismissed) return;
        const existing = resultsList.querySelector('.groups-cold-start-tip');
        if (existing) return;
        const tip = document.createElement('div');
        tip.className = 'groups-cold-start-tip';
        tip.innerHTML = `
          <div class="tip-content">
            <span class="tip-icon">💡</span>
            <span class="tip-text">仅显示当前打开的分组。Chrome 不允许扩展读取已关闭的分组 — 请逐个打开书签栏的已保存分组，打开一次后即可被永久记录。</span>
            <span class="tip-dismiss" title="不再提示">✕</span>
          </div>`;
        resultsList.insertBefore(tip, resultsList.firstChild);
        tip.querySelector('.tip-dismiss').addEventListener('click', (e) => {
          e.stopPropagation();
          chrome.storage.local.set({ groupsColdStartDismissed: true });
          tip.remove();
        });
      });
    }

    groups.forEach((group, groupIndex) => {
      const header = document.createElement('div');
      header.className = 'group-header' + (isSearching ? '' : ' collapsed-header');
      header.dataset.groupIndex = groupIndex;

      const colorDot = document.createElement('span');
      colorDot.className = 'group-color-dot';
      colorDot.style.background = GROUP_COLORS[group.color] || GROUP_COLORS.grey;

      const title = document.createElement('span');
      title.className = 'group-title';
      title.textContent = group.title || '未命名分组';

      const badge = document.createElement('span');
      badge.className = `group-status-badge ${group.isOpen ? 'open' : 'saved'}`;
      badge.textContent = group.isOpen ? '打开' : '已保存';

      const count = document.createElement('span');
      count.className = 'group-tab-count';
      count.textContent = `${group.tabs.length} 个标签`;

      const openBtn = document.createElement('span');
      openBtn.className = 'group-open-btn';
      openBtn.textContent = group.isOpen ? '切换' : '打开';
      openBtn.title = group.isOpen ? '聚焦到该分组窗口' : '以分组方式恢复打开所有标签页';
      openBtn.addEventListener('click', async (e) => {
        e.stopPropagation();
        if (group.isOpen && group.windowId) {
          await chrome.windows.update(group.windowId, { focused: true });
          const firstTab = group.tabs.find(t => t.id);
          if (firstTab) await chrome.tabs.update(firstTab.id, { active: true });
          window.close();
        } else {
          openBtn.textContent = '打开中…';
          openBtn.style.pointerEvents = 'none';
          const restored = await restoreGroup(group);
          if (restored.success) {
            window.close();
          } else {
            openBtn.textContent = '打开';
            openBtn.style.pointerEvents = '';
            showToast(`分组恢复失败：${restored.error || '未知错误'}`);
          }
        }
      });

      const toggle = document.createElement('span');
      toggle.className = 'group-toggle-icon';
      toggle.textContent = isSearching ? '▼' : '▶';

      header.append(colorDot, title, badge, count, openBtn, toggle);

      const body = document.createElement('div');
      body.className = 'group-body' + (isSearching ? '' : ' collapsed');

      group.tabs.forEach(tab => {
        const tabItem = document.createElement('div');
        tabItem.className = 'group-tab-item';
        tabItem.dataset.url = tab.url;

        const favicon = document.createElement('img');
        favicon.className = 'group-tab-favicon';
        try {
          favicon.src = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(tab.url)}&size=16`;
        } catch (e) {
          favicon.src = 'icons/icon16.png';
        }
        favicon.onerror = () => { favicon.src = 'icons/icon16.png'; };

        const content = document.createElement('div');
        content.className = 'group-tab-content';

        const tabTitle = document.createElement('div');
        tabTitle.className = 'group-tab-title';
        tabTitle.textContent = tab.title || '无标题';

        const tabUrl = document.createElement('div');
        tabUrl.className = 'group-tab-url';
        tabUrl.textContent = tab.url || '';

        content.append(tabTitle, tabUrl);
        tabItem.append(favicon, content);
        body.appendChild(tabItem);

        tabItem.addEventListener('click', async (e) => {
          e.stopPropagation();
          if (group.isOpen && tab.id) {
            chrome.tabs.update(tab.id, { active: true });
            chrome.windows.update(tab.windowId || group.windowId, { focused: true });
          } else if (tab.url) {
            const restoreWholeGroup = await shouldRestoreWholeGroupOnChildClick();
            const restored = await restoreGroup(group, restoreWholeGroup ? undefined : tab.url);
            if (!restored.success) {
              showToast(`分组恢复失败：${restored.error || '未知错误'}`);
              return;
            }
          }
          window.close();
        });
      });

      resultsList.appendChild(header);
      resultsList.appendChild(body);

      header.addEventListener('click', () => {
        const isCollapsed = body.classList.contains('collapsed');
        body.classList.toggle('collapsed');
        header.classList.toggle('collapsed-header', !isCollapsed);
        toggle.textContent = isCollapsed ? '▼' : '▶';
      });
    });

    selectedIndex = -1;
    searchStatsElement.textContent = isSearching ? `找到 ${groups.length} 个分组` : '';
  }

  // 恢复已保存的分组
  // activateUrl: 可选，恢复后激活匹配此 URL 的标签页并展开分组
  async function restoreGroup(savedGroup, activateUrl) {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage(
        { type: 'RESTORE_GROUP', group: savedGroup, activateUrl },
        (response) => {
          if (chrome.runtime.lastError) {
            const error = chrome.runtime.lastError.message;
            console.error('[BookmarkSearch] restoreGroup error:', error);
            resolve({ success: false, error });
            return;
          } else if (response && response.success === false) {
            console.error('[BookmarkSearch] restoreGroup error:', response.error);
            resolve({ success: false, error: response.error });
            return;
          }
          resolve({ success: true });
        }
      );
    });
  }

  // 获取用户配置的搜索引擎（或自动检测）
  async function getSearchEngine() {
    try {
      const settings = await window.settings.get();
      const engineKey = settings.defaultSearchEngine || window.getDefaultSearchEngine();
      return { key: engineKey, ...window.SEARCH_ENGINES[engineKey] };
    } catch {
      const key = window.getDefaultSearchEngine();
      return { key, ...window.SEARCH_ENGINES[key] };
    }
  }

  // 创建 URL 直接打开项
  function createUrlOpenItem(url) {
    const item = document.createElement('div');
    item.className = 'result-item special-item url-open-item';
    item.dataset.specialAction = 'open-url';
    item.dataset.url = url;
    item.innerHTML = `
      <div class="result-icon special-icon">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>
      </div>
      <div class="result-item-content">
        <div class="result-title">打开 ${escapeHtml(url)}</div>
        <div class="result-url">在新标签页中打开此链接</div>
      </div>
    `;
    item.addEventListener('click', () => {
      chrome.tabs.create({ url });
      window.close();
    });
    return item;
  }

  // 创建搜索引擎跳转项
  function createSearchEngineItem(query, engine) {
    const item = document.createElement('div');
    item.className = 'result-item special-item search-engine-item';
    item.dataset.specialAction = 'search-engine';
    const searchUrl = engine.url.replace('{query}', encodeURIComponent(query));
    item.dataset.url = searchUrl;
    item.innerHTML = `
      <div class="result-icon special-icon search-engine-icon">
        <svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>
      </div>
      <div class="result-item-content">
        <div class="result-title">使用 ${escapeHtml(engine.name)} 搜索 "<strong>${escapeHtml(query)}</strong>"</div>
        <div class="result-url">在新标签页中搜索</div>
      </div>
    `;
    item.addEventListener('click', () => {
      chrome.tabs.create({ url: searchUrl });
      window.close();
    });
    return item;
  }

  // 显示搜索结果
  function displayResults(items, query = '') {
    const resultsList = document.getElementById('resultsList');
    if (!resultsList) return;
    
    resultsList.innerHTML = '';
    
    currentResults = items;
    const trimmedQuery = query.trim();

    if (items.length === 0 && !trimmedQuery) {
      resultsList.innerHTML = '<div class="no-results">没有找到匹配的结果</div>';
      selectedIndex = -1;
      return;
    }

    // 有搜索词但无结果时，显示搜索引擎跳转
    if (items.length === 0 && trimmedQuery) {
      const detectedUrl = window.normalizeUrl(trimmedQuery);
      if (detectedUrl) {
        resultsList.appendChild(createUrlOpenItem(detectedUrl));
      }
      getSearchEngine().then(engine => {
        resultsList.appendChild(createSearchEngineItem(trimmedQuery, engine));
      });
      resultsList.insertAdjacentHTML('beforeend', '<div class="no-results">没有找到匹配的本地结果</div>');
      selectedIndex = -1;
      return;
    }

    items.forEach((item, index) => {
      const resultItem = document.createElement('div');
      resultItem.className = 'result-item';
      resultItem.dataset.index = index;
      resultItem.dataset.id = item.id || `${item.type}-${index}`;
      resultItem.dataset.url = item.url;
      
      // 添加图标
      const iconWrapper = document.createElement('div');
      iconWrapper.className = 'result-icon';
      const icon = document.createElement('img');
      
      try {
        if (currentMode === 'downloads') {
          // 根据文件类型显示不同图标
          const fileExt = item.filename.split('.').pop().toLowerCase();
          const iconMap = {
            pdf: 'icons/pdf.png',
            doc: 'icons/doc.png',
            docx: 'icons/doc.png',
            xls: 'icons/xls.png',
            xlsx: 'icons/xls.png',
            zip: 'icons/zip.png',
            rar: 'icons/zip.png',
            jpg: 'icons/image.png',
            jpeg: 'icons/image.png',
            png: 'icons/image.png',
            gif: 'icons/image.png'
          };
          icon.src = iconMap[fileExt] || 'icons/file.png';
        } else {
          const url = new URL(item.url);
          icon.src = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
        }
      } catch (e) {
        icon.src = 'icons/icon16.png';
      }
      
      icon.onerror = () => {
        icon.src = 'icons/icon16.png';
      };
      
      iconWrapper.appendChild(icon);
      resultItem.appendChild(iconWrapper);
      
      const content = document.createElement('div');
      content.className = 'result-item-content';
      
      const title = document.createElement('div');
      title.className = 'result-title';
      title.textContent = currentMode === 'downloads' 
        ? item.filename.split('/').pop() || '未命名文件'
        : item.title || '无标题';
      
      const url = document.createElement('div');
      url.className = 'result-url';
      url.textContent = item.url;
      
      const meta = document.createElement('div');
      meta.className = 'result-meta';
      
      if (currentMode === 'bookmarks') {
        // 书签模式：显示状态标签和访问信息
        let metaContent = '';
        
        // 添加状态标签
        if (item.usageStatus && item.usageStatus !== BOOKMARK_STATUS.ACTIVE) {
          const statusLabels = {
            [BOOKMARK_STATUS.NEVER_USED]: { text: '从未访问', class: 'never-used' },
            [BOOKMARK_STATUS.RARELY_USED]: { text: '访问较少', class: 'rarely-used' },
            [BOOKMARK_STATUS.DORMANT]: { text: '长期未访问', class: 'dormant' }
          };
          const status = statusLabels[item.usageStatus];
          if (status) {
            metaContent += `<span class="status-tag ${status.class}">${status.text}</span>`;
          }
        }
        
        // 显示访问次数或添加时间
        if (item.visitCount > 0) {
          metaContent += `<span class="visit-count">${item.visitCount}次访问</span>`;
          if (item.lastVisit) {
            metaContent += `<span class="last-visit">${formatTime(item.lastVisit)}</span>`;
          }
        } else if (item.dateAdded) {
          // 未使用的书签显示添加时间
          metaContent += `<span class="added-date">添加于 ${formatAddedDate(item.dateAdded)}</span>`;
        }
        
        meta.innerHTML = metaContent;
      } else if (currentMode === 'history' && item.visitCount > 0) {
        meta.innerHTML = `
          <span class="visit-count">${item.visitCount}次访问</span>
          ${item.lastVisit ? `<span class="last-visit">${formatTime(item.lastVisit)}</span>` : ''}
        `;
      } else if (currentMode === 'downloads') {
        meta.innerHTML = `
          <span class="download-size">${formatFileSize(item.fileSize)}</span>
          <span class="download-date">${formatTime(item.startTime)}</span>
        `;
      }
      
      content.appendChild(title);
      content.appendChild(url);
      if (meta.children.length > 0) {
        content.appendChild(meta);
      }
      
      resultItem.appendChild(content);
      
      // 添加点击事件，处理多选和普通点击
      resultItem.addEventListener('click', (e) => {
        if (isMultiSelectMode || e.ctrlKey || e.metaKey || e.shiftKey) {
          e.preventDefault();
          e.stopPropagation();
          
          if (e.shiftKey && lastSelectedIndex !== -1) {
            // Shift + 点击：选择范围
            const items = Array.from(resultsList.querySelectorAll('.result-item'));
            const currentIndex = items.indexOf(resultItem);
            const start = Math.min(lastSelectedIndex, currentIndex);
            const end = Math.max(lastSelectedIndex, currentIndex);
            
            items.slice(start, end + 1).forEach(item => {
              item.classList.add('selected');
              selectedItems.add(item.dataset.id);
            });
          } else {
            // Ctrl/Command + 点击：切换选中状态
            resultItem.classList.toggle('selected');
            const itemId = resultItem.dataset.id;
            if (selectedItems.has(itemId)) {
              selectedItems.delete(itemId);
            } else {
              selectedItems.add(itemId);
            }
            lastSelectedIndex = Array.from(resultsList.querySelectorAll('.result-item')).indexOf(resultItem);
          }
          
          updateBatchToolbar();
        } else {
          // 普通点击：打开链接
          selectedIndex = index;
          updateSelection();
          if (item.url) {
            chrome.tabs.create({ url: item.url });
            window.close();
          }
        }
      });
      
      resultsList.appendChild(resultItem);
    });

    // 有搜索词时，在结果末尾追加搜索引擎跳转项
    if (trimmedQuery) {
      const detectedUrl = window.normalizeUrl(trimmedQuery);
      if (detectedUrl) {
        const divider = document.createElement('div');
        divider.className = 'suggestion-divider';
        resultsList.appendChild(divider);
        resultsList.appendChild(createUrlOpenItem(detectedUrl));
      }
      getSearchEngine().then(engine => {
        if (!detectedUrl) {
          const divider = document.createElement('div');
          divider.className = 'suggestion-divider';
          resultsList.appendChild(divider);
        }
        resultsList.appendChild(createSearchEngineItem(trimmedQuery, engine));
      });
    }
    
    // 初始化时不选中任何项
    selectedIndex = -1;
    updateSelection();
    
    // 更新搜索统计
    searchStatsElement.textContent = `找到 ${items.length} 个结果`;
  }

  // 获取不同类型的图标
  function getIconForType(type) {
    const icons = {
      bookmark: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>',
      tab: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z"/></svg>',
      history: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42C8.27 19.99 10.51 21 13 21c4.97 0 9-4.03 9-9s-4.03-9-9-9zm-1 5v5l4.28 2.54.72-1.21-3.5-2.08V8H12z"/></svg>',
      download: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M19 9h-4V3H5v6H3v12h16V9z"/></svg>'
    };
    return icons[type] || icons.bookmark;
  }

  // HTML 转义
  function escapeHtml(unsafe) {
    return unsafe
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");
  }

  function getVisibleModes() {
    const modes = ['bookmarks', 'tabs'];
    const groupsBtn = document.querySelector('.tab-btn[data-mode="groups"]');
    if (groupsBtn && groupsBtn.style.display !== 'none') modes.push('groups');
    modes.push('history', 'downloads');
    const aiBtn = document.querySelector('.tab-btn[data-mode="ai"]');
    if (aiBtn && aiBtn.style.display !== 'none') modes.push('ai');
    return modes;
  }

  function applyGroupsModeVisibility(show) {
    const groupsBtn = document.querySelector('.tab-btn[data-mode="groups"]');
    if (groupsBtn) {
      groupsBtn.style.display = show ? '' : 'none';
    }
    const childOption = document.getElementById('groupChildClickOption');
    if (childOption) {
      childOption.style.display = show ? '' : 'none';
    }
    if (!show && currentMode === 'groups') {
      switchMode('bookmarks');
    }
  }

  function applyAiModeVisibility(show) {
    const aiBtn = document.querySelector('.tab-btn[data-mode="ai"]');
    if (aiBtn) {
      aiBtn.style.display = show ? '' : 'none';
    }
    if (!show && currentMode === 'ai') {
      switchMode('bookmarks');
    }
  }

  // 处理键盘事件
  function handleKeydown(e) {
    // IME 输入中（如中文输入法候选词选择），不拦截按键
    if (e.isComposing || e.keyCode === 229) return;

    // 检查是否在编辑弹窗中（编辑弹窗内的输入框需要正常使用方向键）
    const editModal = document.getElementById('editModal');
    const isEditModalOpen = editModal && editModal.classList.contains('show');
    
    // 检查焦点是否在输入框中（但排除主搜索框，主搜索框不需要左右键移动光标的需求较小）
    const activeElement = document.activeElement;
    const isInNonSearchInput = activeElement && 
      (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA') &&
      activeElement.id !== 'searchInput';
    
    // 如果编辑弹窗打开或焦点在非搜索输入框中，跳过全局快捷键处理
    // 让输入框正常处理方向键、文本选择等
    if (isEditModalOpen || isInNonSearchInput) {
      // 只处理 Escape 键关闭弹窗（但让弹窗自己的事件处理器处理）
      return;
    }
    
    // 处理左右键切换模式（所有模式通用）
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const modes = getVisibleModes();
      const currentIndex = modes.indexOf(currentMode);
      let newIndex;
      
      if (e.key === 'ArrowLeft') {
        newIndex = currentIndex <= 0 ? modes.length - 1 : currentIndex - 1;
      } else {
        newIndex = currentIndex >= modes.length - 1 ? 0 : currentIndex + 1;
      }
      
      switchMode(modes[newIndex]);
      return;
    }

    // 分组模式下不使用上下键/Enter 选中（树状结构用鼠标交互）
    if (currentMode === 'groups') return;

    const items = document.querySelectorAll('.result-item');
    if (items.length === 0) return;

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (selectedIndex === -1) {
          // 如果没有选中项，选择第一项
          selectedIndex = 0;
        } else if (selectedIndex < items.length - 1) {
          selectedIndex++;
        }
        updateSelection();
        break;
      case 'ArrowUp':
        e.preventDefault();
        if (selectedIndex === -1) {
          // 如果没有选中项，选择最后一项
          selectedIndex = items.length - 1;
        } else if (selectedIndex > 0) {
          selectedIndex--;
        }
        updateSelection();
        break;
      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0 && selectedIndex < items.length) {
          const selectedEl = items[selectedIndex];
          const specialAction = selectedEl?.dataset?.specialAction;
          if (specialAction && selectedEl.dataset.url) {
            chrome.tabs.create({ url: selectedEl.dataset.url });
            window.close();
            break;
          }
          const item = currentResults[selectedIndex];
          if (item) {
            switch (currentMode) {
              case 'bookmarks':
              case 'ai':
                chrome.tabs.create({ url: item.url });
                break;
              case 'tabs':
                chrome.tabs.update(item.id, { active: true });
                chrome.windows.update(item.windowId, { focused: true });
                break;
              case 'history':
                chrome.tabs.create({ url: item.url });
                break;
              case 'downloads':
                chrome.downloads.open(item.id);
                break;
            }
            window.close();
          } else if (selectedEl?.dataset?.url) {
            chrome.tabs.create({ url: selectedEl.dataset.url });
            window.close();
          }
        }
        break;
      case 'Escape':
        window.close();
        break;
    }
  }

  // 更新选中状态
  function updateSelection() {
    const resultsList = document.getElementById('resultsList');
    const resultsContainer = document.getElementById('results');
    if (!resultsList || !resultsContainer) return;

    const items = resultsList.querySelectorAll('.result-item');
    items.forEach((item, index) => {
      if (index === selectedIndex) {
        item.classList.add('active');
        // 立即滚动到选中项
        item.scrollIntoView({ block: 'nearest', behavior: 'auto' });
      } else {
        item.classList.remove('active');
      }
    });
  }

  // 确保选中项在视图中可见
  function ensureVisible(element) {
    const container = document.getElementById('results');
    if (!container) return;
    
    const containerRect = container.getBoundingClientRect();
    const elementRect = element.getBoundingClientRect();
    
    if (elementRect.bottom > containerRect.bottom) {
      element.scrollIntoView({ block: 'end' });
    } else if (elementRect.top < containerRect.top) {
      element.scrollIntoView({ block: 'start' });
    }
  }

  // 格式化文件大小
  function formatFileSize(bytes) {
    if (!bytes) return '未知大小';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    let size = bytes;
    let unitIndex = 0;
    while (size >= 1024 && unitIndex < units.length - 1) {
      size /= 1024;
      unitIndex++;
    }
    return `${size.toFixed(1)} ${units[unitIndex]}`;
  }

  // 当前排序方式
  let currentSort = 'smart';

  function search(query) {
    if (currentMode === 'groups') {
      const filtered = searchGroups(query, allGroups);
      displayGroupResults(filtered);
      selectedIndex = -1;
      return;
    }

    if (currentMode === 'ai') {
      searchAi(query);
      return;
    }

    let items;
    
    switch (currentMode) {
      case 'bookmarks':
        items = filterByUsageStatus(allBookmarks, currentFilter);
        break;
      case 'tabs':
        items = allTabs;
        break;
      case 'history':
        items = allHistory;
        break;
      case 'downloads':
        items = allDownloads;
        break;
      default:
        items = [];
    }
    
    let filteredResults = window.SearchParser.filter(items, query);
    
    filteredResults = window.SmartSort.sort(filteredResults, {
      searchText: query,
      mode: currentSort
    });
    
    displayResults(filteredResults, query);
    
    searchStatsElement.textContent = query ? `找到 ${filteredResults.length} 个结果` : '';
    
    if (query.trim() && currentMode !== 'history') {
      appendHistorySuggestions(query, filteredResults);
    }
    
    selectedIndex = -1;
  }

  function searchAi(query) {
    if (!query || !query.trim()) {
      displayResults([], '');
      searchStatsElement.textContent = '输入需求描述或关键词，AI 语义搜索书签、历史和标签页';
      selectedIndex = -1;
      loadAiRecommendations();
      return;
    }

    clearTimeout(aiSearchDebounceTimer);
    searchStatsElement.textContent = '语义搜索中...';

    aiSearchDebounceTimer = setTimeout(() => {
      chrome.runtime.sendMessage({
        type: 'INTELLIGENT_SEARCH',
        query: query.trim(),
        limit: 50,
        rerank: true
      }, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[BookmarkSearch] AI search error:', chrome.runtime.lastError.message);
          searchStatsElement.textContent = 'AI 搜索出错';
          return;
        }
        if (!response) {
          searchStatsElement.textContent = 'AI 搜索无响应';
          return;
        }
        if (response.fallback) {
          const items = allAiData.bookmarks || [];
          let filteredResults = window.SearchParser.filter(items, query);
          filteredResults = window.SmartSort.sort(filteredResults, { searchText: query, mode: currentSort });
          displayResults(filteredResults, query);
          searchStatsElement.textContent = `找到 ${filteredResults.length} 个结果 (关键词回退: ${response.error || ''})`;
          selectedIndex = -1;
          return;
        }
        if (response.ok && response.results) {
          const results = response.results;
          displayAiResults(results, query);
          const semanticCount = results.filter(r => r._matchType === 'semantic' || r._matchType === 'hybrid').length;
          searchStatsElement.textContent = `找到 ${results.length} 个结果 (语义 ${semanticCount})`;
          selectedIndex = results.length > 0 ? 0 : -1;
        }
      });
    }, 300);
  }

  function displayAiResults(items, query) {
    const resultsList = document.getElementById('resultsList');
    resultsList.innerHTML = '';
    currentResults = items;

    if (items.length === 0) {
      resultsList.innerHTML = '<div class="no-results">没有找到相关结果</div>';
      return;
    }

    items.forEach((item, index) => {
      const div = document.createElement('div');
      div.className = 'result-item' + (index === 0 ? ' active' : '');
      div.dataset.url = item.url || '';
      div.dataset.id = item.id || '';
      div.dataset.source = item._source || 'bookmark';

      const iconWrap = document.createElement('div');
      iconWrap.className = 'result-icon';
      const icon = document.createElement('img');
      icon.width = 16; icon.height = 16;
      try {
        const host = new URL(item.url).hostname;
        icon.src = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(item.url)}&size=16`;
        icon.onerror = () => { icon.src = `https://www.google.com/s2/favicons?domain=${host}&sz=32`; };
      } catch { icon.src = 'icons/icon16.png'; }
      iconWrap.appendChild(icon);

      const content = document.createElement('div');
      content.className = 'result-item-content';

      const title = document.createElement('div');
      title.className = 'result-title';
      title.textContent = item.title || '无标题';

      const url = document.createElement('div');
      url.className = 'result-url';
      url.textContent = item.url || '';

      if (item._summary) {
        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'ai-summary-preview';
        summaryDiv.textContent = item._summary;
        content.appendChild(title);
        content.appendChild(url);
        content.appendChild(summaryDiv);
      } else {
        content.appendChild(title);
        content.appendChild(url);
      }

      const meta = document.createElement('div');
      meta.className = 'result-meta';

      if (item._source) {
        const sourceBadge = document.createElement('span');
        const sourceLabels = { bookmark: '书签', history: '历史', tab: '标签页' };
        sourceBadge.className = 'ai-source-badge ai-source-' + item._source;
        sourceBadge.textContent = sourceLabels[item._source] || item._source;
        meta.appendChild(sourceBadge);
      }

      if (item._matchType) {
        const badge = document.createElement('span');
        badge.className = 'ai-match-badge ai-match-' + item._matchType;
        const labels = { keyword: '关键词', semantic: '语义', hybrid: '混合' };
        badge.textContent = labels[item._matchType] || item._matchType;
        meta.appendChild(badge);
      }

      if (item._relevance > 0) {
        const relBar = document.createElement('span');
        relBar.className = 'ai-relevance-bar';
        const level = item._relevance >= 60 ? 'high' : item._relevance >= 30 ? 'medium' : 'low';
        relBar.innerHTML = `<span class="ai-relevance-track"><span class="ai-relevance-fill ${level}" style="width:${item._relevance}%"></span></span><span>${item._relevance}%</span>`;
        meta.appendChild(relBar);
      }

      div.appendChild(iconWrap);
      div.appendChild(content);
      if (meta.children.length > 0) div.appendChild(meta);

      div.addEventListener('click', () => {
        if (item._source === 'tab' && item.id) {
          const tabId = parseInt(String(item.id).replace('tab_', ''));
          if (!isNaN(tabId)) {
            chrome.tabs.update(tabId, { active: true });
            if (item.windowId) chrome.windows.update(item.windowId, { focused: true });
            window.close();
            return;
          }
        }
        if (item.url) {
          chrome.tabs.create({ url: item.url });
          window.close();
        }
      });

      resultsList.appendChild(div);
    });
  }

  // 追加历史记录建议到搜索结果底部
  function appendHistorySuggestions(query, existingResults) {
    const existingUrls = new Set(existingResults.map(r => r.url).filter(Boolean));

    chrome.history.search({
      text: query,
      maxResults: 8,
      startTime: Date.now() - (30 * 24 * 60 * 60 * 1000)
    }, (results) => {
      if (!results || results.length === 0) return;
      // 搜索词可能已变，检查是否仍然匹配
      if (document.getElementById('searchInput').value.trim() !== query.trim()) return;

      const suggestions = results
        .filter(item => item.url && !existingUrls.has(item.url))
        .slice(0, 5);

      if (suggestions.length === 0) return;

      const resultsList = document.getElementById('resultsList');

      // 分隔标题
      const divider = document.createElement('div');
      divider.className = 'suggestion-divider';
      divider.innerHTML = '<span class="suggestion-divider-text">最近访问</span>';
      resultsList.appendChild(divider);

      suggestions.forEach((item, idx) => {
        const el = document.createElement('div');
        el.className = 'result-item suggestion-item';
        el.dataset.url = item.url;

        const iconWrap = document.createElement('div');
        iconWrap.className = 'result-icon';
        const icon = document.createElement('img');
        icon.width = 16; icon.height = 16;
        try {
          const host = new URL(item.url).hostname;
          icon.src = `https://www.google.com/s2/favicons?domain=${host}&sz=32`;
        } catch { icon.src = 'icons/icon16.png'; }
        icon.onerror = () => { icon.src = 'icons/icon16.png'; };
        iconWrap.appendChild(icon);

        const content = document.createElement('div');
        content.className = 'result-item-content';
        const title = document.createElement('div');
        title.className = 'result-title';
        title.textContent = item.title || '无标题';
        const url = document.createElement('div');
        url.className = 'result-url';
        url.textContent = item.url;
        content.appendChild(title);
        content.appendChild(url);

        el.appendChild(iconWrap);
        el.appendChild(content);

        el.addEventListener('click', () => {
          chrome.tabs.create({ url: item.url });
          window.close();
        });

        resultsList.appendChild(el);
      });
    });
  }

  function switchMode(mode) {
    currentMode = mode;
    const searchInput = document.getElementById('searchInput');
    
    document.querySelectorAll('.tab-btn').forEach(btn => {
      if (btn.getAttribute('data-mode') === mode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
    
    const placeholders = {
      bookmarks: '搜索书签...',
      tabs: '搜索标签页...',
      groups: '搜索分组或分组内标签页...',
      history: '搜索历史记录...',
      downloads: '搜索下载记录...',
      ai: '输入自然语言搜索...'
    };
    searchInput.placeholder = placeholders[mode] || '搜索...';

    const modeLabels = {
      bookmarks: '书签', tabs: '标签页', groups: '分组',
      history: '历史记录', downloads: '下载', ai: 'AI 搜索'
    };
    if (modeLabel) modeLabel.textContent = modeLabels[mode] || mode;
    
    searchInput.value = '';
    selectedIndex = -1;
    
    updateFiltersVisibility();
    
    loadData();
  }

  function loadData() {
    switch (currentMode) {
      case 'bookmarks':
        loadBookmarks();
        break;
      case 'tabs':
        loadTabs();
        break;
      case 'groups':
        loadGroups();
        break;
      case 'history':
        loadHistory();
        break;
      case 'downloads':
        loadDownloads();
        break;
      case 'ai':
        loadAiData();
        break;
    }
  }

  async function loadAiData() {
    try {
      const bookmarkTree = await chrome.bookmarks.getTree();
      const bookmarks = [];
      function traverse(node) {
        if (node.url) bookmarks.push(node);
        if (node.children) node.children.forEach(traverse);
      }
      bookmarkTree.forEach(traverse);
      allAiData = { bookmarks };
      totalCountElement.textContent = bookmarks.length;
      displayResults([], '');
      searchStatsElement.textContent = '输入需求描述或关键词，AI 语义搜索书签、历史和标签页';
      loadAiRecommendations();
    } catch (e) {
      console.error('[BookmarkSearch] loadAiData error:', e);
    }
  }

  function loadAiRecommendations() {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs?.[0];
      if (!tab || !tab.url || tab.url.startsWith('chrome://') || tab.url.startsWith('chrome-extension://')) return;

      const resultsList = document.getElementById('resultsList');
      if (!resultsList) return;
      resultsList.innerHTML = '<div class="ai-rec-loading">正在加载推荐...</div>';

      chrome.runtime.sendMessage({
        type: 'GET_AI_RECOMMENDATIONS',
        currentUrl: tab.url,
        currentTitle: tab.title,
        topK: 8
      }, (response) => {
        if (chrome.runtime.lastError || !response) {
          resultsList.innerHTML = '';
          return;
        }
        if (searchInput.value.trim()) return;
        if (!response.ok || !response.results || response.results.length === 0) {
          resultsList.innerHTML = '';
          if (response.error && response.error.includes('向量索引为空')) {
            resultsList.innerHTML = '<div class="ai-no-embedding-hint">尚未构建向量索引，请在设置中点击「构建索引」后即可使用 AI 推荐和语义搜索。</div>';
          }
          return;
        }
        displayAiRecommendations(response.results);
      });
    });
  }

  function displayAiRecommendations(items) {
    const resultsList = document.getElementById('resultsList');
    if (!resultsList) return;
    resultsList.innerHTML = '';
    currentResults = items;

    const container = document.createElement('div');
    container.className = 'ai-recommendations';

    const header = document.createElement('div');
    header.className = 'ai-rec-header';
    header.innerHTML = '<span class="ai-rec-header-icon">✨</span><span>与当前页面相关</span><span class="ai-rec-badge">AI 推荐</span>';
    container.appendChild(header);

    items.forEach((item, index) => {
      const div = document.createElement('div');
      div.className = 'ai-rec-item';
      div.dataset.url = item.url || '';
      div.dataset.id = item.id || '';

      const icon = document.createElement('img');
      icon.width = 16; icon.height = 16;
      icon.style.flexShrink = '0';
      try {
        icon.src = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(item.url)}&size=16`;
        icon.onerror = () => { icon.src = `https://www.google.com/s2/favicons?domain=${new URL(item.url).hostname}&sz=16`; };
      } catch { icon.src = 'icons/icon16.png'; }

      const content = document.createElement('div');
      content.className = 'ai-rec-content';

      const title = document.createElement('div');
      title.className = 'ai-rec-title';
      title.textContent = item.title || '无标题';

      const url = document.createElement('div');
      url.className = 'ai-rec-url';
      url.textContent = item.url || '';

      content.appendChild(title);
      content.appendChild(url);

      if (item._relevance > 0) {
        const score = document.createElement('span');
        score.className = 'ai-rec-score';
        score.textContent = item._relevance + '%';
        div.appendChild(icon);
        div.appendChild(content);
        div.appendChild(score);
      } else {
        div.appendChild(icon);
        div.appendChild(content);
      }

      div.addEventListener('click', () => {
        if (item.url) {
          chrome.tabs.create({ url: item.url });
          window.close();
        }
      });

      container.appendChild(div);
    });

    resultsList.appendChild(container);
    selectedIndex = -1;
  }

  // 加载友情链接的 favicon
  function loadFavicons() {
    const faviconImages = document.querySelectorAll('.friend-link-favicon');
    faviconImages.forEach(img => {
      const url = img.dataset.favicon;
      if (url) {
        // 首先尝试使用 Chrome 扩展的 favicon API
        img.src = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(url)}&size=16`;
        
        // 如果加载失败，使用 Google 的 favicon 服务作为备选
        img.onerror = () => {
          img.src = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url)}&sz=16`;
        };
      }
    });
  }

  // 处理快捷键
  document.addEventListener('keydown', handleKeydown);

  // 初始化设置
  let settings = {
    stickyHints: false // 默认不固定快捷键提示
  };

  // 切换快捷键提示栏的固定状态
  function toggleStickyHints(checked) {
    settings.stickyHints = checked;
    document.body.classList.toggle('sticky-all', checked);
  }

  // 初始化设置按钮
  const settingsBtn = document.getElementById('settingsBtn');
  let settingsMenu = null;

  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    
    if (settingsMenu) {
      settingsMenu.remove();
      settingsMenu = null;
      return;
    }
    
    // 创建设置菜单
    settingsMenu = document.createElement('div');
    settingsMenu.className = 'settings-menu';
    
    // 添加固定快捷键选项
    const stickyItem = document.createElement('div');
    stickyItem.className = 'settings-item';
    stickyItem.innerHTML = `
      <label>
        <input type="checkbox" ${settings.stickyHints ? 'checked' : ''}>
        固定快捷键提示
      </label>
    `;
    
    const checkbox = stickyItem.querySelector('input');
    checkbox.addEventListener('change', (e) => {
      e.stopPropagation();
      toggleStickyHints(e.target.checked);
    });
    
    settingsMenu.appendChild(stickyItem);
    settingsBtn.parentNode.appendChild(settingsMenu);
  });

  // 点击其他地方关闭设置菜单
  document.addEventListener('click', (e) => {
    if (settingsMenu && !settingsMenu.contains(e.target) && !settingsBtn.contains(e.target)) {
      settingsMenu.remove();
      settingsMenu = null;
    }
  });

  async function initSettingsPanel() {
    const settingsBtn = document.getElementById('settingsBtn');
    const settingsPanel = document.getElementById('settingsPanel');
    const settingsClose = document.getElementById('settingsClose');
    
    const settings = await window.settings.get();
    
    document.querySelector(`input[name="theme"][value="${settings.theme}"]`).checked = true;
    document.querySelector(`input[name="fontSize"][value="${settings.fontSize}"]`).checked = true;
    document.querySelector(`input[name="lineHeight"][value="${settings.lineHeight}"]`).checked = true;
    document.getElementById('animation').checked = settings.animation;
    document.getElementById('highContrast').checked = settings.highContrast;
    document.getElementById('showGroupsMode').checked = !!settings.showGroupsMode;
    document.getElementById('groupChildClickRestoreAll').checked = settings.groupChildClickRestoreAll !== false;
    applyGroupsModeVisibility(!!settings.showGroupsMode);

    // 默认模式
    const defaultModeSelect = document.getElementById('defaultMode');
    if (defaultModeSelect) {
      defaultModeSelect.value = settings.defaultMode || 'bookmarks';
    }

    // AI 设置
    const ai = settings.intelligentSearch || {};
    const aiEnabledCheckbox = document.getElementById('aiEnabled');
    const aiSettingsDetail = document.getElementById('aiSettingsDetail');
    const aiProviderSelect = document.getElementById('aiProvider');
    const aiApiKeyInput = document.getElementById('aiApiKey');
    const aiBaseUrlInput = document.getElementById('aiBaseUrl');
    const aiBaseUrlOption = document.getElementById('aiBaseUrlOption');
    const aiRerankCheckbox = document.getElementById('aiRerankEnabled');

    if (aiEnabledCheckbox) {
      aiEnabledCheckbox.checked = !!ai.enabled;
      aiSettingsDetail.style.display = ai.enabled ? '' : 'none';
      applyAiModeVisibility(!!ai.enabled);
    }
    if (aiProviderSelect) {
      aiProviderSelect.value = ai.aiProvider || 'gemini';
      aiBaseUrlOption.style.display = ai.aiProvider === 'custom' ? '' : 'none';
    }
    if (aiApiKeyInput) aiApiKeyInput.value = ai.aiApiKey || '';
    if (aiBaseUrlInput) aiBaseUrlInput.value = ai.aiBaseUrl || '';
    if (aiRerankCheckbox) aiRerankCheckbox.checked = !!ai.rerankEnabled;

    // 刷新索引状态
    refreshAiIndexStatus();

    // 应用默认模式
    if (settings.defaultMode && settings.defaultMode !== 'bookmarks') {
      const mode = settings.defaultMode;
      if (mode === 'ai' && !ai.enabled) {
        // AI 未启用则不切换
      } else if (mode === 'groups' && !settings.showGroupsMode) {
        // 分组未启用则不切换
      } else {
        switchMode(mode);
      }
    }

    // AI 启用切换
    if (aiEnabledCheckbox) {
      aiEnabledCheckbox.addEventListener('change', async () => {
        const s = await window.settings.get();
        s.intelligentSearch = s.intelligentSearch || {};
        s.intelligentSearch.enabled = aiEnabledCheckbox.checked;
        aiSettingsDetail.style.display = aiEnabledCheckbox.checked ? '' : 'none';
        applyAiModeVisibility(aiEnabledCheckbox.checked);
        await window.settings.save(s);
      });
    }

    // AI Provider 切换
    if (aiProviderSelect) {
      aiProviderSelect.addEventListener('change', async () => {
        const s = await window.settings.get();
        s.intelligentSearch = s.intelligentSearch || {};
        s.intelligentSearch.aiProvider = aiProviderSelect.value;
        aiBaseUrlOption.style.display = aiProviderSelect.value === 'custom' ? '' : 'none';
        await window.settings.save(s);
      });
    }

    // API Key 变更
    if (aiApiKeyInput) {
      const saveApiKey = async () => {
        const s = await window.settings.get();
        s.intelligentSearch = s.intelligentSearch || {};
        s.intelligentSearch.aiApiKey = aiApiKeyInput.value;
        await window.settings.save(s);
      };
      aiApiKeyInput.addEventListener('change', saveApiKey);
      aiApiKeyInput.addEventListener('input', saveApiKey);
    }

    // Base URL 变更
    if (aiBaseUrlInput) {
      aiBaseUrlInput.addEventListener('change', async () => {
        const s = await window.settings.get();
        s.intelligentSearch = s.intelligentSearch || {};
        s.intelligentSearch.aiBaseUrl = aiBaseUrlInput.value;
        await window.settings.save(s);
      });
    }

    // Rerank 切换
    if (aiRerankCheckbox) {
      aiRerankCheckbox.addEventListener('change', async () => {
        const s = await window.settings.get();
        s.intelligentSearch = s.intelligentSearch || {};
        s.intelligentSearch.rerankEnabled = aiRerankCheckbox.checked;
        await window.settings.save(s);
      });
    }

    // 验证 API Key
    const verifyBtn = document.getElementById('verifyApiKeyBtn');
    if (verifyBtn) {
      verifyBtn.addEventListener('click', async () => {
        verifyBtn.textContent = '验证中...';
        verifyBtn.disabled = true;

        const currentConfig = {
          aiProvider: aiProviderSelect?.value || 'gemini',
          aiApiKey: aiApiKeyInput?.value || '',
          aiBaseUrl: aiBaseUrlInput?.value || ''
        };
        const s = await window.settings.get();
        s.intelligentSearch = { ...(s.intelligentSearch || {}), ...currentConfig };
        await window.settings.save(s);

        chrome.runtime.sendMessage({
          type: 'VERIFY_API_KEY',
          config: s.intelligentSearch
        }, (response) => {
          verifyBtn.disabled = false;
          if (response && response.ok) {
            verifyBtn.textContent = '✓ 成功';
            setTimeout(() => { verifyBtn.textContent = '验证'; }, 2000);
          } else {
            verifyBtn.textContent = '✗ 失败';
            setTimeout(() => { verifyBtn.textContent = '验证'; }, 2000);
          }
        });
      });
    }

    // 构建索引
    const buildBtn = document.getElementById('buildIndexBtn');
    const resumeBtn = document.getElementById('resumeIndexBtn');
    const pauseBtn = document.getElementById('pauseIndexBtn');
    const clearBtn = document.getElementById('clearIndexBtn');

    function showBuildingUI() {
      if (buildBtn) buildBtn.style.display = 'none';
      if (resumeBtn) resumeBtn.style.display = 'none';
      if (pauseBtn) pauseBtn.style.display = '';
      if (clearBtn) clearBtn.style.display = 'none';
      const progressBar = document.getElementById('aiProgressBar');
      if (progressBar) progressBar.style.display = '';
    }

    function showIdleUI() {
      if (buildBtn) buildBtn.style.display = '';
      if (resumeBtn) resumeBtn.style.display = 'none';
      if (pauseBtn) pauseBtn.style.display = 'none';
      refreshAiIndexStatus();
    }

    if (buildBtn) {
      buildBtn.addEventListener('click', () => {
        showBuildingUI();
        chrome.runtime.sendMessage({ type: 'BUILD_EMBEDDING_INDEX' }, () => {
          showIdleUI();
        });
      });
    }
    if (resumeBtn) {
      resumeBtn.addEventListener('click', () => {
        showBuildingUI();
        chrome.runtime.sendMessage({ type: 'RESUME_EMBEDDING_BUILD' }, () => {
          showIdleUI();
        });
      });
    }
    if (pauseBtn) {
      pauseBtn.addEventListener('click', () => {
        chrome.runtime.sendMessage({ type: 'PAUSE_EMBEDDING_BUILD' });
        showIdleUI();
      });
    }
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        if (confirm('确定要清除所有已构建的向量索引吗？')) {
          chrome.runtime.sendMessage({ type: 'CLEAR_EMBEDDING_INDEX' }, () => {
            showIdleUI();
          });
        }
      });
    }

    // 监听构建进度
    chrome.runtime.onMessage.addListener((msg) => {
      if (msg.type === 'EMBEDDING_BUILD_PROGRESS') {
        updateBuildProgress(msg);
      }
    });
    
    settingsBtn.addEventListener('click', () => {
      settingsPanel.classList.add('show');
    });
    
    settingsClose.addEventListener('click', () => {
      settingsPanel.classList.remove('show');
    });
    
    settingsPanel.addEventListener('change', async (e) => {
      const target = e.target;
      if (['aiEnabled', 'aiProvider', 'aiApiKey', 'aiBaseUrl', 'aiRerankEnabled'].includes(target.name || target.id)) return;
      
      const settings = await window.settings.get();
      
      switch(target.name) {
        case 'theme':
          settings.theme = target.value;
          break;
        case 'fontSize':
          settings.fontSize = target.value;
          break;
        case 'lineHeight':
          settings.lineHeight = target.value;
          break;
        case 'animation':
          settings.animation = target.checked;
          break;
        case 'highContrast':
          settings.highContrast = target.checked;
          break;
        case 'showGroupsMode':
          settings.showGroupsMode = target.checked;
          applyGroupsModeVisibility(target.checked);
          break;
        case 'groupChildClickRestoreAll':
          settings.groupChildClickRestoreAll = target.checked;
          break;
        case 'defaultMode':
          settings.defaultMode = target.value;
          break;
      }
      
      await window.settings.save(settings);
    });
    
    document.addEventListener('click', (e) => {
      if (!settingsPanel.contains(e.target) && !settingsBtn.contains(e.target)) {
        settingsPanel.classList.remove('show');
      }
    });
    
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && settingsPanel.classList.contains('show')) {
        e.stopPropagation();
        settingsPanel.classList.remove('show');
      }
    });
  }

  function refreshAiIndexStatus() {
    chrome.runtime.sendMessage({ type: 'GET_EMBEDDING_STATUS' }, (response) => {
      const statusEl = document.getElementById('aiIndexStatus');
      const buildBtn = document.getElementById('buildIndexBtn');
      const resumeBtn = document.getElementById('resumeIndexBtn');
      const clearBtn = document.getElementById('clearIndexBtn');
      const progressBar = document.getElementById('aiProgressBar');
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
          if (persistedState.status === 'error') {
            statusEl.textContent = `构建出错 (${done}/${total}): ${persistedState.error || '未知错误'}`;
          } else {
            statusEl.textContent = `已暂停 ${done}/${total}`;
          }
          if (buildBtn) buildBtn.style.display = 'none';
          if (resumeBtn) resumeBtn.style.display = '';
          if (clearBtn) clearBtn.style.display = '';
          if (progressBar) {
            progressBar.style.display = '';
            const fill = document.getElementById('aiProgressFill');
            if (fill && total > 0) fill.style.width = (done / total * 100) + '%';
          }
        } else if (vectorCount > 0) {
          statusEl.textContent = `已索引 ${vectorCount} 项`;
          if (buildBtn) buildBtn.style.display = '';
          if (buildBtn) buildBtn.textContent = '重建索引';
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

  function updateBuildProgress(msg) {
    const progressBar = document.getElementById('aiProgressBar');
    const progressFill = document.getElementById('aiProgressFill');
    const statusEl = document.getElementById('aiIndexStatus');

    if (msg.type === 'progress' || msg.type === 'EMBEDDING_BUILD_PROGRESS') {
      const pct = msg.total > 0 ? (msg.progress / msg.total * 100) : 0;
      if (progressBar) progressBar.style.display = '';
      if (progressFill) progressFill.style.width = pct + '%';
      if (statusEl) statusEl.textContent = `构建中 ${msg.progress}/${msg.total}`;
    }
    if (msg.type === 'complete') {
      if (progressBar) progressBar.style.display = 'none';
      if (statusEl) statusEl.textContent = `已索引 ${msg.total} 项`;
    }
    if (msg.type === 'error') {
      if (progressBar) progressBar.style.display = 'none';
      if (statusEl) statusEl.textContent = `构建出错: ${msg.error}`;
    }
    if (msg.type === 'paused') {
      if (statusEl) statusEl.textContent = `已暂停 ${msg.progress}/${msg.total}`;
    }
  }

  // 初始化搜索语法帮助
  function initSearchSyntaxHelp() {
    const helpBtn = document.getElementById('helpBtn');
    const searchBox = document.querySelector('.search-box');
    
    // 创建提示框
    const tooltip = document.createElement('div');
    tooltip.className = 'search-syntax-tooltip';
    tooltip.innerHTML = `
      <h3>高级搜索语法</h3>
      <ul>
        <li><code>关键字1 关键字2</code> - 多关键字同时匹配</li>
        <li><code>"精确词组"</code> - 引号内精确匹配</li>
        <li><code>-关键字</code> - 排除包含该关键字的结果</li>
        <li><code>-词1,词2,词3</code> - 一次排除多个关键字</li>
        <li><code>site:github.com</code> - 限定特定网站</li>
        <li><code>type:pdf</code> - 按文件类型过滤</li>
        <li><code>in:title</code> - 仅搜索标题</li>
        <li><code>in:url</code> - 仅搜索网址</li>
        <li><code>after:2024-01</code> - 指定起始时间</li>
        <li><code>before:2024-02</code> - 指定结束时间</li>
      </ul>
    `;
    searchBox.appendChild(tooltip);
    
    // 显示/隐藏提示框
    let tooltipTimer;
    
    helpBtn.addEventListener('mouseenter', () => {
      clearTimeout(tooltipTimer);
      tooltip.classList.add('show');
    });
    
    helpBtn.addEventListener('mouseleave', () => {
      tooltipTimer = setTimeout(() => {
        tooltip.classList.remove('show');
      }, 200);
    });
    
    tooltip.addEventListener('mouseenter', () => {
      clearTimeout(tooltipTimer);
    });
    
    tooltip.addEventListener('mouseleave', () => {
      tooltipTimer = setTimeout(() => {
        tooltip.classList.remove('show');
      }, 200);
    });
    
    // 点击其他地方关闭提示框
    document.addEventListener('click', (e) => {
      if (!tooltip.contains(e.target) && !helpBtn.contains(e.target)) {
        tooltip.classList.remove('show');
      }
    });
  }

  // 初始化排序功能
  function initSortOptions() {
    const sortBtns = document.querySelectorAll('.sort-btn');
    
    // 点击排序按钮
    sortBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        const sortType = btn.dataset.sort;
        
        // 更新UI
        sortBtns.forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        
        // 更新排序方式
        currentSort = sortType;
        
        // 重新搜索以应用新的排序
        const searchInput = document.getElementById('searchInput');
        search(searchInput.value);
      });
    });
  }

  // 多选相关变量
  let selectedItems = new Set();
  let lastSelectedIndex = -1;
  let isMultiSelectMode = false;

  // 初始化多选功能
  function initMultiSelect() {
    const resultsList = document.getElementById('resultsList');
    if (!resultsList) return;

    const batchToolbar = document.querySelector('.batch-toolbar');
    if (!batchToolbar) return;

    const selectedCount = batchToolbar.querySelector('.selected-count');
    if (!selectedCount) return;

    const batchActions = batchToolbar.querySelectorAll('.batch-btn');

    // 监听按键状态
    document.addEventListener('keydown', (e) => {
      if ((e.key === 'Control' || e.key === 'Meta') && !isMultiSelectMode) {
        isMultiSelectMode = true;
        resultsList.dataset.multiselect = 'true';
      }
    });

    document.addEventListener('keyup', (e) => {
      if (e.key === 'Control' || e.key === 'Meta') {
        isMultiSelectMode = false;
        if (selectedItems.size === 0) {
          resultsList.dataset.multiselect = 'false';
        }
      }
    });

    // 处理结果项点击
    resultsList.addEventListener('click', (e) => {
      const item = e.target.closest('.result-item');
      if (!item) return;

      if (isMultiSelectMode || e.shiftKey) {
        e.preventDefault(); // 阻止默认的打开行为
        
        if (e.shiftKey && lastSelectedIndex !== -1) {
          // Shift + 点击：选择范围
          const items = Array.from(resultsList.querySelectorAll('.result-item'));
          const currentIndex = items.indexOf(item);
          const start = Math.min(lastSelectedIndex, currentIndex);
          const end = Math.max(lastSelectedIndex, currentIndex);
          
          items.slice(start, end + 1).forEach(item => {
            item.classList.add('selected');
            selectedItems.add(item.dataset.id);
          });
        } else {
          // Ctrl/Command + 点击：切换选中状态
          item.classList.toggle('selected');
          const itemId = item.dataset.id;
          if (selectedItems.has(itemId)) {
            selectedItems.delete(itemId);
          } else {
            selectedItems.add(itemId);
          }
          lastSelectedIndex = Array.from(resultsList.querySelectorAll('.result-item')).indexOf(item);
        }

        // 更新工具栏状态
        updateBatchToolbar();
      }
    });

    // 批量操作按钮事件
    batchActions.forEach(btn => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        switch (action) {
          case 'open-all':
            openSelectedItems();
            break;
          case 'copy-all':
            copySelectedLinks();
            break;
          case 'clear-selection':
            clearSelection();
            break;
        }
      });
    });
  }

  // 更新批量操作工具栏
  function updateBatchToolbar() {
    const toolbar = document.querySelector('.batch-toolbar');
    if (!toolbar) return;

    const countElement = toolbar.querySelector('.selected-count');
    if (!countElement) return;

    const resultsList = document.getElementById('resultsList');
    if (!resultsList) return;

    const selectedCount = selectedItems.size;
    countElement.textContent = selectedCount;
    toolbar.style.display = selectedCount > 0 ? 'flex' : 'none';

    // 更新多选模式状态
    resultsList.dataset.multiselect = selectedCount > 0 ? 'true' : 'false';
  }

  // 打开选中的项目
  function openSelectedItems() {
    const items = document.querySelectorAll('.result-item.selected');
    items.forEach(item => {
      const url = item.dataset.url;
      if (url) {
        chrome.tabs.create({ url, active: false });
      }
    });
    clearSelection();
  }

  // 复制选中项目的链接
  function copySelectedLinks() {
    const items = document.querySelectorAll('.result-item.selected');
    const links = Array.from(items)
      .map(item => item.dataset.url)
      .filter(Boolean)
      .join('\n');

    navigator.clipboard.writeText(links).then(() => {
      // 可以添加一个复制成功的提示
      clearSelection();
    });
  }

  // 清除选择
  function clearSelection() {
    const items = document.querySelectorAll('.result-item.selected');
    items.forEach(item => item.classList.remove('selected'));
    selectedItems.clear();
    lastSelectedIndex = -1;
    updateBatchToolbar();
  }

  // 初始化右键菜单
  function initContextMenu() {
    const contextMenu = document.querySelector('.context-menu');
    const deleteText = contextMenu.querySelector('.delete-text');
    const editAction = contextMenu.querySelector('.edit-action');
    const extractSummaryAction = contextMenu.querySelector('.extract-summary-action');
    let activeItem = null;

    function updateMenuItems() {
      const textMap = {
        bookmarks: '删除书签',
        tabs: '关闭标签页',
        groups: '删除快照',
        history: '删除此记录',
        downloads: '删除记录',
        ai: '删除'
      };
      if (deleteText) {
        deleteText.textContent = textMap[currentMode] || '删除';
      }
      
      if (editAction) {
        editAction.style.display = currentMode === 'bookmarks' ? 'flex' : 'none';
      }

      if (extractSummaryAction) {
        const isBookmarkSource = activeItem?.dataset?.source === 'bookmark' || currentMode === 'bookmarks';
        extractSummaryAction.style.display = (currentMode === 'ai' && isBookmarkSource) ? 'flex' : 'none';
      }
      
      const deleteAction = contextMenu.querySelector('.delete-action');
      if (deleteAction) {
        deleteAction.style.display = currentMode === 'groups' ? 'none' : 'flex';
      }
    }

    function updateDeleteMenuText() {
      updateMenuItems();
    }

    // 显示右键菜单
    function showContextMenu(e, item) {
      e.preventDefault();
      activeItem = item;
      
      // 更新删除菜单文案
      updateDeleteMenuText();
      
      const x = e.clientX;
      const y = e.clientY;
      
      // 先让菜单可见以便测量真实尺寸（display:none 时宽高为 0，会导致底部/右侧遮挡）
      contextMenu.classList.remove('show');
      contextMenu.style.display = 'block';
      contextMenu.style.visibility = 'hidden';
      contextMenu.style.left = '0px';
      contextMenu.style.top = '0px';

      // 确保菜单不会超出窗口
      const menuRect = contextMenu.getBoundingClientRect();
      const windowWidth = window.innerWidth;
      const windowHeight = window.innerHeight;
      
      let menuX = x;
      let menuY = y;
      
      if (x + menuRect.width > windowWidth) {
        menuX = windowWidth - menuRect.width - 8;
      }
      
      if (y + menuRect.height > windowHeight) {
        menuY = windowHeight - menuRect.height - 8;
      }

      // 防止出现负值（极端情况下菜单比视窗还大）
      menuX = Math.max(8, menuX);
      menuY = Math.max(8, menuY);
      
      contextMenu.style.left = menuX + 'px';
      contextMenu.style.top = menuY + 'px';
      
      // 使用 requestAnimationFrame 确保过渡动画正常工作
      requestAnimationFrame(() => {
        contextMenu.style.visibility = 'visible';
        contextMenu.classList.add('show');
      });
    }

    // 隐藏右键菜单
    function hideContextMenu() {
      contextMenu.classList.remove('show');
      setTimeout(() => {
        contextMenu.style.display = 'none';
        contextMenu.style.visibility = '';
      }, 100);
    }

    // 处理删除操作
    async function handleDelete() {
      if (!activeItem) return;
      
      const itemId = activeItem.dataset.id;
      const url = activeItem.dataset.url;
      const title = (activeItem.querySelector('.result-title') || activeItem.querySelector('.group-tab-title'))?.textContent || '未知项目';
      
      // 截断过长的标题
      const displayTitle = title.length > 50 ? title.substring(0, 50) + '...' : title;
      
      try {
        switch (currentMode) {
          case 'bookmarks':
            // 书签删除需要确认，显示书签名称
            if (confirm(`确定要删除书签「${displayTitle}」吗？\n\n此操作不可恢复。`)) {
              await chrome.bookmarks.remove(itemId);
              loadBookmarks(); // 刷新列表
            }
            break;
          case 'tabs':
            // 关闭标签页，显示标签名称
            if (confirm(`确定要关闭标签页「${displayTitle}」吗？`)) {
              const tabId = parseInt(itemId);
              if (!isNaN(tabId)) {
                await chrome.tabs.remove(tabId);
                loadTabs(); // 刷新列表
              }
            }
            break;
          case 'history':
            // 删除历史记录，显示页面标题
            if (confirm(`确定要删除历史记录「${displayTitle}」吗？`)) {
              if (url) {
                await chrome.history.deleteUrl({ url: url });
                loadHistory(); // 刷新列表
              }
            }
            break;
          case 'downloads':
            // 删除下载记录（不删除文件），显示文件名
            if (confirm(`确定要删除下载记录「${displayTitle}」吗？\n\n注意：这只会删除下载记录，不会删除实际文件。`)) {
              const downloadId = parseInt(itemId);
              if (!isNaN(downloadId)) {
                await chrome.downloads.erase({ id: downloadId });
                loadDownloads(); // 刷新列表
              }
            }
            break;
        }
      } catch (error) {
        console.error('删除失败:', error);
        alert('删除失败: ' + error.message);
      }
    }

    function handleExtractSummary() {
      if (!activeItem) return;
      const bookmarkId = activeItem.dataset.id;
      if (!bookmarkId) return;

      const titleEl = activeItem.querySelector('.result-title');
      const originalText = titleEl?.textContent || '';
      if (titleEl) titleEl.textContent = '正在提取摘要...';

      chrome.runtime.sendMessage({
        type: 'EXTRACT_AND_SUMMARIZE',
        bookmarkId
      }, (response) => {
        if (response?.ok) {
          if (titleEl) titleEl.textContent = originalText;
          let summaryEl = activeItem.querySelector('.ai-summary-preview');
          if (!summaryEl) {
            summaryEl = document.createElement('div');
            summaryEl.className = 'ai-summary-preview';
            const content = activeItem.querySelector('.result-item-content');
            if (content) content.appendChild(summaryEl);
          }
          summaryEl.textContent = response.summary || '';
          searchStatsElement.textContent = '摘要提取成功';
        } else {
          if (titleEl) titleEl.textContent = originalText;
          searchStatsElement.textContent = '摘要提取失败: ' + (response?.error || '未知错误');
        }
      });
    }

    function handleMenuAction(action) {
      if (!activeItem) return;
      
      const url = activeItem.dataset.url;
      
      if (action === 'delete') {
        handleDelete();
        hideContextMenu();
        return;
      }
      
      if (action === 'edit') {
        handleEdit();
        hideContextMenu();
        return;
      }

      if (action === 'extract-summary') {
        handleExtractSummary();
        hideContextMenu();
        return;
      }
      
      if (!url) return;
      
      switch (action) {
        case 'open-new':
          chrome.tabs.create({ url });
          window.close();
          break;
        case 'open-incognito':
          chrome.windows.create({ url, incognito: true });
          window.close();
          break;
        case 'copy':
          navigator.clipboard.writeText(url);
          break;
        case 'share':
          if (navigator.share) {
            navigator.share({
              url,
              title: (activeItem.querySelector('.result-title') || activeItem.querySelector('.group-tab-title'))?.textContent || '',
            }).catch(() => {
              // 如果分享失败，复制到剪贴板
              navigator.clipboard.writeText(url);
            });
          } else {
            // 如果不支持分享 API，复制到剪贴板
            navigator.clipboard.writeText(url);
          }
          break;
      }
      
      hideContextMenu();
    }
    
    // 处理编辑操作
    function handleEdit() {
      if (!activeItem || currentMode !== 'bookmarks') return;
      
      const itemId = activeItem.dataset.id;
      const title = activeItem.querySelector('.result-title')?.textContent || '';
      const url = activeItem.dataset.url || '';
      
      openEditModal(itemId, title, url);
    }

    // 监听结果项的右键事件
    document.getElementById('resultsList').addEventListener('contextmenu', (e) => {
      const item = e.target.closest('.result-item') || e.target.closest('.group-tab-item');
      if (item) {
        showContextMenu(e, item);
      }
    });

    // 监听菜单项点击
    contextMenu.addEventListener('click', (e) => {
      const menuItem = e.target.closest('.menu-item');
      if (menuItem) {
        const action = menuItem.dataset.action;
        handleMenuAction(action);
      }
    });

    // 点击其他地方关闭菜单
    document.addEventListener('click', (e) => {
      if (!contextMenu.contains(e.target)) {
        hideContextMenu();
      }
    });

    // ESC 键关闭菜单
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        hideContextMenu();
      }
    });
  }

  // 初始化编辑弹窗
  function initEditModal() {
    const editModal = document.getElementById('editModal');
    const editModalClose = document.getElementById('editModalClose');
    const editCancel = document.getElementById('editCancel');
    const editSave = document.getElementById('editSave');
    const editTitle = document.getElementById('editTitle');
    const editUrl = document.getElementById('editUrl');
    
    let currentEditId = null;
    
    // 关闭弹窗
    function closeEditModal() {
      editModal.classList.remove('show');
      currentEditId = null;
      editTitle.value = '';
      editUrl.value = '';
      searchInput.focus();
    }
    
    // 打开弹窗
    window.openEditModal = function(id, title, url) {
      currentEditId = id;
      editTitle.value = title;
      editUrl.value = url;
      editModal.classList.add('show');
      editTitle.focus();
      editTitle.select();
    };
    
    // 保存编辑
    async function saveEdit() {
      if (!currentEditId) return;
      
      const newTitle = editTitle.value.trim();
      const newUrl = editUrl.value.trim();
      
      if (!newTitle) {
        editTitle.focus();
        return;
      }
      
      if (!newUrl) {
        editUrl.focus();
        return;
      }
      
      // 验证 URL 格式
      try {
        new URL(newUrl);
      } catch (e) {
        alert('请输入有效的网址');
        editUrl.focus();
        return;
      }
      
      try {
        await chrome.bookmarks.update(currentEditId, {
          title: newTitle,
          url: newUrl
        });
        
        closeEditModal();
        loadBookmarks(); // 刷新列表
      } catch (error) {
        console.error('编辑书签失败:', error);
        alert('编辑失败: ' + error.message);
      }
    }
    
    // 绑定事件
    editModalClose.addEventListener('click', closeEditModal);
    editCancel.addEventListener('click', closeEditModal);
    editSave.addEventListener('click', saveEdit);
    
    // 点击遮罩关闭
    editModal.addEventListener('click', (e) => {
      if (e.target === editModal) {
        closeEditModal();
      }
    });
    
    // 键盘事件
    editModal.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        closeEditModal();
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        saveEdit();
      }
    });
    
    // 输入时更新保存按钮状态
    function updateSaveButton() {
      const hasTitle = editTitle.value.trim().length > 0;
      const hasUrl = editUrl.value.trim().length > 0;
      editSave.disabled = !hasTitle || !hasUrl;
    }
    
    editTitle.addEventListener('input', updateSaveButton);
    editUrl.addEventListener('input', updateSaveButton);
  }

  // 在初始化函数中添加右键菜单初始化
  async function init() {
    // 初始化设置
    await window.settings.init();
    await initSettingsPanel();
    
    // 初始化搜索语法帮助
    initSearchSyntaxHelp();
    
    // 初始化排序选项
    initSortOptions();
    
    // 初始化书签筛选器
    initBookmarkFilters();
    updateFiltersVisibility();
    
    // 初始化多选功能
    initMultiSelect();
    
    // 初始化右键菜单
    initContextMenu();
    
    // 初始化编辑弹窗
    initEditModal();
    
    // 加载数据
    loadData();
    searchInput.focus();

    // 添加模式切换事件监听
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        switchMode(btn.dataset.mode);
      });
    });

    // 添加搜索事件监听（debounce 防抖，减少高频 DOM 重建导致的抖动）
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(() => {
        search(e.target.value);
      }, 120);
    });
    
    // 只在文档级别添加键盘事件监听，避免重复
    document.addEventListener('keydown', handleKeydown);
    
    // 加载 favicon
    loadFavicons();

    // 监听书签变化，自动刷新（带防抖，避免批量操作时频繁刷新）
    let bookmarkRefreshTimer = null;
    function scheduleBookmarkRefresh() {
      if (currentMode !== 'bookmarks') return;
      clearTimeout(bookmarkRefreshTimer);
      bookmarkRefreshTimer = setTimeout(() => {
        loadBookmarks();
      }, 300);
    }
    chrome.bookmarks.onCreated.addListener(scheduleBookmarkRefresh);
    chrome.bookmarks.onRemoved.addListener(scheduleBookmarkRefresh);
    chrome.bookmarks.onChanged.addListener(scheduleBookmarkRefresh);
    chrome.bookmarks.onMoved.addListener(scheduleBookmarkRefresh);
  }

  init();
});
