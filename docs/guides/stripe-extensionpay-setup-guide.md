# Stripe + ExtensionPay 付费能力构建指导

**创建日期**: 2026-04-06  
**状态**: 进行中  
**关联 PRD**: [pro-payment-prd-2026-03-16.md](../requirements/pro-payment-prd-2026-03-16.md)  
**关联调研**: [chrome-extension-payment-research.md](../research/chrome-extension-payment-research.md)

---

## 当前状态

### 已完成


| 项目                          | 状态  | 说明                                                        |
| --------------------------- | --- | --------------------------------------------------------- |
| ExtPay.js 集成到项目             | ✅   | `ExtPay.js` 文件已在项目根目录                                     |
| background.js 中初始化 ExtPay   | ✅   | `importScripts('ExtPay.js')` + `extpay.startBackground()` |
| Pro 状态检查 API                | ✅   | `CHECK_PRO_STATUS` 消息处理已实现                                |
| 付费/试用/登录页面打开 API            | ✅   | `OPEN_PAYMENT_PAGE`、`OPEN_TRIAL_PAGE`、`OPEN_LOGIN_PAGE`   |
| `js/pro.js` UI 模块           | ✅   | Pro 状态缓存、Feature Gating 函数、Badge HTML                     |
| options.html Pro 会员页面       | ✅   | 状态卡片、定价方案、功能对比表、恢复购买                                      |
| Feature Gating 逻辑           | ✅   | 健康检测、书签分析、CSV 导出、自动检测、AI 模式                               |
| popup/search-window AI 升级引导 | ✅   | 无 API Key 时的提示 UI                                         |


### 未完成（需要你手动操作）


| 项目                 | 状态    | 说明                |
| ------------------ | ----- | ----------------- |
| ExtensionPay 账户注册  | ❓ 待确认 | 需确认是否已注册          |
| Stripe Connect 账户  | ❌ 未完成 | 你提到还没完成 Stripe 注册 |
| ExtensionPay 中注册扩展 | ❓ 待确认 | 需在 Dashboard 中注册  |
| Stripe 身份验证 (KYC)  | ❌ 未完成 | 需完成后才能接收真实付款      |


### 当前临时措施

由于 Stripe 未注册完成，所有付费相关的 UI 入口已临时关闭：

- AI 模式 tab 上的 Pro badge 已移除
- options.html 中 Pro 会员导航和页面已隐藏
- 书签分析、CSV 导出、自动健康检测的 Pro 限制已移除
- 无 API Key 时 AI 模式显示"前往配置"而非"升级 Pro"

**付费功能恢复方法**：完成 Stripe 注册后，回滚这些临时改动即可恢复所有 Pro 门控。

---

## 完成 Stripe 注册的详细步骤

### Step 1: 注册 ExtensionPay 账户

