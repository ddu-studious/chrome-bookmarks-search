# PRD：书签搜索扩展 — 搜索引擎跳转能力

**版本**：v1.0  
**日期**：2026-03-02  
**状态**：待评审  
**前置调研**：[search-engine-integration-research-2026-03-02.md](../research/search-engine-integration-research-2026-03-02.md)

---

## 一、概述

为书签搜索扩展增加搜索引擎跳转能力，让用户在扩展中不仅能搜索本地书签/标签/历史，还能：

1. 识别 URL 输入并直接打开
2. 搜索无本地结果时，一键使用外部搜索引擎搜索
3. 自定义默认搜索引擎

本期 **不包含** 搜索自动建议/补全功能（参见调研报告第二期规划）。

---

## 二、目标用户

- 重度书签用户，习惯使用扩展作为"万能搜索入口"
- 希望减少操作步骤（不想在扩展和地址栏之间切换）
- 国内外用户（需支持 Google 和百度）

---

## 三、功能需求

### 3.1 URL 识别与直接打开

**触发条件**：用户输入内容被识别为 URL

**识别规则**（按优先级）：
1. 以 `http://` 或 `https://` 开头的完整 URL
2. 以 `www.` 开头的域名
3. 包含 `.com`、`.cn`、`.org`、`.net`、`.io`、`.dev` 等常见顶级域名后缀的文本
4. 匹配 `域名.后缀/路径` 模式的文本

**行为**：
- 在搜索结果列表**顶部**显示一个"打开链接"结果项
- 图标：🔗 或地球图标
- 文案：`打开 https://example.com`（自动补全协议）
- 按 Enter 或点击 → 在新标签页打开该 URL
- 不影响下方正常的本地搜索结果

**示例**：

| 输入 | 识别结果 | 显示 |
|------|----------|------|
| `github.com/user` | URL | `打开 https://github.com/user` |
| `https://example.com` | URL | `打开 https://example.com` |
| `www.baidu.com` | URL | `打开 https://www.baidu.com` |
| `react hooks` | 非 URL | 不显示打开链接 |

### 3.2 搜索引擎跳转

**触发条件**：用户有输入内容（任何模式下）

**行为**：
- 在搜索结果列表**末尾**始终显示搜索引擎跳转项
- 如果有本地搜索结果，跳转项在最后
- 如果无本地搜索结果，跳转项在顶部（更显眼）
- 用户可通过键盘方向键选中该项，按 Enter 跳转

**显示格式**：
```
🔍 使用 Google 搜索 "react hooks"
```

- 图标：搜索引擎 favicon 或统一搜索图标
- 关键词高亮显示
- 打开方式：新标签页

**支持的搜索引擎**：

| 引擎 | URL 模板 | 默认 |
|------|----------|------|
| Google | `https://www.google.com/search?q={query}` | ✅（海外用户） |
| 百度 | `https://www.baidu.com/s?wd={query}` | ✅（国内用户） |
| Bing | `https://www.bing.com/search?q={query}` | ❌ |
| DuckDuckGo | `https://duckduckgo.com/?q={query}` | ❌ |

### 3.3 设置项

**位置**：设置面板中新增"搜索引擎"区域

**设置项**：
- **默认搜索引擎**：单选，可选 Google / 百度 / Bing / DuckDuckGo
- 设置后，搜索结果中的跳转项使用所选引擎

**默认值检测**（可选优化）：
- 首次使用时，通过 `navigator.language` 检测语言
- 中文环境默认百度，其他默认 Google

---

## 四、交互设计

### 4.1 正常搜索流程（有本地结果）

```
用户输入: "react hooks"

搜索结果：
┌──────────────────────────────────┐
│ 📑 React Hooks 文档 - react.dev │  ← 书签结果
│ 📑 useEffect 完全指南           │  ← 书签结果
│ 📑 Custom Hooks 最佳实践         │  ← 书签结果
│ ─────────────────────────────── │
│ 🔍 使用 Google 搜索 "react..."  │  ← 搜索引擎跳转
└──────────────────────────────────┘
```

### 4.2 无本地结果

```
用户输入: "tensorflow 2026 新特性"

搜索结果：
┌──────────────────────────────────┐
│ 🔍 使用 Google 搜索 "tensor..." │  ← 搜索引擎跳转（位于顶部）
│                                  │
│    未找到匹配的书签               │
└──────────────────────────────────┘
```

### 4.3 URL 输入

```
用户输入: "github.com/facebook/react"

搜索结果：
┌──────────────────────────────────┐
│ 🔗 打开 https://github.com/...  │  ← URL 直接打开
│ ─────────────────────────────── │
│ 📑 React · GitHub               │  ← 书签结果（匹配到的）
│ 📑 facebook/react releases      │  ← 书签结果
│ ─────────────────────────────── │
│ 🔍 使用 Google 搜索 "github..." │  ← 搜索引擎跳转
└──────────────────────────────────┘
```

### 4.4 键盘交互

- ↑↓ 方向键可选中 URL 打开项和搜索引擎跳转项
- Enter 执行对应操作
- 这些特殊项与普通搜索结果共用同一套键盘导航逻辑

---

## 五、技术要点

### 5.1 URL 识别正则

```javascript
const URL_PATTERN = /^(https?:\/\/|www\.)|(\w+\.(?:com|cn|org|net|io|dev|edu|gov|app|me|co)\b)/i;
```

### 5.2 协议自动补全

```javascript
function normalizeUrl(input) {
  if (/^https?:\/\//.test(input)) return input;
  if (input.startsWith('www.')) return 'https://' + input;
  if (URL_PATTERN.test(input)) return 'https://' + input;
  return null; // 非 URL
}
```

### 5.3 三套 UI 同步

按照项目规范（04-three-ui-sync），需要在以下三处同步实现：

| 文件 | 实现方式 |
|------|----------|
| `js/popup.js` | 直接渲染特殊结果项 |
| `js/content-script.js` | Shadow DOM 中渲染，通过 `safeSendMessage` 打开标签页 |
| `js/search-window.js` | 渲染 + 通过 `safeSendMessage` 打开标签页 |

### 5.4 设置存储

```javascript
// settings.js 新增默认值
defaultSearchEngine: 'google'  // 可选: google, baidu, bing, duckduckgo
```

---

## 六、不在本期范围

| 功能 | 原因 | 规划 |
|------|------|------|
| 搜索自动建议/补全 | 复杂度高，隐私问题 | 第二期 |
| 自定义搜索引擎 URL | 非核心需求 | 第二期 |
| omnibox 集成 | 独立功能 | 第三期 |
| 多搜索引擎同时显示 | 界面复杂 | 第二期 |

---

## 七、验收标准

- [ ] 输入 URL 格式文本时，顶部出现"打开链接"选项
- [ ] 有搜索词且有本地结果时，底部出现搜索引擎跳转
- [ ] 有搜索词且无本地结果时，顶部出现搜索引擎跳转
- [ ] 设置中可切换默认搜索引擎
- [ ] 三套 UI（popup/overlay/search-window）行为一致
- [ ] 键盘导航正常工作
- [ ] 深色/浅色主题下显示正常

---

## 八、工作量估计

| 模块 | 工作量 |
|------|--------|
| URL 识别逻辑 | 0.5 天 |
| 搜索引擎跳转渲染（三套 UI） | 1.5 天 |
| 设置项 | 0.5 天 |
| 键盘导航适配 | 0.5 天 |
| 测试和调整 | 0.5 天 |
| **合计** | **3 天** |
