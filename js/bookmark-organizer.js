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

  categorizeByTitle(title, customKeywords) {
    const rules = [
      { keywords: ['教程', 'tutorial', 'course', 'learn', '入门', '指南', 'guide'], category: '学习教程' },
      { keywords: ['文档', 'docs', 'documentation', 'reference', 'api'], category: '开发文档' },
      { keywords: ['工具', 'tool', 'utility', 'generator', 'converter'], category: '工具' },
      { keywords: ['新闻', 'news', '资讯', '快报'], category: '新闻资讯' },
      { keywords: ['博客', 'blog', '日志'], category: '博客文章' },
      { keywords: ['视频', 'video', '直播', 'live'], category: '视频娱乐' },
    ];
    const lowerTitle = (title || '').toLowerCase();
    if (customKeywords && customKeywords.length > 0) {
      for (const rule of customKeywords) {
        if (lowerTitle.includes(rule.keyword)) return rule.category;
      }
    }
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

  _getCategorizationSource(url, title, domainMap, customKeywords) {
    const bySite = this.categorizeBySite(url, domainMap);
    if (bySite) return { category: bySite, reason: 'domain' };
    const byPath = this.categorizeByPath(url);
    if (byPath) return { category: byPath, reason: 'path' };
    const byTitle = this.categorizeByTitle(title, customKeywords);
    if (byTitle) return { category: byTitle, reason: 'title' };
    return null;
  },

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
    const kwData = await chrome.storage.local.get('customKeywordRules');
    const customKeywords = kwData.customKeywordRules || [];
    const plan = {};
    const subfolderPlans = {};
    const uncategorized = [];

    for (const bm of toOrganize) {
      if (!bm.isUncategorized && organizeSubfolders) {
        const result = this._getCategorizationSource(bm.url, bm.title, domainMap, customKeywords);
        if (result) {
          const parentId = bm.parentId;
          if (!subfolderPlans[parentId]) subfolderPlans[parentId] = {};
          if (!subfolderPlans[parentId][result.category]) subfolderPlans[parentId][result.category] = [];
          subfolderPlans[parentId][result.category].push({
            id: bm.id, title: bm.title, url: bm.url, parentId: bm.parentId,
            source: 'rule', reason: result.reason, confidence: 'high', checked: true
          });
        }
        continue;
      }

      const result = this._getCategorizationSource(bm.url, bm.title, domainMap, customKeywords);
      if (result) {
        if (!plan[result.category]) plan[result.category] = [];
        plan[result.category].push({
          id: bm.id, title: bm.title, url: bm.url, parentId: bm.parentId,
          source: 'rule', reason: result.reason, confidence: 'high', checked: true
        });
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
        reason: aiResult ? 'ai' : null,
        confidence: aiResult?.confidence || null,
        checked: !!(aiResult && aiResult.confidence !== 'low')
      });
    }

    const allCategories = [...new Set([
      ...Object.keys(plan),
      ...Object.values(subfolderPlans).flatMap(sp => Object.keys(sp))
    ])].filter(c => c !== '未分类');

    return {
      plan,
      subfolderPlans,
      allCategories,
      folderMap,
      totalBookmarks: allBookmarks.length,
      uncategorizedCount: allBookmarks.filter(b => b.isUncategorized).length,
      toOrganizeCount: toOrganize.length,
      aiClassifiedCount: aiResults.filter(r => r.category !== '未分类').length,
      ruleClassifiedCount: Object.values(plan).flat().filter(b => b.source === 'rule').length,
      lowConfidenceCount: Object.values(plan).flat().filter(b => b.confidence === 'low').length
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

  buildReviewedPlan(draftResult) {
    const reviewed = {};
    for (const [category, bookmarks] of Object.entries(draftResult.plan || {})) {
      if (category === '未分类') continue;
      const checkedItems = bookmarks.filter(b => b.checked !== false);
      if (checkedItems.length > 0) {
        reviewed[category] = checkedItems;
      }
    }
    return reviewed;
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

      const checkedBookmarks = bookmarks.filter(b => b.checked !== false);
      if (checkedBookmarks.length === 0) continue;

      let folderId = existingFolders[category];
      if (!folderId) {
        const folder = await chrome.bookmarks.create({ parentId: targetParentId || '1', title: category });
        folderId = folder.id;
        existingFolders[category] = folderId;
      }

      for (const bm of checkedBookmarks) {
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
          const checkedBookmarks = bookmarks.filter(b => b.checked !== false);
          if (checkedBookmarks.length === 0) continue;
          let fid = subFolders[cat];
          if (!fid) {
            const f = await chrome.bookmarks.create({ parentId, title: cat });
            fid = f.id;
            subFolders[cat] = fid;
          }
          for (const bm of checkedBookmarks) {
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
  },

  async learnFromUserEdits(edits) {
    if (!edits || edits.length === 0) return;
    const data = await chrome.storage.local.get(['customDomainCategories', 'customKeywordRules']);
    const customDomains = data.customDomainCategories || {};
    const customKeywords = data.customKeywordRules || [];
    let domainChanged = false;
    let keywordChanged = false;

    for (const edit of edits) {
      if (!edit.url || !edit.newCategory) continue;
      try {
        const hostname = new URL(edit.url).hostname.replace(/^www\./, '');
        if (!customDomains[hostname] && !DOMAIN_CATEGORIES[hostname]) {
          customDomains[hostname] = edit.newCategory;
          domainChanged = true;
        } else if (edit.title) {
          const existingKws = customKeywords.map(r => r.keyword);
          const words = this._extractKeywords(edit.title);
          for (const w of words) {
            if (!existingKws.includes(w)) {
              customKeywords.push({ keyword: w, category: edit.newCategory });
              keywordChanged = true;
              existingKws.push(w);
              break;
            }
          }
        }
      } catch {}
    }

    const updates = {};
    if (domainChanged) updates.customDomainCategories = customDomains;
    if (keywordChanged) updates.customKeywordRules = customKeywords;
    if (Object.keys(updates).length > 0) {
      await chrome.storage.local.set(updates);
    }
  },

  _extractKeywords(title) {
    if (!title) return [];
    const stopwords = new Set(['the','a','an','and','or','for','to','in','of','is','it','by','on','at',
      '的','了','是','在','有','和','与','及','等','个','为','被','从','到']);
    return title
      .toLowerCase()
      .split(/[\s\-_|:·,，:：/()（）\[\]]+/)
      .filter(w => w.length >= 2 && !stopwords.has(w))
      .slice(0, 5);
  }
};

if (typeof window !== 'undefined') {
  window.DOMAIN_CATEGORIES = DOMAIN_CATEGORIES;
  window.BookmarkOrganizer = BookmarkOrganizer;
}
