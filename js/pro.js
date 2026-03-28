/**
 * Pro 会员状态管理模块
 * 
 * 通过 background.js 中的 ExtPay 实例检查付费状态，
 * 本模块负责在 UI 侧提供统一的 Pro 状态查询和缓存。
 */

const PRO_CACHE_KEY = 'proStatusCache';
const PRO_CACHE_TTL = 24 * 60 * 60 * 1000; // 24 小时缓存

const PRO_FEATURES = {
  HOSTED_AI: 'hosted_ai',
  UNLIMITED_HEALTH_CHECK: 'unlimited_health_check',
  BATCH_SUMMARY: 'batch_summary',
  RERANK: 'rerank',
  BOOKMARK_ANALYSIS: 'bookmark_analysis',
  AUTO_HEALTH_CHECK: 'auto_health_check',
  EXPORT_CSV: 'export_csv'
};

const FREE_HEALTH_CHECK_LIMIT = 50;

async function getProStatusFromBackground() {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'CHECK_PRO_STATUS' }, (response) => {
      if (chrome.runtime.lastError) {
        resolve(null);
        return;
      }
      resolve(response);
    });
  });
}

async function getCachedProStatus() {
  try {
    const result = await chrome.storage.local.get(PRO_CACHE_KEY);
    const cache = result[PRO_CACHE_KEY];
    if (cache && (Date.now() - cache.timestamp) < PRO_CACHE_TTL) {
      return cache;
    }
  } catch (e) {
    // ignore
  }
  return null;
}

async function setCachedProStatus(status) {
  try {
    await chrome.storage.local.set({
      [PRO_CACHE_KEY]: {
        ...status,
        timestamp: Date.now()
      }
    });
  } catch (e) {
    // ignore
  }
}

async function checkProAccess() {
  try {
    const response = await getProStatusFromBackground();
    if (response && response.ok) {
      const status = {
        isPro: response.paid || false,
        paidAt: response.paidAt || null,
        installedAt: response.installedAt || null,
        trialStartedAt: response.trialStartedAt || null
      };
      await setCachedProStatus(status);
      return status;
    }
  } catch (e) {
    // background 不可达，使用缓存
  }

  const cached = await getCachedProStatus();
  if (cached) {
    return {
      isPro: cached.isPro || false,
      paidAt: cached.paidAt || null,
      installedAt: cached.installedAt || null,
      trialStartedAt: cached.trialStartedAt || null
    };
  }

  return { isPro: false, paidAt: null, installedAt: null, trialStartedAt: null };
}

function canUseFeature(proStatus, feature) {
  if (proStatus.isPro) return true;

  switch (feature) {
    case PRO_FEATURES.HOSTED_AI:
    case PRO_FEATURES.BATCH_SUMMARY:
    case PRO_FEATURES.RERANK:
    case PRO_FEATURES.BOOKMARK_ANALYSIS:
    case PRO_FEATURES.AUTO_HEALTH_CHECK:
    case PRO_FEATURES.EXPORT_CSV:
      return false;
    case PRO_FEATURES.UNLIMITED_HEALTH_CHECK:
      return false;
    default:
      return true;
  }
}

function openPaymentPage() {
  chrome.runtime.sendMessage({ type: 'OPEN_PAYMENT_PAGE' });
}

function openTrialPage() {
  chrome.runtime.sendMessage({ type: 'OPEN_TRIAL_PAGE' });
}

function openLoginPage() {
  chrome.runtime.sendMessage({ type: 'OPEN_LOGIN_PAGE' });
}

function getProBadgeHTML(size = 'sm') {
  const cls = size === 'lg' ? 'pro-badge pro-badge-lg' : 'pro-badge';
  return `<span class="${cls}">Pro</span>`;
}

function getUpgradePromptHTML(featureName) {
  return `
    <div class="pro-upgrade-prompt">
      <div class="pro-upgrade-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="24" height="24">
          <path d="M12 2L2 7l10 5 10-5-10-5z"/>
          <path d="M2 17l10 5 10-5"/>
          <path d="M2 12l10 5 10-5"/>
        </svg>
      </div>
      <div class="pro-upgrade-text">
        <strong>${featureName}</strong> 是 Pro 专属功能
      </div>
      <div class="pro-upgrade-actions">
        <button class="btn btn-pro-upgrade" onclick="window.ProModule && window.ProModule.openPaymentPage()">升级 Pro</button>
        <button class="btn btn-pro-trial" onclick="window.ProModule && window.ProModule.openTrialPage()">免费试用 7 天</button>
      </div>
    </div>
  `;
}

window.ProModule = {
  checkProAccess,
  canUseFeature,
  openPaymentPage,
  openTrialPage,
  openLoginPage,
  getProBadgeHTML,
  getUpgradePromptHTML,
  PRO_FEATURES,
  FREE_HEALTH_CHECK_LIMIT
};
