const DEFAULT_TAG_PALETTE = ['工作', '学习', '待读', '前端', '后端', '设计', '工具', '新闻', '娱乐', '参考'];

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

if (typeof window !== 'undefined') {
  window.DEFAULT_TAG_PALETTE = DEFAULT_TAG_PALETTE;
  window.BookmarkTags = BookmarkTags;
}
