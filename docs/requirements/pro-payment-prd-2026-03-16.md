# Chrome Bookmarks Search - Pro 会员付费功能 PRD

**文档版本**: v1.1  
**创建日期**: 2026-03-16  
**最后更新**: 2026-04-06  
**状态**: Phase 1 代码已就绪，Stripe 注册进行中  
**关联项目**: Chrome Bookmarks Search  
**基于调研**: [chrome-extension-payment-research.md](../research/chrome-extension-payment-research.md)  
**实操指南**: [stripe-extensionpay-setup-guide.md](../guides/stripe-extensionpay-setup-guide.md)

---

## 一、背景与目标

### 1.1 背景

Chrome Bookmarks Search 已完成核心搜索能力和 AI 智能搜索的开发，具备成熟的用户价值。AI 功能（Embedding、Rerank、摘要）依赖第三方 API，产生持续运营成本。当前 BYOK（用户自带 API Key）模式虽无成本，但限制了不具备技术背景的用户使用 AI 功能。

### 1.2 目标

- 为非技术用户提供**开箱即用的 AI 搜索体验**（无需自行申请 API Key）
- 建立可持续的**收入模型**，覆盖 API 调用成本并支持长期迭代
- 保持**基础功能永远免费**，维护用户信任和口碑

### 1.3 核心原则


| 原则      | 说明                           |
| ------- | ---------------------------- |
| 基础免费    | 书签/标签页/历史/下载搜索、高级语法、主题定制永远免费 |
| BYOK 免费 | 自带 API Key 的 AI 搜索永远免费       |
| Pro 增值  | 托管 API、批量功能、高级分析为 Pro 专属     |
| 隐私优先    | 所有数据本地处理，付费验证信息最小化           |


---

## 二、功能分层设计

### 2.1 免费层 vs Pro 层


| 功能                                      | 免费版        | Pro 版            |
| --------------------------------------- | ---------- | ---------------- |
| 书签/标签页/历史/下载搜索                          | ✅ 完整功能     | ✅                |
| 高级搜索语法 (site:/type:/in:/after:/before:) | ✅          | ✅                |
| UI 定制（主题、字体、风格、弹出面板大小）                  | ✅          | ✅                |
| 智能排序（相关度/时间/频率）                         | ✅          | ✅                |
| 批量操作（多选打开/复制）                           | ✅          | ✅                |
| 搜索引擎跳转                                  | ✅          | ✅                |
| AI 语义搜索（BYOK 模式）                        | ✅ 自带 Key   | ✅                |
| **AI 语义搜索（托管模式）**                       | ❌          | ✅ 开箱即用           |
| **书签健康检测**                              | ✅ 限 50 个/次 | ✅ 无限制            |
| **定期自动健康检测**                            | ❌          | ✅ 每周/每月          |
| **批量摘要生成**                              | ❌          | ✅                |
| **AI 重排序 (Rerank)**                     | ❌          | ✅                |
| **书签分析报告**                              | ❌          | ✅ 域名统计/重复检测/使用趋势 |
| **检测报告导出 (CSV)**                        | ❌          | ✅                |


### 2.2 免费版限制策略


| 功能           | 限制方式          | Pro 解锁     |
| ------------ | ------------- | ---------- |
| 健康检测         | 每次最多检测 50 个书签 | 无限制        |
| AI 搜索（无 Key） | 显示"Pro 专属"提示  | 托管 API Key |
| 批量摘要         | 不可用           | 完整功能       |
| Rerank       | 不可用           | 完整功能       |


---

## 三、支付方案

### 3.1 支付平台：ExtensionPay（首选）


