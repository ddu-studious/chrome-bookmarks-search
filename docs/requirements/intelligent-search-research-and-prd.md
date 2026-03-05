# Chrome Bookmarks Search - 智能 AI 搜索能力调研报告与 PRD

**文档版本**: v1.3  
**创建日期**: 2026-03-05  
**最后更新**: 2026-03-05 (v1.10.0 Phase 4 全部完成)  
**状态**: Phase 1-4 全部完成  
**关联项目**: Chrome Bookmarks Search v1.10.0

---

# Part 1: 调研报告

## 1.1 行业调研

### 1.1.1 调研对象概览

| 产品 | 类型 | AI 能力 | 定价 | 用户规模 |
|------|------|---------|------|----------|
| QuickPeek | Chrome 扩展 | 统一搜索、Spotlight 风格 | 免费 + $5.99 终身 | 少量 |
| Memex | Chrome/Firefox | 语义搜索、AI 摘要、知识图谱 | 免费 + Pro | 10,000+ |
| Raindrop.io | 跨平台书签服务 | AI 建议、Stella 语义搜索 | 免费 + Pro | 百万级 |
| Recall | Chrome/Firefox | 语义搜索、知识图谱、间隔复习 | 免费 + Premium | 70,000+ |
| Vimium C | Chrome 扩展 | 无 AI，纯关键词 | 免费开源 | 50,000+ |
| BookmarkMind | Chrome 扩展 | AI 分类、Gemini/Groq | 开源 | 实验性 |

---

### 1.1.2 QuickPeek

**产品定位**：类似 Spotlight / Alfred 的浏览器统一搜索栏。

**AI 功能**：
- 统一搜索：书签、标签页、历史、下载一站式搜索
- 快捷键激活：Ctrl+M / Cmd+M
- 无显式「语义搜索」或「AI 摘要」，以关键词匹配为主

**定价**：
- 免费版：基础功能
- 终身版：$5.99
- PowerUser：$14.99（3 个授权）

**优缺点**：
- ✅ 轻量、启动快
- ✅ 统一入口体验好
- ❌ 无语义理解，依赖精确关键词
- ❌ AI 能力有限

---

### 1.1.3 Memex (WorldBrain)

**产品定位**：个人知识库 + 网页研究工具。

**AI 功能**：
- 全文搜索：书签、标注、PDF 全文索引
- 语义搜索：自然语言查询
- AI 摘要：网页、PDF、YouTube 视频
- 与 AI 对话：基于个人知识库的问答
- 知识图谱：自动关联相关内容

**定价**：
- 免费版：基础功能
- Pro：订阅制（具体价格见官网）

**优缺点**：
- ✅ 语义搜索 + 全文索引
- ✅ 支持 PDF、视频
- ✅ 隐私优先，本地存储
- ❌ 功能复杂，学习成本高
- ❌ 需同步/备份才能跨设备

---

### 1.1.4 Raindrop.io

**产品定位**：跨平台书签管理 + AI 助手。

**AI 功能**：
- AI Suggestions（2024）：保存书签时自动推荐收藏夹和标签
- Stella（2026）：语义搜索、自然语言查询、摘要、内容组织
- 私有模型：数据不离开 Raindrop 服务器，不用于训练

**定价**：
- 免费版：基础收藏
- Pro：Stella 等高级 AI 功能

**优缺点**：
- ✅ 语义搜索体验好（Stella）
- ✅ 云端同步、多端一致
- ❌ 依赖云端，隐私敏感用户有顾虑
- ❌ 非纯扩展，需配合 Web/App

---

### 1.1.5 Recall

**产品定位**：AI 记忆与知识管理。

**AI 功能**：
- 语义搜索：自然语言查找已保存内容
- 知识图谱：自动分类、关联
- 间隔复习：科学记忆法
- 增强浏览：浏览时实时推荐相关已保存内容

**定价**：
- 免费版：基础功能
- Premium：高级功能

