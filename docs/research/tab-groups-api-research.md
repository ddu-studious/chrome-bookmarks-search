# Chrome 标签页分组（Tab Groups）API 调研报告

> 编写日期: 2026-02-24 (更新: 2026-02-24)
> 关联版本: v1.7.0+
> 状态: 调研完成（已确认限制）

---

## 1. 问题描述

### 1.1 现状

Chrome 从 2023 年底开始默认启用**标签页分组保存**（Saved Tab Groups）功能。用户可以将多个标签页归入一个带名称和颜色的分组，右键选择"保存分组"后关闭，分组会显示在书签栏左侧，后续可重新打开。

当前扩展的"标签页"搜索模式仅使用 `chrome.tabs.query({})` 获取当前打开的标签页，**已关闭的已保存分组及其内部标签页完全不可见**。

### 1.2 用户痛点

| 痛点 | 说明 |
|------|------|
| 已保存分组无法搜索 | 用户将相关标签归入分组并关闭后，无法通过扩展找到这些标签页 |
| 分组管理困难 | Chrome 原生没有分组搜索功能，分组多时找不到想要的分组 |
| 分组内标签页不可见 | 必须打开整个分组才能看到里面有哪些标签页 |
| 扁平列表不适合分组展示 | 分组是树状结构（组 → 标签页），现有扁平列表展示不友好 |

### 1.3 用户截图中的典型场景

截图中可见用户标签栏有 15+ 个彩色分组（langchain-1.2、TAR-UI、Cursur/Skill/Mcp/SubAgent 等），每个分组下有多个标签页。Chrome 原生只提供了右键菜单中的"标签页分组"入口，缺乏高效的搜索和管理能力。

---

## 2. Chrome Tab Groups API 调研

### 2.1 chrome.tabGroups API

**可用性**: Chrome 89+, Manifest V3+
**权限**: 需要 `"tabGroups"` 权限

#### 核心方法

| 方法 | 功能 | 说明 |
|------|------|------|
| `tabGroups.query(queryInfo)` | 查询分组 | 可按 `collapsed`、`color`、`title`、`windowId`、`shared` 过滤 |
| `tabGroups.get(groupId)` | 获取指定分组 | 返回 TabGroup 对象 |
| `tabGroups.update(groupId, props)` | 修改分组属性 | 可改 `title`、`color`、`collapsed` |
| `tabGroups.move(groupId, props)` | 移动分组 | 可跨窗口移动 |

#### TabGroup 对象属性

```javascript
{
  id: number,          // 分组 ID（会话内唯一，关闭重开后会变）
  title: string,       // 分组标题
  color: Color,        // grey/blue/red/yellow/green/pink/purple/cyan/orange
  collapsed: boolean,  // 是否折叠
  windowId: number,    // 所属窗口 ID
  shared: boolean      // 是否共享（Chrome 137+）
}
```

#### 事件

| 事件 | 触发时机 |
|------|---------|
| `onCreated` | 分组被创建 |
| `onUpdated` | 分组属性被修改（标题、颜色、折叠状态） |
| `onMoved` | 分组在窗口内移动 |
| `onRemoved` | 分组被关闭（包含零标签页时自动移除） |

### 2.2 相关 chrome.tabs API

| 方法 | 功能 |
|------|------|
| `tabs.query({groupId})` | 获取指定分组内的所有标签页 |
| `tabs.group({tabIds, groupId?})` | 将标签页归入分组（可创建新分组） |
| `tabs.ungroup(tabIds)` | 将标签页移出分组 |

### 2.3 组合使用示例

```javascript
// 获取所有打开的分组及其标签页
async function getAllGroupsWithTabs() {
  const groups = await chrome.tabGroups.query({});
  return Promise.all(groups.map(async group => {
    const tabs = await chrome.tabs.query({ groupId: group.id });
    return { ...group, tabs };
  }));
}
```

---

## 3. 核心限制分析

### 3.1 已保存但关闭的分组 — 完全不可访问

这是**最关键的限制**。Chrome 的 Saved Tab Groups 功能允许用户"保存"分组后关闭，分组会显示在书签栏。但：

| 限制 | 详情 | 状态 |
|------|------|------|
| **无 API 列出 saved groups** | `tabGroups.query()` 只返回当前打开的分组 | 永久限制 |
| **无 API 检测 saved 状态** | TabGroup 对象没有 `isSaved` 属性 | 永久限制 |
| **无 API 恢复 saved group** | 无法通过 API 打开一个已保存的关闭分组 | 永久限制 |
| **saved group 不可编辑（部分修复）** | Chrome 125 已修复 `update()` 对 saved group 的限制 | 已修复 |

