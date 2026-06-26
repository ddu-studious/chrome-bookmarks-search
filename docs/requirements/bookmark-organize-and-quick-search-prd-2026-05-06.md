# PRD：书签智能整理 + 多平台快捷搜索

**版本**：v1.0  
**日期**：2026-05-06  
**状态**：调研完成，待评审  
**涉及模块**：popup.js / search-window.js / background.js / options.html / settings.js

---

## 一、需求背景

### 1.1 书签整理痛点

用户收藏了大量书签（常见 500-5000+），但缺少有效的整理工具：

- **新书签无分类**：收藏后默认放在"其他书签"或书签栏根目录，堆积成山
- **已有分类不统一**：部分书签已手动分类到文件夹，部分散落在根目录
- **不敢轻易整理**：担心 AI 自动整理后打乱已有的文件夹结构
- **标签需求**：希望给书签打标（如"待读"、"工作"、"学习"），但 Chrome 原生不支持

### 1.2 搜索入口分散

用户日常搜索场景散落在多个平台：

- 要搜 GitHub 代码：先打开 GitHub → 找到搜索框 → 输入关键词
- 要搜百度/谷歌：切换到浏览器地址栏 → 输入
- 要搜 Stack Overflow、知乎、B站等：每次都要先导航到对应网站

**期望**：`Alt+B` 唤起扩展后，能直接选择目标平台并搜索，省去中间步骤。

---

## 二、功能一：书签智能整理

### 2.1 核心原则

1. **用户确认制**：任何整理操作必须先展示方案 → 用户确认 → 再执行
2. **不破坏已有结构**：已分类到文件夹的书签，默认不动
3. **可逆操作**：整理前自动备份，支持一键撤销
4. **渐进式**：用户可以选择整理范围（全部 / 仅未分类 / 指定文件夹）

### 2.2 功能拆解

#### 2.2.1 书签标签系统 (Bookmark Tags)

Chrome 原生不支持书签标签，我们通过 `chrome.storage.local` 实现虚拟标签系统。

**数据结构**：

```json
{
  "bookmarkTags": {
    "bookmark_id_123": ["工作", "前端", "待读"],
    "bookmark_id_456": ["学习", "Python"]
  },
  "tagPalette": ["工作", "学习", "待读", "前端", "后端", "设计", "工具", "新闻", "娱乐"]
}
```

**功能点**：

| 功能 | 说明 |
|------|------|
| 打标签 | 搜索结果中右键 → 添加标签，支持选择已有标签或创建新标签 |
| 标签搜索 | 搜索语法 `tag:工作` 筛选带"工作"标签的书签 |
| 标签管理 | 配置中心管理标签列表（重命名、合并、删除） |
| 批量打标 | 多选书签后批量添加/移除标签 |
| 标签推荐 | 基于书签 URL/标题自动推荐标签（可选，利用现有 AI 能力） |

#### 2.2.2 智能归类引擎 (Smart Organize)

**触发方式**：配置中心新增"书签整理"入口，或在书签模式下新增"整理"按钮。

**整理流程**（3 步确认制）：

```
[第一步] 扫描分析
  ↓ 分析所有未分类书签（不在任何子文件夹中的）
  ↓ 基于 URL 域名 + 标题关键词 + 现有标签，生成分类建议
  ↓
[第二步] 展示方案（预览 UI）
  ↓ 以树状视图展示整理方案：
  ↓   📁 开发工具
  ↓     ├── GitHub - user/repo
  ↓     ├── Stack Overflow - question
  ↓     └── MDN Web Docs
  ↓   📁 新闻资讯
  ↓     ├── Hacker News
  ↓     └── 36kr
  ↓   📁 学习教程
  ↓     └── Coursera - xxx
  ↓ 用户可拖拽调整、重命名文件夹、移除某个书签
  ↓
[第三步] 确认执行
  ↓ 用户点击"执行整理"
  ↓ 自动备份当前书签结构到 storage
  ↓ 调用 chrome.bookmarks.move() 逐个移动
  ↓ 完成后展示结果摘要 + 撤销按钮
```

**分类策略**（规则引擎 + 可选 AI）：

