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
  let currentSort = 'smart';
  let currentFilter = 'all';
  let currentStyle = 'spotlight';
  let currentFont = 'system';

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

    // 初始化筛选栏（书签模式下显示）
    filterBar.classList.toggle('show', currentMode === 'bookmarks');

    // 加载初始数据
    await loadData();
    search('');

    // 聚焦搜索框
    searchInput.focus();

    console.log('[BookmarkSearch] Search window initialized');
  }

  // ==================== 事件绑定 ====================
  function bindEvents() {
    // 搜索输入
    searchInput.addEventListener('input', (e) => {
      search(e.target.value);
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
      if (item) {
        openResult(parseInt(item.dataset.index));
      }
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
          openResult(selectedIndex);
        }
        break;
    }
  }

  // ==================== 模式切换 ====================
  function switchMode(mode) {
    currentMode = mode;
    selectedIndex = -1;

    // 更新标签样式
    document.querySelectorAll('.mode-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.mode === mode);
    });

    // 更新搜索框占位符
    const placeholders = {
      bookmarks: '搜索书签...',
      tabs: '搜索标签页...',
      groups: '搜索分组或分组内标签页...',
      history: '搜索历史记录...',
      downloads: '搜索下载文件...'
    };
    searchInput.placeholder = placeholders[mode] || '搜索...';

    // 显示/隐藏筛选器
    filterBar.classList.toggle('show', mode === 'bookmarks');

    // 加载数据并搜索
    loadData().then(() => {
      if (mode === 'groups') {
        const filtered = searchGroups(searchInput.value, allGroups);
        displayGroupResults(filtered);
      } else {
        search(searchInput.value);
      }
    });
  }

  function switchModePrev() {
    const modes = ['bookmarks', 'tabs', 'groups', 'history', 'downloads'];
    const currentIndex = modes.indexOf(currentMode);
    switchMode(modes[currentIndex <= 0 ? modes.length - 1 : currentIndex - 1]);
  }

  function switchModeNext() {
    const modes = ['bookmarks', 'tabs', 'groups', 'history', 'downloads'];
    const currentIndex = modes.indexOf(currentMode);
    switchMode(modes[currentIndex >= modes.length - 1 ? 0 : currentIndex + 1]);
  }

  // ==================== 数据加载 ====================
  async function loadData() {
    return new Promise((resolve) => {
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
          }
        }
        resolve();
      });
    });
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

      const toggle = document.createElement('span');
      toggle.className = 'group-toggle-icon';
      toggle.textContent = isSearching ? '▼' : '▶';

      header.append(colorDot, title, badge, count, toggle);

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

        tabItem.addEventListener('click', (e) => {
          e.stopPropagation();
          if (group.isOpen && tab.id) {
            safeSendMessage({ type: 'OPEN_RESULT', mode: 'tabs', item: { id: tab.id, windowId: tab.windowId || group.windowId } });
          } else if (tab.url) {
            safeSendMessage({ type: 'OPEN_RESULT', mode: 'bookmarks', item: { url: tab.url } });
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
    // 分组模式使用独立的搜索逻辑
    if (currentMode === 'groups') {
      const filtered = searchGroups(query, allGroups);
      displayGroupResults(filtered);
      selectedIndex = -1;
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

    // 使用 SearchParser 进行高级搜索
    if (typeof SearchParser !== 'undefined' && SearchParser.filter) {
      items = SearchParser.filter(items, query || '');
    } else if (query && query.trim()) {
      const tokens = query.trim().split(/\s+/).filter(Boolean).map(t => t.toLowerCase());
      items = items.filter(item => {
        const searchable = [item.title || '', item.url || '', item.filename || ''].join(' ').toLowerCase();
        return tokens.every(t => searchable.includes(t));
      });
    }

    // 排序
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
    displayResults(items);
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

  // ==================== 显示结果 ====================
  function displayResults(items) {
    if (items.length === 0) {
      resultsList.innerHTML = '<div class="no-results">没有找到匹配的结果</div>';
      searchStats.textContent = '无结果';
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
        { name: 'Codeium', url: 'https://www.codeium.com' },
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
