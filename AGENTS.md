# AGENTS.md

## 交互约定

- 默认使用中文交流；代码、命令、配置键、错误日志保持原文。
- 用户没有明确要求提交时，不自动 `git commit`、不自动推送。
- 先读现有实现和文档，再改代码；不要只按 PRD 判断功能状态。

## 项目概览

这是一个 Manifest V3 Chrome 扩展，用于搜索和管理书签、标签页、分组、历史记录、下载记录，并包含 AI 搜索、书签健康检测、书签整理、多平台快捷搜索等能力。

关键入口：

- `manifest.json`：扩展权限、命令快捷键、background service worker。
- `background.js`：数据加载、消息分发、打开/编辑/删除、AI、健康检测等后台能力。
- `popup.html` + `js/popup.js` + `css/popup.css`：扩展按钮弹窗。
- `search-window.html` + `js/search-window.js` + `css/search-window.css`：独立搜索窗口，通常由快捷键打开。
- `options.html` + `js/options.js` + `css/options.css`：设置页、数据管理、书签整理、平台搜索配置。
- `js/settings.js`：默认设置、搜索平台定义、书签标签系统、书签整理引擎。
- `js/search-parser.js`：搜索语法解析，包括 `site:`、`type:`、`tag:`、平台前缀等。
- `js/intelligent-search.js`：AI/语义搜索。
- `js/bookmark-health.js`：书签健康检测。
- `docs/requirements/`、`docs/research/`：需求和调研文档，改功能前优先查对应文档。

## 开发与验证

- 这是无构建步骤的原生扩展项目，主要验证方式是加载未打包扩展：
  1. 打开 `chrome://extensions/`
  2. 开启开发者模式
  3. 选择本项目目录加载
  4. 修改后刷新扩展卡片并手动回归
- 常用静态检查：
  - `rg "关键词"` 搜索调用链。
  - `node --check <file>` 检查单个 JS 文件语法。
- 没有 package/test 脚本时，不要臆造 npm 流程。

## 代码约束

- 维持原生 HTML/CSS/JS 风格，不引入框架或打包器，除非用户明确要求。
- 修改 popup、search-window、content-script 的共同能力时，要检查三端是否需要同步。
- Chrome 扩展 API 调用要考虑 Manifest V3 service worker 生命周期，消息接口需处理 `chrome.runtime.lastError`。
- 书签移动、删除、批量操作属于高风险动作，必须先预览、用户确认，再执行；执行前保留可撤销信息。
- 用户自定义数据优先放 `chrome.storage.sync`；大体量、缓存、索引、标签映射优先放 `chrome.storage.local`。
- 不要扩大 host permissions 或新增敏感权限，除非功能确实需要并在说明里解释原因。

## 书签整理原则

- 默认只整理未归类或根层级书签，不主动重排用户已有文件夹。
- 对已有文件夹内书签，只在用户显式开启“整理子文件夹”时做目录内细分。
- 自动分类应先生成 plan，展示目标文件夹、来源规则、置信度和待移动数量。
- 用户确认后再调用 `chrome.bookmarks.create()` / `chrome.bookmarks.move()`。
- 保留撤销记录，至少能把本次移动的书签移回原父级。

## 搜索能力原则

- `Alt+B` 是主要唤起路径，默认优先保持弹窗/独立窗口体验一致。
- 平台快捷搜索使用 `prefix: query` 形式，例如 `gh: react hooks`。
- 自定义平台 URL 必须包含 `{query}` 占位符。
- 搜索解析器改动要回归：
  - 普通多关键字 AND 搜索
  - `site:` / `type:` / `tag:`
  - 内置平台前缀
  - 自定义平台前缀

## 文档维护

- 功能行为与 README 不一致时，优先相信代码，并在合适时更新 README 或 docs。
- 新增复杂功能时，在 `docs/requirements/` 或 `docs/research/` 留下简短设计记录。
