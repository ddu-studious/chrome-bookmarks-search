/**
 * Offscreen Document — 后台 DOM 解析
 *
 * Service Worker 无法访问 DOM API，此离屏文档提供 DOMParser 能力，
 * 接收 HTML 字符串并提取正文纯文本，完全静默、无可见 UI。
 */

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.target !== 'offscreen') return;

  if (msg.type === 'PARSE_HTML') {
    try {
      const text = extractMainContent(msg.html, msg.url);
      sendResponse({ ok: true, content: text });
    } catch (e) {
      sendResponse({ ok: false, error: e.message });
    }
    return true;
  }
});

function extractMainContent(html, url) {
  const doc = new DOMParser().parseFromString(html, 'text/html');

  doc.querySelectorAll('script, style, noscript, svg, nav, footer, header, aside, iframe, [role="banner"], [role="navigation"], [role="contentinfo"]')
    .forEach(el => el.remove());

  const selectors = ['article', 'main', '[role="main"]', '.post-content', '.article-content', '.entry-content', '#content'];
  let root = null;
  for (const sel of selectors) {
    root = doc.querySelector(sel);
    if (root && root.innerText.trim().length > 100) break;
    root = null;
  }
  if (!root) root = doc.body;

  const text = (root.innerText || root.textContent || '').replace(/\s+/g, ' ').trim();
  return text.slice(0, 5000);
}
