# Chrome 扩展 AI 功能付费模式调研报告

> 调研日期：2026-03-06
> 项目：Chrome Bookmarks Search
> 目标：评估将 AI 智能搜索能力做成付费功能的可行性和实现方案

---

## 一、行业现状

### 1.1 Chrome Web Store 内置支付已废弃

Chrome Web Store 的内置支付系统已被 Google 逐步淘汰，开发者必须通过外部支付平台自行管理计费。这反而带来了更大的灵活性——可以自由设定价格、实验定价策略、跨平台订阅等。

### 1.2 市场上扩展付费已成熟

多款 Chrome 扩展已成功实现付费变现：
- 通过 ExtensionPay 的扩展已产生了**数万美元**的收入
- FillApp（AI 表单填充）：免费 20 次/月，付费 $14.99-$29.99/月
- Chrome Pilot（AI 浏览器助手）：$99 一次性买断
- 各类 SEO/生产力工具普遍采用 $5-15/月的订阅模式

---

## 二、付费模式对比

### 2.1 四种主要模式

| 模式 | 说明 | 优点 | 缺点 | 适合场景 |
|------|------|------|------|----------|
| **Freemium** | 基础免费 + 高级付费 | 用户零门槛体验，转化自然 | 免费用户多、付费率低 | **最适合我们** |
| **订阅制** | 按月/年持续付费 | 持续收入、可预测 | 需要持续提供价值 | 有持续成本时（如 API 调用） |
| **一次性买断** | 付一次永久使用 | 用户心理负担小 | 无持续收入 | 无后端成本时 |
| **BYOK（自带 Key）** | 用户用自己的 API Key | 零成本运营 | 不产生收入 | **我们当前的模式** |

### 2.2 推荐方案：Freemium + 订阅制混合

考虑到我们的 AI 功能使用第三方 API（Gemini/OpenAI 等），建议：

**免费层**：
- 书签/标签页/历史/下载的普通搜索 — 完全免费
- AI 搜索 — BYOK 模式永久免费（用户自带 API Key）

**付费层**（Pro 版）：
- 提供托管 API Key（用户无需自行申请 API Key）
- 更高的 AI 搜索配额
- 批量摘要生成
- 高级 Rerank 重排序
- 未来的高级功能

**定价建议**：
- 月付：$4.99/月
- 年付：$39.99/年（约 $3.33/月，优惠 33%）

---

## 三、支付平台对比

### 3.1 四大候选平台

| 平台 | 类型 | 抽成 | 需要后端 | 难度 | 特色 |
|------|------|------|----------|------|------|
| **ExtensionPay** | 扩展专用 | 7% + Stripe 费用 | 不需要 | ★☆☆ | 最简单，3 行代码集成 |
| **Lemon Squeezy** | MoR（代销商） | 5-15% + 支付费用 | 不需要 | ★★☆ | 自动处理全球税务合规 |
| **Paddle** | MoR（代销商） | 5% + $0.50 | 不需要 | ★★☆ | 企业级方案，支持多币种 |
| **Stripe** | 支付处理 | 2.9% + $0.30 | **需要** | ★★★ | 最灵活，抽成最低 |

> MoR = Merchant of Record（代销商），替你处理税务、发票、退款等合规事务

### 3.2 推荐选择

**首选：ExtensionPay** — 理由：
- 专为 Chrome 扩展设计，无需任何后端服务器
- 集成极其简单（3 行核心代码）
- 基于 Stripe，安全可靠
- 支持一次性、月付、年付等多种计费方式
- 支持 135+ 种货币
- 用户通过账号登录验证，支持多设备

**备选：Lemon Squeezy** — 理由：
- 如果面向全球用户，它自动处理各国 VAT/销售税
- License Key 模式适合离线验证
- 提供完整的 API 用于验证和管理

---

## 四、技术实现方案

### 4.1 方案 A：ExtensionPay（推荐，最快落地）

**集成步骤**：

1. 注册 ExtensionPay 账户
2. 注册扩展并设置价格
3. 下载 ExtPay.js 库放入扩展目录
4. 修改代码

**核心代码**：

```javascript
// background.js
import ExtPay from './ExtPay.js';
const extpay = ExtPay('chrome-bookmarks-search');
extpay.startBackground();

// 任何需要检查付费状态的地方
const user = await extpay.getUser();
if (user.paid) {
  // 启用 Pro 功能
} else {
  // 显示免费版功能 / 引导升级
}
```

**Feature Gating 逻辑**：

