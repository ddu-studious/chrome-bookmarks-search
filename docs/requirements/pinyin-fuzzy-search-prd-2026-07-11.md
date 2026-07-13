# PRD：中文拼音模糊搜索

**版本**：v1.0  
**日期**：2026-07-11  
**状态**：已完成（P0+P1+P2 全部实现）  
**目标版本**：v1.11.0  
**涉及模块**：js/search-parser.js / popup.html / search-window.html / js/popup.js / js/search-window.js  
**调研文档**：[pinyin-search-design.md](../research/pinyin-search-design.md)  
**交互演示**：[pinyin-search-demo.html](../demos/pinyin-search-demo.html)

---

## 一、需求背景

### 1.1 用户画像

本扩展的核心用户群体以中文用户为主：

- 收藏的网站大部分是中文（如"爱奇艺"、"配置中心 | 会员日历"、"知乎"、"掘金"等）
- 书签标题由用户手动设置，通常是中文名称
- 日常搜索时处于英文键盘状态（编程、浏览英文站点后），不想切换输入法

### 1.2 痛点分析

| 场景 | 现状 | 期望 |
|------|------|------|
| 用户收藏了"配置中心 \| 会员日历" | 必须切换到中文输入法输入"配置"才能搜到 | 输入 `pz` 或 `peizhi` 直接定位 |
| 用户收藏了"爱奇艺" | 必须输入精确中文"爱奇艺" | 输入 `iqy` 或 `aiqiyi` 即可 |
| 用户收藏了"网易云音乐" | 只能通过 URL 中的 `163` 搜到 | 输入 `wy` 或 `wangyiyun` 直接定位 |
| 用户记得拼音但记不清全名 | 搜不到 | 输入部分拼音 `zhifu` 找到"支付宝" |

### 1.3 Chrome 原生能力分析

| 功能 | Chrome 地址栏 | Chrome 书签管理器 | 本扩展（当前） |
|------|--------------|------------------|---------------|
| 文本精确匹配 | ✅ | ✅ | ✅ |
| 拼音首字母搜索 | ❌ | ❌ | ❌ |
| 拼音全拼搜索 | ❌ | ❌ | ❌ |
| 拼音混合搜索 | ❌ | ❌ | ❌ |

**结论**：Chrome 原生无任何拼音搜索能力，这是一个明确的差异化功能点。

---

## 二、需求目标

1. **拼音首字母匹配**：输入声母缩写即可匹配中文书签标题（如 `pzzx` → "配置中心"）
2. **拼音全拼匹配**：输入完整拼音可匹配（如 `peizhi` → "配置"）
3. **拼音混合匹配**：部分首字母+部分全拼也能匹配（如 `peizhizx` → "配置中心"）
4. **多音字支持**：如"长城"同时匹配 `changcheng` 和 `zhangcheng`
5. **与现有搜索完全兼容**：拼音搜索是 fallback，不影响现有的文本搜索、高级语法、平台快捷搜索等
6. **高亮定位**：拼音匹配的字符在搜索结果中正确高亮

---

## 三、功能需求

### 3.1 优先级定义

| 等级 | 含义 |
|------|------|
| P0 | 核心功能，本版本必须完成 |
| P1 | 重要功能，本版本尽量完成 |
| P2 | 增强功能，可后续版本迭代 |

---

### P0 - 核心功能

#### F1: 拼音匹配引擎集成

| 属性 | 说明 |
|------|------|
| **功能描述** | 集成 pinyin-match 库，为搜索提供拼音匹配能力 |
| **技术方案** | 引入 pinyin-match v1.2.10 的 dist/main.js（27KB） |
| **集成方式** | 放置于 `js/lib/pinyin-match.js`，通过 script 标签在 HTML 中引入 |
| **全局变量** | `window.PinyinMatch` |

**文件变更**：

| 文件 | 操作 | 说明 |
|------|------|------|
| `js/lib/pinyin-match.js` | 新增 | pinyin-match 库文件 |
| `popup.html` | 修改 | 新增 script 引入 |
| `search-window.html` | 修改 | 新增 script 引入 |

**引入位置**（在 search-parser.js 之前）：

```html
<script src="js/lib/pinyin-match.js"></script>
<script src="js/search-parser.js"></script>
```

---

#### F2: SearchParser 拼音匹配集成

| 属性 | 说明 |
|------|------|
| **功能描述** | 在关键字匹配逻辑中增加拼音 fallback |
| **触发条件** | 当文本精确匹配失败时，自动尝试拼音匹配 |
| **匹配范围** | 仅对 `title` 字段进行拼音匹配（URL 已是英文无需拼音）|
| **兼容性** | 不改变现有搜索行为，拼音匹配仅作为 fallback |

**匹配优先级**：

