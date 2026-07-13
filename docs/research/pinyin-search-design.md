# 中文拼音搜索方案设计

## 需求分析

### 核心需求
1. **书签名称拼音搜索**：用户给书签设置了中文名称（如"配置中心 | 会员日历"），希望输入拼音时也能搜到
2. **首字母快速匹配**：输入 `pzzx` 应匹配到"配置中心"
3. **全拼匹配**：输入 `peizhi` 应匹配到"配置中心"
4. **与现有搜索兼容**：拼音搜索是增强，不影响现有的文本搜索、高级语法等

### 用户场景
- 收藏了大量中文网站，书签标题是中文
- 用户可能记得网站名但懒得切换输入法
- 用户在英文键盘下快速输入拼音定位书签

---

## 方案对比

| 维度 | 方案A: pinyin-match | 方案B: pinyin-pro | 方案C: 自建轻量字典 |
|------|---------------------|-------------------|---------------------|
| **体积** | ~27KB (gzip ~19KB) | ~315KB (gzip ~90KB) | ~25KB |
| **功能** | 纯匹配 | 转换+匹配+分词 | 按需 |
| **多音字** | 支持 | 支持(99.8%准确) | 基础 |
| **匹配方式** | 首字母+全拼+混合 | 首字母+全拼+混合 | 首字母+全拼 |
| **高亮支持** | 返回 [start,end] | 返回索引数组 | 需自行实现 |
| **维护** | 活跃 (2025.12) | 非常活跃 (2026.04) | 自维护 |
| **集成难度** | 低 | 低 | 中 |
| **NPM 周下载** | ~8K | ~473K | - |

---

## 推荐方案：pinyin-match

### 选择理由

1. **体积最适合 Chrome 扩展**
   - 简体版仅 27KB，gzip 约 19KB
   - 对比 pinyin-pro 的 315KB，体积小了 10 倍+
   - Chrome 扩展对总体积敏感，每次加载都需要读取

2. **功能精准匹配需求**
   - 我们不需要"汉字转拼音"功能，只需要"拼音匹配汉字"
   - pinyin-match 专注搜索匹配，不含多余功能
   - 返回匹配位置信息，可直接用于高亮

3. **零依赖、即插即用**
   - 一个 JS 文件引入即可
   - 全局导出 `PinyinMatch` 对象
   - API 极简：`PinyinMatch.match(text, keyword)` 返回 `[start, end]` 或 `false`

4. **多音字支持**
   - 内置完整多音字词典
   - "长城" → 支持 `changcheng` 和 `zhangcheng`
   - "重庆" → 支持 `chongqing` 和 `zhongqing`

### 备选方案

如果后续需要更高级的拼音能力（如音调标注、拼音注音显示），可以升级到 pinyin-pro。

---

## 实现设计

### 文件结构变更

```
js/
├── lib/
│   └── pinyin-match.js   # 新增：pinyin-match 库 (27KB)
├── search-parser.js       # 修改：增加拼音匹配分支
├── popup.js               # 无需修改
└── search-window.js       # 无需修改
```

### 核心改动点

#### 1. 引入 pinyin-match 库

```html
<!-- popup.html / search-window.html -->
<script src="js/lib/pinyin-match.js"></script>
<script src="js/search-parser.js"></script>
```

#### 2. 修改 SearchParser.matchAllKeywords

```javascript
static matchAllKeywords(item, exactMatches, keywords, inField, excludeExact, excludeKeywords) {
  // ... 现有排除逻辑不变 ...

  // 构建搜索目标
  let searchable;
  if (inField === 'title') {
    searchable = (item.title || '').toLowerCase();
  } else if (inField === 'url') {
    searchable = (item.url || '').toLowerCase();
  } else {
    searchable = [item.title || '', item.url || '', item.filename || ''].join(' ').toLowerCase();
  }

  // 检查精确匹配（保持不变）
  for (const exact of exactMatches) { ... }

  // 检查关键字：文本匹配 OR 拼音匹配
  for (const kw of keywords) {
    const textMatch = searchable.includes(kw.toLowerCase());
    if (!textMatch) {
      // 拼音 fallback：对 title 做拼音匹配
      const title = item.title || '';
      const pinyinResult = window.PinyinMatch?.match(title, kw);
      if (!pinyinResult) {
        return false;
      }
    }
  }

  return true;
}
```

#### 3. 搜索结果高亮增强

```javascript
// 利用 PinyinMatch 返回的位置信息做高亮
function highlightText(title, query) {
  // 先尝试文本匹配高亮
  const textIdx = title.toLowerCase().indexOf(query.toLowerCase());
  if (textIdx !== -1) {
    return textHighlight(title, textIdx, textIdx + query.length);
  }

  // 再尝试拼音匹配高亮
  const pinyinResult = window.PinyinMatch?.match(title, query);
  if (pinyinResult) {
    return pinyinHighlight(title, pinyinResult[0], pinyinResult[1]);
  }

  return escapeHtml(title);
}
```

### 匹配优先级

```
1. 精确文本匹配（现有逻辑）    → 最高优先级
2. URL 包含匹配（现有逻辑）    
3. 拼音首字母匹配             → 新增
4. 拼音全拼匹配               → 新增
5. 拼音混合匹配               → 新增（pinyin-match 自动处理）
```

### 性能考量

- pinyin-match 内部使用高效的字典查找，单次匹配耗时 < 0.1ms
- 1000 个书签全部拼音匹配：< 100ms（可接受）
- 已有 debounce 防抖（150ms），搜索性能无瓶颈
- 拼音匹配仅作为文本匹配失败时的 fallback，不增加正常搜索开销

### 设置项

是否需要添加开关让用户启用/禁用拼音搜索？

建议：**默认开启，不需要设置项**。理由：
- 拼音搜索是 fallback 逻辑，不影响现有搜索行为
- 27KB 的体积增加可忽略
- 对非中文用户无副作用（英文关键字不会触发拼音匹配路径）

---

## 同步检查清单

根据项目规范（04-three-ui-sync.mdc），本次改动涉及：

- [x] `popup.html` — 新增 `<script src="js/lib/pinyin-match.js">` 
- [x] `search-window.html` — 新增 `<script src="js/lib/pinyin-match.js">`
- [x] `js/search-parser.js` — matchAllKeywords 增加拼音分支
- [ ] `js/popup.js` — 高亮函数增强（可选）
- [ ] `js/search-window.js` — 高亮函数增强（可选）
- [ ] `background.js` — 无需改动
- [ ] `options.html` — 无需改动（建议不加开关）

---

## Demo

交互式演示页面：`docs/demos/pinyin-search-demo.html`

在浏览器中直接打开即可体验各种拼音搜索场景。

---

## 待确认事项

1. **是否需要模糊容错**？（如 `peizi` 匹配 `配置`）
   - pinyin-match 本身不支持模糊容错
   - 如需要，可在上层增加编辑距离算法，但性能开销较大
   - 建议 V1 不做，后续根据用户反馈决定

2. **匹配范围**？
   - 建议仅对 `title` 做拼音匹配
   - URL 已经是英文，无需拼音匹配
   - 文件名如果是中文也可以匹配

3. **排序权重**？
   - 文本精确匹配 > 拼音首字母匹配 > 拼音全拼匹配
   - 可在 SmartSort 中增加拼音匹配的权重分

---

*创建日期: 2026-07-08*
