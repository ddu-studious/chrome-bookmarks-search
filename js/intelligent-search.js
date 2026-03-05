/**
 * 智能搜索模块 - BM25 + Embedding + RRF 混合搜索
 *
 * 在 background.js (Service Worker) 中运行，通过消息协议供三端调用。
 * 支持：BM25 关键词搜索、向量语义搜索、RRF 融合、LLM Rerank、网页摘要。
 */

const IntelligentSearch = (() => {
  'use strict';

  // ==================== AI Provider 配置 ====================
  const AI_PROVIDERS = {
    deepseek: {
      name: 'DeepSeek',
      embeddingUrl: 'https://api.deepseek.com/v1/embeddings',
      chatUrl: 'https://api.deepseek.com/v1/chat/completions',
      embeddingModel: 'deepseek-embedding',
      chatModel: 'deepseek-chat',
      dimensions: 384
    },
    openai: {
      name: 'OpenAI',
      embeddingUrl: 'https://api.openai.com/v1/embeddings',
      chatUrl: 'https://api.openai.com/v1/chat/completions',
      embeddingModel: 'text-embedding-3-small',
      chatModel: 'gpt-4o-mini',
      dimensions: 384
    },
    gemini: {
      name: 'Gemini',
      embeddingUrl: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent',
      chatUrl: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
      embeddingModel: 'text-embedding-004',
      chatModel: 'gemini-2.0-flash',
      dimensions: 768
    },
    custom: {
      name: '自定义 (OpenAI 兼容)',
      embeddingUrl: '',
      chatUrl: '',
      embeddingModel: '',
      chatModel: '',
      dimensions: 384
    }
  };

  // ==================== IndexedDB 向量存储 ====================
  const DB_NAME = 'IntelligentSearchIndex';
  const DB_VERSION = 1;
  let dbInstance = null;

  function openDB() {
    if (dbInstance) return Promise.resolve(dbInstance);
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = (e) => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains('vectors')) {
          const store = db.createObjectStore('vectors', { keyPath: 'id' });
          store.createIndex('ts', 'ts', { unique: false });
        }
        if (!db.objectStoreNames.contains('queryCache')) {
          const cache = db.createObjectStore('queryCache', { keyPath: 'query' });
          cache.createIndex('ts', 'ts', { unique: false });
        }
      };
      request.onsuccess = (e) => {
        dbInstance = e.target.result;
        resolve(dbInstance);
      };
      request.onerror = (e) => reject(e.target.error);
    });
  }

  async function getVector(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('vectors', 'readonly');
      const req = tx.objectStore('vectors').get(id);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  }

  async function putVector(record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('vectors', 'readwrite');
      tx.objectStore('vectors').put(record);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function deleteVector(id) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('vectors', 'readwrite');
      tx.objectStore('vectors').delete(id);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  async function getAllVectors() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('vectors', 'readonly');
      const req = tx.objectStore('vectors').getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  async function getVectorCount() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('vectors', 'readonly');
      const req = tx.objectStore('vectors').count();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getCachedQueryEmbedding(query) {
    const db = await openDB();
    const key = query.toLowerCase().trim();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('queryCache', 'readonly');
      const req = tx.objectStore('queryCache').get(key);
      req.onsuccess = () => {
        const result = req.result;
        if (result && Date.now() - result.ts < 24 * 60 * 60 * 1000) {
          resolve(result.embedding);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => reject(req.error);
    });
  }

  async function cacheQueryEmbedding(query, embedding) {
    const db = await openDB();
    const key = query.toLowerCase().trim();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('queryCache', 'readwrite');
      tx.objectStore('queryCache').put({ query: key, embedding, ts: Date.now() });
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  }

  // ==================== Embedding API ====================

  async function callEmbeddingAPI(texts, config) {
    const provider = AI_PROVIDERS[config.aiProvider] || AI_PROVIDERS.custom;
    const apiKey = config.aiApiKey;
    if (!apiKey) throw new Error('未配置 API Key');

    if (config.aiProvider === 'gemini') {
      return callGeminiEmbedding(texts, config, provider);
    }

    const baseUrl = config.aiBaseUrl || provider.embeddingUrl;
    const model = config.embeddingModel || provider.embeddingModel;

    const resp = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        input: texts,
        dimensions: provider.dimensions
      })
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new Error(`Embedding API 错误 (${resp.status}): ${errBody.slice(0, 200)}`);
    }

    const data = await resp.json();
    return data.data.map(d => d.embedding);
  }

  async function callGeminiEmbedding(texts, config, provider) {
    const apiKey = config.aiApiKey;
    const model = config.embeddingModel || provider.embeddingModel;
    const baseUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${apiKey}`;

    const requests = texts.map(text => ({
      model: `models/${model}`,
      content: { parts: [{ text }] }
    }));

    const resp = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests })
    });

    if (!resp.ok) {
      const errBody = await resp.text().catch(() => '');
      throw new Error(`Gemini Embedding 错误 (${resp.status}): ${errBody.slice(0, 200)}`);
    }

    const data = await resp.json();
    return data.embeddings.map(e => e.values);
  }

  // ==================== BM25 关键词搜索 ====================

  function tokenize(text) {
    if (!text) return [];
    return text.toLowerCase()
      .replace(/[^\w\u4e00-\u9fff\u3040-\u309f\u30a0-\u30ff]+/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 0);
  }

  function buildBM25Index(items) {
    const k1 = 1.2, b = 0.75;
    const N = items.length;
    const avgDl = items.reduce((sum, item) => {
      const text = `${item.title || ''} ${item.url || ''}`;
      return sum + tokenize(text).length;
    }, 0) / (N || 1);

    const df = {};
    const docs = items.map(item => {
      const text = `${item.title || ''} ${item.url || ''} ${item.summary || ''}`;
      const tokens = tokenize(text);
      const tf = {};
      tokens.forEach(t => { tf[t] = (tf[t] || 0) + 1; });
      const seen = new Set(tokens);
      seen.forEach(t => { df[t] = (df[t] || 0) + 1; });
      return { tokens, tf, dl: tokens.length };
    });

    return { k1, b, N, avgDl, df, docs };
  }

  function bm25Search(query, items, index) {
    const queryTokens = tokenize(query);
    if (queryTokens.length === 0) return items.map((item, i) => ({ item, score: 0, rank: i }));

    const { k1, b, N, avgDl, df, docs } = index;
    const scores = docs.map((doc, i) => {
      let score = 0;
      queryTokens.forEach(qt => {
        const tfVal = doc.tf[qt] || 0;
        if (tfVal === 0) return;
        const idf = Math.log((N - (df[qt] || 0) + 0.5) / ((df[qt] || 0) + 0.5) + 1);
        score += idf * (tfVal * (k1 + 1)) / (tfVal + k1 * (1 - b + b * doc.dl / avgDl));
      });
      return { item: items[i], score, rank: i };
    });

    return scores.sort((a, b) => b.score - a.score);
  }

  // ==================== 向量搜索 ====================

  function cosineSimilarity(a, b) {
    if (!a || !b || a.length !== b.length) return 0;
    let dot = 0, normA = 0, normB = 0;
    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    const denom = Math.sqrt(normA) * Math.sqrt(normB);
    return denom === 0 ? 0 : dot / denom;
  }

  async function vectorSearch(queryEmbedding, items, topK = 50) {
    const allVectors = await getAllVectors();
    const vectorMap = new Map(allVectors.map(v => [v.id, v.embedding]));

    const scores = items.map(item => {
      const vec = vectorMap.get(item.id) || vectorMap.get(`bookmark_${item.id}`);
      const similarity = vec ? cosineSimilarity(queryEmbedding, vec) : 0;
      return { item, score: similarity };
    }).filter(r => r.score > 0);

    scores.sort((a, b) => b.score - a.score);
    return scores.slice(0, topK);
  }

  // ==================== RRF 融合 ====================

  function rrfFusion(keywordResults, semanticResults, k = 60) {
    const scoreMap = new Map();

    const getKey = (item) => item.id || item.url || JSON.stringify(item);

    keywordResults.forEach(({ item, score }, rank) => {
      const key = getKey(item);
      if (!scoreMap.has(key)) {
        scoreMap.set(key, { item, rrfScore: 0, keywordScore: score, semanticScore: 0 });
      }
      scoreMap.get(key).rrfScore += 1 / (k + rank + 1);
      scoreMap.get(key).keywordScore = score;
    });

    semanticResults.forEach(({ item, score }, rank) => {
      const key = getKey(item);
      if (!scoreMap.has(key)) {
        scoreMap.set(key, { item, rrfScore: 0, keywordScore: 0, semanticScore: score });
      }
      scoreMap.get(key).rrfScore += 1 / (k + rank + 1);
      scoreMap.get(key).semanticScore = score;
    });

    const results = Array.from(scoreMap.values());
    results.sort((a, b) => b.rrfScore - a.rrfScore);
    return results;
  }

  // ==================== LLM Rerank ====================

  async function llmRerank(query, candidates, config, topN = 15) {
    if (!config.rerankEnabled || candidates.length <= topN) {
      return candidates.slice(0, topN);
    }

    const provider = AI_PROVIDERS[config.aiProvider] || AI_PROVIDERS.custom;
    const apiKey = config.aiApiKey;
    if (!apiKey) return candidates.slice(0, topN);

    const candidateList = candidates.slice(0, 30).map((c, i) => {
      return `${i + 1}. ${c.item.title || '无标题'} | ${c.item.url || ''}`;
    }).join('\n');

    const prompt = `用户搜索: "${query}"

以下是候选结果，请根据与搜索意图的相关性排序，返回最相关的 ${topN} 个结果的编号（用逗号分隔），不需要解释：

${candidateList}`;

    try {
      let rerankedIds;

      if (config.aiProvider === 'gemini') {
        rerankedIds = await callGeminiChat(prompt, config, provider);
      } else {
        const chatUrl = config.aiChatUrl || config.aiBaseUrl?.replace('/embeddings', '/chat/completions') || provider.chatUrl;
        const chatModel = config.chatModel || provider.chatModel;

        const resp = await fetch(chatUrl, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: chatModel,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0,
            max_tokens: 200
          })
        });

        if (!resp.ok) return candidates.slice(0, topN);
        const data = await resp.json();
        rerankedIds = data.choices?.[0]?.message?.content || '';
      }

      const ids = rerankedIds.match(/\d+/g)?.map(Number).filter(n => n >= 1 && n <= candidates.length) || [];
      if (ids.length === 0) return candidates.slice(0, topN);

      const seen = new Set();
      const reranked = [];
      ids.forEach(id => {
        if (!seen.has(id) && candidates[id - 1]) {
          seen.add(id);
          reranked.push(candidates[id - 1]);
        }
      });

      return reranked.slice(0, topN);
    } catch (e) {
      console.warn('[IntelligentSearch] Rerank failed:', e.message);
      return candidates.slice(0, topN);
    }
  }

  async function callGeminiChat(prompt, config, provider) {
    const apiKey = config.aiApiKey;
    const model = config.chatModel || provider.chatModel;
    const chatUrl = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const resp = await fetch(chatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        generationConfig: { temperature: 0, maxOutputTokens: 200 }
      })
    });

    if (!resp.ok) return '';
    const data = await resp.json();
    return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
  }

  // ==================== 网页摘要 ====================

  async function generateSummary(text, config) {
    const provider = AI_PROVIDERS[config.aiProvider] || AI_PROVIDERS.custom;
    const apiKey = config.aiApiKey;
    if (!apiKey || !text) return null;

    const prompt = `请用中文为以下网页内容生成一段50-100字的摘要，以及3-5个关键词标签。
格式：
摘要：<摘要内容>
标签：<标签1>, <标签2>, <标签3>

网页内容：
${text.slice(0, 3000)}`;

    try {
      if (config.aiProvider === 'gemini') {
        const result = await callGeminiChat(prompt, config, provider);
        return parseSummaryResponse(result);
      }

      const chatUrl = config.aiChatUrl || config.aiBaseUrl?.replace('/embeddings', '/chat/completions') || provider.chatUrl;
      const chatModel = config.chatModel || provider.chatModel;

      const resp = await fetch(chatUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: chatModel,
          messages: [{ role: 'user', content: prompt }],
          temperature: 0.3,
          max_tokens: 300
        })
      });

      if (!resp.ok) return null;
      const data = await resp.json();
      const content = data.choices?.[0]?.message?.content || '';
      return parseSummaryResponse(content);
    } catch (e) {
      console.warn('[IntelligentSearch] Summary generation failed:', e.message);
      return null;
    }
  }

  function parseSummaryResponse(text) {
    if (!text) return null;
    const summaryMatch = text.match(/摘要[：:]\s*([\s\S]*?)(?=标签[：:]|$)/);
    const tagsMatch = text.match(/标签[：:]\s*(.*)/);
    return {
      summary: summaryMatch?.[1]?.trim() || text.trim().slice(0, 100),
      tags: tagsMatch?.[1]?.split(/[,，、]/).map(t => t.trim()).filter(Boolean) || []
    };
  }

  // ==================== Embedding 索引构建 ====================

  let buildState = { running: false, paused: false, progress: 0, total: 0 };

  async function buildEmbeddingIndex(items, config, onProgress) {
    if (buildState.running) {
      throw new Error('正在构建中，请等待或暂停后重试');
    }

    buildState = { running: true, paused: false, progress: 0, total: items.length };
    const BATCH_SIZE = 20;

    try {
      for (let i = 0; i < items.length; i += BATCH_SIZE) {
        if (buildState.paused) {
          buildState.running = false;
          if (onProgress) onProgress({ type: 'paused', progress: buildState.progress, total: buildState.total });
          return { ok: true, paused: true, progress: buildState.progress };
        }

        const batch = items.slice(i, i + BATCH_SIZE);
        const textsToEmbed = [];
        const itemsToEmbed = [];

        for (const item of batch) {
          const existingVec = await getVector(item.id || `bookmark_${item.id}`);
          if (existingVec) {
            buildState.progress++;
            continue;
          }
          const text = buildEmbeddingText(item);
          textsToEmbed.push(text);
          itemsToEmbed.push(item);
        }

        if (textsToEmbed.length > 0) {
          const embeddings = await callEmbeddingAPI(textsToEmbed, config);
          for (let j = 0; j < itemsToEmbed.length; j++) {
            const id = itemsToEmbed[j].id || `bookmark_${itemsToEmbed[j].id}`;
            await putVector({
              id,
              embedding: embeddings[j],
              text: textsToEmbed[j],
              ts: Date.now()
            });
            buildState.progress++;
          }
        }

        if (onProgress) {
          onProgress({
            type: 'progress',
            progress: buildState.progress,
            total: buildState.total
          });
        }

        if (i + BATCH_SIZE < items.length) {
          await new Promise(r => setTimeout(r, 100));
        }
      }

      buildState.running = false;
      if (onProgress) onProgress({ type: 'complete', progress: buildState.total, total: buildState.total });
      return { ok: true, progress: buildState.total };
    } catch (e) {
      buildState.running = false;
      if (onProgress) onProgress({ type: 'error', error: e.message, progress: buildState.progress, total: buildState.total });
      throw e;
    }
  }

  function pauseEmbeddingBuild() {
    buildState.paused = true;
  }

  function getBuildStatus() {
    return { ...buildState };
  }

  function buildEmbeddingText(item) {
    const parts = [];
    if (item.title) parts.push(item.title);
    if (item.url) {
      try {
        const url = new URL(item.url);
        parts.push(url.hostname.replace('www.', ''));
        const pathParts = url.pathname.split('/').filter(Boolean);
        if (pathParts.length > 0) parts.push(pathParts.join(' '));
      } catch (_) {
        parts.push(item.url);
      }
    }
    if (item.summary) parts.push(item.summary);
    if (item.contentTags) parts.push(item.contentTags.join(' '));
    return parts.join(' | ');
  }

  // ==================== 增量索引 ====================

  async function handleBookmarkCreated(bookmark, config) {
    if (!config.enabled || !config.aiApiKey) return;
    try {
      const text = buildEmbeddingText(bookmark);
      const embeddings = await callEmbeddingAPI([text], config);
      await putVector({
        id: bookmark.id,
        embedding: embeddings[0],
        text,
        ts: Date.now()
      });
      console.log('[IntelligentSearch] Indexed new bookmark:', bookmark.title);
    } catch (e) {
      console.warn('[IntelligentSearch] Failed to index new bookmark:', e.message);
    }
  }

  async function handleBookmarkRemoved(bookmarkId) {
    try {
      await deleteVector(bookmarkId);
      console.log('[IntelligentSearch] Removed vector for bookmark:', bookmarkId);
    } catch (e) {
      console.warn('[IntelligentSearch] Failed to remove vector:', e.message);
    }
  }

  async function handleBookmarkChanged(bookmark, config) {
    await handleBookmarkRemoved(bookmark.id);
    await handleBookmarkCreated(bookmark, config);
  }

  // ==================== 混合搜索主入口 ====================

  async function hybridSearch(query, items, config, options = {}) {
    const { limit = 50, rerank = false } = options;

    if (!config.enabled || !config.aiApiKey) {
      return { ok: false, fallback: true, error: '智能搜索未启用' };
    }

    const vectorCount = await getVectorCount();
    if (vectorCount === 0) {
      return { ok: false, fallback: true, error: '向量索引为空，请先构建索引' };
    }

    try {
      const bm25Index = buildBM25Index(items);
      const keywordResults = bm25Search(query, items, bm25Index)
        .filter(r => r.score > 0)
        .slice(0, limit);

      let queryEmbedding = await getCachedQueryEmbedding(query);
      if (!queryEmbedding) {
        const embeddings = await callEmbeddingAPI([query], config);
        queryEmbedding = embeddings[0];
        await cacheQueryEmbedding(query, queryEmbedding);
      }

      const semanticResults = await vectorSearch(queryEmbedding, items, limit);

      let fusedResults = rrfFusion(keywordResults, semanticResults);

      if (rerank && config.rerankEnabled) {
        fusedResults = await llmRerank(query, fusedResults, config, Math.min(limit, 15));
      } else {
        fusedResults = fusedResults.slice(0, limit);
      }

      return {
        ok: true,
        results: fusedResults.map(r => ({
          ...r.item,
          _matchType: r.keywordScore > 0 && r.semanticScore > 0 ? 'hybrid'
            : r.keywordScore > 0 ? 'keyword'
            : 'semantic',
          _rrfScore: r.rrfScore,
          _keywordScore: r.keywordScore,
          _semanticScore: r.semanticScore
        }))
      };
    } catch (e) {
      console.error('[IntelligentSearch] Search error:', e);
      return { ok: false, fallback: true, error: e.message };
    }
  }

  // ==================== API Key 验证 ====================

  async function verifyApiKey(config) {
    try {
      const embeddings = await callEmbeddingAPI(['test'], config);
      return { ok: true, message: '验证成功' };
    } catch (e) {
      return { ok: false, message: e.message };
    }
  }

  // ==================== 网页内容提取 ====================

  async function extractWebContent(tabId) {
    try {
      const results = await chrome.scripting.executeScript({
        target: { tabId },
        func: () => {
          const article = document.querySelector('article') || document.querySelector('main') || document.body;
          const scripts = article.querySelectorAll('script, style, nav, footer, header, aside');
          scripts.forEach(el => el.remove());
          return article.innerText.slice(0, 5000);
        }
      });
      return results?.[0]?.result || '';
    } catch (e) {
      console.warn('[IntelligentSearch] Content extraction failed:', e.message);
      return '';
    }
  }

  async function extractAndSummarize(bookmarkId, config) {
    try {
      const tab = await chrome.tabs.create({ url: '', active: false });
      const bookmark = (await chrome.bookmarks.get(bookmarkId))?.[0];
      if (!bookmark?.url) throw new Error('书签不存在或无 URL');

      await chrome.tabs.update(tab.id, { url: bookmark.url });
      await new Promise(r => setTimeout(r, 3000));

      const content = await extractWebContent(tab.id);
      await chrome.tabs.remove(tab.id);

      if (!content) throw new Error('无法提取页面内容');

      const summaryData = await generateSummary(content, config);
      if (!summaryData) throw new Error('摘要生成失败');

      const existingVec = await getVector(bookmarkId);
      const newText = buildEmbeddingText({
        ...bookmark,
        summary: summaryData.summary,
        contentTags: summaryData.tags
      });
      const embeddings = await callEmbeddingAPI([newText], config);

      await putVector({
        id: bookmarkId,
        embedding: embeddings[0],
        text: newText,
        ts: Date.now()
      });

      return { ok: true, summary: summaryData.summary, tags: summaryData.tags };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ==================== 导出 ====================
  return {
    AI_PROVIDERS,
    hybridSearch,
    buildEmbeddingIndex,
    pauseEmbeddingBuild,
    getBuildStatus,
    handleBookmarkCreated,
    handleBookmarkRemoved,
    handleBookmarkChanged,
    verifyApiKey,
    extractAndSummarize,
    generateSummary,
    getVectorCount,
    getAllVectors
  };
})();

if (typeof self !== 'undefined') {
  self.IntelligentSearch = IntelligentSearch;
}