**优缺点**：
- ✅ 语义搜索 + 知识图谱
- ✅ 间隔复习与记忆增强
- ✅ 70,000+ 用户，成熟度高
- ❌ 偏「记忆管理」，书签仅是数据源之一

---

### 1.1.6 Vimium C

**产品定位**：键盘驱动的浏览器操作。

**AI 功能**：
- 无 AI：纯关键词搜索书签、历史、标签
- Vomnibar：`o` 打开搜索面板

**优缺点**：
- ✅ 键盘效率高
- ✅ 开源、可定制
- ❌ 无语义/AI 能力

---

### 1.1.7 行业总结

| 维度 | 结论 |
|------|------|
| AI 搜索 | 主流产品已支持语义搜索（Memex、Raindrop、Recall） |
| 定价 | 免费 + 订阅/终身，AI 功能多放在付费层 |
| 技术路线 | 远程 Embedding API 为主，本地模型少见 |
| 差异化 | 我们可主打：纯本地可选、轻量、与现有书签/标签/历史/下载无缝集成 |

---

## 1.2 技术方案对比

### 1.2.1 Embedding 方案对比

| 方案 | 代表 | 延迟 | 成本 | 隐私 | 适用场景 |
|------|------|------|------|------|----------|
| 远程 API | DeepSeek/OpenAI/Gemini | 100–500ms | 按 Token | 需信任服务商 | 生产首选 |
| 本地 Transformers.js | mxbai-embed-xsmall | 50–200ms/条 | 无 | 完全本地 | 离线/隐私优先 |
| 本地 ONNX Runtime | 同上 | 更快（WebGPU） | 无 | 完全本地 | 高性能本地 |

**远程 API 示例（OpenAI 兼容格式 / SiliconFlow）**：

> ⚠️ **注意**：DeepSeek 官方 API 不提供 Embedding 端点，仅支持 Chat。推荐使用 Gemini（免费额度大）或 SiliconFlow（国内友好）。

```javascript
const resp = await fetch('https://api.siliconflow.cn/v1/embeddings', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  },
  body: JSON.stringify({
    model: 'BAAI/bge-m3',
    input: texts,
    dimensions: 1024
  })
});
const embeddings = (await resp.json()).data.map(d => d.embedding);
```

**本地 Transformers.js 示例**：

```javascript
import { pipeline } from "@huggingface/transformers";

const extractor = await pipeline(
  "feature-extraction",
  "mixedbread-ai/mxbai-embed-xsmall-v1",
  { device: "webgpu" }
);
const embeddings = await extractor(texts, { pooling: "mean", normalize: true });
```

**建议**：Phase 1–3 以远程 API 为主；v3.0 再考虑本地模型作为可选方案。

---

### 1.2.2 搜索策略对比

| 策略 | 优点 | 缺点 | 适用 |
|------|------|------|------|
| 纯关键词 | 实现简单、无依赖 | 无语义、同义词差 | 基线 |
| 纯向量 | 语义好 | 漏掉精确词、成本高 | 小规模 |
| BM25 + 向量混合 | 兼顾精确与语义 | 实现复杂 | **推荐** |
| BM25 + 向量 + RRF | 排序更稳 | 略增计算 | **推荐** |
| + LLM Rerank | 排序最优 | 延迟与成本高 | 可选增强 |

**RRF 公式**：

```
RRF_score(d) = Σ 1/(k + rank_i(d))
```
通常 `k=60`，`rank_i` 为在第 i 个检索列表中的排名。

**chrome-time-background 现有实现**：

```javascript
// RRF 融合
const k = 60;
keywordResults.forEach((item, rank) => {
  scoreMap.get(item.id).rrfScore += 1 / (k + rank + 1);
});
semanticResults.forEach((item, rank) => {
  scoreMap.get(item.id).rrfScore += 1 / (k + rank + 1);
});
```

---

### 1.2.3 重排序策略

