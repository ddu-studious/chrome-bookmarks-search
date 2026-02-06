/**
 * Focus Guard — 运行在页面 MAIN world 中的焦点拦截脚本
 *
 * 原理：
 *   很多 Web 应用（Prometheus、Grafana、Ant Design Modal 等）在打开弹窗/抽屉时
 *   会实现 "focus trap"——通过 focusin 监听 或 setInterval 周期检查 来发现焦点
 *   离开了弹窗，然后调用 element.focus() 把焦点拉回来。
 *
 *   这会导致我们的书签搜索浮层无法正常使用：搜索框反复失焦、光标闪烁、
 *   中文输入法（IME）只能打出拼音。
 *
 *   此脚本在 `document_start` 时注入到页面的 **MAIN world**（与页面脚本共享
 *   同一个 JavaScript 执行上下文），通过 monkey-patch `HTMLElement.prototype.focus`
 *   来拦截页面的 focus() 调用。
 *
 *   当书签搜索浮层可见时（通过 DOM 标记 `data-bookmark-search-active` 判断），
 *   任何对浮层容器 **外部** 元素的 focus() 调用都会被静默忽略。
 *
 * 关键设计：
 *   - 此脚本运行在 MAIN world，patch 只影响页面自身的 focus() 调用
 *   - 我们的 content-script.js 运行在 ISOLATED world，有独立的 prototype，
 *     因此完全不受此 patch 影响，可以正常调用 focus()
 *   - 浮层关闭时自动恢复正常行为，不影响页面功能
 *   - 脚本极其轻量，对页面性能几乎零影响
 */
(function () {
  'use strict';

  // 保存原始的 focus 方法
  const _originalFocus = HTMLElement.prototype.focus;

  // 浮层容器 ID（与 content-script.js 中创建的一致）
  const OVERLAY_CONTAINER_ID = 'bookmark-search-overlay-container';

  HTMLElement.prototype.focus = function (options) {
    // 快速路径：浮层未激活时，直接执行原始 focus
    if (document.documentElement.dataset.bookmarkSearchActive !== 'true') {
      return _originalFocus.call(this, options);
    }

    // 浮层已激活 → 检查 focus 目标是否在浮层容器内
    const overlay = document.getElementById(OVERLAY_CONTAINER_ID);
    if (!overlay) {
      // 浮层容器不存在（异常情况），放行
      return _originalFocus.call(this, options);
    }

    // 如果 focus 目标是浮层容器本身或其子元素，放行
    if (this === overlay || overlay.contains(this)) {
      return _originalFocus.call(this, options);
    }

    // 页面试图把焦点拉到浮层外部 → 静默忽略
    // 不做任何事，不调用原始 focus，也不抛异常
  };
})();
