/**
 * DOM helper utilities shared across content scripts
 */

const DOMHelpers = {
  /**
   * Create element with attributes and styles
   */
  createElement(tag, { attrs = {}, styles = {}, classes = [], children = [] } = {}) {
    const el = document.createElement(tag);

    Object.entries(attrs).forEach(([key, val]) => el.setAttribute(key, val));
    Object.entries(styles).forEach(([key, val]) => el.style[key] = val);
    classes.forEach(cls => el.classList.add(cls));
    children.forEach(child => el.appendChild(child));

    return el;
  },

  /**
   * Create SVG element (handles namespace correctly)
   */
  createSVGElement(tag, attrs = {}) {
    const el = document.createElementNS('http://www.w3.org/2000/svg', tag);
    Object.entries(attrs).forEach(([key, val]) => el.setAttribute(key, val));
    return el;
  },

  /**
   * Get element's viewport-relative bounds with DPR adjustment
   */
  getScreenshotBounds(element) {
    const rect = element.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    return {
      x: Math.round(rect.left * dpr),
      y: Math.round(rect.top * dpr),
      width: Math.round(rect.width * dpr),
      height: Math.round(rect.height * dpr),
      dpr
    };
  },

  /**
   * Find scrollable ancestor
   */
  findScrollContainer(element) {
    let parent = element.parentElement;
    while (parent) {
      const style = window.getComputedStyle(parent);
      if (style.overflow === 'auto' || style.overflow === 'scroll' ||
          style.overflowY === 'auto' || style.overflowY === 'scroll') {
        return parent;
      }
      parent = parent.parentElement;
    }
    return window;
  },

  /**
   * Check if element is visible in viewport
   */
  isInViewport(element) {
    const rect = element.getBoundingClientRect();
    return (
      rect.top >= 0 &&
      rect.left >= 0 &&
      rect.bottom <= (window.innerHeight || document.documentElement.clientHeight) &&
      rect.right <= (window.innerWidth || document.documentElement.clientWidth)
    );
  },

  /**
   * Wait for element to appear in DOM
   */
  waitForElement(selector, timeout = 5000) {
    return new Promise((resolve, reject) => {
      const existing = document.querySelector(selector);
      if (existing) {
        resolve(existing);
        return;
      }

      const observer = new MutationObserver((mutations, obs) => {
        const el = document.querySelector(selector);
        if (el) {
          obs.disconnect();
          resolve(el);
        }
      });

      observer.observe(document.body, { childList: true, subtree: true });

      setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Element ${selector} not found within ${timeout}ms`));
      }, timeout);
    });
  },

  /**
   * Debounce function calls
   */
  debounce(fn, delay) {
    let timeoutId;
    return (...args) => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(() => fn(...args), delay);
    };
  },

  /**
   * Check if element is inside navigation/header/footer
   */
  isInChromeArea(element) {
    const chromeSelectors = [
      'nav', 'header', 'footer', 'aside',
      '[role="navigation"]', '[role="banner"]', '[role="contentinfo"]',
      '.sidebar', '.nav', '.header', '.footer', '.comments'
    ];

    return chromeSelectors.some(sel => element.closest(sel));
  }
};

// Make available globally
if (typeof window !== 'undefined') {
  window.DOMHelpers = DOMHelpers;
}