```
1. 文本精确匹配（title + url + filename）    [现有逻辑，不变]
2. 拼音匹配（仅 title）                       [新增 fallback]
```

**核心改动 — `SearchParser.matchAllKeywords()`**：

```javascript
// 检查每个关键字
for (const kw of keywords) {
  const textMatch = searchable.includes(kw.toLowerCase());
  if (!textMatch) {
    // 文本不匹配时，尝试拼音匹配 title
    const title = item.title || '';
    const pinyinResult = window.PinyinMatch?.match(title, kw);
    if (!pinyinResult) {
      return false;  // 文本和拼音都不匹配，排除该结果
    }
  }
}
```

**`PinyinMatch.match()` API 说明**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `input` | string | 目标字符串（书签标题） |
| `keyword` | string | 用户输入的拼音或文本 |
| **返回值** | `[number, number]` \| `false` | 匹配成功返回 `[起始索引, 结束索引]`，失败返回 `false` |

**匹配能力**：

| 输入 | 目标文本 | 结果 | 匹配类型 |
|------|---------|------|---------|
| `pzzx` | 配置中心 | `[0, 3]` | 首字母 |
| `peizhi` | 配置中心 | `[0, 1]` | 全拼（部分） |
| `peizhizhongxin` | 配置中心 | `[0, 3]` | 全拼（完整） |
| `peizhizx` | 配置中心 | `[0, 3]` | 混合 |
| `配置` | 配置中心 | `[0, 1]` | 原文（现有逻辑已处理） |

---

#### F3: 排除关键字的拼音匹配

| 属性 | 说明 |
|------|------|
| **功能描述** | 排除语法 `-keyword` 也需要支持拼音匹配 |
| **行为** | `-pzzx` 排除标题拼音首字母为 pzzx 的结果 |
| **优先级** | P0（与核心匹配逻辑一致） |

**改动点 — 排除逻辑中也增加拼音判断**：

```javascript
// 排除关键字检查
for (const kw of excludeKeywords) {
  if (searchable.includes(kw.toLowerCase())) {
    return false;  // 文本匹配则排除
  }
  // 拼音排除
  const title = item.title || '';
  if (window.PinyinMatch?.match(title, kw)) {
    return false;  // 拼音匹配也排除
  }
}
```

---

### P1 - 重要功能

#### F4: 搜索结果拼音高亮

| 属性 | 说明 |
|------|------|
| **功能描述** | 当结果通过拼音匹配命中时，高亮对应的中文字符 |
| **实现方式** | 利用 `PinyinMatch.match()` 返回的 `[start, end]` 位置信息 |
| **展示效果** | 输入 `pzzx` → "<mark>配置中心</mark> \| 会员日历" |

**高亮逻辑**：

```javascript
function highlightTitle(title, query) {
  // 1. 先尝试文本高亮（现有逻辑）
  const textIdx = title.toLowerCase().indexOf(query.toLowerCase());
  if (textIdx !== -1) {
    return textHighlight(title, textIdx, query.length);
  }
  
  // 2. 尝试拼音高亮（新增）
  const pinyinResult = window.PinyinMatch?.match(title, query);
  if (pinyinResult) {
    const [start, end] = pinyinResult;
    const before = escapeHtml(title.substring(0, start));
    const match = escapeHtml(title.substring(start, end + 1));
    const after = escapeHtml(title.substring(end + 1));
    return `${before}<mark class="highlight">${match}</mark>${after}`;
  }
  
  return escapeHtml(title);
}
```

**文件变更**：

| 文件 | 说明 |
|------|------|
| `js/popup.js` | displayResults 中的高亮逻辑增强 |
| `js/search-window.js` | 同步增加拼音高亮 |

---

#### F5: SmartSort 拼音权重

| 属性 | 说明 |
|------|------|
| **功能描述** | 在智能排序中考虑拼音匹配质量 |
| **权重规则** | 文本精确匹配 > 拼音首字母 > 拼音全拼/混合 |
| **实现位置** | `js/smart-sort.js` 的相关度评分函数 |

**评分参考**：

| 匹配类型 | 权重加分 |
|---------|---------|
| title 文本精确匹配 | +1.0（现有） |
| url 文本匹配 | +0.8（现有） |
| title 拼音首字母完全匹配 | +0.7（新增） |
| title 拼音全拼完全匹配 | +0.6（新增） |
| title 拼音部分/混合匹配 | +0.4（新增） |

---

### P2 - 增强功能（后续迭代）

#### F6: tag 标签的拼音搜索

| 属性 | 说明 |
|------|------|
| **功能描述** | `tag:gongzuo` 匹配标签"工作" |
| **依赖** | 标签系统已实现 |
| **迭代理由** | 标签通常较短且数量有限，优先级不高 |

#### F7: 模糊容错搜索

