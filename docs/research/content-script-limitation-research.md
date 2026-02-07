# Content Script 注入限制调研报告

> 编写日期: 2026-02-07
> 关联版本: v1.6.2+
> 状态: 调研完成，待实施

---

## 1. 问题描述

### 1.1 现状

当前扩展使用 **Content Scripts** 方式在页面中注入一个 Spotlight 风格的浮层作为搜索界面。这种方式在普通网页上效果极佳——浮层居中、毛玻璃背景、键盘快捷键，给用户 macOS Spotlight / Raycast 级别的搜索体验。

### 1.2 核心问题

Chrome 出于安全策略，**禁止**向以下页面注入 Content Script：

| 页面类型 | 示例 | 用户使用频率 |
|----------|------|-------------|
| `chrome://` 系统页面 | 新标签页、设置页、扩展管理页、书签管理页 | ⭐⭐⭐⭐⭐ 极高 |
| `chrome-extension://` | 其他扩展页面 | ⭐⭐ 中等 |
| `edge://` | Edge 系统页面 | ⭐⭐⭐ 高（Edge 用户） |
| `about:` | about:blank 等 | ⭐ 低 |
| `file://` | 本地文件 | ⭐ 低 |
| Chrome Web Store | chromewebstore.google.com | ⭐⭐ 中等 |

这是 Chrome 内核的**永久性安全限制**，不会在未来版本中放开。

### 1.3 当前降级策略及其问题

```
background.js: ensureOverlayVisibleFromAnyPage()
  ├── 当前页可注入？→ 注入 Content Script ✅
  ├── 当前页不可注入？
  │     ├── 找到同窗口最近访问的可注入标签 → 切换过去并注入 ⚠️
  │     └── 没有可注入标签 → 打开 example.com 并注入 ❌
```

**用户体验问题：**

1. **突然跳转标签页** — 用户在新标签页按 `Alt+B`，结果被切换到了之前浏览的某个网页。用户："我只想搜个书签，为什么把我带到这个页面？"
2. **打开 example.com** — 极端情况下，用户看到浏览器突然打开了一个完全无关的网页。用户体验严重受损。
3. **新标签页是最高频场景** — 大多数用户打开新标签页后想要快速搜索书签，恰恰是限制最严重的场景。

---

## 2. 可选方案调研

### 2.1 方案 A: Action Popup（传统弹窗）

**原理：** 在 `manifest.json` 中设置 `"default_popup": "popup.html"`，用户点击扩展图标或按快捷键时弹出固定在工具栏图标位置的小窗口。

**可用性：** ✅ 在所有页面上可用（包括 `chrome://`）

```json
{
  "action": {
    "default_popup": "popup.html"
  }
}
```

| 优点 | 缺点 |
|------|------|
| 实现最简单 | 位置固定在工具栏图标旁，非居中 |
| 所有页面可用 | 窗口尺寸受限（最大 800x600） |
| 原生支持 | 失焦即关闭，无法保持打开 |
| | 不是 Spotlight 风格，UX 降级 |
| | 与当前 Content Script 方案冲突（二选一） |

**评价：** ⭐⭐ — 虽然能解决问题，但严重降级了用户体验。放弃了 Spotlight 风格是不可接受的。

---

### 2.2 方案 B: Side Panel API（侧边栏）

**原理：** Chrome 114+ 提供的 Side Panel API，在浏览器右侧打开一个持久化侧边栏。

```json
{
  "permissions": ["sidePanel"],
  "side_panel": {
    "default_path": "sidepanel.html"
  }
}
```

| 优点 | 缺点 |
|------|------|
| 持久化，不会自动关闭 | **未确认在 `chrome://` 页面是否可用** |
| 现代化 API | 侧边栏形态，不是居中浮层 |
| 可跨标签保持 | UX 与 Spotlight 完全不同 |
| | 需要用户手动打开（API 限制） |
| | Chrome 114+ 才支持 |

**评价：** ⭐⭐ — 形态差异太大，且在 `chrome://` 页面的可用性未确认。不适合作为主方案。

---

### 2.3 方案 C: 独立弹出窗口（chrome.windows.create）

**原理：** 通过 `chrome.windows.create({ type: 'popup' })` 创建一个独立的弹出窗口，加载扩展自己的 HTML 页面。

