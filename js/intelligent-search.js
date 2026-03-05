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
    gemini: {
      name: 'Gemini (推荐，免费额度大)',
      embeddingUrl: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:embedContent',
      chatUrl: 'https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent',
      embeddingModel: 'text-embedding-004',
      chatModel: 'gemini-2.0-flash',
      dimensions: 768,
      supportsEmbedding: true,
      supportsChat: true
    },
    openai: {
      name: 'OpenAI',
      embeddingUrl: 'https://api.openai.com/v1/embeddings',
      chatUrl: 'https://api.openai.com/v1/chat/completions',
      embeddingModel: 'text-embedding-3-small',
      chatModel: 'gpt-4o-mini',
      dimensions: 384,
      supportsEmbedding: true,
      supportsChat: true
    },
    deepseek: {
      name: 'DeepSeek',
      embeddingUrl: 'https://api.deepseek.com/v1/embeddings',
      chatUrl: 'https://api.deepseek.com/v1/chat/completions',
      embeddingModel: 'deepseek-embedding',
      chatModel: 'deepseek-chat',
      dimensions: 1536,
      supportsEmbedding: true,
      supportsChat: true
    },
    qwen: {
      name: '通义千问 (Qwen)',
      embeddingUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/embeddings',
      chatUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
      embeddingModel: 'text-embedding-v3',
      chatModel: 'qwen-plus',
      dimensions: 1024,
      supportsEmbedding: true,
      supportsChat: true
    },
    siliconflow: {
      name: 'SiliconFlow',
      embeddingUrl: 'https://api.siliconflow.cn/v1/embeddings',
      chatUrl: 'https://api.siliconflow.cn/v1/chat/completions',
      embeddingModel: 'BAAI/bge-m3',
      chatModel: 'deepseek-ai/DeepSeek-V3',
      dimensions: 1024,
      supportsEmbedding: true,
      supportsChat: true
    },
    custom: {
      name: '自定义 (OpenAI 兼容)',
      embeddingUrl: '',
      chatUrl: '',
      embeddingModel: '',
      chatModel: '',
      dimensions: 384,
      supportsEmbedding: true,
      supportsChat: true
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

  function normalizeBaseUrl(rawBaseUrl) {
    let base = rawBaseUrl.replace(/\/+$/, '');
    if (/^https?:\/\/[^/]+$/.test(base)) {
      base += '/v1';
    }
    return base;
  }

  function deriveEmbeddingUrl(config, provider) {
    if (config.aiBaseUrl) {
      const base = normalizeBaseUrl(config.aiBaseUrl);
      if (base.endsWith('/embeddings')) return base;
      return base.replace(/\/chat\/completions$/, '') + '/embeddings';
    }
    return provider.embeddingUrl;
  }

  function deriveChatUrl(config, provider) {
    if (config.aiBaseUrl) {
      const base = normalizeBaseUrl(config.aiBaseUrl);
      if (base.endsWith('/chat/completions')) return base;
      return base.replace(/\/embeddings$/, '') + '/chat/completions';
    }
    return provider.chatUrl;
  }

  // ==================== Embedding API ====================

  async function callEmbeddingAPI(texts, config) {
    const provider = AI_PROVIDERS[config.aiProvider] || AI_PROVIDERS.custom;
    const apiKey = config.aiApiKey;
    if (!apiKey) throw new Error('未配置 API Key');
    if (!provider.supportsEmbedding) {
      throw new Error(`${provider.name} 不支持 Embedding，请切换到支持 Embedding 的服务商（如 Gemini、DeepSeek、Qwen、SiliconFlow）`);
    }


    if (config.aiProvider === 'gemini') {
      return callGeminiEmbedding(texts, config, provider);
    }

    const baseUrl = deriveEmbeddingUrl(config, provider);
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
        const chatUrl = config.aiChatUrl || deriveChatUrl(config, provider);
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

      const chatUrl = config.aiChatUrl || deriveChatUrl(config, provider);
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
  // 设计要点：
  // - Service Worker 可能在 30s 闲置后休眠，长任务会中断
  // - 使用 chrome.storage.local 持久化构建状态，支持断点续传
  // - 通过 chrome.alarms 定时唤醒 SW 继续未完成的构建
  // - 每批处理少量（10条），处理完立即保存进度

  const BUILD_STATE_KEY = 'embeddingBuildState';
  const BUILD_ALARM_NAME = 'embeddingBuildAlarm';
  const BATCH_SIZE = 10;

  let buildState = { running: false, paused: false, progress: 0, total: 0, error: null };

  async function loadBuildState() {
    try {
      const data = await chrome.storage.local.get(BUILD_STATE_KEY);
      return data[BUILD_STATE_KEY] || null;
    } catch { return null; }
  }

  async function saveBuildState(state) {
    try {
      await chrome.storage.local.set({ [BUILD_STATE_KEY]: state });
    } catch (e) {
      console.warn('[IntelligentSearch] Failed to save build state:', e.message);
    }
  }

  async function clearBuildState() {
    try {
      await chrome.storage.local.remove(BUILD_STATE_KEY);
    } catch {}
  }

  async function buildEmbeddingIndex(items, config, onProgress) {
    if (buildState.running) {
      throw new Error('正在构建中，请等待或暂停后重试');
    }

    const bookmarkIds = items.map(item => item.id).filter(Boolean);
    buildState = { running: true, paused: false, progress: 0, total: items.length, error: null };

    await saveBuildState({
      status: 'running',
      bookmarkIds,
      processedIds: [],
      total: items.length,
      startedAt: Date.now()
    });

    return await processBuildBatch(items, config, onProgress);
  }

  async function processBuildBatch(items, config, onProgress) {
    try {
      const persistedState = await loadBuildState();
      const processedSet = new Set(persistedState?.processedIds || []);
      buildState.progress = processedSet.size;
      buildState.total = items.length;

      const pendingItems = items.filter(item => !processedSet.has(item.id));

      for (let i = 0; i < pendingItems.length; i += BATCH_SIZE) {
        if (buildState.paused) {
          buildState.running = false;
          await saveBuildState({
            status: 'paused',
            bookmarkIds: items.map(it => it.id).filter(Boolean),
            processedIds: Array.from(processedSet),
            total: items.length,
            startedAt: persistedState?.startedAt || Date.now()
          });
          if (onProgress) onProgress({ type: 'paused', progress: buildState.progress, total: buildState.total });
          return { ok: true, paused: true, progress: buildState.progress };
        }

        const batch = pendingItems.slice(i, i + BATCH_SIZE);
        const textsToEmbed = [];
        const itemsToEmbed = [];

        for (const item of batch) {
          const existingVec = await getVector(item.id);
          if (existingVec) {
            processedSet.add(item.id);
            buildState.progress = processedSet.size;
            continue;
          }
          const text = buildEmbeddingText(item);
          if (text.trim()) {
            textsToEmbed.push(text);
            itemsToEmbed.push(item);
          } else {
            processedSet.add(item.id);
            buildState.progress = processedSet.size;
          }
        }

        if (textsToEmbed.length > 0) {
          const embeddings = await callEmbeddingAPI(textsToEmbed, config);
          for (let j = 0; j < itemsToEmbed.length; j++) {
            await putVector({
              id: itemsToEmbed[j].id,
              embedding: embeddings[j],
              text: textsToEmbed[j],
              ts: Date.now()
            });
            processedSet.add(itemsToEmbed[j].id);
            buildState.progress = processedSet.size;
          }
        }

        await saveBuildState({
          status: 'running',
          bookmarkIds: items.map(it => it.id).filter(Boolean),
          processedIds: Array.from(processedSet),
          total: items.length,
          startedAt: persistedState?.startedAt || Date.now()
        });

        if (onProgress) {
          onProgress({
            type: 'progress',
            progress: buildState.progress,
            total: buildState.total
          });
        }

        if (i + BATCH_SIZE < pendingItems.length) {
          await new Promise(r => setTimeout(r, 200));
        }
      }

      buildState.running = false;
      await clearBuildState();
      if (onProgress) onProgress({ type: 'complete', progress: buildState.total, total: buildState.total });
      return { ok: true, progress: buildState.total };
    } catch (e) {
      buildState.running = false;
      buildState.error = e.message;

      const persistedState = await loadBuildState();
      if (persistedState) {
        persistedState.status = 'error';
        persistedState.error = e.message;
        await saveBuildState(persistedState);
      }

      if (onProgress) onProgress({ type: 'error', error: e.message, progress: buildState.progress, total: buildState.total });
      throw e;
    }
  }

  async function resumeBuild(config, onProgress) {
    const persistedState = await loadBuildState();
    if (!persistedState || persistedState.status === 'complete') {
      return { ok: true, message: '没有需要恢复的构建任务' };
    }

    if (buildState.running) {
      return { ok: false, message: '构建正在运行中' };
    }

    console.log('[IntelligentSearch] Resuming build:', persistedState.processedIds?.length, '/', persistedState.total, 'done');

    const bookmarkTree = await chrome.bookmarks.getTree();
    const allBookmarks = [];
    function traverse(node) {
      if (node.url) allBookmarks.push(node);
      if (node.children) node.children.forEach(traverse);
    }
    bookmarkTree.forEach(traverse);

    const targetIds = new Set(persistedState.bookmarkIds || []);
    const items = allBookmarks.filter(b => targetIds.has(b.id));

    if (items.length === 0) {
      await clearBuildState();
      return { ok: true, message: '书签数据已变更，已清除旧构建状态' };
    }

    buildState = { running: true, paused: false, progress: persistedState.processedIds?.length || 0, total: persistedState.total, error: null };
    return await processBuildBatch(items, config, onProgress);
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

      const allVectors = await getAllVectors();
      const vectorSummaryMap = new Map(allVectors.map(v => [v.id, v.summary || '']));

      return {
        ok: true,
        results: fusedResults.map(r => {
          const matchType = r.keywordScore > 0 && r.semanticScore > 0 ? 'hybrid'
            : r.keywordScore > 0 ? 'keyword' : 'semantic';

          return {
            ...r.item,
            _matchType: matchType,
            _rrfScore: r.rrfScore,
            _keywordScore: r.keywordScore,
            _semanticScore: r.semanticScore,
            _relevance: Math.round((r.semanticScore || 0) * 100),
            _summary: vectorSummaryMap.get(r.item.id) || r.item.summary || ''
          };
        })
      };
    } catch (e) {
      console.error('[IntelligentSearch] Search error:', e);
      return { ok: false, fallback: true, error: e.message };
    }
  }

  // ==================== 统一多源语义搜索 ====================

  async function unifiedSemanticSearch(query, sources, config, options = {}) {
    const { limit = 50, rerank = false } = options;

    if (!config.enabled || !config.aiApiKey) {
      return { ok: false, fallback: true, error: '智能搜索未启用' };
    }

    const vectorCount = await getVectorCount();
    if (vectorCount === 0) {
      return { ok: false, fallback: true, error: '向量索引为空，请先构建索引' };
    }

    try {
      const allItems = [];
      const { bookmarks = [], history = [], tabs = [] } = sources;

      bookmarks.forEach(b => {
        allItems.push({ ...b, _source: 'bookmark', id: b.id || `bm_${b.url}` });
      });
      history.forEach(h => {
        allItems.push({
          ...h,
          _source: 'history',
          id: h.id || `hist_${h.url}`,
          summary: ''
        });
      });
      tabs.forEach(t => {
        allItems.push({
          ...t,
          _source: 'tab',
          id: t.id ? `tab_${t.id}` : `tab_${t.url}`,
          summary: ''
        });
      });

      const seen = new Set();
      const dedupItems = allItems.filter(item => {
        const key = item.url || item.id;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      const bm25Index = buildBM25Index(dedupItems);
      const keywordResults = bm25Search(query, dedupItems, bm25Index)
        .filter(r => r.score > 0)
        .slice(0, limit);

      let queryEmbedding = await getCachedQueryEmbedding(query);
      if (!queryEmbedding) {
        const embeddings = await callEmbeddingAPI([query], config);
        queryEmbedding = embeddings[0];
        await cacheQueryEmbedding(query, queryEmbedding);
      }

      const semanticResults = await vectorSearch(queryEmbedding, dedupItems, limit);

      let fusedResults = rrfFusion(keywordResults, semanticResults);

      if (rerank && config.rerankEnabled) {
        fusedResults = await llmRerank(query, fusedResults, config, Math.min(limit, 15));
      } else {
        fusedResults = fusedResults.slice(0, limit);
      }

      const allVectors = await getAllVectors();
      const vectorSummaryMap = new Map(allVectors.map(v => [v.id, v.summary || '']));

      return {
        ok: true,
        results: fusedResults.map(r => {
          const matchType = r.keywordScore > 0 && r.semanticScore > 0 ? 'hybrid'
            : r.keywordScore > 0 ? 'keyword' : 'semantic';

          return {
            ...r.item,
            _matchType: matchType,
            _source: r.item._source || 'bookmark',
            _rrfScore: r.rrfScore,
            _keywordScore: r.keywordScore,
            _semanticScore: r.semanticScore,
            _relevance: Math.round((r.semanticScore || 0) * 100),
            _summary: vectorSummaryMap.get(r.item.id) || r.item.summary || ''
          };
        })
      };
    } catch (e) {
      console.error('[IntelligentSearch] Unified search error:', e);
      return { ok: false, fallback: true, error: e.message };
    }
  }

  // ==================== API Key 验证 ====================

  async function verifyApiKey(config) {
    const provider = AI_PROVIDERS[config.aiProvider] || AI_PROVIDERS.custom;
    let embeddingOk = false;
    let chatOk = false;
    let embeddingErr = '';
    let chatErr = '';

    if (provider.supportsEmbedding) {
      try {
        await callEmbeddingAPI(['test'], config);
        embeddingOk = true;
      } catch (e) {
        embeddingErr = e.message;
      }
    }

    if (provider.supportsChat) {
      try {
        let resp;
        if (config.aiProvider === 'gemini') {
          const model = config.chatModel || provider.chatModel;
          const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${config.aiApiKey}`;
          resp = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{ parts: [{ text: 'hi' }] }],
              generationConfig: { temperature: 0, maxOutputTokens: 5 }
            })
          });
        } else {
          const chatUrl = deriveChatUrl(config, provider);
          const chatModel = config.chatModel || provider.chatModel;
          resp = await fetch(chatUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${config.aiApiKey}` },
            body: JSON.stringify({ model: chatModel, messages: [{ role: 'user', content: 'hi' }], max_tokens: 5 })
          });
        }
        if (resp.ok) {
          chatOk = true;
        } else {
          const err = await resp.text().catch(() => '');
          chatErr = `Chat API (${resp.status}): ${err.slice(0, 150)}`;
        }
      } catch (e) {
        chatErr = e.message;
      }
    }

    if (embeddingOk && chatOk) {
      return { ok: true, message: '验证成功（Embedding + Chat 均可用）' };
    }
    if (embeddingOk) {
      return { ok: true, message: '验证成功（Embedding 可用，Chat 不可用：' + chatErr + '）' };
    }
    if (chatOk) {
      return { ok: true, message: '验证成功（Chat 可用，Embedding 不可用：' + embeddingErr + '）' };
    }
    return { ok: false, message: 'Embedding: ' + embeddingErr + '\nChat: ' + chatErr };
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
        summary: summaryData.summary,
        tags: summaryData.tags,
        ts: Date.now()
      });

      return { ok: true, summary: summaryData.summary, tags: summaryData.tags };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  }

  // ==================== 批量摘要提取 ====================

  const SUMMARY_BATCH_STATE_KEY = 'summaryBatchState';
  let summaryBatchState = { running: false, paused: false, progress: 0, total: 0, errors: [] };

  function getSummaryBatchStatus() {
    return { ...summaryBatchState };
  }

  function pauseSummaryBatch() {
    summaryBatchState.paused = true;
  }

  async function batchExtractSummaries(bookmarkIds, config, onProgress) {
    if (summaryBatchState.running) {
      throw new Error('批量摘要正在进行中');
    }

    summaryBatchState = { running: true, paused: false, progress: 0, total: bookmarkIds.length, errors: [] };

    try {
      for (let i = 0; i < bookmarkIds.length; i++) {
        if (summaryBatchState.paused) {
          summaryBatchState.running = false;
          if (onProgress) onProgress({ type: 'paused', progress: i, total: bookmarkIds.length });
          return { ok: true, paused: true, progress: i, total: bookmarkIds.length };
        }

        const existing = await getVector(bookmarkIds[i]);
        if (existing?.summary) {
          summaryBatchState.progress = i + 1;
          if (onProgress) onProgress({ type: 'progress', progress: i + 1, total: bookmarkIds.length, skipped: true });
          continue;
        }

        try {
          const result = await extractAndSummarize(bookmarkIds[i], config);
          if (!result.ok) {
            summaryBatchState.errors.push({ id: bookmarkIds[i], error: result.error });
          }
        } catch (e) {
          summaryBatchState.errors.push({ id: bookmarkIds[i], error: e.message });
        }

        summaryBatchState.progress = i + 1;
        if (onProgress) {
          onProgress({
            type: 'progress',
            progress: i + 1,
            total: bookmarkIds.length,
            errors: summaryBatchState.errors.length
          });
        }

        if (i < bookmarkIds.length - 1) {
          await new Promise(r => setTimeout(r, 1500));
        }
      }

      summaryBatchState.running = false;
      if (onProgress) onProgress({
        type: 'complete',
        progress: bookmarkIds.length,
        total: bookmarkIds.length,
        errors: summaryBatchState.errors.length
      });

      return { ok: true, progress: bookmarkIds.length, errors: summaryBatchState.errors };
    } catch (e) {
      summaryBatchState.running = false;
      summaryBatchState.error = e.message;
      throw e;
    }
  }

  // ==================== 获取书签的摘要/标签 ====================

  async function getBookmarkSummary(bookmarkId) {
    const vec = await getVector(bookmarkId);
    if (!vec) return null;
    return { summary: vec.summary || '', tags: vec.tags || [] };
  }

  // ==================== AI 推荐 ====================

  async function getRecommendations(currentUrl, currentTitle, bookmarks, config, topK = 8) {
    if (!config.enabled || !config.aiApiKey) {
      return { ok: false, error: '智能搜索未启用' };
    }

    const vectorCount = await getVectorCount();
    if (vectorCount === 0) {
      return { ok: false, error: '向量索引为空' };
    }

    if (!currentUrl && !currentTitle) {
      return { ok: false, error: '无法获取当前页面信息' };
    }

    try {
      let contextText = '';
      if (currentTitle) contextText += currentTitle;
      if (currentUrl) {
        try {
          const u = new URL(currentUrl);
          contextText += ' ' + u.hostname.replace('www.', '');
          const pathParts = u.pathname.split('/').filter(Boolean);
          if (pathParts.length > 0) contextText += ' ' + pathParts.join(' ');
        } catch (_) {
          contextText += ' ' + currentUrl;
        }
      }

      let queryEmbedding = await getCachedQueryEmbedding('_rec_' + contextText.slice(0, 100));
      if (!queryEmbedding) {
        const provider = AI_PROVIDERS[config.aiProvider] || AI_PROVIDERS.custom;
        if (!provider.supportsEmbedding) {
          return { ok: false, error: '当前服务商不支持 Embedding，无法生成推荐' };
        }
        const embeddings = await callEmbeddingAPI([contextText], config);
        queryEmbedding = embeddings[0];
        await cacheQueryEmbedding('_rec_' + contextText.slice(0, 100), queryEmbedding);
      }

      const bookmarksForSearch = bookmarks.filter(b => b.url !== currentUrl);
      const semanticResults = await vectorSearch(queryEmbedding, bookmarksForSearch, topK);

      const allVectors = await getAllVectors();
      const vectorSummaryMap = new Map(allVectors.map(v => [v.id, v.summary || '']));

      const results = semanticResults
        .filter(r => r.score > 0.15)
        .map(r => ({
          ...r.item,
          _source: 'bookmark',
          _matchType: 'semantic',
          _semanticScore: r.score,
          _relevance: Math.round(r.score * 100),
          _summary: vectorSummaryMap.get(r.item.id) || r.item.summary || '',
          _isRecommendation: true
        }));

      return { ok: true, results };
    } catch (e) {
      console.warn('[IntelligentSearch] Recommendation failed:', e.message);
      return { ok: false, error: e.message };
    }
  }

  // ==================== 导出 ====================
  return {
    AI_PROVIDERS,
    hybridSearch,
    unifiedSemanticSearch,
    getRecommendations,
    buildEmbeddingIndex,
    resumeBuild,
    pauseEmbeddingBuild,
    getBuildStatus,
    loadBuildState,
    clearBuildState,
    handleBookmarkCreated,
    handleBookmarkRemoved,
    handleBookmarkChanged,
    verifyApiKey,
    extractAndSummarize,
    batchExtractSummaries,
    getSummaryBatchStatus,
    pauseSummaryBatch,
    getBookmarkSummary,
    generateSummary,
    getVectorCount,
    getAllVectors
  };
})();

if (typeof self !== 'undefined') {
  self.IntelligentSearch = IntelligentSearch;
}