| 属性 | 说明 |
|------|------|
| **功能描述** | 允许 1-2 个拼写错误仍能匹配（如 `peizi` → "配置"） |
| **方案** | 在拼音匹配后增加编辑距离校验层 |
| **迭代理由** | 性能开销较大（O(n*m) 编辑距离），需评估实际需求频次 |

#### F8: 文件夹名拼音搜索

| 属性 | 说明 |
|------|------|
| **功能描述** | 对书签文件夹路径也进行拼音匹配 |
| **场景** | 用户通过文件夹名定位（如 `gongju` → "工具"文件夹下的书签） |
| **迭代理由** | 需要先确认文件夹路径在搜索中的权重定位 |

---

## 四、技术设计

### 4.1 依赖引入

**库选型**：[pinyin-match](https://github.com/xmflswood/pinyin-match) v1.2.10

| 属性 | 值 |
|------|-----|
| 文件 | `dist/main.js` |
| 体积 | 27KB（gzip ~19KB） |
| 依赖 | 0 |
| 字典 | 6763 常用简体汉字 |
| 多音字 | 支持 |
| 许可证 | MIT |

**放置路径**：`js/lib/pinyin-match.js`

### 4.2 改动文件清单

| 文件 | 操作 | 改动说明 |
|------|------|---------|
| `js/lib/pinyin-match.js` | **新增** | pinyin-match 库 |
| `js/search-parser.js` | **修改** | matchAllKeywords 增加拼音 fallback |
| `popup.html` | **修改** | 新增 script 引入 pinyin-match |
| `search-window.html` | **修改** | 新增 script 引入 pinyin-match |
| `js/popup.js` | **修改** | 高亮函数增强（P1） |
| `js/search-window.js` | **修改** | 高亮函数增强（P1） |
| `js/smart-sort.js` | **修改** | 拼音权重评分（P1） |

### 4.3 不涉及的文件

| 文件 | 原因 |
|------|------|
| `manifest.json` | 不需要新权限 |
| `background.js` | 拼音匹配在前端完成 |
| `options.html` / `js/options.js` | 不增加设置开关（默认开启） |
| `js/settings.js` | 不增加新设置项 |
| `css/*.css` | 高亮复用现有 `.highlight` 样式 |

### 4.4 性能评估

| 指标 | 预期 | 说明 |
|------|------|------|
| 单次匹配耗时 | < 0.1ms | pinyin-match 内部字典 O(1) 查找 |
| 1000 书签全量搜索 | < 100ms | 仅在文本匹配失败时触发拼音匹配 |
| 扩展加载增量 | +27KB | 一次性加载，后续无额外请求 |
| 内存增量 | ~200KB | 拼音字典加载到内存 |

### 4.5 兼容性保证

拼音搜索作为 fallback，遵循以下原则：

1. **不改变现有行为**：文本能匹配的情况下，不走拼音路径
2. **优雅降级**：如果 `window.PinyinMatch` 不存在（加载失败），静默回退到纯文本搜索
3. **语法兼容**：所有高级搜索语法（`site:`、`type:`、`tag:`、`after:`、`before:`、`in:`、排除语法）与拼音搜索互不干扰
4. **多关键字兼容**：多个关键字中，每个关键字独立判断（文本 OR 拼音匹配均可）

```javascript
// 防御式编码示例
const pinyinResult = window.PinyinMatch?.match(title, kw);
// PinyinMatch 未加载时自动跳过，不报错
```

---

## 五、验收标准

### 5.1 P0 功能验收

| # | 测试用例 | 输入 | 期望结果 |
|---|---------|------|---------|
| 1 | 首字母搜索 | `pzzx` | 匹配"配置中心 \| 会员日历" |
| 2 | 首字母搜索 | `iqy` | 匹配"爱奇艺" |
| 3 | 首字母搜索 | `wy` | 匹配"网易云音乐"、"网易邮箱"等 |
| 4 | 全拼搜索 | `peizhi` | 匹配"配置中心 \| 会员日历" |
| 5 | 全拼搜索 | `zhifubao` | 匹配"支付宝" |
| 6 | 混合搜索 | `peizhizx` | 匹配"配置中心" |
| 7 | 多音字 | `chongqing` | 匹配"重庆"相关书签 |
| 8 | 多音字 | `zhangcheng` 或 `changcheng` | 匹配"长城"相关书签 |
| 9 | 中英混合 | `pzzx huiyuan` | 匹配标题同时包含"配置中心"和"会员"的书签 |
| 10 | 现有文本搜索不受影响 | `github` | 正常匹配 URL/标题含 github 的书签 |
| 11 | 高级语法兼容 | `site:iqiyi.com pzzx` | 限定 iqiyi.com 且标题匹配"配置中心" |
| 12 | 排除语法 | `wy -yinyue` | 匹配"网易"相关但排除"音乐"相关 |
| 13 | 排除语法拼音 | `-pzzx` | 排除标题为"配置中心"的结果 |
| 14 | PinyinMatch 未加载 | 删除 pinyin-match.js 后搜索 | 不报错，回退到纯文本搜索 |

### 5.2 P1 功能验收

| # | 测试用例 | 输入 | 期望结果 |
|---|---------|------|---------|
| 15 | 拼音高亮 | `pzzx` | "**配置中心**" 四个字高亮 |
| 16 | 文本高亮优先 | `配置` | "**配置**中心" 精确高亮（不走拼音路径） |
| 17 | 排序权重 | `pz` | 标题首字母为 pz 的结果排在 URL 包含 pz 的前面 |

### 5.3 回归测试

以下现有功能在拼音搜索上线后必须正常：

- [ ] 多关键字 AND 搜索
- [ ] 精确匹配（引号语法）
- [ ] 排除语法（`-keyword`）
- [ ] `site:` / `type:` / `in:` / `after:` / `before:` / `tag:` 语法
- [ ] 平台快捷搜索（`gh:` / `bd:` 等前缀）
- [ ] Tabs / History / Downloads 模式搜索
- [ ] AI 搜索模式不受影响
- [ ] 深色/浅色主题下高亮样式正常

---

## 六、实施计划

### 6.1 阶段拆分

| 阶段 | 内容 | 产出 |
|------|------|------|
| **Phase 1** | 引入 pinyin-match + SearchParser 集成 | 拼音搜索基本可用 |
| **Phase 2** | 搜索结果拼音高亮 | 用户可视化感知拼音匹配 |
| **Phase 3** | SmartSort 拼音权重 | 排序结果更合理 |

### 6.2 Phase 1 实施步骤

```
1. 下载 pinyin-match dist/main.js → js/lib/pinyin-match.js
2. popup.html 增加 <script src="js/lib/pinyin-match.js">
3. search-window.html 增加 <script src="js/lib/pinyin-match.js">
4. 修改 js/search-parser.js：
   - matchAllKeywords() 中 keywords 循环增加拼音 fallback
   - excludeKeywords 循环增加拼音排除
5. 验证 P0 测试用例全部通过
```

### 6.3 Phase 2 实施步骤

```
1. js/popup.js 的 displayResults 中高亮逻辑增强
2. js/search-window.js 同步修改
3. 验证 P1 高亮测试用例
```

### 6.4 Phase 3 实施步骤

```
1. js/smart-sort.js 增加拼音匹配权重计算
2. 调整排序结果，验证合理性
```

---

## 七、设计决策记录

| 决策 | 选项 | 决定 | 理由 |
|------|------|------|------|
| 拼音库选型 | pinyin-match / pinyin-pro / 自建 | **pinyin-match** | 体积最小(27KB)、功能精准、零依赖 |
| 匹配范围 | title / title+url / 全部 | **仅 title** | URL 已是英文无需拼音；filename 中文少见 |
| 设置开关 | 加开关 / 默认开启 | **默认开启无开关** | 零副作用(英文不触发)、fallback 不影响现有行为 |
| 模糊容错 | V1 做 / 后续做 | **后续迭代** | 性能开销大、核心需求是精确拼音匹配 |
| 多音字 | 枚举所有 / 智能选择 | **枚举所有** | pinyin-match 默认行为，搜索场景宁多勿漏 |

---

## 八、风险与应对

| 风险 | 影响 | 应对 |
|------|------|------|
| pinyin-match 字典不覆盖生僻字 | 极少数书签标题无法拼音匹配 | 6763 常用字覆盖 99%+ 日常用字；后续可考虑升级完整版(86KB) |
| 多音字导致误匹配 | 搜索结果偏多 | 可接受，宁多勿漏；通过 SmartSort 权重排序缓解 |
| 性能影响 | 大量书签时搜索变慢 | 拼音仅在文本不匹配时触发；已有 debounce 保护 |
| pinyin-match 停止维护 | 后续无 bug 修复 | 库已稳定(7年历史)；必要时可替换为 pinyin-pro |

---

## 九、后续迭代方向

以下功能不在本版本范围内，但记录于此供后续参考：

1. **模糊容错**（编辑距离 ≤ 1）— 需评估性能和用户实际需求
2. **标签拼音搜索** — `tag:` 语法中支持拼音
3. **文件夹路径拼音** — 搜索时对文件夹名做拼音匹配
4. **拼音补全提示** — 输入 `pe` 时提示 `peizhi（配置）`、`peiyang（培养）`
5. **繁体字支持** — 引入 pinyin-match 繁体版(86KB)

---

*文档创建: 2026-07-11*  
*最后更新: 2026-07-13*  
*实现完成: 2026-07-13（Phase 1-3 全部完成，21/21 测试通过）*