| 策略层 | 方法 | 说明 |
|--------|------|------|
| L1 域名 | URL hostname 映射 | `github.com → 开发`, `bilibili.com → 视频娱乐` |
| L2 路径 | URL path 分析 | `/docs → 文档`, `/blog → 博客` |
| L3 标题 | 关键词匹配 | 标题含"教程" → 学习, 含"工具" → 工具 |
| L4 AI | 语义分析 (可选) | 利用现有 AI embedding 能力做语义聚类 |

**域名分类映射表示例**：

```javascript
const DOMAIN_CATEGORIES = {
  'github.com': '开发工具',
  'stackoverflow.com': '开发工具',
  'mdn.mozilla.org': '开发文档',
  'bilibili.com': '视频娱乐',
  'youtube.com': '视频娱乐',
  'zhihu.com': '知识社区',
  'juejin.cn': '技术社区',
  'news.ycombinator.com': '科技资讯',
  // ... 可扩展
};
```

**用户可自定义规则**：在配置中心编辑域名→分类的映射关系。

#### 2.2.3 已有文件夹的处理策略

| 情况 | 默认行为 | 可选行为 |
|------|----------|----------|
| 书签已在子文件夹中 | 不动 | 用户手动勾选"也整理已分类书签" |
| 书签在根目录 / "其他书签" | 整理 | — |
| 文件夹为空 | 标记提示 | 可选删除空文件夹 |
| AI 建议的文件夹与已有文件夹名称相似 | 合并到已有文件夹 | 创建新文件夹 |

#### 2.2.4 备份与撤销

- **自动备份**：整理前将当前书签树完整导出为 JSON，存储在 `chrome.storage.local`
- **保留最近 5 次**整理备份
- **一键撤销**：恢复到整理前的状态（移回原位置）
- **手动导出**：支持导出书签备份 JSON 文件

---

## 三、功能二：多平台快捷搜索

### 3.1 设计理念

将扩展从"本地书签搜索器"升级为"统一搜索入口"。用户 `Alt+B` 唤起后：

1. 默认搜索本地书签/标签/历史（现有行为）
2. 无结果或用户主动选择时，一键切换到外部平台搜索
3. 支持快捷键快速切换搜索平台

### 3.2 搜索平台注册表

**内置平台**：

| 平台 | 前缀 | 搜索 URL | 图标 |
|------|------|----------|------|
| Google | `g:` | `https://www.google.com/search?q={query}` | Google favicon |
| 百度 | `bd:` | `https://www.baidu.com/s?wd={query}` | 百度 favicon |
| GitHub | `gh:` | `https://github.com/search?q={query}&type=repositories` | GitHub favicon |
| Stack Overflow | `so:` | `https://stackoverflow.com/search?q={query}` | SO favicon |
| 知乎 | `zh:` | `https://www.zhihu.com/search?type=content&q={query}` | 知乎 favicon |
| 哔哩哔哩 | `bl:` | `https://search.bilibili.com/all?keyword={query}` | B站 favicon |
| YouTube | `yt:` | `https://www.youtube.com/results?search_query={query}` | YT favicon |
| NPM | `npm:` | `https://www.npmjs.com/search?q={query}` | NPM favicon |
| MDN | `mdn:` | `https://developer.mozilla.org/search?q={query}` | MDN favicon |
| Twitter/X | `x:` | `https://x.com/search?q={query}` | X favicon |
| Reddit | `rd:` | `https://www.reddit.com/search/?q={query}` | Reddit favicon |
| Product Hunt | `ph:` | `https://www.producthunt.com/search?q={query}` | PH favicon |

**用户自定义平台**：在配置中心新增"搜索平台管理"，支持添加自定义平台：

```json
{
  "name": "ClawHub",
  "prefix": "ch:",
  "url": "https://clawhub.com/search?q={query}",
  "icon": "https://clawhub.com/favicon.ico"
}
```

### 3.3 交互方式

#### 方式一：前缀触发（类似 Vimium）

输入搜索框时，以 `前缀:` 开头即触发对应平台搜索：