```javascript
const currentWindow = await chrome.windows.getCurrent();
const w = 620, h = 520;
const left = Math.round(currentWindow.left + (currentWindow.width - w) / 2);
const top = Math.round(currentWindow.top + (currentWindow.height - h) / 2);

await chrome.windows.create({
  url: 'search-window.html',
  type: 'popup',       // 无地址栏、无标签栏
  width: w,
  height: h,
  left: left,
  top: top,
  focused: true
});
```

| 优点 | 缺点 |
|------|------|
| ✅ 在任何页面都能使用 | 有窗口标题栏（OS 级别） |
| ✅ 可居中定位，接近 Spotlight | 不如页内浮层的无缝感 |
| ✅ 独立窗口，无需消息传递 | 是一个独立 OS 窗口而非页内元素 |
| ✅ 拥有完整 Chrome API 权限 | 首次打开有短暂加载 |
| ✅ 无 focus trap 冲突 | |
| ✅ 无 Shadow DOM、样式隔离需求 | |
| ✅ 支持键盘快捷键 | |

**评价：** ⭐⭐⭐⭐ — 独立使用时体验良好，但有窗口标题栏导致不够 "原生"。

---

### 2.4 方案 D: 动态 Popup 切换

**原理：** 通过 `chrome.action.setPopup()` 动态控制点击行为：

- 可注入页面：不设置 popup → 触发 `onClicked` → 注入 Content Script
- 不可注入页面：设置 popup → 弹出 Action Popup

```javascript
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId);
  if (canInjectIntoTab(tab)) {
    chrome.action.setPopup({ popup: '' }); // 清除 popup，启用 onClicked
  } else {
    chrome.action.setPopup({ popup: 'popup.html' }); // 设置 popup
  }
});
```

| 优点 | 缺点 |
|------|------|
| 可注入页面保持最佳体验 | Popup 位置固定在工具栏 |
| 不可注入页面也能用 | 两种模式 UX 不一致 |
| 实现相对简单 | Popup 尺寸受限 |
| | 切换逻辑可能有延迟 |

**评价：** ⭐⭐⭐ — 思路正确但 Popup 形态与 Spotlight 差距大。

---

### 2.5 ⭐ 方案 E: 混合方案（Content Script + 独立窗口）— 推荐

**原理：** 在可注入页面保持 Content Script 浮层的最佳体验；在不可注入页面自动切换为独立弹出窗口。两种模式共享相同的 UI 设计和交互逻辑。

```
┌──────────────────────────────────────────────────────────┐
│  用户按下 Alt+B / 点击扩展图标                              │
│                    │                                       │
│                    ▼                                       │
│  background.js: 判断当前标签页                               │
│         │                        │                         │
│  ┌──────┴──────┐          ┌──────┴──────┐                  │
│  │  可注入页面   │          │ 不可注入页面  │                  │
│  │ http/https  │          │ chrome:// 等 │                  │
│  └──────┬──────┘          └──────┬──────┘                  │
│         │                        │                         │
│         ▼                        ▼                         │
│  注入 Content Script       chrome.windows.create()         │
│  显示页内浮层 overlay        打开独立搜索窗口                  │
│                                                            │
│  ┌──────────────────┐    ┌──────────────────┐              │
│  │  最佳 Spotlight   │    │  居中搜索窗口     │              │
│  │  ・页内浮层       │    │  ・无地址栏       │              │
│  │  ・毛玻璃背景     │    │  ・居中显示       │              │
│  │  ・完全无缝      │    │  ・相同UI        │              │
│  └──────────────────┘    └──────────────────┘              │
│                                                            │
│         共享：搜索逻辑、排序算法、键盘导航、主题样式           │
└──────────────────────────────────────────────────────────┘
```

---

## 3. 推荐方案详细设计

### 3.1 架构总览

```
chrome-bookmarks-search/
├── manifest.json             # 无需 default_popup
├── background.js             # 路由逻辑：判断→注入 or 独立窗口
├── search-window.html        # 🆕 独立搜索窗口页面
├── js/
│   ├── content-script.js     # 页内浮层（现有）
│   ├── search-window.js      # 🆕 独立窗口逻辑
│   ├── search-core.js        # 🆕 共享搜索核心逻辑
│   ├── search-parser.js      # 搜索解析器（已有）
│   ├── smart-sort.js         # 智能排序（已有）
│   └── focus-guard.js        # Focus 守卫（仅 Content Script 需要）
└── css/
    └── search-window.css     # 🆕 独立窗口样式（可复用 popup.css 逻辑）
```