| 策略 | 说明 | 延迟 | 成本 |
|------|------|------|------|
| 无 Rerank | 仅 RRF 融合 | 0 | 0 |
| Listwise LLM | 一次调用对 Top-N 重排 | 1–3s | 约 500–1000 tokens/次 |
| Cross-encoder | 专用重排模型 | 较低 | 需额外模型 |
| 启发式 | 标题/URL 加权 | 0 | 0 |

**建议**：Phase 2 提供可选 LLM Rerank，默认关闭。

---

### 1.2.4 存储方案对比

| 方案 | 容量 | 性能 | 适用 |
|------|------|------|------|
| chrome.storage.local | 默认 10MB，unlimitedStorage 可扩展 | 读写整块，大数组慢 | 配置、小缓存 |
| chrome.storage.sync | 约 100KB | 跨设备同步 | 设置 |
| IndexedDB | 无硬性上限 | 支持索引、增量更新 | **向量、大缓存** |
| WebSQL | 已废弃 | - | 不推荐 |

**向量存储建议**：IndexedDB，理由：
- 支持 Float32Array 等二进制
- 可建索引加速检索
- 增量更新友好
- chrome-time-background 已验证

---

### 1.2.5 性能基准（估算）

| 书签数量 | 关键词搜索 | 向量搜索（内存） | 混合搜索 | Embedding 全量构建 |
|----------|------------|------------------|----------|--------------------|
| 100 | <50ms | <20ms | <80ms | 约 5–10s |
| 500 | <100ms | <50ms | <150ms | 约 30–60s |
| 2000 | <300ms | <150ms | <400ms | 约 2–4min |
| 5000 | <800ms | <400ms | <1s | 约 5–10min |

*注：向量搜索为线性扫描；若需更高规模可考虑 HNSW 等近似最近邻。*

---

## 1.3 适配性分析

### 1.3.1 姐妹项目 chrome-time-background 可复用部分

| 模块 | 文件 | 可复用程度 | 说明 |
|------|------|------------|------|
| BM25 风格关键词搜索 | bookmark-rag.js `search()` | 高 | 需适配我们的 `SearchParser` 语法 |
| Embedding API 调用 | `_callEmbeddingAPI()` | 高 | 可直接迁移 |
| 向量存储 | IndexedDB 逻辑 | 高 |  schema 可微调 |
| RRF 混合搜索 | `hybridSearch()` | 高 | 逻辑通用 |
| LLM Rerank | `rerank()` | 高 | Prompt 可定制 |
| 网页内容提取 | `extractWebContentInTab` | 高 | 在 background 中实现 |
| AI Provider 配置 | `AI_PROVIDERS` | 高 | DeepSeek/OpenAI/Gemini/Custom |
| SRS 间隔复习 | bookmark-srs.js | 低 | 非本扩展核心，可后续考虑 |

---

### 1.3.2 架构差异与改造点

**chrome-time-background**：
- 独立 `bookmark-rag.js`，在 background 或新标签页中运行
- 仅管理「选定文件夹」的书签
- 有独立的 RAG 配置 UI

**Chrome Bookmarks Search**：
- 无独立 bookmark-rag，逻辑分布在 `popup.js`、`content-script.js`、`search-window.js`
- 搜索全量书签 + 标签 + 历史 + 下载
- 三端 UI 需同步（popup、content-script、search-window）

**改造要点**：

| 项目 | 改造内容 |
|------|----------|
| 数据源 | 从「指定文件夹」改为「全量书签 + 可选历史/下载」 |
| 入口 | 在 background 中维护智能搜索模块，供三端通过消息调用 |
| 搜索语法 | 保留现有 `site:`, `type:`, `in:`, `after:`, `before:`，与 BM25/向量结果融合 |
| UI | 在设置中增加「智能搜索」开关、Provider 配置、Embedding 进度 |

---

### 1.3.3 MV3 Service Worker 约束

