---
name: chrome-extension-dev
description: Chrome 书签搜索扩展开发辅助。用于添加新搜索语法、排序方式、设置项，以及调试和发布扩展。当用户提到"添加搜索语法"、"新增排序"、"调试扩展"、"发布版本"时使用。
---

# Chrome Bookmarks Search 开发辅助

## 快速参考

### 项目结构

```
chrome-bookmarks-search/
├── manifest.json          # 扩展配置 (Manifest V3)
├── popup.html             # 弹出窗口 HTML
├── background.js          # Service Worker
├── js/
│   ├── popup.js           # 主逻辑（1000+ 行）
│   ├── search-parser.js   # 搜索语法解析器
│   ├── smart-sort.js      # 智能排序模块
│   └── settings.js        # 设置管理
└── css/popup.css          # 样式（含主题变量）
```

---

## 添加新搜索语法

在 `js/search-parser.js` 中扩展 `COMMANDS` 对象：

```javascript
static COMMANDS = {
  // 现有命令: site, type, in, after, before
  
  // 添加新命令示例：folder: 语法
  folder: {
    regex: /folder:([^\s]+)/,
    process: (value, item) => {
      // value: 用户输入的值（如 "工作"）
      // item: 当前搜索项
      // 返回 true 保留，false 过滤掉
      return item.parentFolder?.includes(value) || false;
    }
  }
};
```

### 命令结构

| 属性 | 说明 |
|------|------|
| `regex` | 匹配语法的正则，捕获组为值 |
| `process` | 过滤函数，参数: (value, item, searchText) |

### 可用 item 属性

- 书签: `title`, `url`, `dateAdded`, `parentId`
- 历史: `title`, `url`, `lastVisitTime`, `visitCount`
- 下载: `filename`, `url`, `startTime`, `fileSize`
- 标签页: `title`, `url`, `id`, `windowId`

---

## 添加新排序方式

在 `js/smart-sort.js` 中扩展：

### 1. 添加分数计算函数

```javascript
static getCustomScore(item) {
  // 返回 0-1 之间的分数
  const someMetric = item.someValue || 0;
  const maxValue = 100;
  return Math.min(1, someMetric / maxValue);
}
```

### 2. 在 sort() 中添加 case

```javascript
static sort(items, options = {}) {
  const getScore = (item) => {
    switch (mode) {
      case 'custom':  // 新增
        return this.getCustomScore(item);
      case 'time':
        return this.getTimeScore(item);
      // ...
    }
  };
}
```

### 3. 在 popup.html 添加按钮

```html
<button class="sort-btn" data-sort="custom" title="自定义排序">
  <svg>...</svg>
</button>
```

---

## 添加新设置项

### 1. 在 settings.js 添加默认值

```javascript
const DEFAULT_SETTINGS = {
  theme: 'system',
  fontSize: 'medium',
  // 新增设置
  newSetting: 'defaultValue'
};
```

### 2. 在 popup.html 添加 UI

```html
<div class="settings-section">
  <div class="settings-section-title">新设置</div>
  <div class="settings-option">
    <input type="radio" name="newSetting" id="option1" value="value1">
    <label for="option1">选项1</label>
  </div>
</div>
```

### 3. 在 popup.js 中处理

```javascript
// 初始化时读取
document.querySelector(`input[name="newSetting"][value="${settings.newSetting}"]`).checked = true;

// 监听变化
case 'newSetting':
  settings.newSetting = target.value;
  break;
```

---

## 调试技巧

### 日志位置

| 脚本 | 日志查看方式 |
|------|-------------|
| popup.js | 右键扩展图标 → 检查弹出窗口 → Console |
| background.js | chrome://extensions/ → 详情 → 检查视图: Service Worker |

### 常用调试代码

```javascript
// 在 popup.js 中
console.log('搜索结果:', filteredResults);
console.log('当前设置:', await window.settings.get());
console.log('解析结果:', SearchParser.parse(searchText));
```

### 重新加载步骤

1. 修改代码
2. 打开 chrome://extensions/
3. 点击扩展卡片的刷新按钮
4. 关闭并重新打开 popup

---

## 版本发布流程

### 1. 更新版本号

```json
// manifest.json
{
  "version": "1.3.4"  // 更新版本号
}
```

### 2. 更新文档

- `PUBLISH.md`: 更新版本历史
- `ROADMAP.md`: 更新进度状态

### 3. 测试清单

- [ ] 书签搜索正常
- [ ] 标签页搜索正常
- [ ] 历史记录搜索正常
- [ ] 下载搜索正常
- [ ] 高级搜索语法正常
- [ ] 三种排序方式正常
- [ ] 深色/浅色主题切换正常
- [ ] 快捷键响应正常
- [ ] 批量操作正常
- [ ] 右键菜单正常

### 4. 打包发布

Chrome Web Store 要求：
- 准备 128x128 图标
- 准备 1280x800 或 640x400 截图
- 填写完整的描述和权限说明

---

## 常见问题

### Favicon 加载失败

检查 `popup.js` 中的 favicon 加载逻辑：

```javascript
// 优先使用 Chrome 扩展 API
img.src = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${url}`;

// 失败后使用 Google 服务
img.onerror = () => {
  img.src = `https://www.google.com/s2/favicons?domain=${url}`;
};
```

### 搜索结果为空

1. 检查 `SearchParser.filter()` 的正则匹配
2. 检查 `process` 函数返回值
3. 在控制台打印 `SearchParser.parse(query)` 查看解析结果

### 设置不生效

1. 检查 `chrome.storage.sync` 权限
2. 检查 `applySettings()` 是否被调用
3. 检查 CSS 变量是否正确应用

---

## 代码模板

### 新搜索命令模板

```javascript
newCommand: {
  regex: /cmd:([^\s]+)/,
  process: (value, item, searchText) => {
    try {
      // 你的过滤逻辑
      return true;
    } catch {
      return false;
    }
  }
}
```

### 新排序函数模板

```javascript
static getNewScore(item) {
  const metric = item.value || 0;
  const normalized = Math.min(1, metric / MAX_VALUE);
  return normalized;
}
```