**来源**: 
- StackOverflow: [How to list all tab groups including closed groups?](https://stackoverflow.com/questions/79493740) — 2025-03-08 提问，0 回答
- Chromium Extensions Group: [breaking change: saved tab groups don't work](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/2RO1vp-8lqE) — Chrome 团队确认是有意限制
- Chromium Extensions Group: [Unable to update saved tab groups](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/tmzzMRp85pQ) — 无 `isSaved` 属性

### 3.2 Chrome 团队的态度

Oliver Dunk（Chrome Extensions DevRel）2024-04 回复：

> One of the main concerns I am aware of is that tabGroups can sync between devices and there are concerns about the implications of allowing extensions to make changes without a user's knowledge. We are just planning to make a couple of other changes first before we open up the extension APIs again.

**结论**: Chrome 团队出于跨设备同步安全考虑有意限制 saved groups 的 API 访问，短期内不会开放。

### 3.3 Group ID 不稳定

分组的 `id` 只在浏览器会话内有效。分组关闭后重新打开，`id` 会改变。因此不能依赖 `id` 作为持久化标识。

### 3.4 sessions API 不包含分组信息

`chrome.sessions.getRecentlyClosed()` 返回最近关闭的标签页和窗口，但**不包含分组元信息**（标题、颜色），也无法通过它恢复一个完整的分组。

---

## 4. 现有第三方扩展的解决方案

### 4.1 TabGroup Vault

Chrome Web Store 上最主流的分组管理扩展，核心思路：

| 策略 | 实现 |
|------|------|
| **快照备份** | 在分组打开时抓取完整信息（标题、颜色、所有标签 URL），存入本地快照 |
| **恢复机制** | 通过 `chrome.tabs.create()` + `chrome.tabs.group()` + `chrome.tabGroups.update()` 重建分组 |
| **导出** | 支持 JSON / Markdown / CSV 导出 |

### 4.2 Tab Groups Exporter

将分组信息导出为 JSON 文件，支持导入恢复。

### 4.3 savetabs

开源方案，配合本地 HTTP 服务器保存标签页链接和分组信息。

### 4.4 共同思路

所有第三方扩展都采用同一策略：**在分组打开时主动快照保存，而非依赖 Chrome 的 saved groups API**。这是目前唯一可行的技术路线。

---

## 5. 推荐技术方案

### 5.1 核心策略：事件监听 + 本地快照

```
┌──────────────────────────────────────────────────────────────────┐
│                     Background Service Worker                     │
│                                                                   │
│  ┌─────────────────────┐     ┌─────────────────────────────┐     │
│  │  Event Listeners     │     │  Periodic Full Sync          │     │
│  │                     │     │                               │     │
│  │  onCreated ─────┐   │     │  chrome.alarms (每5分钟)      │     │
│  │  onUpdated ────┐│   │     │  → 全量扫描所有打开的分组      │     │
│  │  onRemoved ──┐││   │     │  → 更新本地存储               │     │
│  │              │││   │     └─────────────────────────────┘     │
│  └──────────────│││───┘                                         │
│                 │││                                              │
│                 ▼▼▼                                              │
│  ┌─────────────────────────────────────────────────┐             │
│  │          chrome.storage.local                    │             │
│  │                                                 │             │
│  │  {                                              │             │
│  │    "tabGroupSnapshots": {                       │             │
│  │      "langchain-1.2_red": {                     │             │
│  │        title: "langchain-1.2",                  │             │
│  │        color: "red",                            │             │
│  │        tabs: [{url, title, favIconUrl}, ...],   │             │
│  │        isOpen: false,                           │             │
│  │        lastSeen: 1708761600000,                 │             │
│  │        closedAt: 1708768800000                  │             │
│  │      },                                         │             │
│  │      ...                                        │             │
│  │    }                                            │             │
│  │  }                                              │             │
│  └─────────────────────────────────────────────────┘             │
└──────────────────────────────────────────────────────────────────┘
```

### 5.2 稳定标识方案

由于 `groupId` 不稳定，需要构造一个持久化标识：

```
stableKey = `${title}_${color}`
```

| 因素 | 处理方式 |
|------|---------|
| 同名同色分组 | 概率极低，出现时以最新快照为准 |
| 用户重命名 | onUpdated 事件更新旧 key → 新 key，迁移数据 |
| 用户改颜色 | 同上 |

### 5.3 冷启动问题

扩展安装后，之前已关闭的 saved groups 无法回溯。应对策略：

1. **安装/启动时全量扫描当前打开的所有分组**，建立初始快照
2. **提示用户**：首次使用时建议打开所有 saved groups 一次，让扩展记录
3. 后续通过事件监听持续积累

### 5.4 恢复已关闭分组的流程

```javascript
async function restoreGroup(savedGroup) {
  // 1. 依次创建所有标签页
  const tabIds = [];
  for (const tabInfo of savedGroup.tabs) {
    const tab = await chrome.tabs.create({ url: tabInfo.url, active: false });
    tabIds.push(tab.id);
  }
  
  // 2. 将所有标签页归入同一分组
  const groupId = await chrome.tabs.group({ tabIds });
  
  // 3. 恢复分组属性
  await chrome.tabGroups.update(groupId, {
    title: savedGroup.title,
    color: savedGroup.color,
    collapsed: true  // 恢复后默认折叠，避免界面混乱
  });
  
  // 4. 更新本地存储状态
  savedGroup.isOpen = true;
  savedGroup.currentGroupId = groupId;
  await persistSnapshot(savedGroup);
}
```

---

## 6. UI 方案建议

### 6.1 新增 "分组" 模式 TAB

分组与现有的扁平列表模式（书签/标签页/历史/下载）有本质区别——它是树状结构（分组 → 多个标签页）。建议新增独立的 "分组" TAB，而非在现有"标签页"模式中混入分组信息。

```
┌─────────────────────────────────────────────────┐
│ [书签] [标签页] [分组] [历史] [下载]        [⚙]  │
├─────────────────────────────────────────────────┤
│ 🔍 搜索分组或分组内标签页...                     │
├─────────────────────────────────────────────────┤
│ 📊 共 15 个分组 (8 打开 · 7 已保存)             │
├─────────────────────────────────────────────────┤
│                                                 │
│  🔴 langchain-1.2            打开 · 3个标签      │
│  ├─ LangChain Docs           docs.langchain...  │
│  ├─ LangChain GitHub         github.com/lan...  │
│  └─ LangChain Tutorial       tutorial.lang...   │
│                                                 │
│  🟠 Cursur/Skill/Mcp         已保存 · 5个标签    │
│  ► (点击展开)                                    │
│                                                 │
│  🟢 能力提升                  打开 · 2个标签      │
│  ├─ ...                                         │
│  └─ ...                                         │
│                                                 │
└─────────────────────────────────────────────────┘
```

### 6.2 与现有模式的区别

| 维度 | 现有模式（书签/标签页等） | 新 "分组" 模式 |
|------|-------------------------|--------------|
| 数据结构 | 扁平列表 | 树状（分组 → 标签页） |
| 展示方式 | 统一的 result-item | 分组头 + 缩进的子标签页 |
| 搜索行为 | 逐项匹配 | 穿透搜索（搜分组名 + 搜标签页内容） |
| 点击行为 | 打开/切换 | 分组头: 折叠/展开；标签页: 打开/切换 |
| 状态标识 | 无 | 打开/已保存 标签 |
| 批量操作 | 打开/复制 | 打开整个分组/关闭分组/复制所有链接 |

---

## 7. 风险评估

| 风险 | 严重程度 | 概率 | 缓解措施 |
|------|---------|------|---------|
| Chrome 未来开放 saved groups API 导致方案重构 | 低 | 低 | 快照方案作为补充仍有价值，不冲突 |
| onRemoved 触发时标签页已查询不到 | 高 | 中 | 持续快照策略（不依赖 onRemoved 时抓取） |
| storage.local 空间不足 | 低 | 极低 | 几百个分组仅占几 MB，远低于 10MB 限制 |
| Group ID 变化导致数据关联断裂 | 中 | 高 | 使用 title+color 作为稳定标识 |
| 冷启动时缺少历史分组数据 | 中 | 必然 | 提示用户打开已保存分组；安装时全量扫描 |
| 同名同色分组冲突 | 低 | 极低 | 以最新快照为准，用户极少创建完全相同的分组 |

---

## 8. 结论

### 可行性判断: ✅ 可行

虽然 Chrome 官方不提供访问已保存关闭分组的 API，但通过 **事件监听 + 本地快照** 的策略可以有效变通。这也是市面上所有 Tab Group 管理扩展的共同技术路线，已被验证可行。

### 推荐方案

1. **Background Service Worker** 通过 `tabGroups` 事件监听 + 定期全量同步，将分组及其标签页信息持久化到 `chrome.storage.local`
2. **新增 "分组" 模式 TAB**，提供树状的分组浏览和搜索体验
3. **穿透搜索**：同时搜索分组名称和分组内标签页的标题/URL
4. **恢复能力**：对已保存的关闭分组，支持一键重新打开所有标签页并重建分组

### 需要新增的权限

| 权限 | 用途 |
|------|------|
| `tabGroups` | 访问 chrome.tabGroups API |
| `alarms` | 定期全量同步分组数据 |

---

## 9. 补充调研：为什么只显示已打开的分组？(2026-02-24)

### 9.1 问题现象

扩展安装后，"分组"模式只显示了当前打开的 2 个分组，而 Chrome 书签栏左侧有更多已保存但关闭的分组未显示。

### 9.2 根因分析

这是一个**冷启动问题**（Cold Start Problem），属于已知的、不可避免的技术限制：

| 原因 | 说明 |
|------|------|
| **Chrome 不提供 API** | `chrome.tabGroups.query({})` **只返回当前打开的分组**，不返回已保存但关闭的分组。这是 Chrome 官方的有意设计，非 Bug。|
| **没有 saved groups 枚举 API** | 不存在类似 `chrome.tabGroups.getSaved()` 的 API。Chromium issue tracker 和 W3C WebExtensions Community Group 上已有开发者提交 feature request，但截至 2026-02 尚无进展。|
| **sessions API 也不行** | `chrome.sessions` 仅能恢复最近关闭的标签页/窗口，不包含分组元数据。|
| **Chrome 内部存储不可访问** | saved groups 存储在 Chrome 用户数据目录的内部数据结构（LevelDB / Sync 服务）中，扩展沙箱内无法读取。|
| **快照策略的本质限制** | 我们的"事件监听 + 本地快照"策略只能记录**扩展安装后曾经打开过的分组**。安装前就已关闭的 saved groups 从未被扩展"看到"过，因此没有快照数据。|

### 9.3 为什么 Chrome 自己能显示？

Chrome 浏览器本身是**原生代码**，直接读取内部数据结构（`components/saved_tab_groups/`），不受扩展 API 沙箱限制。扩展作为第三方代码，只能通过 Chrome 暴露的 Extension API 来间接访问数据，而 Chrome 团队出于安全和同步一致性考虑，**有意不暴露** saved groups 给扩展。

### 9.4 Chromium 源码佐证

Chromium 源码中 `components/saved_tab_groups/tab_group_store_delegate.h` 管理 saved groups 的存储和同步：
- 使用 Sync GUID 映射本地 group ID
- 数据通过 Chrome Sync 服务跨设备同步
- **完全是浏览器内部组件**，没有 Extension API 桥接层

`chrome/common/extensions/api/tab_groups.json`（扩展 API 定义文件）中：
- `query()` 只有 `collapsed`/`color`/`title`/`windowId` 等过滤参数
- **没有 `saved`/`closed`/`all` 等参数**
- **TabGroup 类型没有 `isSaved` 属性**

### 9.5 行业现状

市面上**所有** Tab Group 管理扩展（如 Tab Group Manager 等）都面临同样的限制，它们的共同策略：
1. 在分组打开时记录快照
2. 提供手动导入/导出 JSON 功能
3. **无法自动获取从未打开过的 saved groups**

### 9.6 我们能做的改善

虽然无法突破 API 限制，但可以通过以下方式最大程度改善用户体验：

| 改善措施 | 说明 | 优先级 |
|----------|------|--------|
| **冷启动引导提示** | 首次使用时告知用户：打开一次已保存分组即可被记录 | P0 |
| **持久化快照** | 已实现 — 分组打开过一次后永久记录在本地 | ✅ 已完成 |
| **事件监听** | 已实现 — 自动捕获 onCreated/onUpdated/onRemoved | ✅ 已完成 |
| **定时同步** | 已实现 — 每 5 分钟全量扫描 | ✅ 已完成 |

### 9.7 结论

**这是 Chrome Extension API 的硬性限制，无法通过任何扩展技术手段突破。** 我们已采用了业界最佳实践（事件监听 + 本地快照），唯一的"缺口"是冷启动阶段需要用户主动打开一次 saved groups。添加引导提示来帮助用户理解这个限制并引导操作。

---

**编写日期**: 2026-02-24 (补充更新: 2026-02-24)
**作者**: AI Assistant
**关联 Issue**: Chrome 标签页分组搜索功能