1. 访问 [https://extensionpay.com/signup](https://extensionpay.com/signup)
2. 输入邮箱和密码注册（建议使用 Gmail 等国际邮箱）
3. 验证邮箱

> 如果你已注册过，直接登录 [https://extensionpay.com/home](https://extensionpay.com/home)

### Step 2: 在 ExtensionPay 注册你的扩展

1. 登录后访问 [https://extensionpay.com/home/register-extension](https://extensionpay.com/home/register-extension)
2. 填写以下信息：
  - **Extension name**: `Chrome Bookmarks Search`
  - **Extension ID**: `jahfbncfedahoolcjkeieeaflojpcgmc`（从 `chrome://extensions` 获取，发布后的 ID）
  - **Price**: 先设 `$3.99`（月付方案，后续可调整）
  - **Payment frequency**: `monthly recurring`
3. 注册完成后，记下分配的 **extension ID**（用于 `ExtPay('your-id')` 调用）

> **重要**: 当前代码中使用的是 `ExtPay('chrome-bookmarks-search')`。如果 ExtensionPay 分配的 ID 不同，需要更新以下文件中的 ID：
>
> - `background.js` 第 8 行
> - 确认 `ExtPay.js` 中无硬编码（通常不会）

### Step 3: 完成 Stripe Connect 注册

这是**最关键的步骤**，ExtensionPay 会引导你完成 Stripe 账户关联。

#### 方案 A: 香港个人账户（推荐，最快）

**前置准备**：

- 有效期内的中国大陆**护照**
- 香港个人银行账户（推荐以下线上银行，支持远程开户）：
  - **众安银行 (ZA Bank)**: 无需赴港，APP 远程开户
  - **天星银行 (Airstar Bank)**: 类似众安，线上开户
  - **汇丰 One**: 有实体网点但也支持线上申请
- 国内手机号（+86 可用）
- 国际邮箱（Gmail/Outlook）
- **稳定的境外网络环境**（全程必须使用香港或其他境外 IP）

**注册流程**：

1. 在 ExtensionPay Dashboard 中点击 **"Connect with Stripe"**（或类似链接）
2. 进入 Stripe 注册页面，选择地区：**中国香港 (Hong Kong)**
3. 选择账户类型：**Individual / Sole proprietor**（个人）
4. 填写个人信息：
  - 英文姓名（与护照一致）
  - 业务名称：`Chrome Bookmarks Search` 或你的开发者名称
  - 业务描述：`Chrome browser extension for bookmark search and management`
  - 业务网址：你的 GitHub 仓库页面或 Chrome Web Store 页面
5. 添加银行账户：
  - 银行名称
  - 账户持有人姓名
  - SWIFT 代码（如众安银行: `ZABNHKHH`）
  - 账号
6. 身份认证 (KYC)：
  - 上传护照照片（正面+信息页）
  - 部分情况需要人脸识别
7. 等待审核（通常当天到 2 个工作日）

**审核通过后**：

- ExtensionPay 会自动关联你的 Stripe 账户
- 在 ExtensionPay Dashboard 中可以看到 Stripe 状态变为 "Connected"
- 此时扩展的支付功能将自动从测试模式切换到正式模式

#### 方案 B: 美国个人账户（备选）

**前置准备**：

- ITIN（美国个人税号）— 需提前申请，预留 6-8 周
- 美国银行账户（如 Mercury、华美银行等）
- 美区 IP

> 此方案准备周期较长，建议优先考虑方案 A。

### Step 4: 测试支付流程

Stripe 账户审核期间，可以使用**测试模式**验证支付流程：

1. 在 Chrome 开发者模式中加载扩展
2. 打开扩展，触发付费功能（如打开 options → Pro 会员页）
3. 点击"升级 Pro"
4. 在弹出的支付页面中，使用空白信用卡信息 + 你注册 ExtensionPay 时的邮箱
5. 输入 ExtensionPay 密码，点击 "Pay"
6. 验证 `extpay.getUser()` 返回 `paid: true`

> **注意**: 测试模式下的数据不会出现在 Stripe Dashboard 中。

### Step 5: 设置定价方案

ExtensionPay 支持三种计费模式。根据 PRD 规划：


| 方案  | 频率       | 价格     | ExtensionPay 设置              |
| --- | -------- | ------ | ---------------------------- |
| 月付  | monthly  | $3.99  | `monthly recurring`, `$3.99` |
| 年付  | yearly   | $29.99 | `yearly recurring`, `$29.99` |
| 终身  | one-time | $59.99 | `one-time`, `$59.99`         |


> **注意**: ExtensionPay 每个注册的扩展只能设置**一种**定价方案。如果需要多种方案（月付/年付/终身），可能需要：
>
> 1. 注册多个扩展 ID（不推荐）
> 2. 使用 ExtensionPay 的自定义 pricing page
> 3. 先从一种方案开始（推荐从**年付**开始，性价比最佳）

### Step 6: 更新隐私政策

1. 在 GitHub 仓库或个人网站创建隐私政策页面，包含以下内容：

```
Privacy Policy for Chrome Bookmarks Search

Payment Processing:
This extension uses ExtensionPay (powered by Stripe) for payment processing.
When you purchase a Pro subscription, your payment information is handled 
directly by Stripe. We do not store your credit card details.

We only store:
- Your payment status (free/pro)
- Payment timestamp
- Trial start date (if applicable)

This information is used solely to determine which features you can access.
All bookmark data remains local to your browser and is never transmitted 
to any server.
```

1. 更新 Chrome Web Store 扩展详情页中的隐私政策链接

---

## 恢复付费功能（Stripe 注册完成后）

完成 Stripe 注册并测试通过后，需要恢复以下临时关闭的功能：

### 恢复清单


| 文件                    | 操作                             | 说明                                             |
| --------------------- | ------------------------------ | ---------------------------------------------- |
| `popup.html`          | 恢复 AI tab 中的 Pro badge         | `<span class="pro-badge-tab">Pro</span>`       |
| `search-window.html`  | 同上                             | 同上                                             |
| `options.html`        | 取消 Pro 会员导航和页面的 `display:none` | 移除 `style="display:none"`                      |
| `options.html`        | 恢复书签分析的 Pro 标记                 | 恢复 `<span class="pro-badge-inline">Pro</span>` |
| `options.html`        | 恢复定期自动检测的 Pro badge            | 同上                                             |
| `background.js`       | 恢复健康检测 50 限制                   | 恢复 Pro Feature Gating 代码                       |
| `background.js`       | 恢复书签分析 Pro 门控                  | 恢复 `extpay.getUser()` 检查                       |
| `background.js`       | 恢复自动健康检测 Pro 门控                | 恢复 `!user?.paid` 检查                            |
| `js/popup.js`         | 恢复 AI 升级提示                     | 改回 Pro 升级引导                                    |
| `js/search-window.js` | 同上                             | 同上                                             |
| `js/options.js`       | 恢复 CSV 导出 Pro 限制               | 恢复 `isPro` 检查                                  |
| `js/options.js`       | 恢复自动健康检测 Pro 限制                | 恢复 `isPro` 检查                                  |
| `js/options.js`       | 恢复书签分析 Pro 门控                  | 恢复 `initAnalysisSection` 中的 Pro 检查             |


> **建议**: 使用 Git 对比当前改动和改动前的版本，直接 revert 相关 commit 即可。

---

## 后续开发路线

### Phase 1: 付费框架上线（Stripe 注册完成后）

- 恢复所有 Pro 门控 UI 和逻辑
- 端到端测试支付流程（测试模式）
- 更新 Chrome Web Store 描述（标注免费 vs Pro 功能）
- 提交扩展审核
- 发布带 Pro 功能的新版本

### Phase 2: 托管 API 代理搭建

- 注册 Cloudflare 账号
- 创建 Worker 项目 `bookmarks-search-api`
- 实现 API 代理逻辑（请求转发 + 用户鉴权 + 速率限制）
- 获取 Gemini API Key 用于托管模式
- 扩展中添加托管 API 模式切换
- 实现 Pro 用户免配置 AI 搜索

### Phase 3: 付费体验优化

- 验证 7 天免费试用流程
- 添加使用额度展示（依赖 Phase 2）
- Pro 到期提醒优化
- 收集用户反馈调整定价

---

## 常见问题

### Q: 没有香港银行账户怎么办？

推荐申请**众安银行 (ZA Bank)**，支持远程开户：

1. 下载 ZA Bank APP
2. 使用大陆身份证 + 手机号注册
3. 完成视频认证
4. 通常 1-3 个工作日开户成功

### Q: ExtensionPay 的费用是多少？

- ExtensionPay 抽成：**7%**
- Stripe 支付处理费：信用卡 **3.4% + HK$2.35/笔**（香港账户）
- 总计：约 **10-11%** 每笔交易

### Q: 测试模式下如何模拟付费？

1. 以开发者模式加载扩展
2. 点击升级/付费按钮
3. 在支付页面输入你的 ExtensionPay 注册邮箱
4. 输入 ExtensionPay 密码（不需要真实信用卡信息）
5. 完成后 `user.paid` 会变为 `true`

### Q: 如果 Stripe 审核不通过怎么办？

常见拒绝原因和解决方案：

- **业务描述不清晰**: 补充详细的产品说明和网站链接
- **网站不可访问**: 确保提供的网址可以正常访问
- **身份信息不匹配**: 确保所有信息与护照一致
- **高风险行业**: 确认你的业务描述不涉及受限行业

### Q: ExtensionPay 只支持一种定价方案？

是的，每个注册的扩展 ID 对应一种价格配置。解决方案：

1. **先从年付开始**（$29.99/年，推荐方案）
2. 后续可以联系 ExtensionPay 支持切换
3. 或考虑迁移到 Lemon Squeezy（支持多方案）

### Q: 中国大陆 IP 能注册 Stripe 吗？

**不能**。全程需要使用境外 IP（香港、新加坡、美国等），否则可能导致：

- 注册页面无法加载
- 身份验证步骤中断
- 账户被标记为可疑

---

## 参考链接

- [ExtensionPay 官网](https://extensionpay.com)
- [ExtPay.js GitHub](https://github.com/Glench/ExtPay)
- [ExtensionPay 注册新扩展](https://extensionpay.com/home/register-extension)
- [Stripe 官网](https://stripe.com)
- [Stripe 支持的国家和地区](https://stripe.com/global)
- [众安银行 ZA Bank 开户](https://www.za.group/zh-cn/bank)
- [Chrome Web Store 开发者政策](https://developer.chrome.com/docs/webstore/program-policies)

---

**最后更新**: 2026-04-06