// 搜索引擎定义
const SEARCH_ENGINES = {
  google: { name: 'Google', url: 'https://www.google.com/search?q={query}' },
  baidu: { name: '百度', url: 'https://www.baidu.com/s?wd={query}' },
  bing: { name: 'Bing', url: 'https://www.bing.com/search?q={query}' },
  duckduckgo: { name: 'DuckDuckGo', url: 'https://duckduckgo.com/?q={query}' }
};

// 多平台快捷搜索注册表
const SEARCH_PLATFORMS = {
  g: { name: 'Google', url: 'https://www.google.com/search?q={query}', icon: 'google' },
  bd: { name: '百度', url: 'https://www.baidu.com/s?wd={query}', icon: 'baidu' },
  gh: { name: 'GitHub', url: 'https://github.com/search?q={query}&type=repositories', icon: 'github' },
  so: { name: 'Stack Overflow', url: 'https://stackoverflow.com/search?q={query}', icon: 'stackoverflow' },
  zh: { name: '知乎', url: 'https://www.zhihu.com/search?type=content&q={query}', icon: 'zhihu' },
  bl: { name: '哔哩哔哩', url: 'https://search.bilibili.com/all?keyword={query}', icon: 'bilibili' },
  yt: { name: 'YouTube', url: 'https://www.youtube.com/results?search_query={query}', icon: 'youtube' },
  npm: { name: 'NPM', url: 'https://www.npmjs.com/search?q={query}', icon: 'npm' },
  mdn: { name: 'MDN', url: 'https://developer.mozilla.org/search?q={query}', icon: 'mdn' },
  x: { name: 'Twitter/X', url: 'https://x.com/search?q={query}', icon: 'x' },
  rd: { name: 'Reddit', url: 'https://www.reddit.com/search/?q={query}', icon: 'reddit' },
  ph: { name: 'Product Hunt', url: 'https://www.producthunt.com/search?q={query}', icon: 'producthunt' }
};

const URL_PATTERN = /^(https?:\/\/|www\.)|(\w+\.(?:com|cn|org|net|io|dev|edu|gov|app|me|co)\b)/i;