```
gh: react hooks        →  在 GitHub 搜索 "react hooks"
g: chrome extension     →  在 Google 搜索 "chrome extension"
bl: Vue3 教程           →  在 B站 搜索 "Vue3 教程"
```

**交互细节**：
- 输入前缀后，搜索框 placeholder 变为"在 GitHub 搜索..."
- 搜索结果区域显示目标平台的 logo 和提示
- 按 Enter 直接在新标签页打开搜索结果

#### 方式二：搜索平台切换栏

在搜索框下方增加一行可滚动的平台图标栏：

```
[🔖 书签] [📑 标签页] [📜 历史] [📥 下载] | [G Google] [百 百度] [🐱 GitHub] [▶ B站] [⋯ 更多]
```

- 点击切换搜索目标
- 快捷键 `Ctrl+数字` 快速切换（`Ctrl+1` = Google, `Ctrl+2` = GitHub ...）
- 搜索模式和外部平台搜索可以共存

#### 方式三：搜索结果末尾快捷跳转（增强现有功能）

当前已有"使用 Google 搜索"的跳转项，增强为多平台版本：

```
─── 在其他平台搜索 ───
🔍 Google 搜索 "react hooks"
🐱 GitHub 搜索 "react hooks"
📚 Stack Overflow 搜索 "react hooks"
```

### 3.4 推荐方案

**组合方式一 + 方式三**，即：
- **前缀触发**作为高效入口（面向高级用户）
- **结果末尾跳转**作为发现入口（面向普通用户，增强现有功能）
- 暂不加搜索平台切换栏（避免 UI 过于复杂）

### 3.5 配置中心

在配置中心新增"搜索平台"设置区域：

| 设置项 | 说明 |
|--------|------|
| 启用的平台 | 勾选要显示的搜索平台 |
| 平台排序 | 拖拽调整搜索结果中平台的显示顺序 |
| 自定义平台 | 添加/编辑/删除自定义搜索平台 |
| 默认搜索引擎 | 当前已有，保留 |
| 前缀触发 | 开/关前缀搜索功能 |

---

## 四、技术方案

### 4.1 书签整理 — 技术架构

```
用户点击"整理书签"
  → background.js 调用 chrome.bookmarks.getTree() 获取完整树
  → 分析引擎对未分类书签进行分类
  → 返回分类方案给 UI
  → UI 以预览树渲染方案
  → 用户确认后 background.js 批量调用 chrome.bookmarks.move()
  → 完成，更新 UI
```

**Chrome API 使用**：

```javascript
// 获取书签树
chrome.bookmarks.getTree()

// 创建文件夹
chrome.bookmarks.create({ parentId, title })

// 移动书签
chrome.bookmarks.move(id, { parentId })

// 获取书签详情（包含 parentId、index）
chrome.bookmarks.get(id)

// 搜索书签
chrome.bookmarks.search(query)
```

**存储设计**：

```javascript
// chrome.storage.local
{
  // 标签数据
  "bookmarkTags": { "id": ["tag1", "tag2"] },
  "tagPalette": ["tag1", "tag2", ...],
  
  // 域名分类映射（用户可自定义扩展）
  "domainCategories": { "github.com": "开发工具", ... },
  
  // 整理备份（最近 5 次）
  "organizeBackups": [
    {
      "timestamp": 1714953600000,
      "moves": [{ "bookmarkId": "123", "fromParent": "0", "toParent": "456" }]
    }
  ]
}
```

### 4.2 多平台搜索 — 技术架构

**前缀解析**：在 `search-parser.js` 中扩展现有语法解析。

```javascript
// 新增平台前缀命令
static PLATFORM_COMMANDS = {
  'g:': { name: 'Google', url: '...' },
  'gh:': { name: 'GitHub', url: '...' },
  // ...
};

static parsePlatformSearch(searchText) {
  for (const [prefix, config] of Object.entries(this.PLATFORM_COMMANDS)) {
    if (searchText.startsWith(prefix)) {
      return {
        platform: config,
        query: searchText.slice(prefix.length).trim()
      };
    }
  }
  return null;
}
```

**结果末尾跳转**：增强现有 `createSearchEngineItem()` 函数，改为支持多平台。

### 4.3 需要同步的文件清单