```javascript
// js/search-window.js 或 js/popup.js 中
async function checkProAccess() {
  const extpay = ExtPay('chrome-bookmarks-search');
  const user = await extpay.getUser();
  return user.paid;
}

// AI 搜索模式入口
async function onAiSearchClick() {
  const settings = await getSettings();
  
  // BYOK 模式：有自己的 API Key，免费使用
  if (settings.intelligentSearch.aiApiKey) {
    doAiSearch();
    return;
  }
  
  // 托管模式：检查是否 Pro 用户
  const isPro = await checkProAccess();
  if (isPro) {
    doAiSearchWithHostedKey();
  } else {
    showUpgradePrompt();
  }
}
```

**Manifest V3 兼容性**：
- ExtPay.js 是本地打包的库，不违反远程代码限制
- 付费验证通过 fetch 调用 ExtensionPay API，完全符合 MV3 CSP

### 4.2 方案 B：Lemon Squeezy License Key

**集成步骤**：

1. 在 Lemon Squeezy 创建产品，启用 License Key
2. 用户购买后获得 License Key
3. 扩展中提供 License Key 输入界面
4. 调用 Lemon Squeezy API 验证

**核心代码**：

```javascript
// 验证 License Key
async function activateLicense(licenseKey) {
  const resp = await fetch('https://api.lemonsqueezy.com/v1/licenses/activate', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `license_key=${licenseKey}&instance_name=chrome-bookmarks-search`
  });
  const data = await resp.json();
  
  if (data.activated && data.meta.store_id === YOUR_STORE_ID) {
    // 保存到 chrome.storage.local
    await chrome.storage.local.set({
      license: {
        key: licenseKey,
        instanceId: data.instance.id,
        status: 'active',
        activatedAt: Date.now()
      }
    });
    return true;
  }
  return false;
}

// 定期验证（每天一次）
async function validateLicense() {
  const { license } = await chrome.storage.local.get('license');
  if (!license) return false;
  
  const resp = await fetch('https://api.lemonsqueezy.com/v1/licenses/validate', {
    method: 'POST',
    headers: { 'Accept': 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `license_key=${license.key}&instance_id=${license.instanceId}`
  });
  const data = await resp.json();
  return data.valid;
}
```

### 4.3 方案 C：纯 BYOK（零成本运营，当前方案）

保持现有模式，用户自带 API Key。这是很多 AI 扩展的做法（如 NWEB AI、SnapMind）：
- 优点：零运营成本，无付费门槛，用户数据完全本地化
- 缺点：不产生收入，有 API Key 门槛

---

## 五、推荐落地路径

### 阶段一：保持 BYOK + 增加付费提示（1-2 周）

- 保持当前 BYOK 模式不变
- 在 AI 搜索设置中增加"Pro 会员"入口
- 增加"使用托管 API（Pro）"选项，尚不可用，显示"即将推出"

### 阶段二：接入 ExtensionPay + 托管 API（2-4 周）

- 注册 ExtensionPay，集成 ExtPay.js
- 搭建轻量 API 代理（Cloudflare Workers / Vercel Serverless）
- Pro 用户通过代理调用 AI API，无需自备 Key
- 实现 Feature Gating：AI 搜索、批量摘要等 Pro 功能

### 阶段三：优化付费体验（持续）

- 添加免费试用期（7 天）
- 添加使用额度展示
- 添加年付优惠
- 收集用户反馈优化定价

---

## 六、关键注意事项

### 6.1 Chrome Web Store 政策

- 必须在扩展描述中清晰标注哪些功能需要付费
- 不能在付费后才告知用户需要订阅
- 隐私政策需更新，说明付费相关数据处理

### 6.2 技术风险

- **Manifest V3 CSP**：不能加载远程 JS，ExtPay.js 必须本地打包
- **Service Worker 生命周期**：后台验证需考虑 SW 可能被杀死
- **离线场景**：验证失败时的优雅降级（缓存上次验证结果）

### 6.3 定价策略

- 建议从低价开始（$3-5/月），后续根据价值逐步调整
- 年付给 30-40% 折扣以锁定用户
- BYOK 永远免费，这是核心竞争力和信任基础

---

## 七、竞品参考

| 扩展 | AI 功能 | 付费模式 | 价格 |
|------|---------|----------|------|
| FillApp | AI 表单填充 | 信用额度制 | $14.99-29.99/月 |
| Chrome Pilot | AI 浏览器助手 | 一次性买断 + BYOK | $99 |
| NWEB AI | ChatGPT/Gemini/Claude | 纯 BYOK | 免费 |
| SnapMind | AI 截图分析 | BYOK | 免费 |
| SurgeFlow | AI 网页自动化 | 免费试用 + 订阅 | 未公开 |

---

## 八、Pro 功能合集规划

> 更新于 2026-03-06，结合书签健康检测功能和市场调研

### 8.1 功能分层设计

