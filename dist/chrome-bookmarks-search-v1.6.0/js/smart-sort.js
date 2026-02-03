/**
 * 智能排序模块
 * 支持多种排序方式：
 * - 相关度排序（默认）
 * - 时间排序（最近优先）
 * - 访问频率排序（最常用优先）
 */

class SmartSort {
  /**
   * 计算项目与搜索词的相关度分数
   * @param {Object} item 项目对象
   * @param {string} searchText 搜索文本
   * @returns {number} 相关度分数 (0-1)
   */
  static getRelevanceScore(item, searchText) {
    if (!searchText) return 0;
    const searchLower = searchText.toLowerCase();
    let score = 0;
    
    // 标题匹配权重
    if (item.title) {
      const titleLower = item.title.toLowerCase();
      if (titleLower === searchLower) score += 1;
      else if (titleLower.startsWith(searchLower)) score += 0.8;
      else if (titleLower.includes(searchLower)) score += 0.6;
    }
    
    // URL匹配权重
    if (item.url) {
      const urlLower = item.url.toLowerCase();
      if (urlLower.includes(searchLower)) score += 0.4;
    }
    
    // 文件名匹配权重（下载项）
    if (item.filename) {
      const filenameLower = item.filename.toLowerCase();
      if (filenameLower.includes(searchLower)) score += 0.5;
    }
    
    return Math.min(1, score);
  }
  
  /**
   * 计算时间分数
   * @param {Object} item 项目对象
   * @returns {number} 时间分数 (0-1)
   */
  static getTimeScore(item) {
    const now = Date.now();
    const itemTime = item.lastVisit || item.startTime || item.dateAdded || 0;
    const age = now - itemTime;
    const maxAge = 30 * 24 * 60 * 60 * 1000; // 30天
    return Math.max(0, 1 - age / maxAge);
  }
  
  /**
   * 计算访问频率分数
   * @param {Object} item 项目对象
   * @returns {number} 频率分数 (0-1)
   */
  static getFrequencyScore(item) {
    const visitCount = item.visitCount || 0;
    const maxVisits = 100; // 假设100次访问为最大值
    return Math.min(1, visitCount / maxVisits);
  }
  
  /**
   * 智能排序
   * @param {Array} items 要排序的项目列表
   * @param {Object} options 排序选项
   * @returns {Array} 排序后的列表
   */
  static sort(items, options = {}) {
    const {
      searchText = '',
      mode = 'smart', // smart, time, frequency
      order = 'desc' // asc, desc
    } = options;
    
    // 备份原始数组
    const sortedItems = [...items];
    
    // 计算综合得分
    const getScore = (item) => {
      switch (mode) {
        case 'time':
          return this.getTimeScore(item);
        case 'frequency':
          return this.getFrequencyScore(item);
        case 'smart':
        default:
          const relevance = this.getRelevanceScore(item, searchText);
          const time = this.getTimeScore(item);
          const frequency = this.getFrequencyScore(item);
          // 智能模式下的权重分配
          return relevance * 0.5 + time * 0.3 + frequency * 0.2;
      }
    };
    
    // 排序
    sortedItems.sort((a, b) => {
      const scoreA = getScore(a);
      const scoreB = getScore(b);
      return order === 'desc' ? scoreB - scoreA : scoreA - scoreB;
    });
    
    return sortedItems;
  }
}

// 导出排序模块
window.SmartSort = SmartSort;
