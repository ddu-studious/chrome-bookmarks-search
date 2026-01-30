// Background script for handling extension events
chrome.runtime.onInstalled.addListener(() => {
  console.log('Chrome Bookmarks Search Extension installed');
});

// 处理消息
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'SEARCH_BOOKMARKS') {
    chrome.bookmarks.search(request.query)
      .then(results => sendResponse({ success: true, results }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true; // Will respond asynchronously
  }
});