### 3.2 Background.js 路由逻辑改造

```javascript
// 搜索窗口管理
let searchWindowId = null;

// 统一入口
async function handleSearchTrigger(tab) {
  // 优先：如果已有独立搜索窗口打开，toggle 它
  if (searchWindowId) {
    try {
      const win = await chrome.windows.get(searchWindowId);
      // 窗口存在，关闭它（toggle off）
      await chrome.windows.remove(searchWindowId);
      searchWindowId = null;
      return;
    } catch (e) {
      // 窗口已被用户关闭
      searchWindowId = null;
    }
  }

  // 路由：判断当前标签页是否可注入
  if (tab && canInjectIntoTab(tab)) {
    // 可注入 → Content Script 浮层
    await injectAndToggleOverlay(tab.id);
  } else {
    // 不可注入 → 独立搜索窗口
    await openSearchWindow();
  }
}

// 打开独立搜索窗口（居中显示）
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

// 监听窗口关闭
chrome.windows.onRemoved.addListener((windowId) => {
  if (windowId === searchWindowId) {
    searchWindowId = null;
  }
});
```

### 3.3 独立搜索窗口（search-window.html）

独立窗口的优势在于——它是一个 `chrome-extension://` 页面，拥有完整的 Chrome API 权限：

```html
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <link rel="stylesheet" href="css/search-window.css">
</head>
<body>
  <!-- 与浮层相同的 UI 结构 -->
  <div class="search-container" id="searchPanel">
    <div class="search-area">
      <input type="text" id="searchInput" placeholder="搜索书签..." autofocus>
    </div>
    <div class="mode-tabs">...</div>
    <div class="results-container">...</div>
    <div class="status-bar">...</div>
  </div>

  <script src="js/search-parser.js"></script>
  <script src="js/smart-sort.js"></script>
  <script src="js/search-window.js"></script>
</body>
</html>
```

**关键差异：**

| 方面 | Content Script 浮层 | 独立搜索窗口 |
|------|---------------------|-------------|
| 运行环境 | 页面内 ISOLATED World | chrome-extension:// 页面 |
| DOM 隔离 | 需要 Shadow DOM | 不需要（独立页面） |
| 样式隔离 | 需要 `:host` 选择器 | 不需要（独立样式表） |
| Focus Trap | 需要 focus-guard.js | 不需要（无宿主页面） |
| 事件隔离 | 需要 EventIsolation | 不需要 |
| Chrome API | 通过 `chrome.runtime.sendMessage` | 直接调用 |
| 数据获取 | background 转发 | 直接调用 `chrome.bookmarks` 等 |
| 关闭行为 | 隐藏浮层 | `window.close()` 或 Esc |

### 3.4 共享逻辑提取

为了保持两种模式的功能一致性，建议将以下逻辑提取为共享模块：

```javascript
// js/search-core.js - 共享搜索核心逻辑
class SearchCore {
  // 加载书签、标签页、历史记录、下载
  static async loadData(mode) { ... }
  
  // 搜索与筛选
  static search(items, query, options) { ... }
  
  // 渲染结果项 HTML
  static renderResultItem(item, index, options) { ... }
  
  // 格式化时间
  static formatTime(timestamp) { ... }
  
  // 获取 favicon URL
  static getFaviconUrl(item) { ... }
}
```

### 3.5 Toggle 行为统一

```
场景1: 用户在普通网页上按 Alt+B
  → Content Script 浮层弹出（现有行为）
  → 再按 Alt+B → 浮层关闭

场景2: 用户在 chrome://newtab 按 Alt+B
  → 独立搜索窗口弹出（居中、无地址栏）
  → 再按 Alt+B → 窗口关闭
  → 或按 Esc → 窗口关闭

场景3: 用户在独立窗口打开时切换到普通网页按 Alt+B
  → 关闭独立窗口 + 弹出 Content Script 浮层

场景4: 用户点击扩展图标
  → 行为与 Alt+B 一致
```

---

## 4. 方案对比总结

