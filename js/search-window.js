/**
 * 独立搜索窗口逻辑
 * 
 * 用于 chrome:// 等不可注入 Content Script 的页面。
 * 与 content-script.js 共享相同的 UI 设计和搜索能力，
 * 但无需 Shadow DOM、EventIsolation、FocusGuard 等隔离机制。
 * 
 * 作为 chrome-extension:// 页面，拥有完整 Chrome API 权限，
 * 通过 chrome.runtime.sendMessage 与 background.js 通信获取数据。
 */

(function () {
  'use strict';

  console.log('[BookmarkSearch] Search window loading...');

  // ==================== 状态 ====================
  let currentMode = 'bookmarks';
  let currentResults = [];
  let selectedIndex = -1;
  let allBookmarks = [];
  let allTabs = [];
  let allGroups = [];
  let allHistory = [];
  let allDownloads = [];
  let allAiData = {};
  let currentSort = 'smart';
  let currentFilter = 'all';
  let currentStyle = 'spotlight';
  let currentFont = 'system';
  let aiSearchDebounceTimer = null;
  let dataLoadPromise = null;

  // 书签使用状态常量
  const BOOKMARK_STATUS = {
    NEVER_USED: 'never_used',
    RARELY_USED: 'rarely_used',
    DORMANT: 'dormant',
    ACTIVE: 'active'
  };

  // 字体配置
  const FONT_CONFIGS = {
    system: { family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif", name: '系统默认' },
    pingfang: { family: "'PingFang SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", name: '苹方' },
    yahei: { family: "'Microsoft YaHei', 'PingFang SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif", name: '微软雅黑' },
    inter: { family: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", name: 'Inter' },
    noto: { family: "'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif", name: 'Noto Sans' },
    sourcehans: { family: "'Source Han Sans SC', 'Noto Sans SC', 'PingFang SC', -apple-system, BlinkMacSystemFont, sans-serif", name: '思源黑体' }
  };

  // ==================== DOM 引用 ====================
  const searchInput = document.getElementById('searchInput');
  const modeTabs = document.getElementById('modeTabs');
  const filterBar = document.getElementById('filterBar');
  const resultsList = document.getElementById('resultsList');
  const searchStats = document.getElementById('searchStats');
  const styleSwitcher = document.getElementById('styleSwitcher');
  const fontSwitcher = document.getElementById('fontSwitcher');
  const settingsBtn = document.getElementById('settingsBtn');
  const contextMenu = document.getElementById('contextMenu');
  const editModal = document.getElementById('editModal');
  const toast = document.getElementById('toast');

  // 安全发送消息，处理 Service Worker 未就绪的情况
  function safeSendMessage(message, callback) {
    try {
      chrome.runtime.sendMessage(message, (response) => {
        if (chrome.runtime.lastError) {
          console.warn('[BookmarkSearch] sendMessage error:', chrome.runtime.lastError.message);
          if (callback) callback(null);
          return;
        }
        if (callback) callback(response);
      });
    } catch (e) {
      console.warn('[BookmarkSearch] sendMessage exception:', e.message);
      if (callback) callback(null);
    }
  }

  // ==================== 初始化 ====================
  async function init() {
    // 加载保存的样式
    safeSendMessage({ type: 'GET_STYLE' }, (response) => {
      if (response && response.style) {
        setStyle(response.style);
      } else {
        setStyle('spotlight');
      }
    });

    // 加载保存的字体
    safeSendMessage({ type: 'GET_FONT' }, (response) => {
      if (response && response.font) {
        setFont(response.font);
      } else {
        setFont('system');
      }
    });

    // 绑定事件
    bindEvents();

    try {
      const result = await chrome.storage.sync.get(['optionsSettings', 'settings']);
      const source = result.optionsSettings || result.settings || {};
      const fromSettings = result.settings?.intelligentSearch || {};
      const fromOptions = result.optionsSettings?.intelligentSearch || {};
      const ai = { ...fromSettings, ...fromOptions };

      let showGroups = false;
      if (source.showGroupsMode !== undefined) {
        showGroups = source.showGroupsMode;
      }
      const groupsBtn = document.querySelector('.mode-tab[data-mode="groups"]');
      if (groupsBtn) groupsBtn.style.display = showGroups ? '' : 'none';

      const aiBtn = document.querySelector('.mode-tab[data-mode="ai"]');
      if (aiBtn) aiBtn.style.display = ai.enabled ? '' : 'none';

      const defaultMode = source.defaultMode || 'bookmarks';
      if (defaultMode !== 'bookmarks') {
        if (defaultMode === 'ai' && !ai.enabled) { /* skip */ }
        else if (defaultMode === 'groups' && !showGroups) { /* skip */ }
        else {
          currentMode = defaultMode;
          document.querySelectorAll('.mode-tab').forEach(tab => {
            tab.classList.toggle('active', tab.dataset.mode === currentMode);
          });
        }
      }
    } catch (_) {}

    filterBar.classList.toggle('show', currentMode === 'bookmarks');

    await loadData();
    search('');

    // 聚焦搜索框
    searchInput.focus();

    console.log('[BookmarkSearch] Search window initialized');
  }

  let searchDebounceTimer = null;

  // ==================== 事件绑定 ====================
  function bindEvents() {
    // 搜索输入（debounce 防抖，减少高频 DOM 重建导致的抖动）
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchDebounceTimer);
      searchDebounceTimer = setTimeout(async () => {
        if (dataLoadPromise) {
          await dataLoadPromise;
        }
        search(e.target.value);
      }, 120);
    });

    // 键盘事件
    searchInput.addEventListener('keydown', handleKeydown);

    // 全局键盘事件（确保 Esc 可以关闭窗口）
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // 如果编辑弹窗打开，先关闭编辑弹窗
        if (editModal.classList.contains('show')) {
          hideEditModal();
          return;
        }
        // 如果右键菜单打开，先关闭右键菜单
        if (contextMenu.classList.contains('show')) {
          hideContextMenu();
          return;
        }
        // 关闭窗口
        window.close();
      }
    });

    // 模式切换
    modeTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.mode-tab');
      if (tab) {
        switchMode(tab.dataset.mode);
      }
    });

    // 筛选器
    filterBar.addEventListener('click', (e) => {
      const filterBtn = e.target.closest('.filter-btn');
      const sortBtn = e.target.closest('.sort-btn');

      if (filterBtn) {
        document.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        filterBtn.classList.add('active');
        currentFilter = filterBtn.dataset.filter;
        search(searchInput.value);
      }

      if (sortBtn) {
        document.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        sortBtn.classList.add('active');
        currentSort = sortBtn.dataset.sort;
        search(searchInput.value);
      }
    });

    // 样式切换
    styleSwitcher.addEventListener('click', cycleStyle);

    // 字体切换
    fontSwitcher.addEventListener('click', cycleFont);

    // 设置按钮
    settingsBtn.addEventListener('click', () => {
      safeSendMessage({ type: 'OPEN_OPTIONS' });
    });

    // 结果项点击
    resultsList.addEventListener('click', (e) => {
      const item = e.target.closest('.result-item');
      if (!item) return;
      const specialAction = item.dataset.specialAction;
      if (specialAction && item.dataset.url) {
        safeSendMessage({ type: 'OPEN_URL', url: item.dataset.url });
        window.close();
        return;
      }
      openResult(parseInt(item.dataset.index));
    });

    // 结果项右键菜单
    resultsList.addEventListener('contextmenu', (e) => {
      const item = e.target.closest('.result-item');
      if (item) {
        e.preventDefault();
        showContextMenu(e, parseInt(item.dataset.index));
      }
    });

    // 点击其他地方关闭右键菜单
    document.addEventListener('click', hideContextMenu);

    // 右键菜单点击
    contextMenu.addEventListener('click', handleContextMenuClick);

    // 编辑弹窗事件
    document.getElementById('editModalClose').addEventListener('click', hideEditModal);
    document.getElementById('editCancel').addEventListener('click', hideEditModal);
    document.getElementById('editSave').addEventListener('click', saveEdit);

    // 加载友情链接
    loadFriendLinks();

    // 监听系统主题变化
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      chrome.storage.sync.get(['optionsSettings', 'settings'], (result) => {
        let userTheme = 'system';
        if (result.optionsSettings && result.optionsSettings.theme) {
          userTheme = result.optionsSettings.theme;
        } else if (result.settings && result.settings.theme) {
          userTheme = result.settings.theme;
        }
        if (userTheme === 'system') {
          setStyle(currentStyle);
        }
      });
    });

    // 监听存储变化以实时更新主题
    chrome.storage.onChanged.addListener((changes, namespace) => {
      if (namespace === 'sync' && (changes.optionsSettings || changes.settings)) {
        setStyle(currentStyle);
      }
    });

    // 监听书签变化消息，自动刷新
    chrome.runtime.onMessage.addListener((message) => {
      if (message.type === 'BOOKMARK_CHANGED' && currentMode === 'bookmarks') {
        loadData();
      }
    });
  }

  // ==================== 键盘导航 ====================
  function handleKeydown(e) {
    switch (e.key) {
      case 'ArrowLeft':
        e.preventDefault();
        switchModePrev();
        return;

      case 'ArrowRight':
        e.preventDefault();
        switchModeNext();
        return;

      case 'Tab':
        e.preventDefault();
        return;
    }

    // 分组模式下不使用上下键/Enter 选中
    if (currentMode === 'groups') return;

    const items = document.querySelectorAll('.result-item');

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (selectedIndex < items.length - 1) {
          selectedIndex++;
          updateSelection();
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (selectedIndex > 0) {
          selectedIndex--;
          updateSelection();
        }
        break;

      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          const allItems = document.querySelectorAll('.result-item');
          const selectedEl = allItems[selectedIndex];
          if (selectedEl?.dataset?.specialAction && selectedEl.dataset.url) {
            safeSendMessage({ type: 'OPEN_URL', url: selectedEl.dataset.url });
            window.close();
            break;
          }
          const targetItem = currentResults[selectedIndex];
          if (targetItem) {
            openResult(selectedIndex);
          } else if (selectedEl?.dataset?.url) {
            safeSendMessage({ type: 'OPEN_URL', url: selectedEl.dataset.url });
            window.close();
          }
        }
        break;
    }
  }

  // ==================== 模式切换 ====================
  function switchMode(mode) {
    currentMode = mode;
    selectedIndex = -1;

    document.querySelectorAll('.mode-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.mode === mode);
    });

    const placeholders = {
      bookmarks: '搜索书签...',
      tabs: '搜索标签页...',
      groups: '搜索分组或分组内标签页...',
      history: '搜索历史记录...',
      downloads: '搜索下载文件...',
      ai: '输入自然语言搜索...'
    };
    searchInput.placeholder = placeholders[mode] || '搜索...';

    filterBar.classList.toggle('show', mode === 'bookmarks');

    loadData().then(() => {
      if (mode === 'groups') {
        const filtered = searchGroups(searchInput.value, allGroups);
        displayGroupResults(filtered);
      } else {
        search(searchInput.value);
      }
    });
  }

  function getVisibleModes() {
    const modes = ['bookmarks', 'tabs'];
    const groupsBtn = document.querySelector('.mode-tab[data-mode="groups"]');
    if (groupsBtn && groupsBtn.style.display !== 'none') modes.push('groups');
    modes.push('history', 'downloads');
    const aiBtn = document.querySelector('.mode-tab[data-mode="ai"]');
    if (aiBtn && aiBtn.style.display !== 'none') modes.push('ai');
    return modes;
  }

  function switchModePrev() {
    const modes = getVisibleModes();
    const currentIndex = modes.indexOf(currentMode);
    switchMode(modes[currentIndex <= 0 ? modes.length - 1 : currentIndex - 1]);
  }

  function switchModeNext() {
    const modes = getVisibleModes();
    const currentIndex = modes.indexOf(currentMode);
    switchMode(modes[currentIndex >= modes.length - 1 ? 0 : currentIndex + 1]);
  }

  // ==================== 数据加载 ====================
  async function loadData() {
    const p = new Promise((resolve) => {
      safeSendMessage({ type: 'GET_DATA', mode: currentMode }, (response) => {
        if (response) {
          switch (currentMode) {
            case 'bookmarks':
              allBookmarks = response.data || [];
              document.getElementById('bookmarksCount').textContent = allBookmarks.length;
              updateFilterCounts();
              break;
            case 'tabs':
              allTabs = response.data || [];
              document.getElementById('tabsCount').textContent = allTabs.length;
              break;
            case 'groups':
              allGroups = response.data || [];
              document.getElementById('groupsCount').textContent = allGroups.length;
              break;
            case 'history':
              allHistory = response.data || [];
              document.getElementById('historyCount').textContent = allHistory.length;
              break;
            case 'downloads':
              allDownloads = response.data || [];
              document.getElementById('downloadsCount').textContent = allDownloads.length;
              break;
            case 'ai':
              allAiData = response.data || {};
              const aiCount = document.getElementById('aiCount');
              if (aiCount) aiCount.textContent = (allAiData.bookmarks || []).length;
              loadSearchWindowRecommendations();
              break;
          }
        }
        resolve();
      });
    });
    dataLoadPromise = p;
    return p;
  }

  function updateFilterCounts() {
    const counts = { never_used: 0, rarely_used: 0, dormant: 0 };
    allBookmarks.forEach(b => {
      if (b.usageStatus && counts.hasOwnProperty(b.usageStatus)) {
        counts[b.usageStatus]++;
      }
    });

    const neverUsedCount = document.querySelector('[data-filter="never_used"] .filter-count');
    const rarelyUsedCount = document.querySelector('[data-filter="rarely_used"] .filter-count');
    const dormantCount = document.querySelector('[data-filter="dormant"] .filter-count');

    if (neverUsedCount) neverUsedCount.textContent = counts.never_used;
    if (rarelyUsedCount) rarelyUsedCount.textContent = counts.rarely_used;
    if (dormantCount) dormantCount.textContent = counts.dormant;
  }

  // ==================== 分组搜索与显示 ====================
  const GROUP_COLORS = {
    grey: '#5f6368', blue: '#1a73e8', red: '#d93025',
    yellow: '#f9ab00', green: '#188038', pink: '#d01884',
    purple: '#a142f4', cyan: '#007b83', orange: '#e8710a'
  };

  async function restoreGroupViaBackground(savedGroup, activateUrl) {
    return new Promise((resolve) => {
      safeSendMessage({ type: 'RESTORE_GROUP', group: savedGroup, activateUrl }, (response) => {
        if (!response) {
          resolve({ success: false, error: 'Service Worker 未响应' });
          return;
        }
        resolve(response);
      });
    });
  }

  async function shouldRestoreWholeGroupOnChildClick() {
    try {
      const result = await chrome.storage.sync.get(['optionsSettings', 'settings']);
      if (result.optionsSettings && result.optionsSettings.groupChildClickRestoreAll !== undefined) {
        return result.optionsSettings.groupChildClickRestoreAll;
      }
      if (result.settings && result.settings.groupChildClickRestoreAll !== undefined) {
        return result.settings.groupChildClickRestoreAll;
      }
    } catch (_) {}
    return true;
  }

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

  function displayGroupResults(groups) {
    resultsList.innerHTML = '';
    currentResults = groups;

    if (groups.length === 0) {
      resultsList.innerHTML = `
        <div class="no-results" style="text-align:center;padding:40px 20px;">
          <div style="font-size:32px;margin-bottom:8px;">📂</div>
          <div>没有找到标签页分组</div>
          <div style="font-size:12px;margin-top:4px;opacity:0.6;">在 Chrome 中创建标签页分组后，这里会自动记录</div>
        </div>`;
      selectedIndex = -1;
      searchStats.textContent = '无结果';
      return;
    }

    const isSearching = searchInput.value.trim().length > 0;

    groups.forEach((group, groupIndex) => {
      const header = document.createElement('div');
      header.className = 'group-header' + (isSearching ? '' : ' collapsed-header');

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
          safeSendMessage({ type: 'OPEN_RESULT', mode: 'tabs', item: { id: group.tabs[0]?.id, windowId: group.windowId } });
          window.close();
        } else {
          openBtn.textContent = '打开中…';
          openBtn.style.pointerEvents = 'none';
          const restored = await restoreGroupViaBackground(group);
          if (restored && restored.success === false) {
            openBtn.textContent = '打开';
            openBtn.style.pointerEvents = '';
            showToast(`分组恢复失败：${restored.error || '未知错误'}`);
            return;
          }
          window.close();
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
          favicon.src = `https://www.google.com/s2/favicons?domain=${new URL(tab.url).hostname}&sz=16`;
        } catch (e) {
          favicon.src = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><path fill=%22%23999%22 d=%22M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z%22/></svg>';
        }
        favicon.onerror = () => { favicon.src = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><path fill=%22%23999%22 d=%22M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z%22/></svg>'; };

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
            safeSendMessage({ type: 'OPEN_RESULT', mode: 'tabs', item: { id: tab.id, windowId: tab.windowId || group.windowId } });
          } else if (tab.url) {
            const restoreWholeGroup = await shouldRestoreWholeGroupOnChildClick();
            const restored = await restoreGroupViaBackground(group, restoreWholeGroup ? undefined : tab.url);
            if (restored && restored.success === false) {
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
    searchStats.textContent = isSearching ? `找到 ${groups.length} 个分组` : `共 ${groups.length} 个分组`;
  }

  // ==================== 搜索 ====================
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
      case 'bookmarks': items = filterByUsageStatus(allBookmarks, currentFilter); break;
      case 'tabs': items = allTabs; break;
      case 'history': items = allHistory; break;
      case 'downloads': items = allDownloads; break;
      default: items = [];
    }

    if (typeof SearchParser !== 'undefined' && SearchParser.filter) {
      items = SearchParser.filter(items, query || '');
    } else if (query && query.trim()) {
      const tokens = query.trim().split(/\s+/).filter(Boolean).map(t => t.toLowerCase());
      items = items.filter(item => {
        const searchable = [item.title || '', item.url || '', item.filename || ''].join(' ').toLowerCase();
        return tokens.every(t => searchable.includes(t));
      });
    }

    let effectiveSort = currentSort;
    if (currentSort === 'smart') {
      if ((currentMode === 'history' || currentMode === 'tabs' || currentMode === 'downloads') && !query?.trim()) {
        effectiveSort = 'time';
      }
    }

    if (typeof SmartSort !== 'undefined' && SmartSort.sort) {
      items = SmartSort.sort(items, { searchText: query || '', mode: effectiveSort });
    } else {
      items = sortItems(items, query || '', effectiveSort);
    }

    currentResults = items;
    selectedIndex = items.length > 0 ? 0 : -1;
    displayResults(items, query);

    if (query && query.trim() && currentMode !== 'history') {
      appendHistorySuggestions(query, items);
    }
  }

  function searchAi(query) {
    if (!query || !query.trim()) {
      resultsList.innerHTML = '';
      currentResults = [];
      searchStats.textContent = '输入需求描述或关键词，AI 语义搜索';
      selectedIndex = -1;
      loadSearchWindowRecommendations();
      return;
    }

    clearTimeout(aiSearchDebounceTimer);
    searchStats.textContent = '语义搜索中...';

    aiSearchDebounceTimer = setTimeout(() => {
      safeSendMessage({
        type: 'INTELLIGENT_SEARCH',
        query: query.trim(),
        limit: 50,
        rerank: true
      }, (response) => {
        if (!response) {
          searchStats.textContent = 'AI 搜索无响应';
          return;
        }
        if (response.fallback) {
          const items = allAiData.bookmarks || [];
          let filtered = (typeof SearchParser !== 'undefined' && SearchParser.filter)
            ? SearchParser.filter(items, query)
            : items;
          if (typeof SmartSort !== 'undefined' && SmartSort.sort) {
            filtered = SmartSort.sort(filtered, { searchText: query, mode: currentSort });
          }
          currentResults = filtered;
          selectedIndex = filtered.length > 0 ? 0 : -1;
          displayResults(filtered, query);
          searchStats.textContent = `找到 ${filtered.length} 个结果 (关键词回退)`;
          return;
        }
        if (response.ok && response.results) {
          currentResults = response.results;
          selectedIndex = response.results.length > 0 ? 0 : -1;
          displayAiResults(response.results, query);
          const semanticCount = response.results.filter(r => r._matchType === 'semantic' || r._matchType === 'hybrid').length;
          searchStats.textContent = `找到 ${response.results.length} 个结果 (语义 ${semanticCount})`;
        }
      });
    }, 300);
  }

  function displayAiResults(items, query) {
    resultsList.innerHTML = '';

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

      const favicon = document.createElement('img');
      favicon.className = 'result-favicon';
      favicon.width = 16; favicon.height = 16;
      try {
        favicon.src = `https://www.google.com/s2/favicons?domain=${new URL(item.url).hostname}&sz=16`;
      } catch { favicon.src = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><path fill=%22%23999%22 d=%22M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z%22/></svg>'; }
      favicon.onerror = () => { favicon.src = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><path fill=%22%23999%22 d=%22M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z%22/></svg>'; };

      const content = document.createElement('div');
      content.className = 'result-content';

      const title = document.createElement('div');
      title.className = 'result-title';
      title.textContent = item.title || '无标题';

      const url = document.createElement('div');
      url.className = 'result-url';
      url.textContent = item.url || '';

      content.appendChild(title);
      content.appendChild(url);

      if (item._summary) {
        const summaryDiv = document.createElement('div');
        summaryDiv.className = 'ai-summary-preview';
        summaryDiv.textContent = item._summary;
        content.appendChild(summaryDiv);
      }

      div.appendChild(favicon);
      div.appendChild(content);

      const metaWrap = document.createElement('div');
      metaWrap.className = 'result-meta';

      if (item._source) {
        const sourceBadge = document.createElement('span');
        const sourceLabels = { bookmark: '书签', history: '历史', tab: '标签页' };
        sourceBadge.className = 'ai-source-badge ai-source-' + item._source;
        sourceBadge.textContent = sourceLabels[item._source] || item._source;
        metaWrap.appendChild(sourceBadge);
      }

      if (item._matchType) {
        const badge = document.createElement('span');
        badge.className = 'ai-match-badge ai-match-' + item._matchType;
        const labels = { keyword: '关键词', semantic: '语义', hybrid: '混合' };
        badge.textContent = labels[item._matchType] || item._matchType;
        metaWrap.appendChild(badge);
      }

      if (item._relevance > 0) {
        const relBar = document.createElement('span');
        relBar.className = 'ai-relevance-bar';
        const level = item._relevance >= 60 ? 'high' : item._relevance >= 30 ? 'medium' : 'low';
        relBar.innerHTML = `<span class="ai-relevance-track"><span class="ai-relevance-fill ${level}" style="width:${item._relevance}%"></span></span><span>${item._relevance}%</span>`;
        metaWrap.appendChild(relBar);
      }

      if (metaWrap.children.length > 0) div.appendChild(metaWrap);

      div.addEventListener('click', () => {
        if (item._source === 'tab' && item.id) {
          const tabId = parseInt(String(item.id).replace('tab_', ''));
          if (!isNaN(tabId)) {
            safeSendMessage({ type: 'OPEN_URL', url: item.url });
            window.close();
            return;
          }
        }
        if (item.url) {
          safeSendMessage({ type: 'OPEN_URL', url: item.url });
          window.close();
        }
      });

      resultsList.appendChild(div);
    });
  }

  function loadSearchWindowRecommendations() {
    safeSendMessage({ type: 'GET_AI_RECOMMENDATIONS', currentUrl: '', currentTitle: document.title || 'search', topK: 8 }, (response) => {
      if (!response || !response.ok || !response.results || response.results.length === 0) return;
      if (searchInput.value.trim()) return;

      resultsList.innerHTML = '';
      currentResults = response.results;
      const container = document.createElement('div');
      container.className = 'ai-recommendations';
      const header = document.createElement('div');
      header.className = 'ai-rec-header';
      header.innerHTML = '<span>✨</span><span>为你推荐</span><span class="ai-rec-badge">AI 推荐</span>';
      container.appendChild(header);

      response.results.forEach(item => {
        const div = document.createElement('div');
        div.className = 'ai-rec-item';
        div.dataset.url = item.url || '';
        const icon = document.createElement('img');
        icon.width = 16; icon.height = 16; icon.style.flexShrink = '0';
        try { icon.src = `https://www.google.com/s2/favicons?domain=${new URL(item.url).hostname}&sz=16`; } catch { /* empty */ }

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
        div.appendChild(icon);
        div.appendChild(content);
        if (item._relevance > 0) {
          const score = document.createElement('span');
          score.className = 'ai-rec-score';
          score.textContent = item._relevance + '%';
          div.appendChild(score);
        }
        div.addEventListener('click', () => { if (item.url) { safeSendMessage({ type: 'OPEN_URL', url: item.url }); window.close(); } });
        container.appendChild(div);
      });
      resultsList.appendChild(container);
      selectedIndex = -1;
    });
  }

  function appendHistorySuggestions(query, existingResults) {
    const existingUrls = new Set(existingResults.map(r => r.url).filter(Boolean));

    safeSendMessage({ type: 'SUGGEST_HISTORY', query: query, maxResults: 8 }, (response) => {
      if (!response || !response.suggestions || response.suggestions.length === 0) return;
      if (searchInput.value.trim() !== query.trim()) return;

      const suggestions = response.suggestions
        .filter(item => item.url && !existingUrls.has(item.url))
        .slice(0, 5);
      if (suggestions.length === 0) return;

      const resultsList = document.getElementById('resultsList');

      const divider = document.createElement('div');
      divider.className = 'suggestion-divider';
      divider.innerHTML = '<span class="suggestion-divider-text">最近访问</span>';
      resultsList.appendChild(divider);

      suggestions.forEach((item) => {
        const el = document.createElement('div');
        el.className = 'result-item suggestion-item';
        el.dataset.url = item.url;

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
        url.textContent = item.url;
        content.appendChild(title);
        content.appendChild(url);

        el.appendChild(iconWrap);
        el.appendChild(content);

        el.addEventListener('click', () => {
          safeSendMessage({ type: 'OPEN_RESULT', mode: 'history', item: { url: item.url } });
          window.close();
        });

        resultsList.appendChild(el);
      });
    });
  }

  function filterByUsageStatus(bookmarks, filter) {
    if (filter === 'all') return bookmarks;
    return bookmarks.filter(b => b.usageStatus === filter);
  }

  function sortItems(items, searchText, sortMode) {
    const sorted = [...items];
    const mode = sortMode || currentSort;

    const getScore = (item) => {
      switch (mode) {
        case 'time':
          return item.lastVisit || item.lastVisitTime || item.startTime || item.dateAdded || 0;
        case 'frequency':
          return item.visitCount || 0;
        case 'smart':
        default:
          let score = 0;
          if (searchText && item.title?.toLowerCase().includes(searchText.toLowerCase())) {
            score += 100;
          }
          score += (item.visitCount || 0) * 0.5;
          score += ((item.lastVisit || item.lastVisitTime || 0) / 1000000000000) * 0.3;
          return score;
      }
    };

    sorted.sort((a, b) => getScore(b) - getScore(a));
    return sorted;
  }

  // 搜索引擎定义（本地兜底，不依赖 settings.js 加载）
  const SW_SEARCH_ENGINES = {
    google: { name: 'Google', url: 'https://www.google.com/search?q={query}' },
    baidu: { name: '百度', url: 'https://www.baidu.com/s?wd={query}' },
    bing: { name: 'Bing', url: 'https://www.bing.com/search?q={query}' },
    duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={query}' }
  };

  function getDefaultSearchEngine() {
    return navigator.language.startsWith('zh') ? 'baidu' : 'google';
  }

  async function getSearchEngine() {
    try {
      const result = await new Promise(resolve => {
        chrome.storage.sync.get(['optionsSettings'], resolve);
      });
      const engineKey = result.optionsSettings?.defaultSearchEngine || getDefaultSearchEngine();
      const engine = SW_SEARCH_ENGINES[engineKey] || SW_SEARCH_ENGINES[getDefaultSearchEngine()];
      return { key: engineKey, ...engine };
    } catch {
      const key = getDefaultSearchEngine();
      return { key, ...SW_SEARCH_ENGINES[key] };
    }
  }

  // URL 识别
  const URL_PATTERN_LOCAL = /^(https?:\/\/|www\.)|(\w+\.(?:com|cn|org|net|io|dev|edu|gov|app|me|co)\b)/i;

  function normalizeUrlLocal(input) {
    if (/^https?:\/\//.test(input)) return input;
    if (input.startsWith('www.')) return 'https://' + input;
    if (URL_PATTERN_LOCAL.test(input)) return 'https://' + input;
    return null;
  }

  function createSpecialItemHtml(type, title, subtitle, url) {
    const iconSvg = type === 'url'
      ? '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M3.9 12c0-1.71 1.39-3.1 3.1-3.1h4V7H7c-2.76 0-5 2.24-5 5s2.24 5 5 5h4v-1.9H7c-1.71 0-3.1-1.39-3.1-3.1zM8 13h8v-2H8v2zm9-6h-4v1.9h4c1.71 0 3.1 1.39 3.1 3.1s-1.39 3.1-3.1 3.1h-4V17h4c2.76 0 5-2.24 5-5s-2.24-5-5-5z"/></svg>'
      : '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M15.5 14h-.79l-.28-.27C15.41 12.59 16 11.11 16 9.5 16 5.91 13.09 3 9.5 3S3 5.91 3 9.5 5.91 16 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14z"/></svg>';
    const itemClass = type === 'url' ? 'url-open-item' : 'search-engine-item';
    return `
      <div class="result-item special-item ${itemClass}" data-special-action="${type === 'url' ? 'open-url' : 'search-engine'}" data-url="${escapeHtml(url)}">
        <div class="result-icon special-icon">${iconSvg}</div>
        <div class="result-content">
          <div class="result-title">${title}</div>
          <div class="result-url">${escapeHtml(subtitle)}</div>
        </div>
      </div>
    `;
  }

  // ==================== 显示结果 ====================
  function displayResults(items, query = '') {
    const trimmedQuery = query.trim();

    if (items.length === 0 && !trimmedQuery) {
      resultsList.innerHTML = '<div class="no-results">没有找到匹配的结果</div>';
      searchStats.textContent = '无结果';
      return;
    }

    if (items.length === 0 && trimmedQuery) {
      let html = '';
      const detectedUrl = normalizeUrlLocal(trimmedQuery);
      if (detectedUrl) {
        html += createSpecialItemHtml('url', `打开 ${escapeHtml(detectedUrl)}`, '在新标签页中打开此链接', detectedUrl);
      }
      resultsList.innerHTML = html + '<div class="no-results">没有找到匹配的本地结果</div>';
      searchStats.textContent = '无结果';

      getSearchEngine().then(engine => {
        const searchUrl = engine.url.replace('{query}', encodeURIComponent(trimmedQuery));
        const engineHtml = createSpecialItemHtml('search', `使用 ${escapeHtml(engine.name)} 搜索 "<strong>${escapeHtml(trimmedQuery)}</strong>"`, '在新标签页中搜索', searchUrl);
        const noResultsEl = resultsList.querySelector('.no-results');
        if (noResultsEl) {
          noResultsEl.insertAdjacentHTML('beforebegin', engineHtml);
        } else {
          resultsList.insertAdjacentHTML('beforeend', engineHtml);
        }
      });
      return;
    }

    resultsList.innerHTML = items.slice(0, 50).map((item, index) => {
      const isActive = index === selectedIndex ? 'active' : '';
      const faviconUrl = getFaviconUrl(item);
      const meta = getMetaInfo(item);

      return `
        <div class="result-item ${isActive}" data-index="${index}">
          <div class="result-icon">
            <img src="${faviconUrl}" data-fallback="true">
          </div>
          <div class="result-content">
            <div class="result-title">${escapeHtml(item.title || item.filename?.split('/').pop() || '无标题')}</div>
            <div class="result-url">${escapeHtml(item.url || '')}</div>
          </div>
          <div class="result-meta">${meta}</div>
        </div>
      `;
    }).join('');

    // 有搜索词时追加搜索引擎跳转
    if (trimmedQuery) {
      const detectedUrl = normalizeUrlLocal(trimmedQuery);
      let extraHtml = '<div class="suggestion-divider"></div>';
      if (detectedUrl) {
        extraHtml += createSpecialItemHtml('url', `打开 ${escapeHtml(detectedUrl)}`, '在新标签页中打开此链接', detectedUrl);
      }
      resultsList.insertAdjacentHTML('beforeend', extraHtml);

      getSearchEngine().then(engine => {
        const searchUrl = engine.url.replace('{query}', encodeURIComponent(trimmedQuery));
        resultsList.insertAdjacentHTML('beforeend',
          createSpecialItemHtml('search', `使用 ${escapeHtml(engine.name)} 搜索 "<strong>${escapeHtml(trimmedQuery)}</strong>"`, '在新标签页中搜索', searchUrl)
        );
      });
    }

    searchStats.textContent = `找到 ${items.length} 个结果`;

    const fallbackSvg = 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><path fill=%22%23999%22 d=%22M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z%22/></svg>';
    resultsList.querySelectorAll('img[data-fallback]').forEach(img => {
      img.addEventListener('error', function() {
        this.src = fallbackSvg;
      }, { once: true });
    });
  }

  function updateSelection() {
    const items = document.querySelectorAll('.result-item');
    items.forEach((item, index) => {
      if (index === selectedIndex) {
        item.classList.add('active');
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        item.classList.remove('active');
      }
    });
  }

  // ==================== 打开结果 ====================
  function openResult(index) {
    const item = currentResults[index];
    if (!item) return;

    safeSendMessage({
      type: 'OPEN_RESULT',
      mode: currentMode,
      item: item
    });

    // 打开后关闭搜索窗口
    window.close();
  }

  // ==================== 样式与字体 ====================
  function setStyle(style) {
    currentStyle = style;

    // 移除所有样式类（保留字体类）
    const fontClass = Array.from(document.body.classList).find(c => c.startsWith('font-'));
    document.body.className = '';
    if (fontClass) {
      document.body.classList.add(fontClass);
    }

    // 添加样式类
    document.body.classList.add(`style-${style}`);

    // 应用主题
    chrome.storage.sync.get(['optionsSettings', 'settings'], (result) => {
      let userTheme = 'system';
      if (result.optionsSettings && result.optionsSettings.theme) {
        userTheme = result.optionsSettings.theme;
      } else if (result.settings && result.settings.theme) {
        userTheme = result.settings.theme;
      }

      let isDark = false;
      if (userTheme === 'dark') {
        isDark = true;
      } else if (userTheme === 'light') {
        isDark = false;
      } else {
        isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      }

      document.body.classList.remove('dark', 'light');

      if (isDark && (style === 'spotlight' || style === 'fluent')) {
        document.body.classList.add('dark');
      } else if (!isDark && style === 'raycast') {
        document.body.classList.add('light');
      }
    });
  }

  function cycleStyle() {
    const styles = ['spotlight', 'raycast', 'fluent'];
    const currentIndex = styles.indexOf(currentStyle);
    const nextIndex = (currentIndex + 1) % styles.length;
    setStyle(styles[nextIndex]);

    safeSendMessage({
      type: 'SAVE_STYLE',
      style: styles[nextIndex]
    });
  }

  function setFont(font) {
    currentFont = font;
    Object.keys(FONT_CONFIGS).forEach(f => {
      document.body.classList.remove(`font-${f}`);
    });
    document.body.classList.add(`font-${font}`);
  }

  function cycleFont() {
    const fonts = ['system', 'pingfang', 'inter', 'noto'];
    const currentIndex = fonts.indexOf(currentFont);
    const nextIndex = (currentIndex + 1) % fonts.length;
    setFont(fonts[nextIndex]);

    safeSendMessage({
      type: 'SAVE_FONT',
      font: fonts[nextIndex]
    });

    const fontConfig = FONT_CONFIGS[fonts[nextIndex]];
    showToast(`字体: ${fontConfig?.name || fonts[nextIndex]}`);
  }

  // ==================== 右键菜单 ====================
  let contextMenuTarget = null;
  let contextMenuIndex = -1;

  function showContextMenu(e, index) {
    contextMenuIndex = index;
    contextMenuTarget = currentResults[index];

    const editAction = contextMenu.querySelector('.edit-action');
    const deleteAction = contextMenu.querySelector('.delete-action');

    if (currentMode === 'bookmarks') {
      editAction.style.display = 'flex';
      deleteAction.style.display = 'flex';
      deleteAction.querySelector('.delete-text').textContent = '删除书签';
    } else if (currentMode === 'history') {
      editAction.style.display = 'none';
      deleteAction.style.display = 'flex';
      deleteAction.querySelector('.delete-text').textContent = '删除历史记录';
    } else if (currentMode === 'downloads') {
      editAction.style.display = 'none';
      deleteAction.style.display = 'flex';
      deleteAction.querySelector('.delete-text').textContent = '删除下载记录';
    } else {
      editAction.style.display = 'none';
      deleteAction.style.display = 'none';
    }

    // 先显示获取尺寸
    contextMenu.style.visibility = 'hidden';
    contextMenu.classList.add('show');
    const menuRect = contextMenu.getBoundingClientRect();
    contextMenu.style.visibility = '';

    let x = e.clientX;
    let y = e.clientY;

    // 确保不超出窗口边界
    if (x + menuRect.width > window.innerWidth - 10) {
      x = window.innerWidth - menuRect.width - 10;
    }
    if (y + menuRect.height > window.innerHeight - 10) {
      y = y - menuRect.height;
      if (y < 10) y = 10;
    }
    if (x < 10) x = 10;

    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
  }

  function hideContextMenu() {
    contextMenu.classList.remove('show');
    contextMenuTarget = null;
    contextMenuIndex = -1;
  }

  function handleContextMenuClick(e) {
    const menuItem = e.target.closest('.menu-item');
    if (!menuItem || !contextMenuTarget) return;

    const action = menuItem.dataset.action;

    switch (action) {
      case 'open-new':
        safeSendMessage({
          type: 'OPEN_RESULT',
          mode: currentMode,
          item: contextMenuTarget,
          newTab: true
        });
        break;

      case 'open-incognito':
        safeSendMessage({
          type: 'OPEN_INCOGNITO',
          url: contextMenuTarget.url
        });
        break;

      case 'copy':
        copyToClipboard(contextMenuTarget.url);
        showToast('链接已复制');
        break;

      case 'share':
        if (navigator.share) {
          navigator.share({
            title: contextMenuTarget.title,
            url: contextMenuTarget.url
          });
        } else {
          copyToClipboard(contextMenuTarget.url);
          showToast('链接已复制（可直接粘贴分享）');
        }
        break;

      case 'edit':
        showEditModal(contextMenuTarget);
        break;

      case 'delete':
        confirmDelete(contextMenuTarget);
        break;
    }

    hideContextMenu();
  }

  // ==================== 编辑功能 ====================
  let editingItem = null;

  function showEditModal(item) {
    editingItem = item;
    const titleInput = document.getElementById('editTitle');
    const urlInput = document.getElementById('editUrl');

    titleInput.value = item.title || '';
    urlInput.value = item.url || '';

    editModal.classList.add('show');
    titleInput.focus();

    // 键盘事件
    const handleEditKeydown = (e) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        hideEditModal();
        editModal.removeEventListener('keydown', handleEditKeydown);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        saveEdit();
        editModal.removeEventListener('keydown', handleEditKeydown);
      }
    };

    editModal.addEventListener('keydown', handleEditKeydown);
  }

  function hideEditModal() {
    editModal.classList.remove('show');
    editingItem = null;
    searchInput.focus();
  }

  function saveEdit() {
    if (!editingItem) return;

    const titleInput = document.getElementById('editTitle');
    const urlInput = document.getElementById('editUrl');

    const newTitle = titleInput.value.trim();
    const newUrl = urlInput.value.trim();

    if (!newTitle || !newUrl) {
      showToast('标题和网址不能为空');
      return;
    }

    safeSendMessage({
      type: 'EDIT_BOOKMARK',
      id: editingItem.id,
      title: newTitle,
      url: newUrl
    }, (response) => {
      if (response && response.success) {
        showToast('书签已更新');
        loadData().then(() => {
          search(searchInput.value);
        });
      } else {
        showToast('更新失败');
      }
    });

    hideEditModal();
  }

  function confirmDelete(item) {
    const typeText = {
      bookmarks: '书签',
      history: '历史记录',
      downloads: '下载记录'
    }[currentMode] || '项目';

    if (confirm(`确定要删除这个${typeText}吗？\n${item.title || item.url}`)) {
      safeSendMessage({
        type: 'DELETE_ITEM',
        mode: currentMode,
        item: item
      }, (response) => {
        if (response && response.success) {
          showToast(`${typeText}已删除`);
          loadData().then(() => {
            search(searchInput.value);
          });
        } else {
          showToast('删除失败');
        }
      });
    }
  }

  // ==================== 友情链接 ====================
  async function loadFriendLinks() {
    try {
      const result = await chrome.storage.sync.get('optionsSettings');
      const defaultLinks = [
        { name: 'DeepSeek', url: 'https://www.deepseek.com' },
        { name: '爱奇艺', url: 'https://www.iqiyi.com' },
        { name: '哔哩哔哩', url: 'https://www.bilibili.com' },
        { name: 'YouTube', url: 'https://www.youtube.com' }
      ];

      const links = result.optionsSettings?.friendLinks || defaultLinks;
      const container = document.getElementById('friendLinksContainer');

      container.innerHTML = links.map(link => {
        let hostname = '';
        try { hostname = new URL(link.url).hostname; } catch (e) {}

        return `
          <a href="${escapeHtml(link.url)}" class="friend-link-item" target="_blank" title="${escapeHtml(link.name)}">
            <img class="friend-link-favicon" src="https://www.google.com/s2/favicons?domain=${hostname}&sz=32" data-hide-on-error="true">
            <span class="friend-link-tag">${escapeHtml(link.name)}</span>
          </a>
        `;
      }).join('');

      container.querySelectorAll('img[data-hide-on-error]').forEach(img => {
        img.addEventListener('error', function() {
          this.style.display = 'none';
        }, { once: true });
      });

      // 点击友情链接
      container.addEventListener('click', (e) => {
        const link = e.target.closest('.friend-link-item');
        if (link) {
          // 延迟关闭，确保链接能正常打开
          setTimeout(() => window.close(), 100);
        }
      });
    } catch (e) {
      console.error('[BookmarkSearch] Failed to load friend links:', e);
    }
  }

  // ==================== 工具函数 ====================
  function getFaviconUrl(item) {
    try {
      if (item.url) {
        const url = new URL(item.url);
        return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
      }
    } catch (e) {}
    return 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><path fill=%22%23999%22 d=%22M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z%22/></svg>';
  }

  function getMetaInfo(item) {
    let html = '';

    if (item.visitCount > 0) {
      html += `<span class="meta-badge">${item.visitCount}次</span>`;
    }

    if (item.lastVisit) {
      html += `<span class="meta-time">${formatTime(item.lastVisit)}</span>`;
    }

    if (item.usageStatus && item.usageStatus !== BOOKMARK_STATUS.ACTIVE) {
      const statusLabels = {
        [BOOKMARK_STATUS.NEVER_USED]: { text: '从未访问', class: 'never-used' },
        [BOOKMARK_STATUS.RARELY_USED]: { text: '访问较少', class: 'rarely-used' },
        [BOOKMARK_STATUS.DORMANT]: { text: '长期未访问', class: 'dormant' }
      };
      const status = statusLabels[item.usageStatus];
      if (status) {
        html = `<span class="status-tag ${status.class}">${status.text}</span>` + html;
      }
    }

    return html;
  }

  function formatTime(timestamp) {
    const date = new Date(timestamp);
    const now = new Date();
    const diff = now - date;

    if (diff < 60000) return '刚刚';
    if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`;
    if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`;
    if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`;
    return date.toLocaleDateString();
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function copyToClipboard(text) {
    navigator.clipboard.writeText(text).catch(() => {
      // 降级方案
      const textarea = document.createElement('textarea');
      textarea.value = text;
      textarea.style.position = 'fixed';
      textarea.style.opacity = '0';
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand('copy');
      document.body.removeChild(textarea);
    });
  }

  function showToast(message) {
    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2000);
  }

  // ==================== 启动 ====================
  init();

})();
