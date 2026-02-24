# Saved Tab Group 原生打开能力调研（2026-02-24）

## 背景

用户反馈：通过扩展“打开分组”时，偶发出现新的无标题分组（如“6 个标签页”）并与原分组内容重复，体验与 Chrome 原生“手动打开分组”不一致。

目标：

1. 评估是否能通过扩展 API 实现“等同 Chrome 原生”的打开行为（直接打开已保存且已关闭的原生分组实体）。
2. 若不能，实现工程可行的最优降级，降低重复分组与误操作负担。

---

## 调研渠道与证据

### 1) Google / 官方 API 文档

- Chrome `chrome.tabGroups` API 仅提供 `query/get/update/move` 等能力，并未提供“枚举 closed saved groups / open saved group by id”的接口。  
  https://developer.chrome.com/docs/extensions/reference/api/tabGroups

### 2) GitHub（标准讨论）

- W3C WebExtensions 议题明确将“closed pinned/saved groups 暴露给扩展”定义为 Feature Request，当前仍未成为标准可用能力。  
  https://github.com/w3c/webextensions/issues/715

### 3) Google Groups（Chromium Extensions）

- Chrome 扩展团队公开说明过：Saved Tab Group 能力受同步与安全模型影响，扩展侧能力与浏览器原生能力不等价；能力开放是渐进过程。  
  https://groups.google.com/a/chromium.org/g/chromium-extensions/c/2RO1vp-8lqE

### 4) 社区现状（Google/StackOverflow）

- 开发者“如何列出 closed groups”问题长期存在，说明 API 层面并无直接可用方案。  
  https://stackoverflow.com/questions/79493740/how-to-list-all-tab-groups-including-closed-groups-in-chrome-extension

### 5) Context7

- Context7 中可用的是 Chrome Extensions API 参考镜像，不包含额外的“closed saved groups 可操作接口”。  
  https://context7.com/websites/developer_chrome_extensions_reference_api

---

## 结论

## 是否可实现“完全原生等价”？

**当前不可实现。**

原因：扩展 API 没有提供“直接打开已关闭 saved group 实体”的接口。扩展只能：

1. 查询当前已打开分组；
2. 对已打开分组做更新；
3. 对关闭分组采用“重建（tabs.create + tabs.group）”策略。

因此，扩展与 Chrome 原生“从浏览器内部 Saved Group 存储直接打开”存在能力差距。

## 是否可显著优化体验？

**可以。**

可通过“复用已打开同组 + 去重 + 失败可见提示”把重复创建概率降到最低，并提升可解释性。

## 能否拿到“唯一标识符”彻底避免重复？

结论分三层：

1. **打开分组（可拿到）**：可拿到 `tabGroupId`（即 `TabGroup.id`），可用于当前会话内唯一定位。  
2. **已关闭/已保存分组（拿不到）**：扩展 API 当前不暴露 saved group 的全局 UUID，也没有“按 saved-group-id 打开”接口。  
3. **跨设备同步标识（理论存在但不可用）**：浏览器内部会有用于同步的标识，但扩展侧不可直接读取。

因此：**“仅靠拿到唯一 ID 就不重复创建”在已关闭 saved group 场景下目前做不到**。  
我们只能在工程层做“近似唯一”：

- 已打开场景：优先用 `groupId` 复用；
- 已关闭场景：用 `stableKey(title+color)` + URL 签名匹配；
- 并发场景：用 in-flight 锁去重。

这也是目前业界扩展可行的最优方案。

---

## 本次工程落地（已实施）

### A. 失败可见化（三 UI）

- `popup` / `content-script` / `search-window`：恢复失败时统一显示 toast，不再只写 console。

### B. 恢复链路去重（background）

- 在 `RESTORE_GROUP` 中先尝试匹配已打开分组，命中则直接聚焦，不再新建。
- 匹配策略：
  - `stableKey(title + color)`
  - `URL 签名`（归一化后排序拼接）
- 新增“同签名请求并发去重锁”（in-flight map），避免短时间重复触发导致连续新建。

### C. 列表层去重

- 在 `background loadGroups` 与 `popup loadGroups` 中，closed snapshots 合并时增加 URL 签名去重，减少同内容多条记录。

### D. URL 归一化增强

- 签名比较改为 `hostname + pathname + search`（忽略协议/哈希、尾斜杠差异），降低跳转/协议差异造成的“同组误判不同组”。

---

## 对“图中 6 个标签页无标题分组”的解释

该现象通常由两类原因叠加：

1. **API 能力边界**：扩展不能“直接打开原生 closed saved group”，只能重建分组；
2. **UI/事件时序**：分组创建后标题更新与菜单渲染存在异步窗口，短时可能显示为“X 个标签页”；若重复触发恢复，则会出现多个同内容分组。

本次改造已尽量在工程层规避重复触发与重复创建，但无法突破 API 边界实现 100% 原生等价。

---

## 后续建议

1. 保持“点击子标签时整组恢复”开关（已支持），给用户明确可控的行为模式。  
2. 增加“恢复后立即刷新分组数据”与“最近一次恢复状态提示”，进一步降低感知抖动。  
3. 持续跟踪 W3C/Chromium 对 saved groups API 的进展，一旦开放可直接切换到原生路径。