| 维度 | 当前方案 | A: Popup | B: Side Panel | C: 独立窗口 | D: 动态Popup | **E: 混合（推荐）** |
|------|---------|----------|--------------|------------|-------------|-------------------|
| `chrome://` 可用 | ❌ 跳转 | ✅ | ❓ | ✅ | ✅ | **✅** |
| Spotlight 感觉 | ⚠️ 部分 | ❌ | ❌ | ⭐⭐⭐⭐ | ⚠️ | **⭐⭐⭐⭐⭐** |
| UX 一致性 | ❌ | ⭐⭐ | ⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | **⭐⭐⭐⭐⭐** |
| 无需跳转 | ❌ | ✅ | ✅ | ✅ | ✅ | **✅** |
| 无 focus trap | ❌ | ✅ | ✅ | ✅ | ⚠️ | **✅（独立窗口模式）** |
| 实现复杂度 | 低 | 低 | 中 | 中 | 中 | **中（可控）** |
| 可维护性 | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | ⭐⭐⭐⭐ | ⭐⭐⭐ | **⭐⭐⭐⭐** |

---

## 5. 实施计划

### Phase 1: 独立搜索窗口 MVP

**目标：** 替换"跳转到最近可注入标签"的行为，改为打开独立搜索窗口

**变更范围：**
1. 新增 `search-window.html` + `css/search-window.css` + `js/search-window.js`
2. 修改 `background.js` 中的 `ensureOverlayVisibleFromAnyPage()` 路由逻辑
3. 独立窗口直接复用 `search-parser.js` + `smart-sort.js`

**预估工作量：** 1-2 天

### Phase 2: UI 复用与一致性

**目标：** 确保独立窗口与浮层的视觉和交互完全一致

**变更范围：**
1. 提取共享搜索核心逻辑到 `js/search-core.js`
2. 统一三种风格（Spotlight/Raycast/Fluent）在两种模式下的样式
3. 统一键盘导航逻辑

**预估工作量：** 1-2 天

### Phase 3: 用户体验优化

**目标：** 打磨细节

**变更范围：**
1. 独立窗口 Toggle 逻辑完善
2. 窗口关闭动画
3. 主题跟随系统
4. 记住用户上次使用的模式/排序

**预估工作量：** 0.5-1 天

---

## 6. 风险评估

| 风险 | 严重程度 | 缓解措施 |
|------|---------|---------|
| 独立窗口有 OS 标题栏，不够"无缝" | 低 | `type: 'popup'` 已移除地址栏/标签栏，标题栏可通过自定义页面样式弱化 |
| 两种模式的代码维护成本 | 中 | 提取共享核心逻辑，减少重复代码 |
| 独立窗口首次打开有加载延迟 | 低 | 预热策略 / 极简 HTML 确保瞬间加载 |
| 窗口管理逻辑复杂度 | 低 | 单一 `searchWindowId` 管理，配合 `onRemoved` 监听 |

---

## 7. 参考资料

- [Chrome Content Scripts 文档](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts)
- [chrome.windows API](https://developer.chrome.com/docs/extensions/reference/api/windows)
- [chrome.action API](https://developer.chrome.com/docs/extensions/reference/api/action)
- [Chrome Side Panel API](https://developer.chrome.com/docs/extensions/reference/api/sidePanel)
- [Manifest V3 MAIN World Content Scripts](https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts)
- Vimium 扩展的 chrome:// 页面限制处理 ([GitHub Issue #1560](https://github.com/philc/vimium/issues/1560))

---

## 8. 结论

**推荐方案 E: 混合方案（Content Script + 独立搜索窗口）**

核心思路：

> 在可注入页面保持 Content Script 页内浮层的完美 Spotlight 体验；
> 在不可注入页面（chrome:// 等），自动切换为居中的独立搜索窗口。
> 用户无感知切换，无页面跳转，两种模式共享相同的搜索能力和视觉设计。

这是唯一能同时满足以下三个条件的方案：
1. **全场景可用** — 任何页面都能唤起搜索
2. **最佳体验** — 普通页面保持 Spotlight 级别的沉浸感
3. **优雅降级** — 受限页面的体验依然出色，不是"退而求其次"

---

**编写日期**: 2026-02-07
**作者**: AI Assistant
**关联 Issue**: Content Script 注入限制导致部分页面无法使用
