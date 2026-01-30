# Chrome Bookmarks Search 项目上下文

## 项目信息

- **项目名称**: Chrome Bookmarks Search (Chrome 书签搜索扩展)
- **版本**: v1.3.3
- **类型**: Chrome Extension (Manifest V3)

## 技术栈

- **平台**: Chrome Extension (Manifest V3)
- **语言**: JavaScript (ES6+), HTML5, CSS3
- **Chrome APIs**: bookmarks, tabs, history, downloads, storage, favicon

## 核心功能

1. **书签搜索**: 搜索所有保存的书签
2. **标签页搜索**: 搜索当前打开的标签页
3. **历史记录搜索**: 搜索最近30天的浏览历史
4. **下载搜索**: 搜索下载的文件
5. **高级搜索语法**: site:、type:、in:、after:、before:
6. **智能排序**: 相关度、时间、访问频率
7. **主题切换**: 深色/浅色/跟随系统
8. **批量操作**: 多选打开、复制链接

## 关键文件路径

### 核心文件
- 配置文件: `manifest.json`
- 弹出窗口: `popup.html`
- 后台脚本: `background.js`

### JavaScript 模块
- 主逻辑: `js/popup.js`
- 设置管理: `js/settings.js`
- 搜索解析器: `js/search-parser.js`
- 智能排序: `js/smart-sort.js`

### 样式
- 主样式: `css/popup.css`

### 资源
- 图标: `icons/` (icon.svg, icon16.png, icon48.png, icon128.png)

## 常用命令

```bash
# 加载扩展到 Chrome
1. 打开 chrome://extensions/
2. 启用"开发者模式"
3. 点击"加载已解压的扩展程序"
4. 选择项目目录

# 重新加载（代码修改后）
在 chrome://extensions/ 点击扩展卡片上的刷新按钮

# 调试 Popup
右键扩展图标 -> 检查弹出窗口

# 调试 Service Worker
chrome://extensions/ -> 详情 -> 检查视图: Service Worker
```

## 搜索语法示例

```
# 限定网站
site:github.com react

# 文件类型
type:pdf javascript

# 搜索范围
in:title 会议
in:url github

# 时间过滤
after:2024-01 before:2024-06 报告

# 组合使用
site:github.com type:pdf in:title docs
```

## 快捷键

| 快捷键 | 功能 |
|--------|------|
| `Alt + B` | 打开扩展 |
| `↑/↓` | 上下选择结果 |
| `←/→` | 切换搜索模式 |
| `Enter` | 打开选中项 |
| `Esc` | 关闭弹窗 |
| `Ctrl/Cmd + Click` | 多选 |
| `Shift + Click` | 范围选择 |

## MCP 工具使用

- **Browser**: 测试扩展功能、验证 UI 交互
- **Sequential Thinking**: 分析复杂功能实现方案
- **GitHub**: 代码提交、版本管理

## 开发注意事项

1. **Manifest V3**: 使用 Service Worker 而非 Background Page
2. **权限最小化**: 只申请必要的权限
3. **本地处理**: 所有数据在本地处理，不传输到服务器
4. **主题支持**: 样式使用 CSS 变量，便于主题切换
5. **模块化**: 每个功能模块导出到 `window` 对象

## 版本发布

- 发布平台: Chrome Web Store
- 发布文档: `PUBLISH.md`
- 路线图: `ROADMAP.md`

## 项目路线图（当前进度）

### 已完成
- [x] v1.0.0 - 基础搜索功能
- [x] v1.1.0 - 深色模式、字体调节
- [x] v1.2.0 - 高级搜索语法、智能排序
- [x] v1.3.0 - 批量操作、右键菜单（部分）

### 进行中
- [ ] v1.3.x - 全局快捷键优化

### 规划中
- [ ] v1.4.0 - 智能推荐、上下文感知