| 层级 | 功能 | 免费 | Pro |
|------|------|------|-----|
| **基础搜索** | 书签/标签页/历史/下载搜索 | ✅ | ✅ |
| **高级语法** | site:/type:/in:/after:/before: | ✅ | ✅ |
| **UI 定制** | 主题切换、字体调节、快捷键 | ✅ | ✅ |
| **AI 搜索 (BYOK)** | 用自己的 API Key 做语义搜索 | ✅ | ✅ |
| **AI 搜索 (托管)** | 无需 Key，开箱即用的语义搜索 | ❌ | ✅ |
| **书签健康检测** | 基础检测（≤50 个书签） | ✅ | ✅ |
| **书签健康检测 Pro** | 无限制批量检测 + 定期自动检测 | ❌ | ✅ |
| **批量摘要生成** | AI 提取所有书签内容摘要 | ❌ | ✅ |
| **书签分析** | 使用趋势、域名统计、重复检测 | ❌ | ✅ |
| **高级 Rerank** | LLM 重排序提升搜索精度 | ❌ | ✅ |

### 8.2 书签健康检测 — 付费策略

**市场参考**：
- Bookmark Maestro: link health testing 在 Pro 中（$1.99/月, $9.99/年, $29.99 终身）
- KK Bookmark Checker: 免费但功能有限
- Bookmarks Checker: 免费但无高级分析

**我们的策略**：

- **免费层**：每次最多检测 50 个书签，手动触发
- **Pro 层**：
  - 无限制批量检测所有书签
  - 定期自动检测（通过 chrome.alarms，可设置每周/每月）
  - 检测报告导出（CSV）
  - 重复书签检测 + 清理
  - 书签域名统计分析

**理由**：书签健康检测是低成本功能（纯 HTTP 请求，无 API 费用），限制免费用量可以作为 Pro 入口的"钩子"——用户发现自己有数百个书签需要检测时，自然会考虑升级。

### 8.3 Pro 合集定价

| 方案 | 价格 | 说明 |
|------|------|------|
| 月付 | $3.99/月 | 灵活，按月使用 |
| 年付 | $29.99/年（$2.50/月） | 优惠 37%，推荐 |
| 终身 | $59.99 一次性 | 无后续费用 |

相比竞品 Bookmark Maestro（$29.99 终身），我们提供 AI 搜索 + 健康检测 + 摘要生成的组合包，定价 $59.99 终身具有竞争力。

### 8.4 落地优先级

| 阶段 | 内容 | 时间 |
|------|------|------|
| **P0** | 书签健康检测（已实现基础版） | ✅ 已完成 |
| **P1** | Offscreen 静默抓取改造（已实现） | ✅ 已完成 |
| **P2** | 接入 ExtensionPay + Feature Gating | 1-2 周 |
| **P3** | Pro 功能限制（健康检测 50 个上限） | 1 周 |
| **P4** | 托管 AI API 代理搭建 | 2 周 |
| **P5** | 定期自动检测 + 导出报告 | 1 周 |
| **P6** | 重复书签检测 + 域名分析 | 1 周 |

---

## 九、结论

**可以做付费，建议采用 Freemium + ExtensionPay 方案**：

1. **基础搜索永远免费** — 这是用户信任的基础
2. **BYOK AI 永远免费** — 自带 Key 的用户无需付费，这是差异化优势
3. **书签健康检测作为付费钩子** — 免费 50 个，Pro 无限制，低成本高感知价值
4. **托管 AI 作为核心 Pro 功能** — 用户不需要自己申请 API Key，一键开箱即用
5. **ExtensionPay 最快落地** — 3 行代码集成，无需搭建后端
6. **Pro 合集比单一功能更有价值感** — AI 搜索 + 健康检测 + 摘要 + 分析 = 完整的书签管理解决方案

预计可以在 4-6 周内完成 Pro 版的首版上线（含支付集成和所有 Pro 功能）。

---

*参考资料*：
- [ExtensionPay 官方文档](https://github.com/Glench/ExtPay)
- [Lemon Squeezy License API](https://docs.lemonsqueezy.com/guides/tutorials/license-keys)
- [Chrome Extension Monetization 2025](https://www.averagedevs.com/blog/monetize-chrome-extensions-2025)
- [How to Collect Payments 2026](https://www.extensionfast.com/blog/how-to-collect-payments-for-your-chrome-extension-in-2026)
- [Bookmark Maestro 定价](https://www.bookmark-maestro.com/pricing) — $1.99/月, $9.99/年, $29.99 终身
- [KK Bookmark Checker](https://bookmarks-checker-home.pages.dev/en) — 免费死链检测, 10,000+ 用户
- [Bookmark Link Checker](https://chromewebstore.google.com/detail/bookmark-link-checker/mhnbmcgigkemfoopbokmnnonblhiclgb) — 自动扫描 + CSV 导出
