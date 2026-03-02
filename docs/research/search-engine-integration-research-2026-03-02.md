# 书签扩展集成搜索引擎能力 — 调研报告

**日期**：2026-03-02  
**作者**：AI 协作调研  
**状态**：调研完成，待决策

---

## 一、需求背景

用户希望在书签搜索扩展中，当搜索词不匹配任何本地书签/标签/历史时，能够：

1. **直接跳转**：输入 URL 直接打开，输入关键词可一键跳转到 Google/百度等搜索引擎
2. **搜索建议**：输入时实时展示搜索引擎的自动补全建议
3. **多引擎支持**：支持 Google、百度、Bing、DuckDuckGo 等

这本质上是让书签扩展从"本地数据搜索工具"升级为"统一搜索入口"。

---

## 二、竞品调研

### 2.1 Vimium C（4.9 分，40,000+ 用户）

- 内置 Omnibar，支持搜索书签、历史、标签页
- **可配置搜索引擎**：用户可自定义搜索引擎 URL
- 输入 `g ` 前缀搜 Google，`b ` 前缀搜百度等
- Shift+Delete 可从结果中移除历史条目

### 2.2 Surfingkeys（4.6 分，20,000+ 用户）

- 内置搜索面板
- **多搜索引擎**：Google、Bing、YouTube、百度等
- 可通过 JavaScript 自行扩展搜索源

### 2.3 Alfred / Raycast（macOS）

- 输入关键词时展示搜索引擎建议
- 默认用 Google 搜索，可切换引擎
- 搜索建议来自 Google Suggest API
- 无搜索结果时自动建议 "Search Google for ..."

### 竞品总结

| 特性 | Vimium C | Surfingkeys | Alfred/Raycast |
|------|----------|------------|----------------|
| 搜索建议 | ❌ | ❌ | ✅ |
| 自定义引擎 | ✅ | ✅ | ✅ |
| URL 直接打开 | ✅ | ✅ | ✅ |
| 键盘驱动 | ✅ | ✅ | ✅ |

**发现**：大多数浏览器扩展竞品**没有做搜索建议**，仅做了"搜索引擎跳转"。搜索建议更多出现在桌面应用（Alfred/Raycast）中。

---

## 三、技术调研

### 3.1 搜索建议 API 可用性

#### Google Suggest API

```
https://suggestqueries.google.com/complete/search?client=chrome&q=关键词
```

- **CORS 限制**：❌ 不支持跨域，网页端无法直接调用
- **Chrome 扩展**：✅ 在 background.js (Service Worker) 中可绕过 CORS
- **需要 host_permissions**：需声明 `https://suggestqueries.google.com/*`
- **返回格式**：JSON 数组 `["query", ["suggestion1", "suggestion2", ...]]`
- **限制**：无官方 TOS 保证免费使用，可能被限流

#### 百度 Suggest API

```
http://suggestion.baidu.com/su?wd=关键词&action=opensearch
```

- **CORS 限制**：部分支持 JSONP
- **Chrome 扩展**：✅ background.js 中可直接调用
- **返回格式**：OpenSearch 标准格式 `["query", ["建议1", "建议2", ...]]`
- **限制**：HTTP 协议（非 HTTPS），可能触发 mixed-content 警告

#### DuckDuckGo Suggest API

```
https://ac.duckduckgo.com/ac/?q=关键词&type=list
```

- **CORS 限制**：⚠️ 部分限制
- **Chrome 扩展**：✅ background.js 中可调用
- **返回格式**：JSON 数组
- **限制**：免费，无需认证，但 JSONP 支持不完善

#### Bing Autosuggest API

```
https://api.bing.microsoft.com/v7.0/suggestions?q=关键词
```

- **CORS 限制**：需要 API Key
- **Chrome 扩展**：需要 Azure 订阅
- **返回格式**：JSON
- **限制**：付费 API（有免费额度）

### 3.2 Chrome Extension APIs

#### chrome.omnibox API

- 可在地址栏注册自定义关键字触发搜索
- 输入关键字 + 空格后，后续输入全部路由到扩展
- 最多展示 6 个建议项
- **局限**：只能在地址栏工作，无法在扩展 popup/overlay 中使用

#### chrome.search API（Chrome 87+）

- `chrome.search.query()` 可调起 Chrome 默认搜索引擎
- 支持 `disposition`：当前标签 / 新标签 / 新窗口
- **局限**：只能触发搜索，不能获取建议结果

### 3.3 技术方案总结