| 约束 | 影响 | 对策 |
|------|------|------|
| 无持久页面 | 不能长期驻留 | 用 alarms 定期唤醒做增量索引 |
| 30s 闲置休眠 | 长时间任务可能中断 | 分批处理 + 进度持久化 |
| 无 DOM | 不能直接操作页面 | 所有 UI 在 popup/content-script |
| 消息通信 | 需异步 | 统一 `chrome.runtime.sendMessage` 协议 |

---

### 1.3.4 扩展体积与性能预算

| 项目 | 建议 |
|------|------|
| 扩展包体积 | 尽量 < 5MB（不含运行时下载的模型） |
| 首次加载 | popup 打开 < 500ms 内可交互 |
| 搜索响应 | 混合搜索 < 500ms（不含 Rerank） |
| 内存 | 5000 书签向量约 7–8MB，可接受 |

---

# Part 2: 需求 PRD

## 2.1 背景与目标

### 2.1.1 背景

Chrome Bookmarks Search 当前支持：
- 书签、标签页、历史、下载的搜索
- 高级语法：`site:`, `type:`, `in:`, `after:`, `before:`
- 多关键字、排除、精确匹配
- 三种 UI：Spotlight、Raycast、Fluent

**痛点**：
- 仅关键词匹配，无法理解「React 教程」「之前收藏的 GitHub 项目」等自然语言
- 同义词、相关概念检索能力弱
- 与 Memex、Raindrop、Recall 等产品的语义能力存在差距

### 2.1.2 目标

1. **短期**：在保持轻量的前提下，引入 BM25 + 向量混合搜索，提升语义检索能力
2. **中期**：可选 LLM 重排序、网页摘要，增强结果质量
3. **长期**：探索本地模型、统一搜索入口、AI 推荐与分类

---

## 2.2 用户故事

| ID | 用户故事 | 优先级 |
|----|----------|--------|
| US1 | 作为用户，我希望能用自然语言搜索书签（如「React 入门教程」），而不仅是精确关键词 | P0 |
| US2 | 作为用户，我希望能快速找到「之前收藏的某个网站」而记不清具体名字 | P0 |
| US3 | 作为用户，我希望在未配置 API 时仍能使用原有关键词搜索，不受影响 | P0 |
| US4 | 作为用户，我希望能选择不同的 AI 服务商（DeepSeek/OpenAI/Gemini）并配置自己的 API Key | P0 |
| US5 | 作为用户，我希望能看到 Embedding 构建进度，并在后台增量更新 | P1 |
| US6 | 作为用户，我希望能对重要书签启用「网页摘要」，让语义搜索更准确 | P1 |
| US7 | 作为用户，我希望能开启「AI 重排序」在结果较多时获得更优排序 | P2 |
| US8 | 作为用户，我希望能用本地模型（如 Transformers.js）完全离线使用语义搜索 | P3 |

---

## 2.3 功能范围

### Phase 1：本地智能搜索基础（BM25 + Embedding + 混合搜索）

| 功能 | 说明 | 状态 |
|------|------|------|
| BM25 风格关键词搜索 | 在现有 SearchParser 基础上增强权重与打分 | ✅ 已完成 (v1.8.0) |
| 向量索引 | 对书签 title+url+domain 生成向量，存 IndexedDB | ✅ 已完成 (v1.8.0) |
| Embedding API | 支持 Gemini / OpenAI / SiliconFlow / 自定义 OpenAI 兼容 | ✅ 已完成 (v1.9.0 修正 Provider) |
| 混合搜索 | BM25 + 向量 + RRF 融合 | ✅ 已完成 (v1.8.0) |
| 设置 UI (Popup) | API Key、Provider、开关、进度条 | ✅ 已完成 (v1.8.0) |
| 设置 UI (Options) | 完整 AI 设置区块含引导流程 | ✅ 已完成 (v1.9.0) |
| 增量索引 | 书签增删改时更新向量 | ✅ 已完成 (v1.8.0) |
| 向量构建断点续传 | alarms 分批、状态持久化、SW 重启恢复 | ✅ 已完成 (v1.9.0) |
| API Key 验证 | 配置后可一键验证连通性 | ✅ 已完成 (v1.8.0) |
| 关键词回退 | 未配置/索引未建时自动回退到原有搜索 | ✅ 已完成 (v1.8.0) |
| 三端 AI 模式 | popup / content-script / search-window 均支持 | ✅ 已完成 (v1.8.0) |