function normalizeUrl(input) {
  if (/^https?:\/\//.test(input)) return input;
  if (input.startsWith('www.')) return 'https://' + input;
  if (URL_PATTERN.test(input)) return 'https://' + input;
  return null;
}

function getDefaultSearchEngine() {
  const lang = (typeof navigator !== 'undefined' && navigator.language) || 'en';
  return lang.startsWith('zh') ? 'baidu' : 'google';
}

// 域名分类映射表
const DOMAIN_CATEGORIES = {
  'github.com': '开发工具', 'gitlab.com': '开发工具', 'bitbucket.org': '开发工具',
  'stackoverflow.com': '开发工具', 'stackexchange.com': '开发工具',
  'codepen.io': '开发工具', 'codesandbox.io': '开发工具', 'replit.com': '开发工具',
  'npmjs.com': '开发工具', 'pypi.org': '开发工具', 'crates.io': '开发工具',
  'mdn.mozilla.org': '开发文档', 'developer.mozilla.org': '开发文档',
  'docs.python.org': '开发文档', 'devdocs.io': '开发文档',
  'w3schools.com': '开发文档', 'developer.apple.com': '开发文档',
  'cloud.google.com': '云服务', 'aws.amazon.com': '云服务', 'azure.microsoft.com': '云服务',
  'vercel.com': '云服务', 'netlify.com': '云服务', 'heroku.com': '云服务',
  'bilibili.com': '视频娱乐', 'youtube.com': '视频娱乐', 'youtu.be': '视频娱乐',
  'vimeo.com': '视频娱乐', 'twitch.tv': '视频娱乐', 'iqiyi.com': '视频娱乐',
  'zhihu.com': '知识社区', 'quora.com': '知识社区', 'reddit.com': '知识社区',
  'v2ex.com': '知识社区', 'segmentfault.com': '知识社区',
  'juejin.cn': '技术社区', 'csdn.net': '技术社区', 'cnblogs.com': '技术社区',
  'medium.com': '技术社区', 'dev.to': '技术社区', 'hashnode.com': '技术社区',
  'infoq.com': '技术社区', 'infoq.cn': '技术社区',
  'news.ycombinator.com': '科技资讯', '36kr.com': '科技资讯',
  'techcrunch.com': '科技资讯', 'theverge.com': '科技资讯', 'wired.com': '科技资讯',
  'producthunt.com': '科技资讯', 'huxiu.com': '科技资讯',
  'google.com': '搜索引擎', 'baidu.com': '搜索引擎', 'bing.com': '搜索引擎',
  'coursera.org': '在线教育', 'udemy.com': '在线教育', 'edx.org': '在线教育',
  'mooc.cn': '在线教育', 'khanacademy.org': '在线教育', 'codecademy.com': '在线教育',
  'figma.com': '设计工具', 'canva.com': '设计工具', 'dribbble.com': '设计工具',
  'behance.net': '设计工具', 'sketch.com': '设计工具',
  'twitter.com': '社交媒体', 'x.com': '社交媒体', 'facebook.com': '社交媒体',
  'instagram.com': '社交媒体', 'linkedin.com': '社交媒体', 'weibo.com': '社交媒体',
  'notion.so': '效率工具', 'trello.com': '效率工具', 'asana.com': '效率工具',
  'todoist.com': '效率工具', 'linear.app': '效率工具',
  'docs.google.com': '办公文档', 'sheets.google.com': '办公文档',
  'wikipedia.org': '百科参考', 'baike.baidu.com': '百科参考',
  'amazon.com': '购物', 'jd.com': '购物', 'taobao.com': '购物', 'tmall.com': '购物',
};

// 默认标签面板
const DEFAULT_TAG_PALETTE = ['工作', '学习', '待读', '前端', '后端', '设计', '工具', '新闻', '娱乐', '参考'];

// 默认设置
const DEFAULT_SETTINGS = {
  theme: 'system', // system, light, dark
  fontSize: 'medium', // small, medium, large
  lineHeight: 'normal', // compact, normal, relaxed
  animation: true, // true, false
  highContrast: false, // true, false
  showGroupsMode: false, // 是否显示分组搜索模式（官方 API 能力有限，默认关闭）
  groupChildClickRestoreAll: true, // 点击分组内子标签时是否整组恢复
  defaultSearchEngine: null, // null = 自动检测(中文环境百度/其他Google), 或 google/baidu/bing/duckduckgo
  defaultMode: 'bookmarks', // 扩展打开时的默认搜索模式
  searchWindowMode: 'window', // window = 独立搜索窗口, popup = 弹出面板
  searchPlatforms: {
    enabled: true,
    prefixEnabled: true,
    showInResults: true,
    enabledPlatforms: ['g', 'bd', 'gh', 'so', 'zh', 'bl', 'yt', 'npm', 'mdn'],
    customPlatforms: []
  },
  intelligentSearch: {
    enabled: false,
    aiProvider: 'gemini', // gemini, openai, siliconflow, custom
    aiApiKey: '',
    aiBaseUrl: '',
    embeddingModel: '',
    chatModel: '',
    rerankEnabled: false,
    lastBuildProgress: 0
  }
};

// 获取当前设置
async function getSettings() {
  const result = await chrome.storage.sync.get(['settings', 'optionsSettings']);
  
  const source = result.optionsSettings || result.settings || {};
  const merged = { ...DEFAULT_SETTINGS };

  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (key === 'intelligentSearch') {
      const fromSettings = result.settings?.intelligentSearch || {};
      const fromOptions = result.optionsSettings?.intelligentSearch || {};
      merged.intelligentSearch = {
        ...DEFAULT_SETTINGS.intelligentSearch,
        ...fromSettings,
        ...fromOptions
      };
    } else if (key === 'searchPlatforms') {
      const fromSettings = result.settings?.searchPlatforms || {};
      const fromOptions = result.optionsSettings?.searchPlatforms || {};
      merged.searchPlatforms = {
        ...DEFAULT_SETTINGS.searchPlatforms,
        ...fromSettings,
        ...fromOptions
      };
    } else if (source[key] !== undefined) {
      merged[key] = source[key];
    }
  }

  if (typeof window !== 'undefined') {
    window.__BOOKMARK_SEARCH_SETTINGS = merged;
  }

  return merged;
}

