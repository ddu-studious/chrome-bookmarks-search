/**
 * Content Script - 书签搜索浮层
 * 在页面上注入居中浮层，支持三种 UI 风格
 */

(function() {
  'use strict';

  console.log('[BookmarkSearch] Content script loading...');

  // 防止重复注入
  if (window.__bookmarkSearchInjected) {
    console.log('[BookmarkSearch] Already injected, skipping...');
    return;
  }
  window.__bookmarkSearchInjected = true;
  
  console.log('[BookmarkSearch] Content script initialized');

  // 浮层状态
  let overlayContainer = null;
  let shadowRoot = null;
  let isVisible = false;
  let currentMode = 'bookmarks';
  let currentResults = [];
  let selectedIndex = -1;
  let allBookmarks = [];
  let allTabs = [];
  let allHistory = [];
  let allDownloads = [];
  let currentSort = 'smart';
  let currentFilter = 'all';
  let currentStyle = 'spotlight'; // spotlight, raycast, fluent

  // IME（中文输入法）组合输入状态
  // 如果在 composition 期间反复 focus/selection，会导致输入法被打断，只落拼音
  const imeState = {
    searchComposing: false,
    editTitleComposing: false,
    editUrlComposing: false
  };

  // 用户意图（主动交互）与自动抢焦点节流
  // 目的：避免与宿主页面 focus trap 打乒乓导致光标闪烁/IME 被打断
  let lastUserIntentAt = 0;
  let lastAutoRefocusAt = 0;

  function markUserIntent() {
    lastUserIntentAt = Date.now();
  }

  // ==================== 事件隔离模块 ====================
  // 用于防止宿主页面的事件影响浮层
  const EventIsolation = {
    // 保存原始状态，用于恢复
    _savedState: {
      bodyOverflow: '',
      htmlOverflow: '',
      scrollY: 0
    },

    // 需要阻止传播的事件类型
    _eventTypes: [
      // 键盘事件
      'keydown', 'keyup', 'keypress',
      // 鼠标滚轮事件
      'wheel', 'mousewheel', 'DOMMouseScroll',
      // 触摸事件（移动端）
      'touchmove', 'touchstart', 'touchend',
      // 拖拽事件
      'drag', 'dragstart', 'dragend', 'dragover', 'dragenter', 'dragleave', 'drop'
    ],

    // 在 document 级别捕获并阻止事件传播到宿主页面
    _documentHandler: null,
    
    // window 级别按键拦截（用于抢在页面“焦点陷阱/快捷键”之前处理）
    _windowKeyHandler: null,
    // window 级别 focus/click 拦截（用于抢在页面 modal 的 focus trap 之前）
    _windowFocusHandler: null,
    _windowPointerHandler: null,

    // 启用事件隔离
    enable() {
      // 1. 锁定页面滚动（使用更安全的方式）
      this._lockScroll();

      // 2. 在捕获阶段拦截所有事件
      this._documentHandler = (e) => {
        // 只有当浮层可见时才拦截
        if (!isVisible) return;

        // 检查事件是否来自我们的浮层
        const isFromOverlay = overlayContainer && 
          (overlayContainer.contains(e.target) || e.target === overlayContainer);

        // 对于键盘事件，特殊处理
        if (e.type === 'keydown' || e.type === 'keyup' || e.type === 'keypress') {
          // 如果是来自我们浮层的事件，不阻止
          if (isFromOverlay) return;

          // IME 输入中，不拦截
          if (e.isComposing || e.keyCode === 229) return;
          
          // 阻止宿主页面的键盘事件
          e.stopPropagation();
          e.stopImmediatePropagation();
          
          // 对于某些特殊按键，也阻止默认行为（如空格键可能导致页面滚动）
          if (e.key === ' ' || e.key === 'Tab' || e.key === 'ArrowUp' || 
              e.key === 'ArrowDown' || e.key === 'PageUp' || e.key === 'PageDown' ||
              e.key === 'Home' || e.key === 'End') {
            e.preventDefault();
          }
          return;
        }

        // 对于滚轮事件，只允许在浮层内滚动
        if (e.type === 'wheel' || e.type === 'mousewheel' || e.type === 'DOMMouseScroll') {
          if (!isFromOverlay) {
            e.preventDefault();
            e.stopPropagation();
            e.stopImmediatePropagation();
          }
          return;
        }

        // 对于触摸滚动事件
        if (e.type === 'touchmove') {
          if (!isFromOverlay) {
            e.preventDefault();
            e.stopPropagation();
          }
          return;
        }
      };

      // 使用捕获阶段，在事件到达目标之前拦截
      this._eventTypes.forEach(type => {
        document.addEventListener(type, this._documentHandler, {
          capture: true,
          passive: false
        });
      });

      // 3. 阻止浮层内的滚轮事件传播到外部
      if (overlayContainer) {
        this._preventScrollPropagation();
      }

      // 4. 启用导航按键拦截（解决↑↓导致页面弹窗获取焦点的问题）
      this._enableKeyTrap();

      // 5. 启用 focus/click 捕获拦截（解决输入框无法获得焦点的问题）
      this._enableFocusAndPointerTrap();

      // 6. 启用 focusout 守卫（终极防线：焦点被抢走时自动恢复）
      this.enableFocusGuard();

      console.log('[BookmarkSearch] Event isolation enabled');
    },

    // 禁用事件隔离
    disable() {
      // 1. 恢复页面滚动
      this._unlockScroll();

      // 2. 移除事件监听
      if (this._documentHandler) {
        this._eventTypes.forEach(type => {
          document.removeEventListener(type, this._documentHandler, {
            capture: true,
            passive: false
          });
        });
        this._documentHandler = null;
      }
      
      // 3. 禁用导航按键拦截
      this._disableKeyTrap();

      // 4. 禁用 focus/click 捕获拦截
      this._disableFocusAndPointerTrap();

      // 5. 禁用 focusout 守卫
      this.disableFocusGuard();

      console.log('[BookmarkSearch] Event isolation disabled');
    },

    // 启用导航按键拦截：在 window 捕获阶段阻止页面的“焦点陷阱/快捷键”
    // 注意：只拦截导航类按键（不拦截普通字符输入），并在拦截后交给我们自己的 handleKeydown() 处理
    _enableKeyTrap() {
      if (this._windowKeyHandler) return;

      const navKeys = new Set([
        'ArrowDown',
        'ArrowUp',
        'ArrowLeft',
        'ArrowRight',
        'Enter',
        'Escape',
        'Tab',
        'PageUp',
        'PageDown',
        'Home',
        'End'
      ]);

      this._windowKeyHandler = (e) => {
        if (!isVisible) return;

        // IME 输入中（如中文输入法候选词选择），不拦截
        if (e.isComposing || e.keyCode === 229) return;

        // 编辑弹窗打开且焦点在输入框时：允许用户正常使用键盘
        const editModal = shadowRoot?.getElementById('editModal');
        const isEditModalOpen = editModal?.classList.contains('show');
        if (isEditModalOpen) {
          const editTitle = shadowRoot?.getElementById('editTitle');
          const editUrl = shadowRoot?.getElementById('editUrl');
          const active = shadowRoot?.activeElement;
          if (active === editTitle || active === editUrl) {
            return;
          }
        }

        const searchInput = shadowRoot?.getElementById('searchInput');

        // 处理导航键（方向键、回车、ESC 等）
        if (navKeys.has(e.key)) {
          markUserIntent();
          e.preventDefault();
          e.stopImmediatePropagation();

          if (searchInput && shadowRoot?.activeElement !== searchInput) {
            try { searchInput.focus({ preventScroll: true }); } catch (err) {}
          }

          try { handleKeydown(e); } catch (err) {}
          return;
        }

        // 处理字符键输入：当焦点不在搜索框时（被页面 focus trap 抢走），
        // 将焦点拉回搜索框，让用户能正常输入
        if (searchInput && shadowRoot?.activeElement !== searchInput) {
          if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
            markUserIntent();
            e.stopImmediatePropagation();
            try { searchInput.focus({ preventScroll: true }); } catch (err) {}
            return;
          }
          if (e.key === 'Backspace' || e.key === 'Delete') {
            markUserIntent();
            e.stopImmediatePropagation();
            try { searchInput.focus({ preventScroll: true }); } catch (err) {}
            return;
          }
        }
      };

      window.addEventListener('keydown', this._windowKeyHandler, true);
    },

    _disableKeyTrap() {
      if (!this._windowKeyHandler) return;
      window.removeEventListener('keydown', this._windowKeyHandler, true);
      this._windowKeyHandler = null;
    },

    // 捕获并阻断页面的 focus trap
    // 原理：很多站点 modal 会在 window/document capture 阶段监听 focusin/click，
    // 一旦发现焦点/点击落在 modal 外，就强行把焦点拉回 modal 内（比如“管理资源”按钮）。
    // 我们在更早（同样是 capture 阶段）发现事件来自扩展浮层时，直接 stopImmediatePropagation，
    // 让站点逻辑“看不到”这些事件，从而不会抢回焦点。
    _enableFocusAndPointerTrap() {
      if (this._windowFocusHandler || this._windowMousedownHandler) return;

      const isFromOverlay = (target) => {
        if (!overlayContainer) return false;
        return target === overlayContainer || overlayContainer.contains(target);
      };

      // 辅助函数：通过 composedPath 查找实际点击的可聚焦元素
      const findFocusableTarget = (e) => {
        try {
          const path = e.composedPath();
          for (const el of path) {
            if (el === overlayContainer) break;
            if (el.nodeType === 1 && (
              el.tagName === 'INPUT' || 
              el.tagName === 'TEXTAREA' || 
              el.isContentEditable
            )) {
              return el;
            }
          }
        } catch (err) {}
        return null;
      };

      // 精简的聚焦函数：立即 + 单次 rAF 兜底
      // 避免过多异步 focus 调用导致事件级联和性能问题
      const safeFocus = (target) => {
        if (!target || !isVisible) return;
        markUserIntent();
        try { target.focus({ preventScroll: true }); } catch (e) {}
        // 仅一次 rAF 兜底，足以击败大部分 focus trap
        requestAnimationFrame(() => {
          if (!isVisible || shadowRoot?.activeElement === target) return;
          try { target.focus({ preventScroll: true }); } catch (e) {}
        });
      };

      // 防抖标志：mousedown 和 pointerdown 会对同一次点击各触发一次，
      // 用时间戳去重，避免双倍 focus 调用
      let lastPointerTime = 0;

      // 层1：拦截 focusin 传播 —— 阻止页面看到焦点变化
      this._windowFocusHandler = (e) => {
        if (!isVisible) return;
        if (!isFromOverlay(e.target)) return;
        e.stopImmediatePropagation();
        e.stopPropagation();
      };
      window.addEventListener('focusin', this._windowFocusHandler, true);

      // 层2：拦截 mousedown/pointerdown 传播 + 编程式强制聚焦
      // 很多站点的 focus trap（如 Prometheus、Grafana、Ant Design Modal）会在
      // window/document capture 阶段监听 mousedown，检测到点击在 modal 外部后
      // 就强制把焦点拉回 modal 内。
      //
      // 关键修复：由于 content script 在 document_idle 加载，页面的 capture handler
      // 可能注册在我们之前，先执行 preventDefault() 阻止了浏览器默认聚焦行为。
      // 因此我们必须通过编程方式（safeFocus）强制聚焦，不能依赖浏览器默认行为。
      this._windowMousedownHandler = (e) => {
        if (!isVisible) return;
        if (!isFromOverlay(e.target)) return;
        e.stopImmediatePropagation();
        
        // 防抖：mousedown 和 pointerdown 对同一次点击只处理一次
        const now = Date.now();
        if (now - lastPointerTime < 50) return;
        lastPointerTime = now;
        
        // 尝试获取实际点击的可聚焦元素（如搜索框、编辑框）
        const focusableTarget = findFocusableTarget(e);
        if (focusableTarget) {
          safeFocus(focusableTarget);
        }
      };
      window.addEventListener('mousedown', this._windowMousedownHandler, true);
      window.addEventListener('pointerdown', this._windowMousedownHandler, true);
    },

    _disableFocusAndPointerTrap() {
      if (this._windowFocusHandler) {
        window.removeEventListener('focusin', this._windowFocusHandler, true);
        this._windowFocusHandler = null;
      }
      if (this._windowMousedownHandler) {
        window.removeEventListener('mousedown', this._windowMousedownHandler, true);
        window.removeEventListener('pointerdown', this._windowMousedownHandler, true);
        this._windowMousedownHandler = null;
      }
      this._windowPointerHandler = null;
    },

    // 层3：focusout 守卫 —— 轻量兜底
    // 主要防线已由 focus-guard.js（MAIN world）在根源上拦截页面的 focus() 调用。
    // 此守卫仅作为极端情况下的最后兜底（如页面通过非 focus() 方式转移焦点）。
    _focusGuardHandler: null,

    enableFocusGuard() {
      if (this._focusGuardHandler) return;
      if (!overlayContainer) return;

      this._focusGuardHandler = (e) => {
        if (!isVisible) return;

        // 编辑弹窗打开时，不干预焦点
        const editModal = shadowRoot?.getElementById('editModal');
        if (editModal?.classList.contains('show')) return;

        // IME 组合输入中，绝不抢焦点
        if (imeState.searchComposing) return;

        // 检查新焦点是否仍然在浮层容器内
        const newFocus = e.relatedTarget;
        if (newFocus && (newFocus === overlayContainer || overlayContainer.contains(newFocus))) {
          return;
        }

        // 焦点被外部抢走，使用 rAF 延迟恢复
        requestAnimationFrame(() => {
          if (!isVisible || imeState.searchComposing) return;
          const searchInput = shadowRoot?.getElementById('searchInput');
          if (!searchInput) return;

          const editModalNow = shadowRoot?.getElementById('editModal');
          if (editModalNow?.classList.contains('show')) return;

          if (shadowRoot?.activeElement === searchInput) return;

          try {
            searchInput.focus({ preventScroll: true });
          } catch (err) {}
        });
      };

      overlayContainer.addEventListener('focusout', this._focusGuardHandler);
    },

    disableFocusGuard() {
      if (this._focusGuardHandler && overlayContainer) {
        overlayContainer.removeEventListener('focusout', this._focusGuardHandler);
        this._focusGuardHandler = null;
      }
    },

    // 锁定页面滚动（更安全的方式，不使用 position: fixed）
    _lockScroll() {
      // 保存当前状态
      this._savedState.scrollY = window.scrollY;
      this._savedState.bodyOverflow = document.body.style.overflow;
      this._savedState.htmlOverflow = document.documentElement.style.overflow;

      // 只设置 overflow: hidden，不改变 position
      // 这样更安全，不会导致页面布局问题
      document.body.style.overflow = 'hidden';
      document.documentElement.style.overflow = 'hidden';
    },

    // 解锁页面滚动
    _unlockScroll() {
      // 恢复样式
      document.body.style.overflow = this._savedState.bodyOverflow;
      document.documentElement.style.overflow = this._savedState.htmlOverflow;
    },

    // 防止滚轮事件从浮层内部传播到外部
    _preventScrollPropagation() {
      if (!shadowRoot) return;

      const resultsContainer = shadowRoot.querySelector('.results-container');
      if (!resultsContainer) return;

      // 处理浮层内部的滚轮事件
      resultsContainer.addEventListener('wheel', (e) => {
        const { scrollTop, scrollHeight, clientHeight } = resultsContainer;
        const delta = e.deltaY;

        // 检查是否滚动到边界
        const atTop = scrollTop <= 0 && delta < 0;
        const atBottom = scrollTop + clientHeight >= scrollHeight && delta > 0;

        // 如果到达边界，阻止事件传播（防止页面滚动）
        if (atTop || atBottom) {
          e.preventDefault();
        }

        // 始终阻止事件传播到宿主页面
        e.stopPropagation();
      }, { passive: false });

      // 触摸事件处理（移动端）
      let touchStartY = 0;
      resultsContainer.addEventListener('touchstart', (e) => {
        touchStartY = e.touches[0].clientY;
      }, { passive: true });

      resultsContainer.addEventListener('touchmove', (e) => {
        const touchY = e.touches[0].clientY;
        const { scrollTop, scrollHeight, clientHeight } = resultsContainer;
        const delta = touchStartY - touchY;

        const atTop = scrollTop <= 0 && delta < 0;
        const atBottom = scrollTop + clientHeight >= scrollHeight && delta > 0;

        if (atTop || atBottom) {
          e.preventDefault();
        }
        e.stopPropagation();
      }, { passive: false });
    }
  };

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

  // 创建浮层容器
  function createOverlay() {
    if (overlayContainer) return;

    console.log('[BookmarkSearch] Creating overlay container...');
    
    overlayContainer = document.createElement('div');
    overlayContainer.id = 'bookmark-search-overlay-container';
    shadowRoot = overlayContainer.attachShadow({ mode: 'closed' });
    
    // 注入样式和 HTML
    shadowRoot.innerHTML = getOverlayHTML();
    
    // 确保 body 存在
    if (document.body) {
      document.body.appendChild(overlayContainer);
      console.log('[BookmarkSearch] Overlay appended to body');
    } else {
      console.error('[BookmarkSearch] document.body not available!');
      return;
    }

    // 绑定事件
    bindEvents();
    console.log('[BookmarkSearch] Overlay created successfully');
  }

  // 获取浮层 HTML
  function getOverlayHTML() {
    return `
      <style>${getStyles()}</style>
      <div class="overlay-backdrop" id="backdrop"></div>
      <div class="overlay-container" id="searchPanel">
        <div class="search-area">
          <div class="search-box">
            <svg class="search-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <circle cx="11" cy="11" r="8"/>
              <path d="M21 21l-4.35-4.35"/>
            </svg>
            <input type="text" class="search-input" id="searchInput" placeholder="搜索书签、标签页、历史记录..." autocomplete="off">
            <span class="shortcut-badge">Alt+B</span>
          </div>
        </div>

        <div class="mode-tabs" id="modeTabs">
          <button class="mode-tab active" data-mode="bookmarks">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z"/></svg>
            <span>书签</span>
            <span class="tab-count" id="bookmarksCount">0</span>
          </button>
          <button class="mode-tab" data-mode="tabs">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M21 3H3c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h18c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm0 16H3V5h18v14z"/></svg>
            <span>标签页</span>
            <span class="tab-count" id="tabsCount">0</span>
          </button>
          <button class="mode-tab" data-mode="history">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M13 3c-4.97 0-9 4.03-9 9H1l3.89 3.89.07.14L9 12H6c0-3.87 3.13-7 7-7s7 3.13 7 7-3.13 7-7 7c-1.93 0-3.68-.79-4.94-2.06l-1.42 1.42A8.954 8.954 0 0013 21c4.97 0 9-4.03 9-9s-4.03-9-9-9z"/></svg>
            <span>历史</span>
            <span class="tab-count" id="historyCount">0</span>
          </button>
          <button class="mode-tab" data-mode="downloads">
            <svg viewBox="0 0 24 24" fill="currentColor"><path d="M19 9h-4V3H9v6H5l7 7 7-7zM5 18v2h14v-2H5z"/></svg>
            <span>下载</span>
            <span class="tab-count" id="downloadsCount">0</span>
          </button>
        </div>

        <div class="filter-bar" id="filterBar">
          <div class="filter-group">
            <button class="filter-btn active" data-filter="all">全部</button>
            <button class="filter-btn" data-filter="never_used">未使用 <span class="filter-count">0</span></button>
            <button class="filter-btn" data-filter="rarely_used">很少使用 <span class="filter-count">0</span></button>
            <button class="filter-btn" data-filter="dormant">休眠 <span class="filter-count">0</span></button>
          </div>
          <div class="sort-group">
            <button class="sort-btn active" data-sort="smart" title="智能排序">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M9 21c0 .55.45 1 1 1h4c.55 0 1-.45 1-1v-1H9v1zm3-19C8.14 2 5 5.14 5 9c0 2.38 1.19 4.47 3 5.74V17c0 .55.45 1 1 1h6c.55 0 1-.45 1-1v-2.26c1.81-1.27 3-3.36 3-5.74 0-3.86-3.14-7-7-7z"/></svg>
            </button>
            <button class="sort-btn" data-sort="time" title="时间排序">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M11.99 2C6.47 2 2 6.48 2 12s4.47 10 9.99 10C17.52 22 22 17.52 22 12S17.52 2 11.99 2zM12 20c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z"/></svg>
            </button>
            <button class="sort-btn" data-sort="frequency" title="频率排序">
              <svg viewBox="0 0 24 24" fill="currentColor"><path d="M16 6l2.29 2.29-4.88 4.88-4-4L2 16.59 3.41 18l6-6 4 4 6.3-6.29L22 12V6z"/></svg>
            </button>
          </div>
        </div>

        <div class="results-container" id="results">
          <div class="results-list" id="resultsList"></div>
        </div>

        <!-- 友情链接区域 -->
        <div class="friend-links" id="friendLinks">
          <div class="friend-links-container" id="friendLinksContainer">
            <!-- 动态生成 -->
          </div>
        </div>

        <div class="status-bar">
          <div class="status-left">
            <span class="result-count" id="searchStats">准备就绪</span>
          </div>
          <div class="keyboard-hints">
            <span class="hint"><kbd>↑↓</kbd> 选择</span>
            <span class="hint"><kbd>↵</kbd> 打开</span>
            <span class="hint"><kbd>←→</kbd> 切换</span>
            <span class="hint"><kbd>Esc</kbd> 关闭</span>
          </div>
          <button class="font-switcher" id="fontSwitcher" title="切换字体">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M9.93 13.5h4.14L12 7.98 9.93 13.5zM20 2H4c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zm-4.05 16.5l-1.14-3H9.17l-1.12 3H5.96l5.11-13h1.86l5.11 13h-2.09z"/>
            </svg>
          </button>
          <button class="settings-btn-overlay" id="settingsBtn" title="设置">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M19.14 12.94c.04-.31.06-.63.06-.94 0-.31-.02-.63-.06-.94l2.03-1.58c.18-.14.23-.41.12-.61l-1.92-3.32c-.12-.22-.37-.29-.59-.22l-2.39.96c-.5-.38-1.03-.7-1.62-.94l-.36-2.54c-.04-.24-.24-.41-.48-.41h-3.84c-.24 0-.43.17-.47.41l-.36 2.54c-.59.24-1.13.57-1.62.94l-2.39-.96c-.22-.08-.47 0-.59.22L2.74 8.87c-.12.21-.08.47.12.61l2.03 1.58c-.04.31-.06.63-.06.94s.02.63.06.94l-2.03 1.58c-.18.14-.23.41-.12.61l1.92 3.32c.12.22.37.29.59.22l2.39-.96c.5.38 1.03.7 1.62.94l.36 2.54c.05.24.24.41.48.41h3.84c.24 0 .44-.17.47-.41l.36-2.54c.59-.24 1.13-.56 1.62-.94l2.39.96c.22.08.47 0 .59-.22l1.92-3.32c.12-.22.07-.47-.12-.61l-2.01-1.58zM12 15.6c-1.98 0-3.6-1.62-3.6-3.6s1.62-3.6 3.6-3.6 3.6 1.62 3.6 3.6-1.62 3.6-3.6 3.6z"/>
            </svg>
          </button>
          <button class="style-switcher" id="styleSwitcher" title="切换样式">
            <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
              <path d="M12 3c-4.97 0-9 4.03-9 9s4.03 9 9 9c.83 0 1.5-.67 1.5-1.5 0-.39-.15-.74-.39-1.01-.23-.26-.38-.61-.38-.99 0-.83.67-1.5 1.5-1.5H16c2.76 0 5-2.24 5-5 0-4.42-4.03-8-9-8zm-5.5 9c-.83 0-1.5-.67-1.5-1.5S5.67 9 6.5 9 8 9.67 8 10.5 7.33 12 6.5 12zm3-4C8.67 8 8 7.33 8 6.5S8.67 5 9.5 5s1.5.67 1.5 1.5S10.33 8 9.5 8zm5 0c-.83 0-1.5-.67-1.5-1.5S13.67 5 14.5 5s1.5.67 1.5 1.5S15.33 8 14.5 8zm3 4c-.83 0-1.5-.67-1.5-1.5S16.67 9 17.5 9s1.5.67 1.5 1.5-.67 1.5-1.5 1.5z"/>
            </svg>
          </button>
        </div>

        <!-- 右键菜单 -->
        <div class="context-menu" id="contextMenu">
          <div class="menu-item" data-action="open-new">
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M19 19H5V5h7V3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7h-2v7zM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7z"/></svg>
            <span class="menu-item-text">在新标签页打开</span>
            <span class="menu-item-shortcut">⌘↵</span>
          </div>
          <div class="menu-item" data-action="open-incognito">
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 4.5C7 4.5 2.73 7.61 1 12c1.73 4.39 6 7.5 11 7.5s9.27-3.11 11-7.5c-1.73-4.39-6-7.5-11-7.5zM12 17c-2.76 0-5-2.24-5-5s2.24-5 5-5 5 2.24 5 5-2.24 5-5 5zm0-8c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3z"/></svg>
            <span class="menu-item-text">在隐私窗口打开</span>
            <span class="menu-item-shortcut">⇧⌘N</span>
          </div>
          <div class="menu-separator"></div>
          <div class="menu-item" data-action="copy">
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2zm0 16H8V7h11v14z"/></svg>
            <span class="menu-item-text">复制链接</span>
            <span class="menu-item-shortcut">⌘C</span>
          </div>
          <div class="menu-item" data-action="share">
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92s2.92-1.31 2.92-2.92-1.31-2.92-2.92-2.92z"/></svg>
            <span class="menu-item-text">分享链接</span>
          </div>
          <div class="menu-separator"></div>
          <div class="menu-item edit-action" data-action="edit">
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>
            <span class="menu-item-text edit-text">编辑书签</span>
            <span class="menu-item-shortcut">⌘E</span>
          </div>
          <div class="menu-item delete-action" data-action="delete">
            <svg viewBox="0 0 24 24"><path fill="currentColor" d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"/></svg>
            <span class="menu-item-text delete-text">删除书签</span>
            <span class="menu-item-shortcut">⌘⌫</span>
          </div>
        </div>

        <!-- 编辑弹窗 -->
        <div class="edit-modal" id="editModal">
          <div class="edit-modal-content">
            <div class="edit-modal-header">
              <span class="edit-modal-title">编辑书签</span>
              <button class="edit-modal-close" id="editModalClose">×</button>
            </div>
            <div class="edit-modal-body">
              <div class="edit-field">
                <label for="editTitle">标题</label>
                <input type="text" id="editTitle" placeholder="输入书签标题...">
              </div>
              <div class="edit-field">
                <label for="editUrl">网址</label>
                <input type="url" id="editUrl" placeholder="输入网址...">
              </div>
            </div>
            <div class="edit-modal-footer">
              <button class="edit-btn edit-btn-cancel" id="editCancel">取消</button>
              <button class="edit-btn edit-btn-save" id="editSave">保存</button>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  // 字体配置 - 6种常用字体
  const FONT_CONFIGS = {
    system: {
      family: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
      name: '系统默认'
    },
    pingfang: {
      family: "'PingFang SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      name: '苹方'
    },
    yahei: {
      family: "'Microsoft YaHei', 'PingFang SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
      name: '微软雅黑'
    },
    inter: {
      family: "Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      name: 'Inter'
    },
    noto: {
      family: "'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif",
      name: 'Noto Sans'
    },
    sourcehans: {
      family: "'Source Han Sans SC', 'Noto Sans SC', 'PingFang SC', -apple-system, BlinkMacSystemFont, sans-serif",
      name: '思源黑体'
    }
  };

  let currentFont = 'system';

  // 获取样式
  function getStyles() {
    return `
      /* 基础变量 */
      :host {
        --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        --overlay-width: 620px;
        --overlay-min-width: 520px;
        --overlay-max-width: 680px;
        --overlay-max-height: 520px;
        --transition-duration: 0.2s;
      }

      /* 字体切换支持 - 6种常用字体 */
      :host(.font-system) { --font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; }
      :host(.font-pingfang) { --font-family: 'PingFang SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      :host(.font-yahei) { --font-family: 'Microsoft YaHei', 'PingFang SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }
      :host(.font-inter) { --font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      :host(.font-noto) { --font-family: 'Noto Sans SC', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; }
      :host(.font-sourcehans) { --font-family: 'Source Han Sans SC', 'Noto Sans SC', 'PingFang SC', -apple-system, BlinkMacSystemFont, sans-serif; }

      /* ==================== Spotlight 风格 (默认) ==================== */
      :host(.style-spotlight) {
        --bg-primary: rgba(255, 255, 255, 0.92);
        --bg-secondary: rgba(248, 249, 250, 0.95);
        --bg-hover: rgba(0, 0, 0, 0.04);
        --bg-active: #007aff;
        --text-primary: #1d1d1f;
        --text-secondary: #86868b;
        --text-active: #ffffff;
        --accent: #007aff;
        --accent-light: rgba(0, 122, 255, 0.1);
        --border: rgba(0, 0, 0, 0.08);
        --shadow: 0 22px 70px 4px rgba(0, 0, 0, 0.2);
        --blur: blur(30px);
        --radius: 16px;
        --radius-sm: 10px;
      }

      :host(.style-spotlight.dark) {
        --bg-primary: rgba(30, 30, 30, 0.92);
        --bg-secondary: rgba(45, 45, 45, 0.95);
        --bg-hover: rgba(255, 255, 255, 0.08);
        --text-primary: #f5f5f7;
        --text-secondary: #a1a1a6;
        --accent: #0a84ff;
        --accent-light: rgba(10, 132, 255, 0.15);
        --border: rgba(255, 255, 255, 0.1);
      }

      /* ==================== Raycast 风格 ==================== */
      :host(.style-raycast) {
        --bg-primary: #18181b;
        --bg-secondary: #27272a;
        --bg-hover: #3f3f46;
        --bg-active: transparent;
        --text-primary: #fafafa;
        --text-secondary: #a1a1aa;
        --text-active: #fafafa;
        --accent: #a855f7;
        --accent-secondary: #ec4899;
        --accent-gradient: linear-gradient(135deg, #a855f7 0%, #ec4899 100%);
        --accent-light: rgba(168, 85, 247, 0.15);
        --border: rgba(255, 255, 255, 0.08);
        --shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        --blur: none;
        --radius: 12px;
        --radius-sm: 8px;
      }

      :host(.style-raycast.light) {
        --bg-primary: #ffffff;
        --bg-secondary: #f4f4f5;
        --bg-hover: #e4e4e7;
        --text-primary: #18181b;
        --text-secondary: #52525b;
        --border: rgba(0, 0, 0, 0.08);
        --shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.15);
      }

      /* ==================== Fluent 风格 ==================== */
      :host(.style-fluent) {
        --bg-primary: rgba(243, 243, 243, 0.85);
        --bg-secondary: rgba(255, 255, 255, 0.7);
        --bg-hover: rgba(0, 0, 0, 0.03);
        --bg-active: rgba(0, 120, 212, 0.1);
        --text-primary: #1a1a1a;
        --text-secondary: #616161;
        --text-active: #0078d4;
        --accent: #0078d4;
        --accent-light: rgba(0, 120, 212, 0.1);
        --border: rgba(0, 0, 0, 0.06);
        --border-strong: rgba(0, 0, 0, 0.12);
        --shadow: 0 8px 16px rgba(0, 0, 0, 0.08);
        --blur: blur(20px);
        --radius: 8px;
        --radius-sm: 4px;
      }

      :host(.style-fluent.dark) {
        --bg-primary: rgba(32, 32, 32, 0.9);
        --bg-secondary: rgba(44, 44, 44, 0.8);
        --bg-hover: rgba(255, 255, 255, 0.05);
        --bg-active: rgba(96, 205, 255, 0.12);
        --text-primary: #ffffff;
        --text-secondary: #c5c5c5;
        --text-active: #60cdff;
        --accent: #60cdff;
        --accent-light: rgba(96, 205, 255, 0.12);
        --border: rgba(255, 255, 255, 0.06);
        --border-strong: rgba(255, 255, 255, 0.1);
      }

      /* ==================== 基础样式 ==================== */
      * {
        margin: 0;
        padding: 0;
        box-sizing: border-box;
      }

      .overlay-backdrop {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.4);
        opacity: 0;
        visibility: hidden;
        transition: all var(--transition-duration) ease;
        z-index: 2147483646;
      }

      .overlay-backdrop.show {
        opacity: 1;
        visibility: visible;
      }

      .overlay-container {
        position: fixed;
        top: 50%;
        left: 50%;
        transform: translate(-50%, -50%) scale(0.95);
        width: var(--overlay-width);
        min-width: var(--overlay-min-width);
        max-width: var(--overlay-max-width);
        max-height: var(--overlay-max-height);
        background: var(--bg-primary);
        backdrop-filter: var(--blur);
        -webkit-backdrop-filter: var(--blur);
        border-radius: var(--radius);
        box-shadow: var(--shadow);
        border: 1px solid var(--border);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        font-family: var(--font-family);
        opacity: 0;
        visibility: hidden;
        transition: all var(--transition-duration) ease;
        z-index: 2147483647;
      }

      .overlay-container.show {
        opacity: 1;
        visibility: visible;
        transform: translate(-50%, -50%) scale(1);
      }

      /* ==================== 搜索区域 ==================== */
      .search-area {
        padding: 16px 20px;
        border-bottom: 1px solid var(--border);
      }

      .search-box {
        display: flex;
        align-items: center;
        gap: 12px;
      }

      .search-icon {
        width: 20px;
        height: 20px;
        color: var(--text-secondary);
        flex-shrink: 0;
      }

      .search-input {
        flex: 1;
        border: none;
        background: transparent;
        font-size: 16px;
        color: var(--text-primary);
        outline: none;
        font-weight: 400;
      }

      .search-input::placeholder {
        color: var(--text-secondary);
      }

      .shortcut-badge {
        padding: 4px 8px;
        background: var(--bg-secondary);
        border-radius: 6px;
        font-size: 11px;
        color: var(--text-secondary);
        font-family: 'SF Mono', Monaco, monospace;
        flex-shrink: 0;
      }

      /* ==================== 模式标签 ==================== */
      .mode-tabs {
        display: flex;
        gap: 2px;
        padding: 8px 12px;
        background: var(--bg-secondary);
        border-bottom: 1px solid var(--border);
      }

      .mode-tab {
        flex: 1;
        padding: 8px 12px;
        border: none;
        background: transparent;
        border-radius: var(--radius-sm);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
        font-size: 13px;
        color: var(--text-secondary);
        transition: all 0.15s ease;
        font-family: inherit;
      }

      .mode-tab:hover {
        background: var(--bg-hover);
        color: var(--text-primary);
      }

      .mode-tab.active {
        background: var(--bg-primary);
        color: var(--accent);
        font-weight: 500;
        box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
      }

      .mode-tab svg {
        width: 16px;
        height: 16px;
      }

      .tab-count {
        padding: 2px 6px;
        background: var(--bg-hover);
        border-radius: 10px;
        font-size: 10px;
        font-weight: 600;
      }

      .mode-tab.active .tab-count {
        background: var(--accent-light);
        color: var(--accent);
      }

      /* ==================== 筛选栏 ==================== */
      .filter-bar {
        display: none;
        align-items: center;
        justify-content: space-between;
        padding: 8px 16px;
        border-bottom: 1px solid var(--border);
        gap: 8px;
      }

      .filter-bar.show {
        display: flex;
      }

      .filter-group, .sort-group {
        display: flex;
        gap: 4px;
      }

      .filter-btn {
        padding: 5px 12px;
        border: 1px solid var(--border);
        background: transparent;
        border-radius: var(--radius-sm);
        font-size: 12px;
        color: var(--text-secondary);
        cursor: pointer;
        transition: all 0.15s ease;
        font-family: inherit;
      }

      .filter-btn:hover {
        border-color: var(--accent);
        color: var(--accent);
      }

      .filter-btn.active {
        background: var(--accent);
        border-color: var(--accent);
        color: white;
      }

      .filter-count {
        margin-left: 2px;
        opacity: 0.8;
      }

      .sort-btn {
        width: 28px;
        height: 28px;
        border: none;
        background: var(--bg-hover);
        border-radius: var(--radius-sm);
        color: var(--text-secondary);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
      }

      .sort-btn:hover {
        background: var(--accent-light);
        color: var(--accent);
      }

      .sort-btn.active {
        background: var(--accent);
        color: white;
      }

      .sort-btn svg {
        width: 14px;
        height: 14px;
      }

      /* ==================== 结果列表 ==================== */
      .results-container {
        flex: 1;
        overflow-y: auto;
        min-height: 180px;
        max-height: 320px;
      }

      .results-list {
        padding: 8px;
      }

      .result-item {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px 12px;
        border-radius: var(--radius-sm);
        cursor: pointer;
        transition: all 0.1s ease;
        position: relative;
      }

      .result-item:hover {
        background: var(--bg-hover);
      }

      .result-item.active {
        background: var(--bg-active);
      }

      /* Spotlight 风格激活样式 */
      :host(.style-spotlight) .result-item.active {
        background: var(--accent);
      }

      :host(.style-spotlight) .result-item.active .result-title,
      :host(.style-spotlight) .result-item.active .result-url,
      :host(.style-spotlight) .result-item.active .result-meta {
        color: white !important;
      }

      /* Raycast 风格左侧指示条 */
      :host(.style-raycast) .result-item::before {
        content: '';
        position: absolute;
        left: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 3px;
        height: 0;
        background: var(--accent-gradient);
        border-radius: 2px;
        transition: height 0.15s ease;
      }

      :host(.style-raycast) .result-item:hover::before,
      :host(.style-raycast) .result-item.active::before {
        height: 24px;
      }

      /* Fluent 风格边框高亮 */
      :host(.style-fluent) .result-item.active {
        border: 1px solid var(--accent);
        background: var(--accent-light);
      }

      .result-icon {
        width: 36px;
        height: 36px;
        border-radius: 8px;
        background: var(--bg-secondary);
        display: flex;
        align-items: center;
        justify-content: center;
        flex-shrink: 0;
        overflow: hidden;
      }

      .result-icon img {
        width: 20px;
        height: 20px;
        object-fit: contain;
      }

      .result-content {
        flex: 1;
        min-width: 0;
      }

      .result-title {
        font-size: 14px;
        font-weight: 500;
        color: var(--text-primary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .result-url {
        font-size: 12px;
        color: var(--text-secondary);
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        margin-top: 2px;
      }

      .result-meta {
        display: flex;
        align-items: center;
        gap: 8px;
        flex-shrink: 0;
      }

      .meta-badge {
        padding: 3px 8px;
        background: var(--accent-light);
        border-radius: 10px;
        font-size: 11px;
        color: var(--accent);
        font-weight: 500;
      }

      .meta-time {
        font-size: 11px;
        color: var(--text-secondary);
      }

      .status-tag {
        padding: 2px 6px;
        border-radius: 4px;
        font-size: 10px;
        font-weight: 500;
      }

      .status-tag.never-used {
        background: rgba(255, 149, 0, 0.15);
        color: #ff9500;
      }

      .status-tag.rarely-used {
        background: rgba(52, 199, 89, 0.15);
        color: #34c759;
      }

      .status-tag.dormant {
        background: rgba(255, 59, 48, 0.15);
        color: #ff3b30;
      }

      .no-results {
        text-align: center;
        padding: 40px 20px;
        color: var(--text-secondary);
        font-size: 14px;
      }

      /* ==================== 状态栏 ==================== */
      .status-bar {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 16px;
        background: var(--bg-secondary);
        border-top: 1px solid var(--border);
        font-size: 12px;
        color: var(--text-secondary);
      }

      .status-left {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .keyboard-hints {
        display: flex;
        gap: 12px;
      }

      .hint {
        display: flex;
        align-items: center;
        gap: 4px;
      }

      .hint kbd {
        padding: 2px 6px;
        background: var(--bg-primary);
        border-radius: 4px;
        font-family: 'SF Mono', Monaco, monospace;
        font-size: 11px;
        box-shadow: 0 1px 2px rgba(0, 0, 0, 0.1);
      }

      .style-switcher {
        width: 28px;
        height: 28px;
        border: none;
        background: var(--bg-hover);
        border-radius: var(--radius-sm);
        color: var(--text-secondary);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
        margin-left: 8px;
      }

      .style-switcher:hover {
        background: var(--accent-light);
        color: var(--accent);
      }

      .style-switcher svg {
        width: 16px;
        height: 16px;
      }

      /* ==================== 滚动条 ==================== */
      .results-container::-webkit-scrollbar {
        width: 6px;
      }

      .results-container::-webkit-scrollbar-track {
        background: transparent;
      }

      .results-container::-webkit-scrollbar-thumb {
        background: var(--border);
        border-radius: 3px;
      }

      .results-container::-webkit-scrollbar-thumb:hover {
        background: var(--text-secondary);
      }

      /* ==================== 友情链接 ==================== */
      .friend-links {
        padding: 8px 16px;
        border-top: 1px solid var(--border);
        background: var(--bg-secondary);
      }

      .friend-links-container {
        display: flex;
        flex-wrap: wrap;
        gap: 8px;
        justify-content: center;
      }

      .friend-link-item {
        display: flex;
        align-items: center;
        gap: 6px;
        padding: 4px 10px;
        background: var(--bg-primary);
        border-radius: 14px;
        text-decoration: none;
        color: var(--text-secondary);
        font-size: 12px;
        transition: all 0.15s ease;
        border: 1px solid var(--border);
      }

      .friend-link-item:hover {
        background: var(--accent-light);
        color: var(--accent);
        border-color: var(--accent);
      }

      .friend-link-favicon {
        width: 14px;
        height: 14px;
        border-radius: 3px;
      }

      .friend-link-tag {
        white-space: nowrap;
      }

      /* ==================== 字体切换按钮 ==================== */
      .font-switcher {
        width: 28px;
        height: 28px;
        border: none;
        background: var(--bg-hover);
        border-radius: var(--radius-sm);
        color: var(--text-secondary);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
        margin-left: 8px;
      }

      .font-switcher:hover {
        background: var(--accent-light);
        color: var(--accent);
      }

      .font-switcher svg {
        width: 16px;
        height: 16px;
      }

      /* ==================== 设置按钮 ==================== */
      .settings-btn-overlay {
        width: 28px;
        height: 28px;
        border: none;
        background: var(--bg-hover);
        border-radius: var(--radius-sm);
        color: var(--text-secondary);
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        transition: all 0.15s ease;
        margin-left: 8px;
      }

      .settings-btn-overlay:hover {
        background: var(--accent-light);
        color: var(--accent);
      }

      .settings-btn-overlay svg {
        width: 16px;
        height: 16px;
      }

      /* ==================== 右键菜单基础 ==================== */
      .context-menu {
        position: fixed;
        min-width: 200px;
        z-index: 2147483648;
        opacity: 0;
        visibility: hidden;
        transform: scale(0.95);
        transition: all 0.15s ease;
      }

      .context-menu.show {
        opacity: 1;
        visibility: visible;
        transform: scale(1);
      }

      .menu-item {
        display: flex;
        align-items: center;
        gap: 10px;
        cursor: pointer;
        font-size: 13px;
        transition: all 0.1s;
      }

      .menu-item svg {
        width: 16px;
        height: 16px;
        flex-shrink: 0;
      }

      .menu-item-text {
        flex: 1;
      }

      .menu-item-shortcut {
        font-size: 11px;
        font-family: 'SF Mono', Monaco, monospace;
      }

      .menu-separator {
        height: 1px;
      }

      /* ==================== Spotlight 风格右键菜单 ==================== */
      :host(.style-spotlight) .context-menu,
      :host(.style-spotlight.dark) .context-menu {
        background: rgba(255, 255, 255, 0.85);
        backdrop-filter: blur(20px);
        -webkit-backdrop-filter: blur(20px);
        border-radius: 10px;
        box-shadow: 
          0 0 0 0.5px rgba(0, 0, 0, 0.1),
          0 12px 24px rgba(0, 0, 0, 0.15),
          0 2px 8px rgba(0, 0, 0, 0.08);
        padding: 5px 0;
      }

      :host(.style-spotlight.dark) .context-menu {
        background: rgba(40, 40, 40, 0.88);
        box-shadow: 
          0 0 0 0.5px rgba(255, 255, 255, 0.1),
          0 12px 24px rgba(0, 0, 0, 0.4);
      }

      :host(.style-spotlight) .menu-item,
      :host(.style-spotlight.dark) .menu-item {
        padding: 6px 12px;
        margin: 0 5px;
        border-radius: 5px;
        color: #1d1d1f;
      }

      :host(.style-spotlight.dark) .menu-item {
        color: #f5f5f7;
      }

      :host(.style-spotlight) .menu-item:hover,
      :host(.style-spotlight.dark) .menu-item:hover {
        background: #007aff;
        color: white;
      }

      :host(.style-spotlight) .menu-item:hover svg,
      :host(.style-spotlight.dark) .menu-item:hover svg {
        color: white;
      }

      :host(.style-spotlight) .menu-item svg,
      :host(.style-spotlight.dark) .menu-item svg {
        color: #6e6e73;
      }

      :host(.style-spotlight) .menu-item-shortcut {
        color: #a1a1a6;
      }

      :host(.style-spotlight) .menu-item:hover .menu-item-shortcut {
        color: rgba(255, 255, 255, 0.7);
      }

      :host(.style-spotlight) .menu-separator,
      :host(.style-spotlight.dark) .menu-separator {
        background: rgba(0, 0, 0, 0.1);
        margin: 5px 12px;
      }

      :host(.style-spotlight.dark) .menu-separator {
        background: rgba(255, 255, 255, 0.1);
      }

      :host(.style-spotlight) .menu-item.delete-action {
        color: #ff3b30;
      }

      :host(.style-spotlight) .menu-item.delete-action svg {
        color: #ff3b30;
      }

      :host(.style-spotlight) .menu-item.delete-action:hover {
        background: #ff3b30;
        color: white;
      }

      :host(.style-spotlight) .menu-item.delete-action:hover svg {
        color: white;
      }

      :host(.style-spotlight) .menu-item.edit-action {
        color: #007aff;
      }

      :host(.style-spotlight) .menu-item.edit-action svg {
        color: #007aff;
      }

      /* ==================== Raycast 风格右键菜单 ==================== */
      :host(.style-raycast) .context-menu,
      :host(.style-raycast.light) .context-menu {
        background: #1e1e20;
        border-radius: 12px;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.4);
        padding: 6px;
        border: 1px solid rgba(255, 255, 255, 0.08);
      }

      :host(.style-raycast.light) .context-menu {
        background: #ffffff;
        box-shadow: 0 20px 40px rgba(0, 0, 0, 0.15);
        border: 1px solid rgba(0, 0, 0, 0.08);
      }

      :host(.style-raycast) .menu-item,
      :host(.style-raycast.light) .menu-item {
        padding: 10px 12px;
        border-radius: 8px;
        color: #e5e5e5;
        position: relative;
      }

      :host(.style-raycast.light) .menu-item {
        color: #1d1d1f;
      }

      :host(.style-raycast) .menu-item::before {
        content: '';
        position: absolute;
        left: 0;
        top: 50%;
        transform: translateY(-50%);
        width: 3px;
        height: 0;
        background: linear-gradient(135deg, #a855f7, #ec4899);
        border-radius: 2px;
        transition: height 0.15s;
      }

      :host(.style-raycast) .menu-item:hover {
        background: #2a2a2c;
      }

      :host(.style-raycast.light) .menu-item:hover {
        background: #f5f5f7;
      }

      :host(.style-raycast) .menu-item:hover::before {
        height: 20px;
      }

      :host(.style-raycast) .menu-item svg {
        color: #8e8e93;
      }

      :host(.style-raycast) .menu-item:hover svg {
        color: #a855f7;
      }

      :host(.style-raycast) .menu-item-shortcut {
        color: #5e5e63;
        padding: 2px 6px;
        background: rgba(255, 255, 255, 0.06);
        border-radius: 4px;
      }

      :host(.style-raycast) .menu-separator {
        background: rgba(255, 255, 255, 0.06);
        margin: 6px 0;
      }

      :host(.style-raycast.light) .menu-separator {
        background: rgba(0, 0, 0, 0.06);
      }

      :host(.style-raycast) .menu-item.delete-action {
        color: #ff6b6b;
      }

      :host(.style-raycast) .menu-item.delete-action svg {
        color: #ff6b6b;
      }

      :host(.style-raycast) .menu-item.delete-action:hover::before {
        background: linear-gradient(135deg, #ff6b6b, #ff3b30);
      }

      :host(.style-raycast) .menu-item.edit-action {
        color: #a855f7;
      }

      :host(.style-raycast) .menu-item.edit-action svg {
        color: #a855f7;
      }

      /* ==================== Fluent 风格右键菜单 ==================== */
      :host(.style-fluent) .context-menu,
      :host(.style-fluent.dark) .context-menu {
        background: rgba(255, 255, 255, 0.9);
        backdrop-filter: blur(20px) saturate(180%);
        -webkit-backdrop-filter: blur(20px) saturate(180%);
        border-radius: 8px;
        box-shadow: 
          0 0 0 1px rgba(0, 0, 0, 0.05),
          0 8px 16px rgba(0, 0, 0, 0.1);
        padding: 4px;
      }

      :host(.style-fluent.dark) .context-menu {
        background: rgba(40, 40, 40, 0.9);
        box-shadow: 
          0 0 0 1px rgba(255, 255, 255, 0.05),
          0 8px 16px rgba(0, 0, 0, 0.3);
      }

      :host(.style-fluent) .menu-item,
      :host(.style-fluent.dark) .menu-item {
        padding: 8px 10px;
        border-radius: 4px;
        color: #1a1a1a;
      }

      :host(.style-fluent.dark) .menu-item {
        color: #f5f5f7;
      }

      :host(.style-fluent) .menu-item:hover {
        background: rgba(0, 0, 0, 0.04);
      }

      :host(.style-fluent.dark) .menu-item:hover {
        background: rgba(255, 255, 255, 0.06);
      }

      :host(.style-fluent) .menu-item:active {
        background: rgba(0, 0, 0, 0.08);
      }

      :host(.style-fluent) .menu-item svg {
        color: #424242;
      }

      :host(.style-fluent.dark) .menu-item svg {
        color: #a1a1a6;
      }

      :host(.style-fluent) .menu-item-shortcut {
        color: #6e6e6e;
      }

      :host(.style-fluent) .menu-separator {
        background: rgba(0, 0, 0, 0.08);
        margin: 4px 8px;
      }

      :host(.style-fluent.dark) .menu-separator {
        background: rgba(255, 255, 255, 0.08);
      }

      :host(.style-fluent) .menu-item.delete-action {
        color: #c42b1c;
      }

      :host(.style-fluent) .menu-item.delete-action svg {
        color: #c42b1c;
      }

      :host(.style-fluent) .menu-item.delete-action:hover {
        background: rgba(196, 43, 28, 0.08);
      }

      :host(.style-fluent) .menu-item.edit-action {
        color: #0078d4;
      }

      :host(.style-fluent) .menu-item.edit-action svg {
        color: #0078d4;
      }

      /* ==================== 编辑弹窗 ==================== */
      .edit-modal {
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.5);
        display: none;
        align-items: center;
        justify-content: center;
        z-index: 2147483649;
      }

      .edit-modal.show {
        display: flex;
      }

      .edit-modal-content {
        background: var(--bg-primary);
        border-radius: var(--radius);
        width: 400px;
        max-width: 90%;
        box-shadow: var(--shadow);
        overflow: hidden;
      }

      .edit-modal-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 16px 20px;
        border-bottom: 1px solid var(--border);
      }

      .edit-modal-title {
        font-size: 16px;
        font-weight: 600;
        color: var(--text-primary);
      }

      .edit-modal-close {
        width: 28px;
        height: 28px;
        border: none;
        background: transparent;
        cursor: pointer;
        font-size: 20px;
        color: var(--text-secondary);
        border-radius: 4px;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .edit-modal-close:hover {
        background: var(--bg-hover);
      }

      .edit-modal-body {
        padding: 20px;
      }

      .edit-field {
        margin-bottom: 16px;
      }

      .edit-field:last-child {
        margin-bottom: 0;
      }

      .edit-field label {
        display: block;
        font-size: 13px;
        font-weight: 500;
        color: var(--text-secondary);
        margin-bottom: 6px;
      }

      .edit-field input {
        width: 100%;
        padding: 10px 12px;
        border: 1px solid var(--border);
        border-radius: var(--radius-sm);
        background: var(--bg-secondary);
        color: var(--text-primary);
        font-size: 14px;
        outline: none;
        transition: border-color 0.15s;
      }

      .edit-field input:focus {
        border-color: var(--accent);
      }

      .edit-modal-footer {
        display: flex;
        justify-content: flex-end;
        gap: 8px;
        padding: 16px 20px;
        border-top: 1px solid var(--border);
        background: var(--bg-secondary);
      }

      .edit-btn {
        padding: 8px 16px;
        border: none;
        border-radius: var(--radius-sm);
        font-size: 14px;
        font-weight: 500;
        cursor: pointer;
        transition: all 0.15s;
      }

      .edit-btn-cancel {
        background: var(--bg-primary);
        color: var(--text-primary);
        border: 1px solid var(--border);
      }

      .edit-btn-cancel:hover {
        background: var(--bg-hover);
      }

      .edit-btn-save {
        background: var(--accent);
        color: white;
      }

      .edit-btn-save:hover {
        opacity: 0.9;
      }
    `;
  }

  // 绑定事件
  function bindEvents() {
    const backdrop = shadowRoot.getElementById('backdrop');
    const searchInput = shadowRoot.getElementById('searchInput');
    const modeTabs = shadowRoot.getElementById('modeTabs');
    const filterBar = shadowRoot.getElementById('filterBar');
    const styleSwitcher = shadowRoot.getElementById('styleSwitcher');
    const searchPanel = shadowRoot.getElementById('searchPanel');

    // 点击背景关闭
    backdrop.addEventListener('click', hideOverlay);
    
    // 点击搜索区域时自动聚焦搜索框（解决焦点丢失问题）
    const searchArea = shadowRoot.querySelector('.search-area');
    if (searchArea) {
      searchArea.addEventListener('click', (e) => {
        // 如果点击的不是输入框本身，聚焦到输入框
        if (e.target !== searchInput) {
          markUserIntent();
          searchInput.focus();
        }
      });
    }
    
    // 点击面板空白区域时尝试聚焦搜索框
    searchPanel.addEventListener('click', (e) => {
      // 只有点击的是面板本身（非子元素）时才聚焦
      if (e.target === searchPanel) {
        markUserIntent();
        searchInput.focus();
      }
    });

    // 搜索输入
    searchInput.addEventListener('input', (e) => {
      search(e.target.value);
    });

    // IME 组合输入状态跟踪（解决中文输入法只落拼音问题）
    searchInput.addEventListener('compositionstart', () => {
      imeState.searchComposing = true;
    });
    searchInput.addEventListener('compositionend', () => {
      imeState.searchComposing = false;
    });

    // 某些站点会用 focus trap 抢焦点：pointerdown 时主动聚焦 + rAF 兜底
    searchInput.addEventListener('pointerdown', () => {
      markUserIntent();
      if (shadowRoot.activeElement !== searchInput) {
        try { searchInput.focus({ preventScroll: true }); } catch (e) {}
      }
      requestAnimationFrame(() => {
        if (isVisible && !imeState.searchComposing && shadowRoot.activeElement !== searchInput) {
          try { searchInput.focus({ preventScroll: true }); } catch (e) {}
        }
      });
    });

    // 键盘事件 - 在搜索框上
    searchInput.addEventListener('keydown', handleKeydown);

    // 全局键盘事件 - 在整个面板上，确保即使焦点不在搜索框也能响应
    searchPanel.addEventListener('keydown', (e) => {
      // 阻止事件冒泡到宿主页面
      e.stopPropagation();
      
      // 如果焦点在搜索框，已经由 handleKeydown 处理
      if (document.activeElement === searchInput || 
          shadowRoot.activeElement === searchInput) {
        return;
      }
      
      // 处理 Escape 关闭
      if (e.key === 'Escape') {
        e.preventDefault();
        hideOverlay();
        return;
      }
      
      // 其他按键时聚焦到搜索框
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
        if (e.isComposing || e.keyCode === 229) return;
        searchInput.focus();
      }
    });

    // 阻止面板内所有事件传播到宿主页面
    const stopPropagationEvents = ['keydown', 'keyup', 'keypress', 'click', 'mousedown', 'mouseup'];
    stopPropagationEvents.forEach(eventType => {
      searchPanel.addEventListener(eventType, (e) => {
        e.stopPropagation();
      });
    });

    // 模式切换
    modeTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.mode-tab');
      if (tab) {
        const mode = tab.dataset.mode;
        switchMode(mode);
      }
    });

    // 筛选器
    filterBar.addEventListener('click', (e) => {
      const filterBtn = e.target.closest('.filter-btn');
      const sortBtn = e.target.closest('.sort-btn');

      if (filterBtn) {
        shadowRoot.querySelectorAll('.filter-btn').forEach(b => b.classList.remove('active'));
        filterBtn.classList.add('active');
        currentFilter = filterBtn.dataset.filter;
        search(searchInput.value);
      }

      if (sortBtn) {
        shadowRoot.querySelectorAll('.sort-btn').forEach(b => b.classList.remove('active'));
        sortBtn.classList.add('active');
        currentSort = sortBtn.dataset.sort;
        search(searchInput.value);
      }
    });

    // 样式切换
    styleSwitcher.addEventListener('click', cycleStyle);

    // 结果项点击
    shadowRoot.getElementById('resultsList').addEventListener('click', (e) => {
      const item = e.target.closest('.result-item');
      if (item) {
        const index = parseInt(item.dataset.index);
        openResult(index);
      }
    });

    // 结果项右键菜单
    shadowRoot.getElementById('resultsList').addEventListener('contextmenu', (e) => {
      const item = e.target.closest('.result-item');
      if (item) {
        e.preventDefault();
        e.stopPropagation(); // 阻止宿主页面的右键菜单
        const index = parseInt(item.dataset.index);
        showContextMenu(e, index);
      }
    });

    // 阻止整个面板的默认右键菜单
    searchPanel.addEventListener('contextmenu', (e) => {
      // 允许在输入框中使用系统右键菜单
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') {
        return;
      }
      e.stopPropagation();
    });

    // 点击其他地方关闭右键菜单
    shadowRoot.addEventListener('click', hideContextMenu);
    backdrop.addEventListener('click', hideContextMenu);

    // 右键菜单点击
    shadowRoot.getElementById('contextMenu').addEventListener('click', handleContextMenuClick);

    // 字体切换按钮
    shadowRoot.getElementById('fontSwitcher').addEventListener('click', cycleFont);

    // 设置按钮
    shadowRoot.getElementById('settingsBtn').addEventListener('click', openSettings);

    // 编辑弹窗事件
    shadowRoot.getElementById('editModalClose').addEventListener('click', hideEditModal);
    shadowRoot.getElementById('editCancel').addEventListener('click', hideEditModal);
    shadowRoot.getElementById('editSave').addEventListener('click', saveEdit);
    
    // 编辑弹窗输入框：pointerdown 时聚焦 + rAF 兜底
    const editTitleInput = shadowRoot.getElementById('editTitle');
    const editUrlInput = shadowRoot.getElementById('editUrl');

    if (editTitleInput) {
      editTitleInput.addEventListener('compositionstart', () => { imeState.editTitleComposing = true; });
      editTitleInput.addEventListener('compositionend', () => { imeState.editTitleComposing = false; });
    }
    if (editUrlInput) {
      editUrlInput.addEventListener('compositionstart', () => { imeState.editUrlComposing = true; });
      editUrlInput.addEventListener('compositionend', () => { imeState.editUrlComposing = false; });
    }

    [editTitleInput, editUrlInput].forEach(input => {
      if (!input) return;
      input.addEventListener('pointerdown', () => {
        if (shadowRoot.activeElement !== input) {
          try { input.focus({ preventScroll: true }); } catch (e) {}
        }
        requestAnimationFrame(() => {
          const isComposing = (input === editTitleInput && imeState.editTitleComposing) ||
            (input === editUrlInput && imeState.editUrlComposing);
          if (isVisible && !isComposing && shadowRoot.activeElement !== input) {
            try { input.focus({ preventScroll: true }); } catch (e) {}
          }
        });
      });
    });

    // 加载友情链接
    loadFriendLinks();
  }

  // 处理键盘事件
  function handleKeydown(e) {
    // 始终阻止事件传播到宿主页面
    e.stopPropagation();
    e.stopImmediatePropagation();

    // IME 输入中（如中文输入法候选词选择），不拦截按键
    if (e.isComposing || e.keyCode === 229) return;
    
    const items = shadowRoot.querySelectorAll('.result-item');

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

      case 'ArrowLeft':
        e.preventDefault();
        switchModePrev();
        break;

      case 'ArrowRight':
        e.preventDefault();
        switchModeNext();
        break;

      case 'Enter':
        e.preventDefault();
        if (selectedIndex >= 0) {
          openResult(selectedIndex);
        }
        break;

      case 'Escape':
        e.preventDefault();
        hideOverlay();
        break;
        
      case 'Tab':
        // 阻止 Tab 键将焦点移出浮层
        e.preventDefault();
        break;
    }
  }

  // 更新选中状态
  function updateSelection() {
    const items = shadowRoot.querySelectorAll('.result-item');
    items.forEach((item, index) => {
      if (index === selectedIndex) {
        item.classList.add('active');
        item.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        item.classList.remove('active');
      }
    });
  }

  // 切换到上一个模式
  function switchModePrev() {
    const modes = ['bookmarks', 'tabs', 'history', 'downloads'];
    const currentIndex = modes.indexOf(currentMode);
    const newIndex = currentIndex <= 0 ? modes.length - 1 : currentIndex - 1;
    switchMode(modes[newIndex]);
  }

  // 切换到下一个模式
  function switchModeNext() {
    const modes = ['bookmarks', 'tabs', 'history', 'downloads'];
    const currentIndex = modes.indexOf(currentMode);
    const newIndex = currentIndex >= modes.length - 1 ? 0 : currentIndex + 1;
    switchMode(modes[newIndex]);
  }

  // 切换搜索模式
  function switchMode(mode) {
    currentMode = mode;
    selectedIndex = -1;

    // 更新标签样式
    shadowRoot.querySelectorAll('.mode-tab').forEach(tab => {
      tab.classList.toggle('active', tab.dataset.mode === mode);
    });

    // 更新搜索框占位符
    const searchInput = shadowRoot.getElementById('searchInput');
    const placeholders = {
      bookmarks: '搜索书签...',
      tabs: '搜索标签页...',
      history: '搜索历史记录...',
      downloads: '搜索下载文件...'
    };
    searchInput.placeholder = placeholders[mode];

    // 显示/隐藏筛选器
    const filterBar = shadowRoot.getElementById('filterBar');
    filterBar.classList.toggle('show', mode === 'bookmarks');

    // 加载数据并搜索
    loadData().then(() => {
      search(searchInput.value);
    });
  }

  // 加载数据
  async function loadData() {
    return new Promise((resolve) => {
      chrome.runtime.sendMessage({ type: 'GET_DATA', mode: currentMode }, (response) => {
        if (response) {
          switch (currentMode) {
            case 'bookmarks':
              allBookmarks = response.data || [];
              shadowRoot.getElementById('bookmarksCount').textContent = allBookmarks.length;
              updateFilterCounts();
              break;
            case 'tabs':
              allTabs = response.data || [];
              shadowRoot.getElementById('tabsCount').textContent = allTabs.length;
              break;
            case 'history':
              allHistory = response.data || [];
              shadowRoot.getElementById('historyCount').textContent = allHistory.length;
              break;
            case 'downloads':
              allDownloads = response.data || [];
              shadowRoot.getElementById('downloadsCount').textContent = allDownloads.length;
              break;
          }
        }
        resolve();
      });
    });
  }

  // 更新筛选器计数
  function updateFilterCounts() {
    const counts = {
      never_used: 0,
      rarely_used: 0,
      dormant: 0
    };

    allBookmarks.forEach(b => {
      if (b.usageStatus && counts.hasOwnProperty(b.usageStatus)) {
        counts[b.usageStatus]++;
      }
    });

    const neverUsedCount = shadowRoot.querySelector('[data-filter="never_used"] .filter-count');
    const rarelyUsedCount = shadowRoot.querySelector('[data-filter="rarely_used"] .filter-count');
    const dormantCount = shadowRoot.querySelector('[data-filter="dormant"] .filter-count');

    if (neverUsedCount) neverUsedCount.textContent = counts.never_used;
    if (rarelyUsedCount) rarelyUsedCount.textContent = counts.rarely_used;
    if (dormantCount) dormantCount.textContent = counts.dormant;
  }

  // 搜索函数
  function search(query) {
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

    // 恢复原有“多关键字 + 高级语法”能力：复用 SearchParser + SmartSort
    // SearchParser 支持：空格分隔多关键字 AND、引号精确匹配、site/type/in/after/before 等
    if (typeof SearchParser !== 'undefined' && SearchParser.filter) {
      items = SearchParser.filter(items, query || '');
    } else if (query && query.trim()) {
      // 兜底：至少支持“空格分词 AND”
      const tokens = query.trim().split(/\s+/).filter(Boolean).map(t => t.toLowerCase());
      items = items.filter(item => {
        const searchable = [
          item.title || '',
          item.url || '',
          item.filename || ''
        ].join(' ').toLowerCase();
        return tokens.every(t => searchable.includes(t));
      });
    }

    // 确定实际使用的排序模式
    // 历史记录、标签页、下载：无搜索词时默认按时间排序更直观
    // 书签：默认按智能排序（访问频率 + 相关度）
    let effectiveSort = currentSort;
    if (currentSort === 'smart') {
      if ((currentMode === 'history' || currentMode === 'tabs' || currentMode === 'downloads') && !query?.trim()) {
        effectiveSort = 'time';
      }
    }

    if (typeof SmartSort !== 'undefined' && SmartSort.sort) {
      items = SmartSort.sort(items, { searchText: query || '', mode: effectiveSort });
    } else {
      // 兜底排序（保持行为可用）
      items = sortItems(items, query || '', effectiveSort);
    }

    currentResults = items;
    selectedIndex = items.length > 0 ? 0 : -1;
    displayResults(items);
  }

  // 按使用状态筛选
  function filterByUsageStatus(bookmarks, filter) {
    if (filter === 'all') return bookmarks;
    return bookmarks.filter(b => b.usageStatus === filter);
  }

  // 排序
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

  // 显示结果
  function displayResults(items) {
    const resultsList = shadowRoot.getElementById('resultsList');
    const searchStats = shadowRoot.getElementById('searchStats');

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
            <img src="${faviconUrl}" onerror="this.src='data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><path fill=%22%23999%22 d=%22M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z%22/></svg>'">
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
  }

  // 获取 favicon URL
  function getFaviconUrl(item) {
    try {
      if (item.url) {
        const url = new URL(item.url);
        return `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=32`;
      }
    } catch (e) {}
    return 'data:image/svg+xml,<svg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 24 24%22><path fill=%22%23999%22 d=%22M17 3H7c-1.1 0-2 .9-2 2v16l7-3 7 3V5c0-1.1-.9-2-2-2z%22/></svg>';
  }

  // 获取元信息
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

  // 格式化时间
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

  // HTML 转义
  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  // 打开结果
  function openResult(index) {
    const item = currentResults[index];
    if (!item) return;

    chrome.runtime.sendMessage({
      type: 'OPEN_RESULT',
      mode: currentMode,
      item: item
    });

    hideOverlay();
  }

  // 循环切换字体
  function cycleFont() {
    const fonts = ['system', 'pingfang', 'inter', 'noto'];
    const currentIndex = fonts.indexOf(currentFont);
    const nextIndex = (currentIndex + 1) % fonts.length;
    setFont(fonts[nextIndex]);

    // 保存设置
    chrome.runtime.sendMessage({
      type: 'SAVE_FONT',
      font: fonts[nextIndex]
    });

    // 显示当前字体名称
    const fontConfig = FONT_CONFIGS[fonts[nextIndex]];
    showToast(`字体: ${fontConfig?.name || fonts[nextIndex]}`);
  }

  // 设置字体
  function setFont(font) {
    currentFont = font;
    
    // 移除所有字体类
    Object.keys(FONT_CONFIGS).forEach(f => {
      overlayContainer.classList.remove(`font-${f}`);
    });
    
    // 添加新字体类
    overlayContainer.classList.add(`font-${font}`);
  }

  // 循环切换样式
  function cycleStyle() {
    const styles = ['spotlight', 'raycast', 'fluent'];
    const currentIndex = styles.indexOf(currentStyle);
    const nextIndex = (currentIndex + 1) % styles.length;
    setStyle(styles[nextIndex]);

    // 保存设置
    chrome.runtime.sendMessage({
      type: 'SAVE_STYLE',
      style: styles[nextIndex]
    });
  }

  // 设置样式
  function setStyle(style) {
    currentStyle = style;
    
    // Shadow DOM 的 :host 选择器需要通过 host 元素的 class 来控制
    // 所以我们直接在 shadowRoot 内部的容器上应用样式
    const container = shadowRoot.getElementById('searchPanel');
    const backdrop = shadowRoot.getElementById('backdrop');
    
    // 移除所有样式类，但保留字体类
    const fontClass = Array.from(overlayContainer.classList).find(c => c.startsWith('font-'));
    overlayContainer.className = 'bookmark-search-overlay-host';
    if (fontClass) {
      overlayContainer.classList.add(fontClass);
    }
    
    // 添加新样式类
    overlayContainer.classList.add(`style-${style}`);

    // 获取用户主题设置并应用
    chrome.storage.sync.get(['optionsSettings', 'settings'], (result) => {
      // 优先使用 optionsSettings（来自 options 页面）
      let userTheme = 'system';
      if (result.optionsSettings && result.optionsSettings.theme) {
        userTheme = result.optionsSettings.theme;
      } else if (result.settings && result.settings.theme) {
        userTheme = result.settings.theme;
      }
      
      // 根据用户设置或系统偏好决定是否使用深色模式
      let isDark = false;
      if (userTheme === 'dark') {
        isDark = true;
      } else if (userTheme === 'light') {
        isDark = false;
      } else {
        // system 模式：跟随系统
        isDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
      }
      
      // 移除之前的主题类
      overlayContainer.classList.remove('dark', 'light');
      
      // 应用主题
      if (isDark && (style === 'spotlight' || style === 'fluent')) {
        overlayContainer.classList.add('dark');
      } else if (!isDark && style === 'raycast') {
        overlayContainer.classList.add('light');
      }
    });
  }

  // 显示浮层
  function showOverlay() {
    console.log('[BookmarkSearch] showOverlay called');
    if (!overlayContainer) {
      console.log('[BookmarkSearch] Creating overlay...');
      createOverlay();
    }

    // 加载保存的样式
    chrome.runtime.sendMessage({ type: 'GET_STYLE' }, (response) => {
      if (response && response.style) {
        setStyle(response.style);
      } else {
        setStyle('spotlight');
      }
    });

    // 加载保存的字体
    chrome.runtime.sendMessage({ type: 'GET_FONT' }, (response) => {
      if (response && response.font) {
        setFont(response.font);
      } else {
        setFont('system');
      }
    });

    const backdrop = shadowRoot.getElementById('backdrop');
    const panel = shadowRoot.getElementById('searchPanel');
    const searchInput = shadowRoot.getElementById('searchInput');

    backdrop.classList.add('show');
    panel.classList.add('show');
    isVisible = true;

    // 激活 MAIN world focus guard —— 从根源上阻止页面 focus trap 抢焦点
    document.documentElement.dataset.bookmarkSearchActive = 'true';

    // 启用事件隔离 - 防止宿主页面事件干扰
    EventIsolation.enable();

    // 聚焦策略：页面 focus trap 已由 focus-guard.js（MAIN world）从根源拦截，
    // 只需一次聚焦 + rAF 兜底即可，不再需要多层重试
    if (shadowRoot.activeElement !== searchInput) {
      try { searchInput.focus({ preventScroll: true }); } catch (e) {}
    }
    requestAnimationFrame(() => {
      if (!isVisible || imeState.searchComposing) return;
      if (shadowRoot.activeElement !== searchInput) {
        try { searchInput.focus({ preventScroll: true }); } catch (e) {}
      }
    });

    // 初始化筛选栏显示状态（书签模式下显示）
    const filterBar = shadowRoot.getElementById('filterBar');
    if (filterBar) {
      filterBar.classList.toggle('show', currentMode === 'bookmarks');
    }

    // 加载初始数据
    loadData().then(() => {
      search('');
    });
  }

  // 隐藏浮层
  function hideOverlay() {
    if (!shadowRoot) return;

    const backdrop = shadowRoot.getElementById('backdrop');
    const panel = shadowRoot.getElementById('searchPanel');

    backdrop.classList.remove('show');
    panel.classList.remove('show');
    isVisible = false;

    // 关闭 MAIN world focus guard —— 恢复页面正常 focus 行为
    delete document.documentElement.dataset.bookmarkSearchActive;

    // 禁用事件隔离 - 恢复宿主页面正常行为
    EventIsolation.disable();

    // 清空搜索
    const searchInput = shadowRoot.getElementById('searchInput');
    if (searchInput) {
      searchInput.value = '';
    }
  }

  // 切换浮层
  function toggleOverlay() {
    if (isVisible) {
      hideOverlay();
    } else {
      showOverlay();
    }
  }

  // 监听来自 background 的消息
  chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    console.log('[BookmarkSearch] Content script received message:', request.type);
    if (request.type === 'TOGGLE_OVERLAY') {
      console.log('[BookmarkSearch] Toggling overlay...');
      toggleOverlay();
      sendResponse({ success: true });
    }
    return true;
  });
  
  console.log('[BookmarkSearch] Message listener registered');

  // 监听系统主题变化（仅当用户设置为跟随系统时才响应）
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
    if (overlayContainer) {
      chrome.storage.sync.get(['optionsSettings', 'settings'], (result) => {
        let userTheme = 'system';
        if (result.optionsSettings && result.optionsSettings.theme) {
          userTheme = result.optionsSettings.theme;
        } else if (result.settings && result.settings.theme) {
          userTheme = result.settings.theme;
        }
        
        // 只有跟随系统时才响应系统主题变化
        if (userTheme === 'system') {
          setStyle(currentStyle);
        }
      });
    }
  });
  
  // 监听存储变化以实时更新主题
  chrome.storage.onChanged.addListener((changes, namespace) => {
    if (namespace === 'sync' && (changes.optionsSettings || changes.settings)) {
      if (overlayContainer) {
        setStyle(currentStyle);
      }
    }
  });

  // 监听快捷键 (备用，如果 background 无法触发)
  document.addEventListener('keydown', (e) => {
    if (e.altKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      toggleOverlay();
    }
  });

  // ==================== 右键菜单功能 ====================
  let contextMenuTarget = null;
  let contextMenuIndex = -1;

  function showContextMenu(e, index) {
    contextMenuIndex = index;
    contextMenuTarget = currentResults[index];
    
    const menu = shadowRoot.getElementById('contextMenu');
    const editAction = menu.querySelector('.edit-action');
    const deleteAction = menu.querySelector('.delete-action');
    
    // 根据模式显示/隐藏编辑和删除选项
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
    
    // 计算菜单位置
    const panel = shadowRoot.getElementById('searchPanel');
    const panelRect = panel.getBoundingClientRect();
    
    // 先显示菜单获取尺寸
    menu.style.visibility = 'hidden';
    menu.classList.add('show');
    const menuRect = menu.getBoundingClientRect();
    menu.style.visibility = '';
    
    let x = e.clientX - panelRect.left;
    let y = e.clientY - panelRect.top;
    
    // 确保菜单不超出面板右边界
    if (x + menuRect.width > panelRect.width - 10) {
      x = panelRect.width - menuRect.width - 10;
    }
    
    // 确保菜单不超出面板底部边界
    if (y + menuRect.height > panelRect.height - 10) {
      y = y - menuRect.height;
      if (y < 10) y = 10;
    }
    
    // 确保不超出左边界
    if (x < 10) x = 10;
    
    menu.style.left = x + 'px';
    menu.style.top = y + 'px';
  }

  function hideContextMenu() {
    const menu = shadowRoot.getElementById('contextMenu');
    menu.classList.remove('show');
    contextMenuTarget = null;
    contextMenuIndex = -1;
  }

  function handleContextMenuClick(e) {
    const menuItem = e.target.closest('.menu-item');
    if (!menuItem || !contextMenuTarget) return;
    
    const action = menuItem.dataset.action;
    
    switch (action) {
      case 'open-new':
        chrome.runtime.sendMessage({
          type: 'OPEN_RESULT',
          mode: currentMode,
          item: contextMenuTarget,
          newTab: true
        });
        break;
      
      case 'open-incognito':
        chrome.runtime.sendMessage({
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
    const modal = shadowRoot.getElementById('editModal');
    const titleInput = shadowRoot.getElementById('editTitle');
    const urlInput = shadowRoot.getElementById('editUrl');
    
    titleInput.value = item.title || '';
    urlInput.value = item.url || '';
    
    modal.classList.add('show');
    
    // 聚焦策略：focus-guard.js 已阻止页面抢焦点，简单聚焦即可
    if (shadowRoot.activeElement !== titleInput) {
      try { titleInput.focus({ preventScroll: true }); } catch (e) {}
    }
    requestAnimationFrame(() => {
      if (!modal.classList.contains('show') || imeState.editTitleComposing) return;
      if (shadowRoot.activeElement !== titleInput) {
        try { titleInput.focus({ preventScroll: true }); } catch (e) {}
      }
    });
    
    // 为编辑弹窗添加键盘事件处理
    const handleEditKeydown = (e) => {
      e.stopPropagation();
      e.stopImmediatePropagation();
      
      if (e.key === 'Escape') {
        e.preventDefault();
        hideEditModal();
        modal.removeEventListener('keydown', handleEditKeydown);
      } else if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        saveEdit();
        modal.removeEventListener('keydown', handleEditKeydown);
      }
    };
    
    modal.addEventListener('keydown', handleEditKeydown);
  }

  function hideEditModal() {
    const modal = shadowRoot.getElementById('editModal');
    modal.classList.remove('show');
    editingItem = null;
    
    // 关闭后重新聚焦到搜索框
    const searchInput = shadowRoot.getElementById('searchInput');
    if (searchInput) {
      searchInput.focus();
    }
  }

  function saveEdit() {
    if (!editingItem) return;
    
    const titleInput = shadowRoot.getElementById('editTitle');
    const urlInput = shadowRoot.getElementById('editUrl');
    
    const newTitle = titleInput.value.trim();
    const newUrl = urlInput.value.trim();
    
    if (!newTitle || !newUrl) {
      showToast('标题和网址不能为空');
      return;
    }
    
    chrome.runtime.sendMessage({
      type: 'EDIT_BOOKMARK',
      id: editingItem.id,
      title: newTitle,
      url: newUrl
    }, (response) => {
      if (response && response.success) {
        showToast('书签已更新');
        // 刷新数据
        loadData().then(() => {
          search(shadowRoot.getElementById('searchInput').value);
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
      chrome.runtime.sendMessage({
        type: 'DELETE_ITEM',
        mode: currentMode,
        item: item
      }, (response) => {
        if (response && response.success) {
          showToast(`${typeText}已删除`);
          // 刷新数据
          loadData().then(() => {
            search(shadowRoot.getElementById('searchInput').value);
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
      const container = shadowRoot.getElementById('friendLinksContainer');
      
      container.innerHTML = links.map(link => {
        let hostname = '';
        try {
          hostname = new URL(link.url).hostname;
        } catch (e) {}
        
        return `
          <a href="${escapeHtml(link.url)}" class="friend-link-item" target="_blank" title="${escapeHtml(link.name)}">
            <img class="friend-link-favicon" src="https://www.google.com/s2/favicons?domain=${hostname}&sz=32" onerror="this.style.display='none'">
            <span class="friend-link-tag">${escapeHtml(link.name)}</span>
          </a>
        `;
      }).join('');
      
      // 点击友情链接后关闭浮层
      container.addEventListener('click', (e) => {
        const link = e.target.closest('.friend-link-item');
        if (link) {
          // 延迟关闭，确保链接能正常打开
          setTimeout(() => hideOverlay(), 100);
        }
      });
    } catch (e) {
      console.error('[BookmarkSearch] Failed to load friend links:', e);
    }
  }

  // ==================== 设置页面 ====================
  function openSettings() {
    chrome.runtime.sendMessage({ type: 'OPEN_OPTIONS' });
    hideOverlay();
  }

  // ==================== 工具函数 ====================
  function copyToClipboard(text) {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  }

  function showToast(message) {
    // 创建简单的 toast 提示
    let toast = shadowRoot.getElementById('toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 20px;
        left: 50%;
        transform: translateX(-50%);
        padding: 10px 20px;
        background: var(--text-primary);
        color: var(--bg-primary);
        border-radius: 8px;
        font-size: 13px;
        z-index: 2147483650;
        opacity: 0;
        transition: opacity 0.3s;
      `;
      shadowRoot.getElementById('searchPanel').appendChild(toast);
    }
    
    toast.textContent = message;
    toast.style.opacity = '1';
    
    setTimeout(() => {
      toast.style.opacity = '0';
    }, 2000);
  }

})();