### Phase 2：AI 增强（LLM Rerank + 智能分类）

| 功能 | 说明 | 状态 |
|------|------|------|
| LLM Rerank | 对 Top-30 候选调用 LLM 重排，返回 Top-15 | ✅ 已完成 (v1.8.0) |
| 智能分类建议 | 保存书签时推荐文件夹（可选） | ⏳ 规划中 |
| Rerank 开关 | 用户可关闭以节省成本与延迟 | ✅ 已完成 (v1.8.0) |

### Phase 3：网页摘要 + 语义增强

| 功能 | 说明 | 状态 |
|------|------|------|
| 网页内容提取 | 隐藏标签页 + scripting 注入提取正文 | ✅ 已完成 (v1.8.0) |
| 摘要生成 | LLM 生成 50–100 字摘要 + 关键词 | ✅ 已完成 (v1.8.0) |
| 摘要参与 Embedding | 将摘要纳入向量文本，提升语义质量 | ✅ 已完成 (v1.8.0) |
| 单条摘要提取 UI | 右键菜单「提取摘要」，实时更新结果 | ✅ 已完成 (v1.9.0) |
| 批量摘要提取 UI | Options 页面批量提取 + 进度条 | ✅ 已完成 (v1.9.0) |

### Phase 4：统一搜索 + AI 推荐

| 功能 | 说明 | 状态 |
|------|------|------|
| 多源统一语义搜索 | 书签+历史+标签页一次查询，RRF 融合 | ✅ 已完成 (v1.9.0) |
| 来源标签 | 搜索结果标注「书签/历史/标签页」来源 | ✅ 已完成 (v1.9.0) |
| 相关度可视化 | 语义匹配度百分比 + 进度条 | ✅ 已完成 (v1.9.0) |
| 摘要预览 | 搜索结果显示 AI 生成的摘要 | ✅ 已完成 (v1.9.0) |
| AI 推荐 | 根据当前浏览页推荐相关书签 | ✅ 已完成 (v1.10.0) |
| 快捷操作 | 从推荐直接打开/收藏 | ✅ 已完成 (v1.10.0) |

---

## 2.4 交互设计

### 2.4.1 设置面板 - 智能搜索配置

```
┌─────────────────────────────────────────────────────────┐
│ 设置 > 智能搜索                                           │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  [x] 启用智能搜索（语义理解）                              │
│                                                          │
│  AI 服务商:  [DeepSeek ▼]                                 │
│  API Key:    [••••••••••••••••••••]  [验证]               │
│  API 地址:   [https://api.deepseek.com/v1    ] (可选)     │
│                                                          │
│  Embedding 进度:  ████████░░ 320/500 书签已索引           │
│  [重新构建] [暂停]                                         │
│                                                          │
│  [ ] 启用 AI 重排序（消耗更多 Token，延迟增加）            │
│                                                          │
│  [保存]                                                   │
└─────────────────────────────────────────────────────────┘
```

### 2.4.2 搜索框 - 智能模式指示

```
┌─────────────────────────────────────────────────────────┐
│  [🔍]  React 入门教程                    [书签] [标签] ... │
│         └─ 智能搜索已启用，支持语义匹配                    │
├─────────────────────────────────────────────────────────┤
│  1. React 官方文档 - react.dev          ⭐ 语义匹配       │
│  2. React 中文文档 - zh-hans.reactjs.org                 │
│  3. 从零开始学 React - github.com/xxx                   │
└─────────────────────────────────────────────────────────┘
```

### 2.4.3 结果项 - 匹配类型标签