// 保存设置
async function saveSettings(settings) {
  await chrome.storage.sync.set({ settings });
  applySettings(settings);
}

// 应用设置到界面
function applySettings(settings) {
  const root = document.documentElement;
  const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  
  // 应用主题
  const isDark = settings.theme === 'dark' || 
                 (settings.theme === 'system' && prefersDark);
  
  root.classList.toggle('dark-theme', isDark);
  root.classList.toggle('high-contrast', settings.highContrast);
  
  // 应用字体大小
  root.style.setProperty('--font-size-base', {
    small: '12px',
    medium: '14px',
    large: '16px'
  }[settings.fontSize]);
  
  // 应用行高
  root.style.setProperty('--line-height-base', {
    compact: '1.3',
    normal: '1.5',
    relaxed: '1.7'
  }[settings.lineHeight]);
  
  // 应用动画
  root.style.setProperty('--transition-duration', 
    settings.animation ? '0.3s' : '0s');
}

// 监听系统主题变化
function watchSystemTheme() {
  const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
  mediaQuery.addEventListener('change', async () => {
    const settings = await getSettings();
    if (settings.theme === 'system') {
      applySettings(settings);
    }
  });
}

// 初始化设置
async function initSettings() {
  const settings = await getSettings();
  applySettings(settings);
  watchSystemTheme();
}

// ==================== 书签标签系统 ====================

const BookmarkTags = {
  async getAll() {
    const data = await chrome.storage.local.get(['bookmarkTags', 'tagPalette']);
    return {
      tags: data.bookmarkTags || {},
      palette: data.tagPalette || [...DEFAULT_TAG_PALETTE]
    };
  },

  async getTagsForBookmark(bookmarkId) {
    const data = await chrome.storage.local.get('bookmarkTags');
    return (data.bookmarkTags || {})[bookmarkId] || [];
  },

  async setTagsForBookmark(bookmarkId, tags) {
    const data = await chrome.storage.local.get('bookmarkTags');
    const allTags = data.bookmarkTags || {};
    if (tags.length === 0) {
      delete allTags[bookmarkId];
    } else {
      allTags[bookmarkId] = [...new Set(tags)];
    }
    await chrome.storage.local.set({ bookmarkTags: allTags });
  },

  async addTag(bookmarkId, tag) {
    const current = await this.getTagsForBookmark(bookmarkId);
    if (!current.includes(tag)) {
      current.push(tag);
      await this.setTagsForBookmark(bookmarkId, current);
    }
    await this.ensureInPalette(tag);
  },

  async removeTag(bookmarkId, tag) {
    const current = await this.getTagsForBookmark(bookmarkId);
    const filtered = current.filter(t => t !== tag);
    await this.setTagsForBookmark(bookmarkId, filtered);
  },

  async batchAddTag(bookmarkIds, tag) {
    const data = await chrome.storage.local.get('bookmarkTags');
    const allTags = data.bookmarkTags || {};
    for (const id of bookmarkIds) {
      const current = allTags[id] || [];
      if (!current.includes(tag)) {
        current.push(tag);
        allTags[id] = current;
      }
    }
    await chrome.storage.local.set({ bookmarkTags: allTags });
    await this.ensureInPalette(tag);
  },

  async batchRemoveTag(bookmarkIds, tag) {
    const data = await chrome.storage.local.get('bookmarkTags');
    const allTags = data.bookmarkTags || {};
    for (const id of bookmarkIds) {
      if (allTags[id]) {
        allTags[id] = allTags[id].filter(t => t !== tag);
        if (allTags[id].length === 0) delete allTags[id];
      }
    }
    await chrome.storage.local.set({ bookmarkTags: allTags });
  },

  async getPalette() {
    const data = await chrome.storage.local.get('tagPalette');
    return data.tagPalette || [...DEFAULT_TAG_PALETTE];
  },

  async setPalette(palette) {
    await chrome.storage.local.set({ tagPalette: [...new Set(palette)] });
  },

  async ensureInPalette(tag) {
    const palette = await this.getPalette();
    if (!palette.includes(tag)) {
      palette.push(tag);
      await this.setPalette(palette);
    }
  },

  async renameTag(oldName, newName) {
    const data = await chrome.storage.local.get(['bookmarkTags', 'tagPalette']);
    const allTags = data.bookmarkTags || {};
    for (const id of Object.keys(allTags)) {
      const idx = allTags[id].indexOf(oldName);
      if (idx !== -1) allTags[id][idx] = newName;
    }
    const palette = data.tagPalette || [...DEFAULT_TAG_PALETTE];
    const pi = palette.indexOf(oldName);
    if (pi !== -1) palette[pi] = newName;
    await chrome.storage.local.set({ bookmarkTags: allTags, tagPalette: palette });
  },

  async deleteTagFromAll(tag) {
    const data = await chrome.storage.local.get(['bookmarkTags', 'tagPalette']);
    const allTags = data.bookmarkTags || {};
    for (const id of Object.keys(allTags)) {
      allTags[id] = allTags[id].filter(t => t !== tag);
      if (allTags[id].length === 0) delete allTags[id];
    }
    const palette = (data.tagPalette || []).filter(t => t !== tag);
    await chrome.storage.local.set({ bookmarkTags: allTags, tagPalette: palette });
  },

  async getBookmarksByTag(tag) {
    const data = await chrome.storage.local.get('bookmarkTags');
    const allTags = data.bookmarkTags || {};
    return Object.entries(allTags)
      .filter(([, tags]) => tags.includes(tag))
      .map(([id]) => id);
  },

  async getTagStats() {
    const data = await chrome.storage.local.get('bookmarkTags');
    const allTags = data.bookmarkTags || {};
    const stats = {};
    for (const tags of Object.values(allTags)) {
      for (const tag of tags) {
        stats[tag] = (stats[tag] || 0) + 1;
      }
    }
    return stats;
  }
};