| 方案 | 搜索跳转 | 搜索建议 | 复杂度 | 隐私 | 稳定性 |
|------|----------|----------|--------|------|--------|
| A. 仅搜索引擎跳转 | ✅ | ❌ | 低 | ✅ | 高 |
| B. A + Google Suggest | ✅ | ✅ | 中 | ⚠️ | 中 |
| C. A + 多引擎 Suggest | ✅ | ✅ | 高 | ⚠️ | 低 |
| D. chrome.omnibox 集成 | ✅ | ✅ | 中 | ✅ | 高 |

---

## 四、实现复杂度分析

### 4.1 搜索引擎跳转（低复杂度）— 推荐先做

**核心逻辑**：
1. 检测输入是否为 URL（含协议或 `.com/.cn` 等后缀）→ 直接打开
2. 当搜索无结果时，显示"使用 Google 搜索 xxx"等选项
3. 用户可在设置中选择默认搜索引擎

**工作量**：约 2-3 天

**需要修改的文件**：
- `js/popup.js`、`js/content-script.js`、`js/search-window.js`：搜索结果为空时追加引擎选项
- `js/settings.js`：新增搜索引擎选择设置
- 三个 HTML 文件：设置面板新增选项

### 4.2 搜索建议（中-高复杂度）— 可选做

**核心逻辑**：
1. 用户输入时，延迟 300ms 发送请求到 background.js
2. background.js 调用 Google/百度 Suggest API
3. 返回建议结果，混合到搜索结果列表中显示
4. 需要处理：防抖、缓存、错误处理、离线降级

**工作量**：约 5-7 天

**额外复杂性**：
- 三套 UI 需同步实现（popup / content-script / search-window）
- 需要新的消息类型通信（GET_SUGGESTIONS）
- 隐私政策需更新（搜索词会发送到外部服务器）
- host_permissions 需新增搜索引擎域名

### 4.3 omnibox 集成（中复杂度）— 独立功能

**核心逻辑**：
1. manifest.json 注册关键字（如 `bm`）
2. 在地址栏输入 `bm ` 后触发书签搜索
3. 返回书签匹配结果作为建议项

**工作量**：约 2 天

**优点**：利用 Chrome 原生能力，体验最接近地址栏搜索  
**缺点**：与现有 popup/overlay UI 独立，用户需要记住关键字

---

## 五、隐私和合规性分析

| 关注点 | 说明 | 影响 |
|--------|------|------|
| 搜索词外传 | 搜索建议需将输入发送到 Google/百度服务器 | Chrome Web Store 审核可能更严格 |
| 隐私政策 | 当前承诺"所有数据本地处理" | 需更新隐私政策声明 |
| API TOS | Google Suggest 非官方公开 API | 存在被限流/封禁风险 |
| 中国用户 | 国内无法访问 Google | 需默认百度或可切换 |

---

## 六、建议和结论

### 推荐分期实施

#### 第一期：搜索引擎跳转 + URL 识别（推荐立即做）✅

- **理由**：低复杂度、高实用性、无隐私争议
- **范围**：
  - 识别 URL 输入 → 直接打开
  - 搜索无结果 → 显示"使用 Google/百度搜索"
  - 设置中可选择默认搜索引擎
- **预计工作量**：2-3 天

#### 第二期：搜索建议（建议暂缓）⏸️

- **理由**：
  1. 复杂度高（三套 UI 同步 + 消息通信 + 防抖缓存）
  2. 隐私政策需改动
  3. 竞品中也少有实现
  4. Google Suggest API 非官方，稳定性存疑
- **如果要做**：建议仅在 search-window 中先试点，验证用户反馈后再推广到 popup 和 overlay

#### 第三期：omnibox 集成（可选）

- **理由**：独立小功能，不影响现有架构，体验加分
- **预计工作量**：1-2 天

### 最终建议

**先做第一期**。搜索引擎跳转是用户明确需要的功能，复杂度低，不涉及外部 API 调用和隐私问题。搜索建议功能可以作为后续版本的增值特性，建议在用户量达到一定规模且有明确反馈需求时再投入。

---

## 七、参考资料

- [Chrome omnibox API 文档](https://developer.chrome.com/docs/extensions/reference/api/omnibox)
- [Chrome search API 文档](https://developer.chrome.com/docs/extensions/mv2/reference/search)
- [Google Autocomplete API (SearchAPI)](https://www.searchapi.io/docs/google-autocomplete)
- [百度搜索建议 API](https://www.cnblogs.com/qdog/p/7163600.html)
- [DuckDuckGo Autocomplete API](https://stackoverflow.com/questions/64048533)
- [Vimium C Chrome Web Store](https://chromewebstore.google.com/detail/vimium-c-all-by-keyboard/hfjbmagddngcpeloejdejnfgbamkjaeg)
- [Surfingkeys Chrome Web Store](https://chromewebstore.google.com/detail/surfingkeys/gfbliohnnapiefjpjlpjnehglfpaknnc)