```
┌─────────────────────────────────────────────────────────┐
│  📄 React 官方文档                          [关键词+语义]  │
│     https://react.dev                                    │
│     最后访问: 2天前                                       │
└─────────────────────────────────────────────────────────┘
```

---

## 2.5 技术架构

### 2.5.1 整体架构图

```
                    ┌──────────────────────────────────────┐
                    │          用户界面层                   │
                    │  popup.js / content-script.js /      │
                    │  search-window.js                     │
                    └──────────────┬───────────────────────┘
                                   │ chrome.runtime.sendMessage
                                   ▼
                    ┌──────────────────────────────────────┐
                    │         background.js                 │
                    │  - 消息路由                            │
                    │  - 书签/历史/下载加载                   │
                    │  - extractWebContent                   │
                    └──────────────┬───────────────────────┘
                                   │ import
                                   ▼
                    ┌──────────────────────────────────────┐
                    │      js/intelligent-search.js          │
                    │  - BM25 关键词搜索                     │
                    │  - Embedding API 调用                 │
                    │  - 向量搜索 + RRF 融合                 │
                    │  - LLM Rerank（可选）                  │
                    │  - 网页摘要生成                        │
                    └──────────────┬───────────────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
    ┌─────────────────┐  ┌──────────────┐  ┌──────────────────┐
    │   IndexedDB     │  │ chrome.      │  │  Fetch (Embedding │
    │   - vectors     │  │ storage.sync │  │  / Chat API)     │
    │   - queryCache  │  │ - 配置       │  │                  │
    └─────────────────┘  └──────────────┘  └──────────────────┘
```

### 2.5.2 数据流

```
用户输入 "React 教程"
        │
        ▼
┌───────────────────┐
│ SearchParser      │ 解析 site:/type:/in: 等
│ (保留现有逻辑)     │
└─────────┬─────────┘
          │
          ▼
┌───────────────────┐     ┌──────────────────┐
│ 关键词搜索         │────▶│ 候选集 A          │
│ (BM25 风格)       │     └────────┬─────────┘
└───────────────────┘              │
                                   │
┌───────────────────┐     ┌───────▼──────────┐
│ 向量搜索           │────▶│ 候选集 B          │
│ (Embedding+余弦)   │     └────────┬─────────┘
└───────────────────┘              │
                                   │
                          ┌────────▼────────┐
                          │ RRF 融合         │
                          │ 取 Top-K         │
                          └────────┬────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │ 启用 Rerank?                 │
                    │ 是 → LLM 重排 → 最终结果     │
                    │ 否 → 直接返回                │
                    └─────────────────────────────┘
```

### 2.5.3 文件映射

| 文件 | 职责 |
|------|------|
| `background.js` | 消息路由、loadBookmarks 等、extractWebContent |
| `js/intelligent-search.js` | 新建，BM25+向量+RRF+Rerank+摘要 |
| `js/search-parser.js` | 保留，语法解析，与 intelligent-search 协同 |
| `js/smart-sort.js` | 保留，时间/频率排序 |
| `js/popup.js` | 调用智能搜索、展示结果、设置入口 |
| `js/content-script.js` | 同上，通过消息 |
| `js/search-window.js` | 同上，通过消息 |
| `options.html` | 增加「智能搜索」配置区块 |
| `manifest.json` | 增加 `unlimitedStorage`（可选） |

---

## 2.6 数据结构

### 2.6.1 IndexedDB Schema

**数据库名**: `IntelligentSearchIndex`  
**版本**: 1

**Object Store: vectors**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | string | 书签 id 或 `history_${url}` |
| embedding | Array<number> | 384 维向量 |
| text | string | 用于生成向量的原文 |
| ts | number | 更新时间戳 |

**Object Store: queryCache**

| 字段 | 类型 | 说明 |
|------|------|------|
| query | string | 查询文本（小写 trim） |
| embedding | Array<number> | 查询向量 |
| ts | number | 缓存时间，24h 有效 |

### 2.6.2 chrome.storage 结构

**storage.sync**（配置）:

```json
{
  "intelligentSearch": {
    "enabled": true,
    "aiProvider": "gemini",
    "aiApiKey": "AIza...",
    "aiBaseUrl": "",
    "embeddingModel": "",
    "chatModel": "",
    "rerankEnabled": false,
    "lastBuildProgress": 85
  }
}
```

**storage.local**（缓存，可选）:

```json
{
  "bookmarkMetadata": {
    "version": 1,
    "lastSync": 1735689600000,
    "items": [
      {
        "id": "123",
        "summary": "摘要文本",
        "contentTags": ["react", "tutorial"],
        "contentExtractedAt": 1735689600000
      }
    ]
  }
}
```

---

## 2.7 API 设计

### 2.7.1 消息协议

**从 popup/content-script/search-window → background**

| action | payload | 说明 |
|--------|---------|------|
| `intelligentSearch` | `{ query, mode, limit, rerank }` | 执行智能搜索 |
| `getIntelligentSearchConfig` | - | 获取配置 |
| `setIntelligentSearchConfig` | `config` | 保存配置 |
| `buildEmbeddingIndex` | `{ onProgress }` | 构建/重建向量索引 |
| `pauseEmbeddingBuild` | - | 暂停构建 |
| `extractAndSummarize` | `{ bookmarkId }` | 提取并生成摘要 |
| `batchExtractSummaries` | `{ onProgress }` | 批量提取 |
| `verifyApiKey` | `{ provider, apiKey, baseUrl }` | 验证 API Key |

**background 响应格式**

```javascript
// 成功
{ ok: true, data: {...} }

// 失败
{ ok: false, error: "错误信息" }

// 进度回调（需特殊处理，如 Port）
{ type: 'progress', percent: 50, processed: 250 }
```

### 2.7.2 调用示例

```javascript
// popup.js 中调用智能搜索
const response = await chrome.runtime.sendMessage({
  action: 'intelligentSearch',
  query: searchInput.value,
  mode: currentMode,
  limit: 50,
  rerank: settings.rerankEnabled
});
if (response?.ok) {
  currentResults = response.data.results;
  displayResults(currentResults);
}
```

---

## 2.8 成本估算

### 2.8.1 Embedding 成本（按万次计，约 384 维）

| 服务商 | 单价（约） | 500 书签首次 | 5000 书签首次 |
|--------|------------|--------------|---------------|
| DeepSeek | ¥0.007/万 | ¥0.004 | ¥0.04 |
| OpenAI text-embedding-3-small | ¥0.015/万 | ¥0.008 | ¥0.08 |
| Gemini | 免费额度大 | 免费 | 免费 |

### 2.8.2 LLM Rerank 成本（每次搜索）

| 模型 | 输入 Token | 输出 Token | 单次约成本 |
|------|------------|------------|------------|
| DeepSeek Chat | ~800 | ~200 | ¥0.002 |
| GPT-4o-mini | ~800 | ~200 | ¥0.003 |
| Gemini Flash | ~800 | ~200 | 免费额度内 |

### 2.8.3 摘要生成（每页）

| 模型 | 输入 ~2500 + 输出 ~200 | 单次约成本 |
|------|------------------------|------------|
| DeepSeek | - | ¥0.003 |
| GPT-4o-mini | - | ¥0.004 |

**建议**：默认关闭 Rerank 与批量摘要，由用户按需开启。

---

## 2.9 验收标准

### Phase 1

- [x] 配置 Gemini/OpenAI/SiliconFlow/自定义 后能成功验证 API Key ✅
- [x] 能对全量书签启动 Embedding 构建并看到进度（支持断点续传） ✅
- [x] 构建完成后，自然语言查询能返回语义相关结果 ✅
- [x] 未配置或构建未完成时，自动回退到原有关键词搜索 ✅
- [x] 书签增删改后，向量索引能正确增量更新 ✅
- [x] 三端（popup、content-script、search-window）行为一致 ✅
- [x] Options 页面提供完整 AI 配置界面 ✅

