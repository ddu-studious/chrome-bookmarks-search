/**
 * 搜索语法解析器
 * 支持的语法：
 * - site:github.com       (限定网站)
 * - type:pdf             (文件类型)
 * - in:title             (搜索范围)
 * - after:2024-01        (时间过滤)
 * - before:2024-02       (时间过滤)
 * - 空格分隔多关键字      (AND 逻辑)
 * - "精确匹配"           (引号内作为整体匹配)
 */

class SearchParser {
  // 搜索命令定义
  static COMMANDS = {
    site: {
      regex: /site:([^\s]+)/,
      process: (value, item) => {
        try {
          const itemHost = new URL(item.url).hostname;
          const searchHost = value.toLowerCase();
          return itemHost.includes(searchHost);
        } catch {
          return false;
        }
      }
    },
    type: {
      regex: /type:([^\s]+)/,
      process: (value, item) => {
        if (!item.filename) return false;
        const ext = item.filename.split('.').pop().toLowerCase();
        return ext === value.toLowerCase();
      }
    },
    in: {
      regex: /in:(title|url)/,
      process: (value, item, searchText) => {
        if (value === 'title') {
          return item.title?.toLowerCase().includes(searchText.toLowerCase());
        } else if (value === 'url') {
          return item.url?.toLowerCase().includes(searchText.toLowerCase());
        }
        return true;
      }
    },
    after: {
      regex: /after:(\d{4}-\d{2}(?:-\d{2})?)/,
      process: (value, item) => {
        const date = new Date(value);
        const itemDate = new Date(item.lastVisit || item.startTime || 0);
        return itemDate >= date;
      }
    },
    before: {
      regex: /before:(\d{4}-\d{2}(?:-\d{2})?)/,
      process: (value, item) => {
        const date = new Date(value);
        const itemDate = new Date(item.lastVisit || item.startTime || 0);
        return itemDate <= date;
      }
    }
  };

  /**
   * 解析关键字，支持引号精确匹配和空格分隔的多关键字
   * @param {string} text 搜索文本（已去除命令）
   * @returns {{exactMatches: string[], keywords: string[]}} 解析结果
   */
  static parseKeywords(text) {
    const exactMatches = [];
    const keywords = [];
    
    // 提取引号内的精确匹配词组
    let remaining = text.replace(/"([^"]+)"/g, (match, p1) => {
      if (p1.trim()) {
        exactMatches.push(p1.trim());
      }
      return '';
    });
    
    // 剩余文本按空格分割为关键字
    remaining.trim().split(/\s+/).filter(Boolean).forEach(kw => {
      keywords.push(kw);
    });
    
    return { exactMatches, keywords };
  }

  /**
   * 检查项目是否匹配所有关键字（AND 逻辑）
   * @param {Object} item 项目对象
   * @param {string[]} exactMatches 精确匹配词组
   * @param {string[]} keywords 关键字列表
   * @param {string|null} inField 限定搜索字段 (title/url/null)
   * @returns {boolean} 是否匹配
   */
  static matchAllKeywords(item, exactMatches, keywords, inField = null) {
    // 构建可搜索文本
    let searchable;
    if (inField === 'title') {
      searchable = (item.title || '').toLowerCase();
    } else if (inField === 'url') {
      searchable = (item.url || '').toLowerCase();
    } else {
      searchable = [
        item.title || '',
        item.url || '',
        item.filename || ''
      ].join(' ').toLowerCase();
    }
    
    // 检查所有精确匹配词组
    for (const exact of exactMatches) {
      if (!searchable.includes(exact.toLowerCase())) {
        return false;
      }
    }
    
    // 检查所有关键字（AND 逻辑）
    for (const kw of keywords) {
      if (!searchable.includes(kw.toLowerCase())) {
        return false;
      }
    }
    
    return true;
  }

  /**
   * 解析搜索文本，提取命令和搜索词
   * @param {string} searchText 完整的搜索文本
   * @returns {{commands: Object, remainingText: string, exactMatches: string[], keywords: string[]}} 解析结果
   */
  static parse(searchText) {
    const commands = {};
    let text = searchText.trim();

    // 提取所有命令
    Object.entries(this.COMMANDS).forEach(([name, command]) => {
      const match = text.match(command.regex);
      if (match) {
        commands[name] = match[1];
        text = text.replace(match[0], '').trim();
      }
    });

    // 解析剩余文本中的关键字
    const { exactMatches, keywords } = this.parseKeywords(text);

    return {
      commands,
      remainingText: text,
      exactMatches,
      keywords
    };
  }

  /**
   * 过滤项目列表
   * @param {Array} items 要过滤的项目列表
   * @param {string} searchText 搜索文本
   * @returns {Array} 过滤后的列表
   */
  static filter(items, searchText) {
    if (!searchText.trim()) return items;

    const { commands, exactMatches, keywords } = this.parse(searchText);
    
    return items.filter(item => {
      // 应用所有命令过滤
      for (const [name, value] of Object.entries(commands)) {
        const command = this.COMMANDS[name];
        // 对于 in: 命令，需要特殊处理
        if (name === 'in') {
          // in: 命令会在后面的关键字匹配中处理
          continue;
        }
        if (!command.process(value, item, '')) {
          return false;
        }
      }

      // 如果有关键字或精确匹配词，进行多关键字 AND 匹配
      if (exactMatches.length > 0 || keywords.length > 0) {
        const inField = commands.in || null;
        return this.matchAllKeywords(item, exactMatches, keywords, inField);
      }

      return true;
    });
  }
}

// 导出搜索解析器
window.SearchParser = SearchParser;