| 文件 | 书签整理 | 多平台搜索 |
|------|----------|-----------|
| `js/popup.js` | 整理入口按钮、标签UI | 前缀解析、多平台跳转 |
| `js/search-window.js` | 同 popup.js | 同 popup.js |
| `popup.html` | 整理按钮 HTML | — |
| `search-window.html` | 整理按钮 HTML | — |
| `background.js` | 书签移动/备份/恢复 | — |
| `js/settings.js` | 标签相关默认设置 | 搜索平台默认设置 |
| `js/options.js` | 标签管理/域名映射/备份管理 | 搜索平台管理 |
| `options.html` | 整理设置 UI | 搜索平台设置 UI |
| `js/search-parser.js` | `tag:` 搜索语法 | 平台前缀解析 |
| `css/popup.css` | 整理预览/标签样式 | 平台图标样式 |
| `css/search-window.css` | 同 popup.css | 同 popup.css |

---

## 五、开发计划

### Phase 1：多平台快捷搜索（2-3 天）

优先做搜索能力增强，因为实现简单、用户价值高。

| 步骤 | 任务 | 预估 |
|------|------|------|
| 1.1 | 搜索平台注册表数据结构 + settings.js | 0.5h |
| 1.2 | search-parser.js 前缀解析 | 1h |
| 1.3 | popup.js / search-window.js 前缀搜索交互 | 2h |
| 1.4 | 增强搜索结果末尾多平台跳转 | 1h |
| 1.5 | 配置中心 - 搜索平台管理 UI | 2h |
| 1.6 | CSS 样式（两套） | 1h |
| 1.7 | 测试 & 调优 | 1h |

### Phase 2：书签标签系统（2-3 天）

| 步骤 | 任务 | 预估 |
|------|------|------|
| 2.1 | 标签存储层（storage CRUD） | 1h |
| 2.2 | 右键菜单"添加标签"交互 | 2h |
| 2.3 | `tag:` 搜索语法 | 1h |
| 2.4 | 标签筛选 UI（书签模式下） | 1.5h |
| 2.5 | 配置中心 - 标签管理 | 1.5h |
| 2.6 | 批量打标 | 1h |
| 2.7 | CSS 样式 + 测试 | 1h |

### Phase 3：书签智能归类（3-5 天）

| 步骤 | 任务 | 预估 |
|------|------|------|
| 3.1 | 分类引擎（域名映射 + 关键词） | 2h |
| 3.2 | 整理预览 UI（树状拖拽） | 4h |
| 3.3 | 备份 & 撤销机制 | 2h |
| 3.4 | chrome.bookmarks.move 批量执行 | 1h |
| 3.5 | 配置中心 - 整理设置 + 域名映射 | 2h |
| 3.6 | AI 辅助分类（可选，利用现有 embedding） | 3h |
| 3.7 | 测试 & 边界情况处理 | 2h |

---

## 六、风险与注意事项

### 6.1 书签整理风险

| 风险 | 应对 |
|------|------|
| 用户书签被错误移动 | 整理前强制备份，支持一键撤销 |
| 大量书签时性能问题 | 分批 move，添加进度条 |
| 文件夹命名冲突 | 先查询已有文件夹，同名则合并 |
| Chrome 书签 API 限制 | 无并发限制但建议串行 move 避免竞态 |

### 6.2 搜索平台风险

| 风险 | 应对 |
|------|------|
| 自定义平台 URL 注入 | 校验 URL 格式，禁止 javascript: 协议 |
| 平台搜索 URL 变更 | 内置平台可通过扩展更新修复 |
| 前缀与搜索语法冲突 | 前缀以 `:` 结尾，与 `site:` 等不冲突（前缀在最前面） |

---

## 七、成功指标

| 指标 | 目标 |
|------|------|
| 书签整理使用率 | > 20% 的书签模式用户尝试整理 |
| 标签系统采用率 | > 10% 的用户至少创建了 1 个标签 |
| 外部搜索使用率 | > 30% 的搜索会话使用了外部平台搜索 |
| 整理撤销率 | < 5%（说明分类质量好） |

---

**最后更新**：2026-05-06