### Phase 2

- [x] 开启 Rerank 后，结果顺序明显优于未开启 ✅
- [x] Rerank 可关闭，且关闭后无额外 API 调用 ✅
- [ ] 智能分类建议（若实现）在保存书签时正确展示

### Phase 3

- [x] 单个书签可触发「提取摘要」（后端已实现，UI 待接入） ✅
- [x] 摘要生成后，再次语义搜索能利用摘要 ✅
- [ ] 批量提取有进度展示，可取消

### Phase 4

- [ ] 历史/下载（若支持）能参与语义搜索
- [ ] 统一入口一次查询可检索多类数据
- [ ] AI 推荐（若实现）在指定场景下正确展示

---

## 2.10 风险与对策

| 风险 | 影响 | 对策 |
|------|------|------|
| API 限流/失败 | 搜索不可用 | 降级到关键词搜索，提示用户 |
| 大量书签构建慢 | 用户等待久 | 后台分批、可暂停、进度持久化 |
| 隐私顾虑 | 用户不敢用 | 明确说明数据用途，支持自建 API |
| 扩展体积膨胀 | 商店/加载变慢 | 不打包模型，按需加载 |
| Service Worker 休眠 | 后台任务中断 | 用 alarms 分片，断点续传 |
| 多端状态不一致 | 体验割裂 | 配置存 sync，索引存 local，统一消息协议 |

---

# Part 3: 版本路线图

## 3.1 版本规划

| 版本 | 主题 | 核心功能 | 预计周期 |
|------|------|----------|----------|
| v2.0.0 | 智能搜索基础 | BM25 + 向量 + 混合搜索、IndexedDB、设置 UI | 4–6 周 |
| v2.1.0 | AI 增强排序 | LLM Rerank、可选开关 | 2–3 周 |
| v2.2.0 | 网页摘要 | 内容提取、摘要生成、语义增强 | 3–4 周 |
| v2.3.0 | 统一搜索 | 历史/下载向量化、统一入口、AI 推荐 | 4–5 周 |
| v3.0.0 | 本地模型 | Transformers.js/ONNX、多轮对话（可选） | 6–8 周 |

## 3.2 时间线估算

```
2026 Q2
├── v2.0.0 智能搜索基础     [====] 4-6 周
├── v2.1.0 AI 增强排序      [==] 2-3 周
└── v2.2.0 网页摘要         [===] 3-4 周

2026 Q3
├── v2.3.0 统一搜索         [====] 4-5 周
└── v3.0.0 本地模型         [======] 6-8 周
```

## 3.3 里程碑

| 里程碑 | 交付物 |
|--------|--------|
| M1 | 智能搜索可配置、可构建、可搜索 |
| M2 | Rerank 可选、体验可感知提升 |
| M3 | 摘要参与语义搜索，覆盖核心书签 |
| M4 | 多数据源统一语义检索 |
| M5 | 本地模型可选，完全离线可用 |

---

# 附录

## A. 参考资料

- chrome-time-background: `js/bookmark-rag.js`, `js/background.js`
- [Transformers.js - Feature Extraction](https://huggingface.co/docs/transformers.js/main/en/guides/webgpu)
- [Elasticsearch Hybrid Search](https://www.elastic.co/search-labs/blog/improving-information-retrieval-elastic-stack-hybrid)
- [Chrome Storage API](https://developer.chrome.com/docs/extensions/reference/storage/)
- [IndexedDB - Chrome Developers](https://developer.chrome.com/docs/chromium/indexeddb-storage-improvements)

## B. 术语表

| 术语 | 说明 |
|------|------|
| BM25 | 基于词频的排序函数，常用于关键词检索 |
| Embedding | 文本的向量表示，用于语义相似度计算 |
| RRF | Reciprocal Rank Fusion，多路排序结果融合方法 |
| Rerank | 对初筛结果进行二次排序 |
| IndexedDB | 浏览器端结构化数据库，适合存储向量等大数据 |

---

**文档结束**
