/**
 * 书签健康检测模块（两阶段混合检测）
 *
 * 在 Service Worker (background.js) 中运行。
 *
 * 阶段 1：fetch 快速预筛（带 credentials 使用用户的 Cookie）
 * 阶段 2：对预筛出的问题 URL，用后台标签页做浏览器级精确验证
 *
 * 这样既保证了检测速度，又避免了"需要登录的页面被误判为死链"。
 */

const BookmarkHealth = (() => {
  'use strict';

  const STATUS = {
    OK: 'ok',
    REDIRECT: 'redirect',
    NOT_FOUND: 'not_found',
    SERVER_ERROR: 'server_error',
    TIMEOUT: 'timeout',
    NETWORK_ERROR: 'network_error',
    SSL_ERROR: 'ssl_error',
    SKIPPED: 'skipped'
  };

  const STATUS_LABELS = {
    [STATUS.OK]: '正常',
    [STATUS.REDIRECT]: '重定向',
    [STATUS.NOT_FOUND]: '未找到 (404)',
    [STATUS.SERVER_ERROR]: '服务器错误',
    [STATUS.TIMEOUT]: '超时',
    [STATUS.NETWORK_ERROR]: '网络错误',
    [STATUS.SSL_ERROR]: 'SSL 错误',
    [STATUS.SKIPPED]: '已跳过'
  };

  const DEFAULT_OPTIONS = {
    timeout: 8000,
    concurrency: 5,
    retries: 1,
    retryDelay: 1000,
    tabVerifyTimeout: 12000,
    tabConcurrency: 2
  };

  const SKIP_PREFIXES = [
    'chrome://', 'chrome-extension://', 'edge://', 'about:',
    'moz-extension://', 'file://', 'data:', 'blob:', 'javascript:',
    'chrome-error://', 'devtools://'
  ];

  const CORS_BLOCKED_HOSTS = [
    'chrome.google.com',
    'chromewebstore.google.com',
    'microsoftedge.microsoft.com',
    'addons.mozilla.org',
    'addons.opera.com'
  ];

  let state = {
    running: false,
    paused: false,
    progress: 0,
    total: 0,
    phase: 'idle',
    results: [],
    startedAt: null
  };

  function getStatus() {
    return { ...state, results: [...state.results] };
  }

  function pause() {
    if (state.running) state.paused = true;
  }

  function resume() {
    state.paused = false;
  }

  function stop() {
    state.running = false;
    state.paused = false;
  }

  function shouldSkipUrl(url) {
    if (!url || typeof url !== 'string') return true;
    const u = url.trim().toLowerCase();
    if (SKIP_PREFIXES.some(p => u.startsWith(p))) return true;
    try {
      const host = new URL(u).hostname;
      return CORS_BLOCKED_HOSTS.some(h => host === h || host.endsWith('.' + h));
    } catch {
      return false;
    }
  }

  function classifyError(error) {
    const msg = (error?.message || '').toLowerCase();
    if (msg.includes('timeout') || msg.includes('aborted')) return STATUS.TIMEOUT;
    if (msg.includes('ssl') || msg.includes('cert') || msg.includes('tls')) return STATUS.SSL_ERROR;
    return STATUS.NETWORK_ERROR;
  }

  function classifyStatus(httpStatus, redirected) {
    if (httpStatus >= 200 && httpStatus < 300) {
      return redirected ? STATUS.REDIRECT : STATUS.OK;
    }
    if (httpStatus === 301 || httpStatus === 302 || httpStatus === 307 || httpStatus === 308) {
      return STATUS.REDIRECT;
    }
    if (httpStatus === 404 || httpStatus === 410) return STATUS.NOT_FOUND;
    if (httpStatus >= 400 && httpStatus < 500) return STATUS.NOT_FOUND;
    if (httpStatus >= 500) return STATUS.SERVER_ERROR;
    return STATUS.NETWORK_ERROR;
  }

  // ==================== 阶段 1：fetch 快速检测（带 Cookie） ====================

  async function checkViaFetch(url, options) {
    const { timeout, retries, retryDelay } = { ...DEFAULT_OPTIONS, ...options };

    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), timeout);

        let resp;
        try {
          resp = await fetch(url, {
            method: 'HEAD',
            signal: controller.signal,
            redirect: 'follow',
            cache: 'no-store',
            credentials: 'include'
          });
        } catch (headErr) {
          if (!controller.signal.aborted) {
            resp = await fetch(url, {
              method: 'GET',
              signal: controller.signal,
              redirect: 'follow',
              cache: 'no-store',
              credentials: 'include',
              headers: { Range: 'bytes=0-0' }
            });
          } else {
            throw headErr;
          }
        }

        clearTimeout(timer);
        return {
          status: classifyStatus(resp.status, resp.redirected),
          httpStatus: resp.status,
          redirected: resp.redirected,
          finalUrl: resp.url || url
        };
      } catch (e) {
        if (attempt < retries) {
          await new Promise(r => setTimeout(r, retryDelay));
          continue;
        }
        return {
          status: classifyError(e),
          httpStatus: 0,
          error: e.message
        };
      }
    }
  }

  // ==================== 阶段 2：标签页浏览器级验证 ====================

  async function checkViaTab(url, options) {
    const timeoutMs = options?.tabVerifyTimeout || DEFAULT_OPTIONS.tabVerifyTimeout;
    let tabId = null;

    try {
      const tab = await chrome.tabs.create({ url, active: false });
      tabId = tab.id;

      const result = await new Promise((resolve) => {
        let resolved = false;
        const timer = setTimeout(() => {
          if (!resolved) { resolved = true; cleanup(); resolve({ status: STATUS.TIMEOUT }); }
        }, timeoutMs);

        function onError(details) {
          if (details.tabId !== tabId || details.frameId !== 0) return;
          if (!resolved) {
            resolved = true;
            cleanup();
            const errMsg = details.error || '';
            if (errMsg.includes('net::ERR_NAME_NOT_RESOLVED')) {
              resolve({ status: STATUS.NETWORK_ERROR, error: 'DNS 解析失败' });
            } else if (errMsg.includes('net::ERR_CONNECTION_REFUSED')) {
              resolve({ status: STATUS.NETWORK_ERROR, error: '连接被拒绝' });
            } else if (errMsg.includes('net::ERR_CERT') || errMsg.includes('net::ERR_SSL')) {
              resolve({ status: STATUS.SSL_ERROR, error: errMsg });
            } else if (errMsg.includes('net::ERR_TIMED_OUT')) {
              resolve({ status: STATUS.TIMEOUT, error: '连接超时' });
            } else if (errMsg.includes('net::ERR_ABORTED')) {
              resolve({ status: STATUS.OK, note: '导航被中断（可能是正常重定向）' });
            } else {
              resolve({ status: STATUS.NETWORK_ERROR, error: errMsg || '页面加载失败' });
            }
          }
        }

        function onCompleted(details) {
          if (details.tabId !== tabId || details.frameId !== 0) return;
          if (!resolved) {
            resolved = true;
            cleanup();
            resolve({ status: STATUS.OK });
          }
        }

        function onUpdated(updatedTabId, changeInfo, updatedTab) {
          if (updatedTabId !== tabId) return;
          if (changeInfo.status === 'complete') {
            const tabUrl = (updatedTab?.url || '').toLowerCase();
            if (tabUrl.startsWith('chrome-error://')) {
              if (!resolved) {
                resolved = true;
                cleanup();
                resolve({ status: STATUS.NETWORK_ERROR, error: '页面不可达' });
              }
            }
          }
        }

        function cleanup() {
          clearTimeout(timer);
          chrome.webNavigation.onErrorOccurred.removeListener(onError);
          chrome.webNavigation.onCompleted.removeListener(onCompleted);
          chrome.tabs.onUpdated.removeListener(onUpdated);
        }

        chrome.webNavigation.onErrorOccurred.addListener(onError);
        chrome.webNavigation.onCompleted.addListener(onCompleted);
        chrome.tabs.onUpdated.addListener(onUpdated);
      });

      return result;
    } catch (e) {
      return { status: STATUS.NETWORK_ERROR, error: e.message };
    } finally {
      if (tabId !== null) {
        try { await chrome.tabs.remove(tabId); } catch (_) {}
      }
    }
  }

  // ==================== 批量检测主流程 ====================

  async function runBatchCheck(bookmarks, options, onProgress) {
    if (state.running) throw new Error('检测已在运行中');

    const opts = { ...DEFAULT_OPTIONS, ...options };
    const toCheck = bookmarks.filter(b => !shouldSkipUrl(b.url));
    const skipped = bookmarks.filter(b => shouldSkipUrl(b.url));

    state = {
      running: true,
      paused: false,
      progress: 0,
      total: toCheck.length,
      phase: 'fetch',
      results: skipped.map(b => ({
        id: b.id, title: b.title, url: b.url,
        status: STATUS.SKIPPED, httpStatus: 0
      })),
      startedAt: Date.now()
    };

    // ---- 阶段 1：fetch 快速预筛 ----
    let idx = 0;
    const fetchResults = new Map();

    async function fetchWorker() {
      while (idx < toCheck.length) {
        if (state.paused) { await new Promise(r => setTimeout(r, 500)); continue; }
        if (!state.running) return;

        const i = idx++;
        if (i >= toCheck.length) return;
        const bm = toCheck[i];

        const result = await checkViaFetch(bm.url, opts);
        fetchResults.set(bm.id, { ...bm, ...result });

        state.progress++;
        if (onProgress) {
          onProgress({
            type: 'progress',
            phase: 'fetch',
            progress: state.progress,
            total: toCheck.length,
            current: { title: bm.title, url: bm.url, ...result }
          });
        }
      }
    }

    const fetchWorkers = Array.from({ length: opts.concurrency }, () => fetchWorker());
    await Promise.all(fetchWorkers);

    if (!state.running) {
      state.paused = false;
      return getResults();
    }

    // ---- 阶段 2：对问题 URL 做标签页二次验证 ----
    const problemStatuses = [STATUS.NOT_FOUND, STATUS.SERVER_ERROR, STATUS.NETWORK_ERROR, STATUS.SSL_ERROR];
    const needsVerify = [];
    for (const [id, r] of fetchResults) {
      if (problemStatuses.includes(r.status)) {
        needsVerify.push(r);
      } else {
        state.results.push(r);
      }
    }

    if (needsVerify.length > 0 && state.running) {
      state.phase = 'tab_verify';
      state.progress = 0;
      state.total = needsVerify.length;

      if (onProgress) {
        onProgress({
          type: 'phase_change',
          phase: 'tab_verify',
          total: needsVerify.length,
          message: `发现 ${needsVerify.length} 个可疑链接，使用浏览器环境验证中...`
        });
      }

      let verifyIdx = 0;

      async function tabWorker() {
        while (verifyIdx < needsVerify.length) {
          if (state.paused) { await new Promise(r => setTimeout(r, 500)); continue; }
          if (!state.running) return;

          const i = verifyIdx++;
          if (i >= needsVerify.length) return;
          const item = needsVerify[i];

          const tabResult = await checkViaTab(item.url, opts);

          const finalResult = {
            id: item.id,
            title: item.title,
            url: item.url,
            folderId: item.folderId || item.parentId,
            status: tabResult.status,
            httpStatus: item.httpStatus,
            error: tabResult.error || item.error,
            redirected: item.redirected,
            finalUrl: item.finalUrl,
            fetchStatus: item.status,
            tabVerified: true
          };

          state.results.push(finalResult);
          state.progress++;

          if (onProgress) {
            onProgress({
              type: state.progress === needsVerify.length ? 'complete' : 'progress',
              phase: 'tab_verify',
              progress: state.progress,
              total: needsVerify.length,
              current: { title: item.title, url: item.url, ...tabResult }
            });
          }
        }
      }

      const tabWorkers = Array.from({ length: opts.tabConcurrency }, () => tabWorker());
      await Promise.all(tabWorkers);
    } else if (state.running) {
      if (onProgress) {
        onProgress({ type: 'complete', phase: 'done', progress: 0, total: 0 });
      }
    }

    state.running = false;
    state.paused = false;
    state.phase = 'done';
    return getResults();
  }

  function getResults() {
    const results = state.results;
    const summary = {
      total: results.length,
      ok: results.filter(r => r.status === STATUS.OK).length,
      redirect: results.filter(r => r.status === STATUS.REDIRECT).length,
      not_found: results.filter(r => r.status === STATUS.NOT_FOUND).length,
      server_error: results.filter(r => r.status === STATUS.SERVER_ERROR).length,
      timeout: results.filter(r => r.status === STATUS.TIMEOUT).length,
      network_error: results.filter(r => r.status === STATUS.NETWORK_ERROR).length,
      ssl_error: results.filter(r => r.status === STATUS.SSL_ERROR).length,
      skipped: results.filter(r => r.status === STATUS.SKIPPED).length
    };
    return { results, summary };
  }

  return {
    STATUS,
    STATUS_LABELS,
    runBatchCheck,
    checkViaFetch,
    checkViaTab,
    getStatus,
    getResults,
    pause,
    resume,
    stop,
    shouldSkipUrl
  };
})();

if (typeof self !== 'undefined') {
  self.BookmarkHealth = BookmarkHealth;
}