// ==================== 书签整理引擎 ====================

const BookmarkOrganizer = {
  async getDomainCategories() {
    const data = await chrome.storage.local.get('customDomainCategories');
    return { ...DOMAIN_CATEGORIES, ...(data.customDomainCategories || {}) };
  },

  async setCustomDomainCategories(custom) {
    await chrome.storage.local.set({ customDomainCategories: custom });
  },

  categorizeBySite(url, domainMap) {
    try {
      const parsed = new URL(url);
      const hostname = parsed.hostname.replace(/^www\./, '');
      if (domainMap[hostname]) return domainMap[hostname];
      const parts = hostname.split('.');
      if (parts.length > 2) {
        const topDomain = parts.slice(-2).join('.');
        if (domainMap[topDomain]) return domainMap[topDomain];
      }
    } catch {}
    return null;
  },

  categorizeByTitle(title) {
    const rules = [
      { keywords: ['教程', 'tutorial', 'course', 'learn', '入门', '指南', 'guide'], category: '学习教程' },
      { keywords: ['文档', 'docs', 'documentation', 'reference', 'api'], category: '开发文档' },
      { keywords: ['工具', 'tool', 'utility', 'generator', 'converter'], category: '工具' },
      { keywords: ['新闻', 'news', '资讯', '快报'], category: '新闻资讯' },
      { keywords: ['博客', 'blog', '日志'], category: '博客文章' },
      { keywords: ['视频', 'video', '直播', 'live'], category: '视频娱乐' },
    ];
    const lowerTitle = (title || '').toLowerCase();
    for (const rule of rules) {
      if (rule.keywords.some(kw => lowerTitle.includes(kw))) return rule.category;
    }
    return null;
  },

  categorizeByPath(url) {
    try {
      const path = new URL(url).pathname.toLowerCase();
      if (/\/docs?\//.test(path)) return '开发文档';
      if (/\/blog\//.test(path)) return '博客文章';
      if (/\/wiki\//.test(path)) return '百科参考';
      if (/\/tutorial/.test(path)) return '学习教程';
    } catch {}
    return null;
  },

  // AI chat provider 配置（精简版，仅 chat 能力）
  AI_CHAT_PROVIDERS: {
    gemini: { chatUrl: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent', chatModel: 'gemini-2.0-flash' },
    openai: { chatUrl: 'https://api.openai.com/v1/chat/completions', chatModel: 'gpt-4o-mini' },
    deepseek: { chatUrl: 'https://api.deepseek.com/v1/chat/completions', chatModel: 'deepseek-chat' },
    qwen: { chatUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', chatModel: 'qwen-plus' },
    siliconflow: { chatUrl: 'https://api.siliconflow.cn/v1/chat/completions', chatModel: 'deepseek-ai/DeepSeek-V3' },
    custom: { chatUrl: '', chatModel: '' }
  },

  async getAIConfig() {
    const result = await chrome.storage.sync.get('optionsSettings');
    const s = result.optionsSettings?.intelligentSearch || {};
    return {
      aiProvider: s.aiProvider || 'gemini',
      aiApiKey: s.aiApiKey || '',
      aiBaseUrl: s.aiBaseUrl || '',
      chatModel: s.chatModel || ''
    };
  },

  _deriveChatUrl(config, provider) {
    if (config.aiBaseUrl) {
      let base = config.aiBaseUrl.replace(/\/+$/, '');
      if (!/\/v\d/.test(base)) base += '/v1';
      if (base.endsWith('/chat/completions')) return base;
      return base.replace(/\/embeddings$/, '') + '/chat/completions';
    }
    return provider.chatUrl;
  },

  async _callChat(prompt, config) {
    const provider = this.AI_CHAT_PROVIDERS[config.aiProvider] || this.AI_CHAT_PROVIDERS.custom;
    const apiKey = config.aiApiKey;
    if (!apiKey) throw new Error('未配置 API Key');

    if (config.aiProvider === 'gemini') {
      const model = config.chatModel || provider.chatModel;
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: 0, maxOutputTokens: 4096 } })
      });
      if (!resp.ok) throw new Error(`Gemini API error: ${resp.status}`);
      const data = await resp.json();
      return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
    }

    const chatUrl = config.aiChatUrl || this._deriveChatUrl(config, provider);
    const chatModel = config.chatModel || provider.chatModel;
    const resp = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
      body: JSON.stringify({ model: chatModel, messages: [{ role: 'user', content: prompt }], temperature: 0, max_tokens: 4096 })
    });
    if (!resp.ok) throw new Error(`Chat API error: ${resp.status}`);
    const data = await resp.json();
    return data.choices?.[0]?.message?.content || '';
  },

  async categorizeByAI(uncategorizedBookmarks, existingCategories) {
    const config = await this.getAIConfig();
    if (!config.aiApiKey) return [];

    const BATCH_SIZE = 40;
    const results = [];

    for (let i = 0; i < uncategorizedBookmarks.length; i += BATCH_SIZE) {
      const batch = uncategorizedBookmarks.slice(i, i + BATCH_SIZE);
      const bookmarkList = batch.map((b, idx) => `${idx + 1}. [${b.id}] ${b.title || '无标题'} | ${b.url || ''}`).join('\n');

      const prompt = `你是书签分类专家。请根据书签的标题和URL，将每个书签归入一个合适的分类文件夹。

已有分类: ${existingCategories.join(', ')}

规则：
1. 优先复用已有分类名，保持一致性
2. 如果已有分类都不合适，可以创建新分类（简短的中文名称）
3. 对每个书签评估分类置信度：high（非常确定）、medium（较确定）、low（不太确定）
4. 实在无法分类的标记为"未分类"

书签列表：
${bookmarkList}

请严格以 JSON 数组格式返回，不要包含其他文字：
[{"id":"书签id","category":"分类名","confidence":"high/medium/low"}]`;

      try {
        const response = await this._callChat(prompt, config);
        const jsonMatch = response.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          results.push(...parsed.map(item => ({ ...item, source: 'ai' })));
        }
      } catch (e) {
        console.error('[BookmarkOrganizer] AI batch error:', e);
      }
    }
    return results;
  },

  async analyzeBookmarks(options = {}) {
    const bookmarkTree = await chrome.bookmarks.getTree();
    const topLevelIds = new Set();
    const allBookmarks = [];
    const folderMap = {};

    bookmarkTree.forEach(node => {
      if (node.children) node.children.forEach(c => {
        if (!c.url) topLevelIds.add(c.id);
      });
    });

    function collectBookmarks(node, parentPath) {
      if (!node.url && node.children) {
        folderMap[node.id] = { title: node.title, parentId: node.parentId };
      }
      if (node.url) {
        const isInRootOrBar = topLevelIds.has(node.parentId) || !node.parentId || node.parentId === '0';
        allBookmarks.push({
          ...node,
          isUncategorized: isInRootOrBar,
          folderPath: parentPath
        });
      }
      if (node.children) {
        node.children.forEach(child => collectBookmarks(child, node.title || parentPath));
      }
    }
    bookmarkTree.forEach(n => collectBookmarks(n, ''));

    const useAI = options.useAI === true;
    const organizeSubfolders = options.organizeSubfolders === true;
    const onlyUncategorized = !organizeSubfolders;

    const toOrganize = onlyUncategorized ? allBookmarks.filter(b => b.isUncategorized) : allBookmarks;

    const domainMap = await this.getDomainCategories();
    const plan = {};
    const subfolderPlans = {};
    const uncategorized = [];

    for (const bm of toOrganize) {
      if (!bm.isUncategorized && organizeSubfolders) {
        const category = this.categorizeBySite(bm.url, domainMap)
          || this.categorizeByPath(bm.url)
          || this.categorizeByTitle(bm.title);
        if (category) {
          const parentId = bm.parentId;
          if (!subfolderPlans[parentId]) subfolderPlans[parentId] = {};
          if (!subfolderPlans[parentId][category]) subfolderPlans[parentId][category] = [];
          subfolderPlans[parentId][category].push({ id: bm.id, title: bm.title, url: bm.url, parentId: bm.parentId, source: 'rule' });
        }
        continue;
      }

      let category = this.categorizeBySite(bm.url, domainMap)
        || this.categorizeByPath(bm.url)
        || this.categorizeByTitle(bm.title);

      if (category) {
        if (!plan[category]) plan[category] = [];
        plan[category].push({ id: bm.id, title: bm.title, url: bm.url, parentId: bm.parentId, source: 'rule' });
      } else {
        uncategorized.push({ id: bm.id, title: bm.title, url: bm.url, parentId: bm.parentId });
      }
    }

    let aiResults = [];
    if (useAI && uncategorized.length > 0) {
      const existingCategories = Object.keys(plan).filter(k => k !== '未分类');
      const domainCats = Object.values(await this.getDomainCategories());
      const allCats = [...new Set([...existingCategories, ...domainCats])];

      try {
        aiResults = await this.categorizeByAI(uncategorized, allCats);
      } catch (e) {
        console.error('[BookmarkOrganizer] AI classification failed:', e);
      }
    }

    const aiMap = {};
    for (const r of aiResults) {
      aiMap[r.id] = r;
    }

    for (const bm of uncategorized) {
      const aiResult = aiMap[bm.id];
      const category = (aiResult && aiResult.category !== '未分类') ? aiResult.category : '未分类';
      if (!plan[category]) plan[category] = [];
      plan[category].push({
        id: bm.id,
        title: bm.title,
        url: bm.url,
        parentId: bm.parentId,
        source: aiResult ? 'ai' : 'none',
        confidence: aiResult?.confidence || null
      });
    }

    return {
      plan,
      subfolderPlans,
      totalBookmarks: allBookmarks.length,
      uncategorizedCount: allBookmarks.filter(b => b.isUncategorized).length,
      toOrganizeCount: toOrganize.length,
      aiClassifiedCount: aiResults.filter(r => r.category !== '未分类').length,
      ruleClassifiedCount: Object.values(plan).flat().filter(b => b.source === 'rule').length
    };
  },

  async backup() {
    const bookmarkTree = await chrome.bookmarks.getTree();
    const data = await chrome.storage.local.get('organizeBackups');
    const backups = data.organizeBackups || [];

    backups.unshift({
      timestamp: Date.now(),
      tree: JSON.parse(JSON.stringify(bookmarkTree))
    });

    while (backups.length > 5) backups.pop();
    await chrome.storage.local.set({ organizeBackups: backups });
    return backups[0].timestamp;
  },

  async getBackups() {
    const data = await chrome.storage.local.get('organizeBackups');
    return (data.organizeBackups || []).map(b => ({
      timestamp: b.timestamp,
      date: new Date(b.timestamp).toLocaleString()
    }));
  },

  async executePlan(plan, targetParentId, subfolderPlans) {
    const moves = [];
    const existingFolders = {};

    const children = await chrome.bookmarks.getChildren(targetParentId || '1');
    for (const child of children) {
      if (!child.url) existingFolders[child.title] = child.id;
    }

    for (const [category, bookmarks] of Object.entries(plan)) {
      if (category === '未分类') continue;

      let folderId = existingFolders[category];
      if (!folderId) {
        const folder = await chrome.bookmarks.create({ parentId: targetParentId || '1', title: category });
        folderId = folder.id;
        existingFolders[category] = folderId;
      }

      for (const bm of bookmarks) {
        const prevParent = bm.parentId;
        await chrome.bookmarks.move(bm.id, { parentId: folderId });
        moves.push({ bookmarkId: bm.id, fromParent: prevParent, toParent: folderId });
      }
    }

    if (subfolderPlans && Object.keys(subfolderPlans).length > 0) {
      for (const [parentId, categories] of Object.entries(subfolderPlans)) {
        const subChildren = await chrome.bookmarks.getChildren(parentId);
        const subFolders = {};
        for (const c of subChildren) {
          if (!c.url) subFolders[c.title] = c.id;
        }
        for (const [cat, bookmarks] of Object.entries(categories)) {
          if (cat === '未分类') continue;
          let fid = subFolders[cat];
          if (!fid) {
            const f = await chrome.bookmarks.create({ parentId, title: cat });
            fid = f.id;
            subFolders[cat] = fid;
          }
          for (const bm of bookmarks) {
            const prevParent = bm.parentId;
            await chrome.bookmarks.move(bm.id, { parentId: fid });
            moves.push({ bookmarkId: bm.id, fromParent: prevParent, toParent: fid });
          }
        }
      }
    }

    const moveData = await chrome.storage.local.get('organizeHistory');
    const history = moveData.organizeHistory || [];
    history.unshift({ timestamp: Date.now(), moves });
    while (history.length > 5) history.pop();
    await chrome.storage.local.set({ organizeHistory: history });

    return { movedCount: moves.length };
  },

  async undoLastOrganize() {
    const data = await chrome.storage.local.get('organizeHistory');
    const history = data.organizeHistory || [];
    if (history.length === 0) return { success: false, error: '没有可撤销的整理操作' };

    const lastOp = history.shift();
    let restored = 0;
    for (const move of lastOp.moves.reverse()) {
      try {
        await chrome.bookmarks.move(move.bookmarkId, { parentId: move.fromParent });
        restored++;
      } catch {}
    }

    await chrome.storage.local.set({ organizeHistory: history });
    return { success: true, restored };
  }
};

// 导出函数和常量
window.settings = {
  get: getSettings,
  save: saveSettings,
  init: initSettings
};
window.SEARCH_ENGINES = SEARCH_ENGINES;
window.SEARCH_PLATFORMS = SEARCH_PLATFORMS;
window.URL_PATTERN = URL_PATTERN;
window.normalizeUrl = normalizeUrl;
window.getDefaultSearchEngine = getDefaultSearchEngine;
window.DOMAIN_CATEGORIES = DOMAIN_CATEGORIES;
window.DEFAULT_TAG_PALETTE = DEFAULT_TAG_PALETTE;
window.BookmarkTags = BookmarkTags;
window.BookmarkOrganizer = BookmarkOrganizer;