| 项目   | 说明                                       |
| ---- | ---------------------------------------- |
| 平台   | [ExtensionPay](https://extensionpay.com) |
| 原理   | 基于 Stripe，专为 Chrome 扩展设计                 |
| 集成方式 | 本地 JS 库（ExtPay.js），符合 Manifest V3 CSP    |
| 需要后端 | 不需要                                      |
| 抽成   | 7% + Stripe 手续费                          |
| 多设备  | 支持，通过账号登录                                |
| 货币   | 135+ 种                                   |


**备选方案**：Lemon Squeezy（License Key 模式，适合全球税务合规需求更高的场景）

### 3.2 定价方案


| 方案  | 价格         | 折算月价  | 说明        |
| --- | ---------- | ----- | --------- |
| 月付  | $3.99/月    | $3.99 | 灵活试用      |
| 年付  | $29.99/年   | $2.50 | 优惠 37%，推荐 |
| 终身  | $59.99 一次性 | -     | 无后续费用     |


### 3.3 免费试用

- Pro 功能提供 **7 天免费试用**
- 试用期内享受所有 Pro 功能
- 试用结束后自动降级为免费版（不自动扣费）

---

## 四、技术实现方案

### 4.1 ExtensionPay 集成

#### 4.1.1 核心架构

```
用户点击 Pro 功能
    │
    ├─ 有 BYOK Key → 直接使用（免费）
    │
    └─ 无 Key → 检查 ExtPay 付费状态
         │
         ├─ 已付费 → 使用托管 API
         │
         └─ 未付费 → 显示升级引导
```

#### 4.1.2 代码集成点

**background.js**：

```javascript
import ExtPay from './ExtPay.js';
const extpay = ExtPay('chrome-bookmarks-search');
extpay.startBackground();
```

**Feature Gating（popup.js / search-window.js）**：

```javascript
async function checkProAccess() {
  const extpay = ExtPay('chrome-bookmarks-search');
  const user = await extpay.getUser();
  return user.paid;
}
```

**升级入口（settings-panel / options.html）**：

```javascript
async function openUpgradeDialog() {
  const extpay = ExtPay('chrome-bookmarks-search');
  extpay.openPaymentPage();
}
```

#### 4.1.3 文件改动清单


| 文件                    | 改动                                  |
| --------------------- | ----------------------------------- |
| `manifest.json`       | 无需修改（ExtPay.js 是本地文件）               |
| `background.js`       | 导入 ExtPay.js，调用 `startBackground()` |
| `js/popup.js`         | AI 搜索入口添加 Feature Gating            |
| `js/search-window.js` | 同 popup.js                          |
| `js/options.js`       | 添加 Pro 会员状态显示、升级按钮                  |
| `options.html`        | 添加 Pro 会员管理 section                 |
| `js/settings.js`      | 添加 Pro 状态缓存逻辑                       |
| `popup.html`          | 设置面板添加 Pro 状态显示                     |
| `search-window.html`  | 同 popup.html                        |
| `ExtPay.js`           | 新增文件，从 ExtensionPay 下载              |


### 4.2 托管 API 代理

Pro 用户的 AI 请求通过托管代理转发，避免暴露主 API Key。

#### 4.2.1 架构

```
Pro 用户 AI 请求
    │
    └─ 扩展发送请求 → Cloudflare Worker / Vercel Serverless
         │
         ├─ 验证 ExtPay 付费状态
         ├─ 检查使用额度
         └─ 转发到 Gemini/OpenAI API → 返回结果
```

#### 4.2.2 技术选型


| 项目     | 推荐方案                               |
| ------ | ---------------------------------- |
| 代理平台   | Cloudflare Workers（免费额度 100K 请求/天） |
| AI API | Gemini（免费额度大，成本低）                  |
| 身份验证   | ExtPay user token + 请求签名           |
| 速率限制   | 每用户 100 次/天 AI 搜索                  |


### 4.3 离线/降级策略


| 场景          | 处理方式                 |
| ----------- | -------------------- |
| 网络断开        | 缓存上次 Pro 状态（24 小时有效） |
| ExtPay 服务异常 | 使用缓存状态，不阻断免费功能       |
| 托管 API 异常   | 提示用户切换 BYOK 模式       |
| 额度用完        | 提示升级或切换 BYOK 模式      |


---

## 五、UI 设计要点

### 5.1 升级引导入口

1. **AI 搜索模式** — 未配置 Key 时显示"使用 Pro 托管 API"选项
2. **健康检测** — 检测到 >50 个书签时显示"升级 Pro 解锁无限制检测"
3. **设置面板** — 底部显示 Pro 状态和升级按钮
4. **Options 页面** — 侧边栏新增"Pro 会员"导航项

### 5.2 Pro 标识

- 搜索模式选择器旁显示 Pro 徽章
- Pro 功能按钮使用渐变色或特殊图标标识
- 避免过度营销打扰，保持简洁克制

### 5.3 付费页面体验

- 点击"升级 Pro" → ExtPay 弹出支付页面（由 ExtPay 托管）
- 支付成功后自动刷新状态，无需手动操作
- 支持取消订阅（通过 ExtPay 管理页面）

---

## 六、实施计划

### Phase 1：付费框架搭建（1-2 周）

- 注册 ExtensionPay 账户（手动）
- 在 ExtensionPay 注册扩展并设置价格方案（手动）
- 下载 ExtPay.js，集成到 background.js
- 实现 `checkProAccess()` 工具函数（js/pro.js）
- 在 options.html 添加 Pro 会员 section（含状态卡片、定价、功能对比、账户管理）
- 实现 Feature Gating：健康检测 50 个上限
- AI 搜索 Feature Gating（popup.js + search-window.js）
- Pro 徽章标识（popup.html + search-window.html）
- 更新 Chrome Web Store 描述（标注付费功能）（手动）

### Phase 2：托管 API 搭建（2-3 周）

- 搭建 Cloudflare Worker 代理（手动）
- 实现 API Key 管理和用户鉴权
- 实现速率限制和额度管理
- 扩展中添加托管 API 模式切换
- 实现 Pro 用户免配置 AI 搜索流程

### Phase 3：付费体验优化（1-2 周）

- 实现 7 天免费试用（ExtPay openTrialPage 已集成）
- 添加使用额度展示 UI（依赖 Phase 2 托管 API）
- 添加 Pro 到期提醒
- 实现年付/终身优惠展示（定价卡片已实现）
- 收集用户反馈优化定价

### Phase 4：高级 Pro 功能（2-3 周）

- 定期自动健康检测（chrome.alarms）
- 检测报告 CSV 导出
- 重复书签检测
- 域名统计分析
- 书签使用趋势图表

---

## 七、Chrome Web Store 合规要求

### 7.1 必须满足的要求

- 扩展描述中清晰标注免费和付费功能的区别
- 不得在安装后突然弹出付费页面
- 隐私政策更新：说明付费相关数据处理（ExtPay 账号、付费状态）
- 所有付费功能在免费版中需可见（显示锁定/Pro 标签），不可隐藏

### 7.2 审核注意事项

- ExtPay.js 必须本地打包（不可远程加载），符合 MV3 CSP
- 付费验证使用 fetch API 调用 ExtensionPay 服务，这是允许的
- 不可在扩展内嵌入支付表单，必须跳转到 ExtPay 托管的支付页面

---

## 八、风险与应对


| 风险                | 概率  | 影响     | 应对                                    |
| ----------------- | --- | ------ | ------------------------------------- |
| 付费转化率低            | 中   | 低收入    | 从低价切入，逐步调整；保持 BYOK 吸引技术用户             |
| ExtensionPay 服务停摆 | 低   | 付费验证失败 | 本地缓存 Pro 状态 24h；准备 Lemon Squeezy 备选方案 |
| Chrome 审核拒绝       | 低   | 延迟上线   | 严格遵守合规要求，提前准备隐私政策                     |
| API 成本超出预期        | 中   | 利润受压   | 合理设置速率限制；优先使用 Gemini（免费额度大）           |
| 用户对付费反感           | 中   | 差评流失   | 保持核心功能免费；升级引导简洁非侵入式                   |


---

## 九、成功指标


| 指标      | 目标（上线 3 个月内）         |
| ------- | -------------------- |
| Pro 转化率 | ≥ 3% 活跃用户            |
| 月付留存率   | ≥ 70%（续费率）           |
| 用户评分    | 维持 ≥ 4.5 星（不因付费功能降分） |
| 退款率     | < 5%                 |
| 月收入     | 覆盖 API 成本 + 正利润      |


---

## 十、你需要做什么（开发者操作指南）

> 以下是按顺序需要**手动完成**的操作，代码实现部分可由 AI 辅助，但以下步骤必须人工操作。

### 10.1 注册与配置（Phase 1 前置条件）

#### Step 1: 注册 ExtensionPay 账户

1. 访问 [https://extensionpay.com](https://extensionpay.com)
2. 使用 Google 或 GitHub 账号注册
3. 完成 Stripe 连接（用于接收付款）

#### Step 2: 注册你的扩展

1. 在 ExtensionPay Dashboard 中点击 "New Extension"
2. 填写扩展 ID：`jahfbncfedahoolcjkeieeaflojpcgmc`（从 `chrome://extensions` 获取）
3. 设置定价方案：
  - Plan 1: Monthly $3.99
  - Plan 2: Yearly $29.99
  - Plan 3: Lifetime $59.99

#### Step 3: 下载 ExtPay.js

1. 在 Dashboard 中下载 `ExtPay.js` 文件
2. 将其放入项目根目录：`/ExtPay.js`
3. 确认文件大小约 10-20KB（纯 JS，无外部依赖）

#### Step 4: 更新隐私政策

1. 在你的 GitHub 仓库或个人网站创建隐私政策页面
2. 添加说明：扩展通过 ExtensionPay/Stripe 处理付费验证，不收集额外个人信息
3. 更新 Chrome Web Store 的隐私政策链接

### 10.2 搭建托管 API 代理（Phase 2 前置条件）

#### Step 5: 创建 Cloudflare Workers 项目

1. 注册 [Cloudflare](https://dash.cloudflare.com/) 账号（免费）
2. 创建 Worker 项目（如 `bookmarks-search-api`）
3. 配置环境变量：
  - `GEMINI_API_KEY`：你的 Gemini API Key
  - `EXTPAY_API_KEY`：ExtensionPay 提供的服务端验证 Key（如有）

#### Step 6: 申请 AI API Key（用于托管模式）

1. 访问 [Google AI Studio](https://aistudio.google.com/apikey) 获取 Gemini API Key
2. 该 Key 用于托管模式，由你的代理服务管理，不暴露给用户

### 10.3 发布准备（Phase 1 完成后）

#### Step 7: 更新 Chrome Web Store 描述

1. 在扩展描述中添加以下内容：
  ```
   免费功能：
   - 书签/标签页/历史/下载搜索
   - 高级搜索语法
   - UI 主题定制
   - AI 搜索（需自行配置 API Key）

   Pro 功能（可选付费）：
   - 开箱即用的 AI 智能搜索
   - 无限制书签健康检测
   - 批量摘要生成
   - 高级分析报告
  ```

#### Step 8: 提交审核

1. 更新 `manifest.json` 版本号
2. 打包扩展并上传到 Chrome Web Store
3. 提交审核（通常 1-3 个工作日）

### 10.4 运营监控（持续）

#### Step 9: 监控付费数据

1. 在 ExtensionPay Dashboard 查看：
  - 付费用户数、收入、退款率
  - 活跃付费 vs 取消用户
2. 在 Cloudflare Dashboard 查看：
  - API 调用量、错误率
  - 用户额度使用情况

#### Step 10: 根据数据调整

- 如果转化率 < 1%：考虑降低价格或增加免费试用天数
- 如果退款率 > 10%：检查 Pro 功能的实际价值感知
- 如果 API 成本过高：调整速率限制或切换更经济的模型

---

**总结**：ExtensionPay 注册和 Cloudflare Workers 配置是需要你亲自操作的核心步骤，代码集成和 UI 实现可以交由 AI 辅助完成。建议从 Phase 1 开始，先完成最小可行的付费闭环（ExtensionPay + 健康检测限制），验证付费意愿后再投入 Phase 2 的托管 API 搭建。