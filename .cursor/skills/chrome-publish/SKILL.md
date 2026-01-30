---
name: chrome-publish
description: Chrome 扩展发布流程辅助。用于打包扩展、更新版本号、生成版本说明、发布到 Chrome Web Store。当用户提到"发布"、"打包"、"上传到商店"、"更新版本"时使用。
---

# Chrome Extension 发布流程

## 快速发布（一键执行）

```bash
# 1. 运行打包脚本
./scripts/build.sh

# 输出文件: dist/chrome-bookmarks-search-v{版本号}.zip
```

---

## 完整发布流程

### Step 1: 更新版本号

修改 `manifest.json` 中的 version 字段：

```json
{
  "version": "1.x.x"
}
```

### Step 2: 更新变更日志

修改 `docs/changelog/CHANGELOG.md`，添加新版本记录：

```markdown
## [1.x.x] - YYYY-MM-DD

### 新增
- 功能描述

### 优化
- 优化描述

### 修复
- 修复描述
```

### Step 3: 更新发布说明

修改 `PUBLISH.md`，在版本历史中添加：

**英文版本：**
```markdown
### v1.x.x (YYYY-MM-DD) 🎯
- Feature description 1
- Feature description 2
```

**中文版本：**
```markdown
### v1.x.x (YYYY-MM-DD) 🎯
- 功能描述 1
- 功能描述 2
```

### Step 4: 执行打包

```bash
./scripts/build.sh
```

### Step 5: 上传到 Chrome Web Store

1. 打开 [Chrome Web Store 开发者控制台](https://chrome.google.com/webstore/devconsole)
2. 登录开发者账号
3. 选择扩展 "Chrome Bookmarks Search"
4. 点击「软件包」标签页
5. 点击「上传新软件包」
6. 选择 `dist/chrome-bookmarks-search-v{版本号}.zip`
7. 等待上传完成

### Step 6: 填写版本说明

在「商品详情」中更新：
- 简短描述（如有更改）
- 详细描述（如有更改）
- 版本说明

### Step 7: 提交审核

1. 确认所有信息正确
2. 点击「提交审核」
3. 等待 Google 审核（通常 1-3 个工作日）

---

## 发布检查清单

### 代码检查
- [ ] 所有功能测试通过
- [ ] 无控制台错误
- [ ] 深色/浅色模式正常
- [ ] 快捷键响应正常

### 版本号检查
- [ ] `manifest.json` 版本号已更新
- [ ] 版本号格式正确（x.y.z）
- [ ] 版本号大于当前已发布版本

### 文档检查
- [ ] `docs/changelog/CHANGELOG.md` 已更新
- [ ] `PUBLISH.md` 版本历史已更新
- [ ] 版本说明包含英文和中文

### 打包检查
- [ ] 运行 `./scripts/build.sh` 成功
- [ ] zip 包在 `dist/` 目录
- [ ] zip 包大小合理（通常 < 1MB）

### 发布检查
- [ ] 已登录开发者账号
- [ ] 扩展 ID 正确
- [ ] 上传成功
- [ ] 提交审核

---

## 版本说明模板

### 新功能版本（Minor: x.Y.0）

**英文：**
```
v1.4.0 brings exciting new features:
- Multi-keyword AND search for precise results
- Right-click delete for bookmarks, tabs, and history
- Improved context menu positioning

Enjoy the enhanced search experience!
```

**中文：**
```
v1.4.0 带来全新功能：
- 多关键字同时搜索，结果更精准
- 右键删除书签、标签页、历史记录
- 优化右键菜单定位

享受更强大的搜索体验！
```

### Bug 修复版本（Patch: x.y.Z）

**英文：**
```
v1.4.1 fixes:
- Fixed context menu being cut off at bottom
- Improved search performance

Thank you for your feedback!
```

**中文：**
```
v1.4.1 修复：
- 修复底部右键菜单被裁剪问题
- 优化搜索性能

感谢您的反馈！
```

---

## 常见问题

### 上传失败
- 检查 zip 包是否完整
- 确认 manifest.json 格式正确
- 版本号必须大于当前版本

### 审核被拒
- 检查权限声明是否完整
- 确认隐私政策链接有效
- 查看审核反馈邮件

### 发布后回滚
- Chrome Web Store 不支持直接回滚
- 需要上传旧版本的新版本号包
- 例如：1.4.0 有问题，上传 1.4.1 修复版
