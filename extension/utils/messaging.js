/**
 * Message passing utilities for extension communication
 */

const Messaging = {
  /**
   * Send message to background script with promise wrapper
   */
  sendToBackground(action, data = {}) {
    return new Promise((resolve, reject) => {
      const message = { action, ...data };

      chrome.runtime.sendMessage(message, response => {
        if (chrome.runtime.lastError) {
          reject(new Error(chrome.runtime.lastError.message));
        } else {
          resolve(response);
        }
      });
    });
  },

  /**
   * Archive URL through background script
   */
  async archive(url, options = {}) {
    return this.sendToBackground('archive', {
      url,
      title: options.title || document.title,
      pageUrl: options.pageUrl || window.location.href,
      saveMode: options.saveMode || 'full',
      screenshot: options.screenshot || null,
      tweetContent: options.tweetContent || null,
      emotionTag: options.emotionTag || null
    });
  },

  /**
   * Archive image through background script
   */
  async archiveImage(imageUrl, options = {}) {
    return this.sendToBackground('archiveImage', {
      imageUrl,
      pageUrl: options.pageUrl || window.location.href,
      saveMode: options.saveMode || 'full',
      metadata: options.metadata || {}
    });
  },

  /**
   * Capture screenshot of element bounds
   */
  async captureScreenshot(bounds) {
    return this.sendToBackground('captureScreenshot', { bounds });
  },

  /**
   * Check server availability
   */
  async checkServer() {
    return this.sendToBackground('checkServer');
  },

  /**
   * Get recent jobs
   */
  async getJobs(limit = 50) {
    return this.sendToBackground('getJobs', { limit });
  }
};

// Make available globally
if (typeof window !== 'undefined') {
  window.Messaging = Messaging;
}
