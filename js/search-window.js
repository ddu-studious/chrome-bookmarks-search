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
  let cachedProStatus = null;

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
      updatePlatformPlaceholderSW(e.target.value);
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

  // ==================== 多选状态 ====================
  let selectedItems = new Set();

  function clearMultiSelection() {
    selectedItems.clear();
    document.querySelectorAll('.result-item.selected').forEach(el => {
      el.classList.remove('selected');
    });
  }

  function updateMultiSelectionUI() {
    const items = document.querySelectorAll('.result-item');
    items.forEach((item, index) => {
      item.classList.toggle('selected', selectedItems.has(index));
    });
  }

  function openMultiSelectedItems() {
    const sortedIndices = Array.from(selectedItems).sort((a, b) => a - b);
    sortedIndices.forEach(idx => {
      const item = currentResults[idx];
      if (item && item.url) {
        safeSendMessage({ type: 'OPEN_URL', url: item.url });
      }
    });
    clearMultiSelection();
    window.close();
  }

  // ==================== 键盘导航 ====================
  function handleKeydown(e) {
    // Tab / Shift+Tab 切换搜索模式
    if (e.key === 'Tab') {
      e.preventDefault();
      if (e.shiftKey) {
        switchModePrev();
      } else {
        switchModeNext();
      }
      return;
    }

    // 分组模式下不使用上下键/Enter 选中
    if (currentMode === 'groups') return;

    const items = document.querySelectorAll('.result-item');

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        if (items.length === 0) break;
        if (e.shiftKey) {
          // Shift+↓: 扩展多选
          if (selectedIndex < items.length - 1) {
            if (selectedItems.size === 0 && selectedIndex >= 0) {
              selectedItems.add(selectedIndex);
            }
            selectedIndex++;
            selectedItems.add(selectedIndex);
            updateSelection();
            updateMultiSelectionUI();
          }
        } else {
          if (selectedItems.size > 0) clearMultiSelection();
          if (selectedIndex < items.length - 1) {
            selectedIndex++;
          } else if (selectedIndex === -1) {
            selectedIndex = 0;
          }
          updateSelection();
        }
        break;

      case 'ArrowUp':
        e.preventDefault();
        if (items.length === 0) break;
        if (e.shiftKey) {
          // Shift+↑: 扩展多选
          if (selectedIndex > 0) {
            if (selectedItems.size === 0 && selectedIndex >= 0) {
              selectedItems.add(selectedIndex);
            }
            selectedIndex--;
            selectedItems.add(selectedIndex);
            updateSelection();
            updateMultiSelectionUI();
          }
        } else {
          if (selectedItems.size > 0) clearMultiSelection();
          if (selectedIndex > 0) {
            selectedIndex--;
          } else if (selectedIndex === -1) {
            selectedIndex = items.length - 1;
          }
          updateSelection();
        }
        break;

      case 'Enter': {
        e.preventDefault();
        let handled = false;

        // 有多选项时，批量打开
        if (selectedItems.size > 1) {
          openMultiSelectedItems();
          return;
        }

        if (selectedIndex >= 0) {
          const allItems = document.querySelectorAll('.result-item');
          const selectedEl = allItems[selectedIndex];
          if (selectedEl?.dataset?.specialAction && selectedEl.dataset.url) {
            safeSendMessage({ type: 'OPEN_URL', url: selectedEl.dataset.url });
            handled = true;
          } else {
            const targetItem = currentResults[selectedIndex];
            if (targetItem) {
              openResult(selectedIndex);
              return;
            } else if (selectedEl?.dataset?.url) {
              safeSendMessage({ type: 'OPEN_URL', url: selectedEl.dataset.url });
              handled = true;
            }
          }
        }

        if (!handled) {
          const query = searchInput.value.trim();
          if (query) {
            getSearchEngine().then(engine => {
              const searchUrl = engine.url.replace('{query}', encodeURIComponent(query));
              safeSendMessage({ type: 'OPEN_URL', url: searchUrl });
              window.close();
            });
            return;
          }
        }

        window.close();
        break;
      }
    }
  }

  // ==================== 模式切换 ====================
  function switchMode(mode) {
    currentMode = mode;
    selectedIndex = -1;
    clearMultiSelection();

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
              BookmarkTags.getAll().then(tagData => {
                for (const bm of allBookmarks) {
                  bm._tags = tagData.tags[bm.id] || [];
                }
              }).catch(() => {});
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
              checkAiProAccess().then(canUse => {
                if (canUse) {
                  loadSearchWindowRecommendations();
                } else {
                  showSearchWindowAiUpgradePrompt();
                }
              });
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
    // 搜索时清除多选状态
    clearMultiSelection();

    // 平台前缀搜索拦截
    if (typeof SearchParser !== 'undefined' && SearchParser.parsePlatformSearch) {
      const platformResult = SearchParser.parsePlatformSearch(query);
      if (platformResult) {
        displayPlatformSearch(platformResult);
        return;
      }
    }

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

  async function checkAiProAccess() {
    try {
      const settingsResult = await chrome.storage.sync.get(['settings', 'optionsSettings']);
      const fromSettings = settingsResult.settings?.intelligentSearch || {};
      const fromOptions = settingsResult.optionsSettings?.intelligentSearch || {};
      const hasApiKey = !!(fromSettings.aiApiKey || fromOptions.aiApiKey);
      return hasApiKey;
    } catch (e) {
      return false;
    }
  }

  function showSearchWindowAiUpgradePrompt() {
    resultsList.innerHTML = `
      <div class="ai-config-prompt">
        <div class="pro-upgrade-inline-icon">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="32" height="32">
            <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/><path d="M11 8v6M8 11h6"/>
          </svg>
        </div>
        <div class="pro-upgrade-inline-text">
          <strong>AI 智能搜索</strong> 需要配置 API Key<br>
          <span style="font-size:12px;opacity:0.7">支持 Gemini、OpenAI、DeepSeek 等多种 AI 服务商</span>
        </div>
        <div class="pro-upgrade-inline-actions">
          <button class="btn-pro-upgrade" id="swAiConfigBtn" style="background:var(--color-primary,#1a73e8);">前往配置</button>
        </div>
        <div style="font-size:11px;color:var(--text-secondary,#5f6368);margin-top:4px;">
          在配置中心中配置 API Key 即可使用
        </div>
      </div>
    `;
    const configBtn = document.getElementById('swAiConfigBtn');
    if (configBtn) configBtn.addEventListener('click', () => {
      chrome.runtime.openOptionsPage();
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

  let swOriginalPlaceholder = '';
  function updatePlatformPlaceholderSW(value) {
    if (!swOriginalPlaceholder) {
      swOriginalPlaceholder = searchInput.placeholder;
    }
    if (typeof SearchParser !== 'undefined' && SearchParser.parsePlatformSearch) {
      const platformResult = SearchParser.parsePlatformSearch(value);
      if (platformResult && !platformResult.query) {
        searchInput.placeholder = `在 ${platformResult.platform.name} 中搜索...`;
      } else if (!platformResult) {
        searchInput.placeholder = swOriginalPlaceholder;
      }
    }
  }

  function displayPlatformSearch(platformResult) {
    const { prefix, platform, query } = platformResult;
    resultsList.innerHTML = '';

    if (!query) {
      searchStats.textContent = `在 ${platform.name} 中搜索`;
      resultsList.innerHTML = `<div class="platform-search-hint">
        <div class="platform-hint-icon">${getPlatformIconSW(platform.icon)}</div>
        <div class="platform-hint-text">在 <strong>${escapeHtml(platform.name)}</strong> 中搜索</div>
        <div class="platform-hint-example">输入关键词后按 Enter 跳转</div>
      </div>`;
      selectedIndex = -1;
      return;
    }

    const searchUrl = platform.url.replace('{query}', encodeURIComponent(query));
    searchStats.textContent = `在 ${platform.name} 搜索`;
    resultsList.innerHTML = `
      <div class="result-item special-item platform-search-item active" data-special-action="platform-search" data-url="${escapeHtml(searchUrl)}">
        <div class="result-icon special-icon platform-icon">${getPlatformIconSW(platform.icon)}</div>
        <div class="result-content">
          <div class="result-title">在 ${escapeHtml(platform.name)} 搜索 "<strong>${escapeHtml(query)}</strong>"</div>
          <div class="result-url">${escapeHtml(searchUrl)}</div>
        </div>
      </div>
    `;
    selectedIndex = 0;
    currentResults = [{ url: searchUrl, title: `${platform.name}: ${query}` }];
  }

  function appendPlatformSearchItems(query) {
    getSettings().then(settings => {
      const spSettings = settings?.searchPlatforms || {};
      if (!spSettings.showInResults) return;

      const platforms = (typeof SearchParser !== 'undefined' && SearchParser.getAvailablePlatforms)
        ? SearchParser.getAvailablePlatforms(settings)
        : [];
      const defaultEngine = settings?.defaultSearchEngine || getDefaultSearchEngine();
      const shown = platforms.filter(p => {
        if (defaultEngine === 'google' && p.prefix === 'g') return false;
        if (defaultEngine === 'baidu' && p.prefix === 'bd') return false;
        return true;
      }).slice(0, 5);

      if (shown.length === 0) return;

      let html = '<div class="platform-divider"><span>在其他平台搜索</span></div>';
      shown.forEach(p => {
        const searchUrl = p.url.replace('{query}', encodeURIComponent(query));
        html += `
          <div class="result-item special-item platform-jump-item" data-special-action="platform-search" data-url="${escapeHtml(searchUrl)}">
            <div class="result-icon special-icon platform-icon">${getPlatformIconSW(p.icon)}</div>
            <div class="result-content">
              <div class="result-title">${escapeHtml(p.name)} 搜索 "<strong>${escapeHtml(query)}</strong>"</div>
              <div class="result-url">${escapeHtml(p.prefix)}:${escapeHtml(query)}</div>
            </div>
          </div>
        `;
      });
      resultsList.insertAdjacentHTML('beforeend', html);
    });
  }

  function getPlatformIconSW(iconName) {
    const icons = {
      google: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>',
      baidu: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="#2319DC" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 15h-2v-6h2v6zm4 0h-2v-6h2v6zm-2-8c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2z"/></svg>',
      github: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.604-3.369-1.341-3.369-1.341-.454-1.155-1.11-1.462-1.11-1.462-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.564 9.564 0 0112 6.844c.85.004 1.705.115 2.504.337 1.909-1.294 2.747-1.025 2.747-1.025.546 1.377.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.416 22 12c0-5.523-4.477-10-10-10z"/></svg>',
      stackoverflow: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="#F48024" d="M15.725 0l-1.72 1.277 6.39 8.588 1.72-1.277L15.725 0zm-3.94 3.418l-1.369 1.644 8.225 6.85 1.369-1.644-8.225-6.85zm-3.15 4.465l-.905 1.94 9.702 4.517.905-1.94-9.702-4.517zm-1.85 4.86l-.44 2.093 10.473 2.2.44-2.092-10.473-2.2zM1.89 21.906v2.094h13.97v-2.094H1.89zm1.046-4.08v2.094h11.878V17.83H2.935z"/></svg>',
      zhihu: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="#0066FF" d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm3 14h-2l-1-3H8v-2h4V9H8V7h8v2h-2l1 3h2l-2 4z"/></svg>',
      bilibili: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="#00A1D6" d="M17.813 4.653h.854c1.51.054 2.769.578 3.773 1.574 1.004.995 1.524 2.249 1.56 3.76v7.36c-.036 1.51-.556 2.769-1.56 3.773s-2.262 1.524-3.773 1.56H5.333c-1.51-.036-2.769-.556-3.773-1.56S.036 18.858 0 17.347v-7.36c.036-1.511.556-2.765 1.56-3.76 1.004-.996 2.262-1.52 3.773-1.574h.774l-1.174-1.12a1.234 1.234 0 0 1-.373-.906c0-.356.124-.658.373-.907l.027-.027c.267-.249.573-.373.92-.373.347 0 .653.124.92.373L9.653 4.44c.071.071.134.142.187.213h4.267a.836.836 0 0 1 .16-.213l2.853-2.747c.267-.249.573-.373.92-.373.347 0 .662.124.929.373.258.249.383.553.383.907 0 .355-.138.657-.413.906l-1.126 1.147zM5.333 7.24c-.746.018-1.373.276-1.88.773-.506.498-.769 1.13-.786 1.894v7.52c.017.764.28 1.395.786 1.893.507.498 1.134.756 1.88.773h13.334c.746-.017 1.373-.275 1.88-.773.506-.498.769-1.129.786-1.893v-7.52c-.017-.765-.28-1.396-.786-1.894-.507-.497-1.134-.755-1.88-.773H5.333zM8 11.107c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373zm8 0c.373 0 .684.124.933.373.25.249.383.569.4.96v1.173c-.017.391-.15.711-.4.96-.249.25-.56.374-.933.374s-.684-.125-.933-.374c-.25-.249-.383-.569-.4-.96V12.44c.017-.391.15-.711.4-.96.249-.249.56-.373.933-.373z"/></svg>',
      youtube: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="#FF0000" d="M23.498 6.186a3.016 3.016 0 0 0-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 0 0 .502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 0 0 2.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 0 0 2.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>',
      npm: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="#CB3837" d="M0 7.334v8h6.666v1.332H12v-1.332h12v-8H0zm6.666 6.664H5.334v-4H3.999v4H1.335V8.667h5.331v5.331zm4 0v1.336H8.001V8.667h5.334v5.332h-2.669v-.001zm12.001 0h-1.33v-4h-1.336v4h-1.335v-4h-1.33v4h-2.671V8.667h8.002v5.331z"/></svg>',
      mdn: '<svg viewBox="0 0 24 24" width="16" height="16"><rect fill="#000" width="24" height="24" rx="4"/><text x="12" y="16" text-anchor="middle" fill="white" font-size="9" font-weight="bold">MDN</text></svg>',
      x: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="currentColor" d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>',
      reddit: '<svg viewBox="0 0 24 24" width="16" height="16"><path fill="#FF4500" d="M12 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0zm5.01 4.744c.688 0 1.25.561 1.25 1.249a1.25 1.25 0 0 1-2.498.056l-2.597-.547-.8 3.747c1.824.07 3.48.632 4.674 1.488.308-.309.73-.491 1.207-.491.968 0 1.754.786 1.754 1.754 0 .716-.435 1.333-1.01 1.614a3.111 3.111 0 0 1 .042.52c0 2.694-3.13 4.87-7.004 4.87-3.874 0-7.004-2.176-7.004-4.87 0-.183.015-.366.043-.534A1.748 1.748 0 0 1 4.028 12c0-.968.786-1.754 1.754-1.754.463 0 .898.196 1.207.49 1.207-.883 2.878-1.43 4.744-1.487l.885-4.182a.342.342 0 0 1 .14-.197.35.35 0 0 1 .238-.042l2.906.617a1.214 1.214 0 0 1 1.108-.701zM9.25 12C8.561 12 8 12.562 8 13.25c0 .687.561 1.248 1.25 1.248.687 0 1.248-.561 1.248-1.249 0-.688-.561-1.249-1.249-1.249zm5.5 0c-.687 0-1.248.561-1.248 1.25 0 .687.561 1.248 1.249 1.248.688 0 1.249-.561 1.249-1.249 0-.687-.562-1.249-1.25-1.249zm-5.466 3.99a.327.327 0 0 0-.231.094.33.33 0 0 0 0 .463c.842.842 2.484.913 2.961.913.477 0 2.105-.056 2.961-.913a.361.361 0 0 0 .029-.463.33.33 0 0 0-.464 0c-.547.533-1.684.73-2.512.73-.828 0-1.979-.196-2.512-.73a.326.326 0 0 0-.232-.095z"/></svg>',
      producthunt: '<svg viewBox="0 0 24 24" width="16" height="16"><circle fill="#DA552F" cx="12" cy="12" r="12"/><path fill="white" d="M13.604 8.4h-3.405V12h3.405c.995 0 1.801-.806 1.801-1.801 0-.993-.806-1.799-1.801-1.799zM13.604 13.8H10.2v3.6H8.399V6.6h5.205c1.99 0 3.6 1.611 3.6 3.6 0 1.99-1.611 3.6-3.6 3.6z"/></svg>'
    };
    return icons[iconName] || '<svg viewBox="0 0 24 24" width="16" height="16"><circle cx="12" cy="12" r="10" fill="none" stroke="currentColor" stroke-width="2"/><path d="M2 12h20M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10A15.3 15.3 0 0112 2z" fill="none" stroke="currentColor" stroke-width="2"/></svg>';
  }

  async function getSettings() {
    try {
      const result = await new Promise(resolve => {
        chrome.storage.sync.get(['settings', 'optionsSettings'], resolve);
      });
      const source = result.optionsSettings || result.settings || {};
      return { ...source };
    } catch { return {}; }
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
      appendPlatformSearchItems(trimmedQuery);
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

    if (selectedItems.size > 1) {
      searchStats.textContent = `已选择 ${selectedItems.size} 项 (Enter 批量打开)`;
    }
  }

  // ==================== 打开结果 ====================
  function openResult(index) {
    const item = currentResults[index];
    if (!item) return;

    safeSendMessage({
      type: 'OPEN_RESULT',
      mode: currentMode,
      item: item
    }, () => {
      try { window.close(); } catch (e) {}
    });

    setTimeout(() => {
      try { window.close(); } catch (e) {}
    }, 300);
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

    const tagAction = contextMenu.querySelector('.tag-action');

    if (currentMode === 'bookmarks') {
      editAction.style.display = 'flex';
      deleteAction.style.display = 'flex';
      deleteAction.querySelector('.delete-text').textContent = '删除书签';
      if (tagAction) tagAction.style.display = 'flex';
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
      if (tagAction) tagAction.style.display = 'none';
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

      case 'manage-tags':
        if (contextMenuTarget && contextMenuTarget.id) {
          openTagModal(contextMenuTarget.id);
        }
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

  // ==================== 标签管理弹窗 ====================
  let tagModalBookmarkId = null;

  function openTagModal(bookmarkId) {
    tagModalBookmarkId = bookmarkId;
    const modal = document.getElementById('tagModal');
    modal.classList.add('show');
    refreshTagModal();
    document.getElementById('tagInput').focus();
  }

  function closeTagModal() {
    const modal = document.getElementById('tagModal');
    modal.classList.remove('show');
    tagModalBookmarkId = null;
    document.getElementById('tagInput').value = '';
  }

  async function refreshTagModal() {
    if (!tagModalBookmarkId) return;
    const currentTags = await BookmarkTags.getTagsForBookmark(tagModalBookmarkId);
    const palette = await BookmarkTags.getPalette();

    const currentList = document.getElementById('tagCurrentList');
    currentList.innerHTML = currentTags.length === 0
      ? '<span class="tag-empty">暂无标签</span>'
      : currentTags.map(t =>
        `<span class="tag-chip">${escapeHtml(t)}<span class="tag-chip-remove" data-tag="${t}">&times;</span></span>`
      ).join('');

    currentList.querySelectorAll('.tag-chip-remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        await BookmarkTags.removeTag(tagModalBookmarkId, btn.dataset.tag);
        const bm = allBookmarks.find(b => b.id === tagModalBookmarkId);
        if (bm) bm._tags = await BookmarkTags.getTagsForBookmark(tagModalBookmarkId);
        refreshTagModal();
      });
    });

    const paletteList = document.getElementById('tagPaletteList');
    paletteList.innerHTML = palette.filter(t => !currentTags.includes(t)).map(t =>
      `<span class="tag-palette-item" data-tag="${escapeHtml(t)}">${escapeHtml(t)}</span>`
    ).join('');

    paletteList.querySelectorAll('.tag-palette-item').forEach(el => {
      el.addEventListener('click', async () => {
        await BookmarkTags.addTag(tagModalBookmarkId, el.dataset.tag);
        const bm = allBookmarks.find(b => b.id === tagModalBookmarkId);
        if (bm) bm._tags = await BookmarkTags.getTagsForBookmark(tagModalBookmarkId);
        refreshTagModal();
      });
    });
  }

  async function addTagFromInput() {
    const input = document.getElementById('tagInput');
    const tag = input.value.trim();
    if (!tag || !tagModalBookmarkId) return;
    await BookmarkTags.addTag(tagModalBookmarkId, tag);
    input.value = '';
    const bm = allBookmarks.find(b => b.id === tagModalBookmarkId);
    if (bm) bm._tags = await BookmarkTags.getTagsForBookmark(tagModalBookmarkId);
    refreshTagModal();
  }

  (function initTagModal() {
    document.getElementById('tagModalClose').addEventListener('click', closeTagModal);
    document.getElementById('tagModal').addEventListener('click', e => {
      if (e.target.id === 'tagModal') closeTagModal();
    });
    document.getElementById('tagAddBtn').addEventListener('click', addTagFromInput);
    document.getElementById('tagInput').addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); addTagFromInput(); }
      if (e.key === 'Escape') { e.stopPropagation(); closeTagModal(); }
    });
  })();

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

    if (item._tags && item._tags.length > 0) {
      html += item._tags.map(t => `<span class="bookmark-tag">${escapeHtml(t)}</span>`).join('');
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
