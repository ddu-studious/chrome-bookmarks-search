# MCP 命令快捷方式

## 常用 MCP 工具

```json
{
  "cursor.commands": {
    "browser": "@cursor-ide-browser",
    "thinking": "@sequential-thinking",
    "git": "@github"
  }
}
```

## 使用示例

### 浏览器测试 (@cursor-ide-browser)

```
# 测试扩展功能
@browser 打开 chrome://extensions/ 加载扩展

# 验证 UI
@browser 测试搜索功能是否正常
@browser 验证深色模式切换
@browser 检查快捷键是否响应

# 调试
@browser 打开开发者工具查看控制台日志
```

### 复杂问题分析 (@sequential-thinking)

```
# 功能设计
@thinking 设计新的搜索语法实现方案
@thinking 分析智能排序算法优化

# 问题排查
@thinking 分析搜索结果不准确的可能原因
@thinking 排查 Favicon 加载失败问题

# 方案对比
@thinking 对比不同的多选实现方案
@thinking 评估性能优化策略
```

### Git 操作 (@github)

```
# 版本管理
@git 查看当前修改状态
@git 提交当前更改

# 发布相关
@git 创建新版本标签 v1.3.4
@git 查看版本提交历史
```

## Chrome 扩展开发专用命令

### 调试命令

```bash
# 查看扩展日志
# Popup: 右键扩展图标 -> 检查弹出窗口 -> Console
# Background: chrome://extensions/ -> 详情 -> 检查视图

# 重新加载扩展
# chrome://extensions/ -> 点击扩展卡片刷新按钮
```

### 常用 Chrome URLs

```
chrome://extensions/     # 扩展管理页面
chrome://bookmarks/      # 书签管理器
chrome://history/        # 历史记录
chrome://downloads/      # 下载内容
```

## 自动触发场景

AI 会根据上下文自动选择合适的 MCP 工具：

| 场景 | 自动使用工具 |
|------|-------------|
| 需要测试 UI 交互 | Browser |
| 复杂问题、多步骤分析 | Sequential Thinking |
| 版本管理、代码提交 | GitHub |

## 项目特定查询示例

### 搜索功能相关

```
@thinking 如何优化搜索结果的相关度排序
@thinking 分析 site: 语法的匹配逻辑
@thinking 设计新的时间过滤语法
```

### UI/UX 相关

```
@browser 测试深色模式下的对比度
@browser 验证快捷键提示的显示效果
@thinking 分析批量操作工具栏的 UX 优化方案
```

### 性能优化

```
@thinking 分析大量书签时的搜索性能
@thinking 评估 Favicon 缓存策略
@thinking 优化首次加载时间
```

## 组合使用示例

### 新增搜索语法

```
# 1. 分析实现方案
@thinking 设计 "folder:" 语法实现方案

# 2. 实现后测试
@browser 测试新语法功能是否正常

# 3. 提交代码
@git 提交新增 folder: 搜索语法
```

### 修复 Bug

```
# 1. 分析问题
@thinking 分析搜索结果为空的可能原因

# 2. 验证修复
@browser 测试修复后的搜索功能

# 3. 提交修复
@git 提交 Bug 修复
```

### 版本发布

```
# 1. 功能验证
@browser 全面测试所有功能

# 2. 更新版本
# 手动更新 manifest.json 和 PUBLISH.md

# 3. 提交发布
@git 创建版本标签并提交
```

## 快捷命令总结

| 命令 | 用途 | 示例 |
|------|------|------|
| `@browser` | 浏览器测试 | `@browser 测试搜索功能` |
| `@thinking` | 复杂问题分析 | `@thinking 设计新功能方案` |
| `@git` | Git 操作 | `@git 提交代码` |

---

**最后更新**: 2025-01-30
