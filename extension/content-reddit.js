// Reddit-specific content script for Media Archiver
// Supports both old.reddit.com and new reddit (www.reddit.com)

(function() {
  'use strict';

  const browserAPI = (typeof browser !== 'undefined') ? browser : chrome;

  // Configuration
  const BUTTON_STYLES = {
    position: 'absolute',
    right: '8px',
    top: '8px',
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    backgroundColor: 'rgba(255, 69, 0, 0.1)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(255, 69, 0, 0.2)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    zIndex: '10',
    transition: 'all 0.2s ease',
    opacity: '0',
    transform: 'scale(0.9)'
  };

  // Track processed posts
  const processedPosts = new WeakSet();
  const downloadingPosts = new Set();

  // Save mode config with distinct arrows
  const SAVE_MODES = {
    full: { icon: '⬇️', label: 'Full save', desc: 'media + screenshot' },
    quick: { icon: '↓', label: 'Quick', desc: 'media only' },
    text: { icon: '📋', label: 'Text', desc: 'screenshot + meta' }
  };

  // Create hover menu HTML
  function createHoverMenu() {
    const menu = document.createElement('div');
    menu.className = 'archiver-menu';
    menu.innerHTML = `
      <div class="archiver-menu-item active" data-mode="full">
        <span>⬇️</span> Full save <kbd>click</kbd>
      </div>
      <div class="archiver-menu-item" data-mode="quick">
        <span>↓</span> Quick <kbd>⇧</kbd>
      </div>
      <div class="archiver-menu-item" data-mode="text">
        <span>📋</span> Text only <kbd>⌥</kbd>
      </div>
    `;
    return menu;
  }

  // Detect Reddit version
  function isOldReddit() {
    return window.location.hostname === 'old.reddit.com' ||
           document.querySelector('#header-bottom-left') !== null;
  }

  // Capture element screenshot via background script
  async function captureElement(element) {
    const rect = element.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const bounds = {
      x: Math.round((rect.x + window.scrollX) * dpr),
      y: Math.round(rect.y * dpr),
      width: Math.round(rect.width * dpr),
      height: Math.round(rect.height * dpr),
      viewportY: Math.round(rect.y),
      dpr: dpr
    };

    try {
      const response = await browserAPI.runtime.sendMessage({
        action: 'captureScreenshot',
        bounds: bounds
      });
      return response?.screenshot || null;
    } catch (error) {
      console.error('Screenshot capture failed:', error);
      return null;
    }
  }

  // Determine save mode from keyboard modifiers
  function getSaveModeFromEvent(e) {
    if (e.shiftKey) return 'quick';
    if (e.altKey) return 'text';
    return 'full';
  }

  // Extract post data from new Reddit
  function extractNewRedditPost(postElement) {
    // New Reddit uses shreddit-post custom elements or article elements
    const isShredditPost = postElement.tagName.toLowerCase() === 'shreddit-post';

    let permalink, subreddit, title, author, score;
    let hasVideo = false, hasImage = false, hasGallery = false;
    let imageUrls = [];

    if (isShredditPost) {
      permalink = postElement.getAttribute('permalink') || postElement.getAttribute('content-href');
      subreddit = postElement.getAttribute('subreddit-prefixed-name') || '';
      title = postElement.getAttribute('post-title') || '';
      author = postElement.getAttribute('author') || '';
      score = postElement.getAttribute('score') || '0';

      // Check for media
      hasVideo = postElement.querySelector('shreddit-player, video, [slot="post-media-container"] video') !== null;
      hasImage = postElement.querySelector('img[src*="i.redd.it"], img[src*="preview.redd.it"]') !== null;
      hasGallery = postElement.querySelector('[slot="gallery"]') !== null ||
                   postElement.hasAttribute('is-gallery');

      // Get image URLs
      const images = postElement.querySelectorAll('img[src*="i.redd.it"], img[src*="preview.redd.it"]');
      imageUrls = Array.from(images).map(img => img.src);
    } else {
      // Fallback for article-based posts
      const linkElement = postElement.querySelector('a[href*="/comments/"]');
      permalink = linkElement?.getAttribute('href') || '';

      const subredditLink = postElement.querySelector('a[href^="/r/"]');
      subreddit = subredditLink?.textContent || '';

      const titleElement = postElement.querySelector('h3, [slot="title"]');
      title = titleElement?.textContent || '';

      const authorLink = postElement.querySelector('a[href^="/user/"]');
      author = authorLink?.textContent?.replace('u/', '') || '';

      const scoreElement = postElement.querySelector('[score], [data-click-id="upvote"]');
      score = scoreElement?.textContent || '0';

      hasVideo = postElement.querySelector('video, [data-click-id="media"]') !== null;
      hasImage = postElement.querySelector('img[src*="i.redd.it"], img[src*="preview.redd.it"]') !== null;
      hasGallery = postElement.querySelector('[data-gallery-id]') !== null;
    }

    // Ensure permalink is full URL
    if (permalink && !permalink.startsWith('http')) {
      permalink = 'https://www.reddit.com' + permalink;
    }

    const hasMedia = hasVideo || hasImage || hasGallery;
    const postId = permalink?.match(/comments\/([a-z0-9]+)/i)?.[1] || '';

    return {
      permalink,
      subreddit,
      title,
      author,
      score,
      postId,
      hasMedia,
      hasVideo,
      hasImage,
      hasGallery,
      imageUrls,
      mediaCount: imageUrls.length + (hasVideo ? 1 : 0)
    };
  }

  // Extract post data from old Reddit
  function extractOldRedditPost(postElement) {
    const permalink = postElement.querySelector('a.comments, a.bylink')?.href || '';
    const subreddit = postElement.querySelector('.subreddit')?.textContent || '';
    const title = postElement.querySelector('a.title')?.textContent || '';
    const author = postElement.querySelector('.author')?.textContent || '';
    const score = postElement.querySelector('.score.unvoted')?.textContent || '0';

    const hasVideo = postElement.classList.contains('video') ||
                     postElement.querySelector('.expando video') !== null;
    const hasImage = postElement.classList.contains('image') ||
                     postElement.querySelector('a.thumbnail[href*="i.redd.it"]') !== null;
    const hasGallery = postElement.querySelector('.gallery') !== null;

    const hasMedia = hasVideo || hasImage || hasGallery;
    const postId = postElement.getAttribute('data-fullname')?.replace('t3_', '') || '';

    return {
      permalink,
      subreddit,
      title,
      author,
      score,
      postId,
      hasMedia,
      hasVideo,
      hasImage,
      hasGallery,
      imageUrls: [],
      mediaCount: hasMedia ? 1 : 0
    };
  }

  // Get default icon based on media type
  function getDefaultIcon(postData) {
    if (postData.hasVideo) return '🎬';
    if (postData.hasGallery) return '🖼️';
    if (postData.hasImage) return '🖼️';
    return '📄';
  }

  // Get default tooltip based on media type
  function getDefaultTooltip(postData) {
    const base = postData.hasVideo ? 'Archive video' :
                 postData.hasGallery ? 'Archive gallery' :
                 postData.hasImage ? 'Archive image' : 'Archive post';
    return `${base}\n⇧ quick · ⌥ text-only`;
  }

  // Create archive button
  function createArchiveButton(postData, postElement) {
    const button = document.createElement('button');
    button.className = 'media-archiver-reddit-btn';
    button.setAttribute('aria-label', 'Archive post');
    button.innerHTML = '⬇️';
    button.title = '';

    Object.assign(button.style, BUTTON_STYLES);

    // Add hover menu
    const menu = createHoverMenu();
    button.appendChild(menu);

    function updateButtonForModifier(e) {
      if (downloadingPosts.has(postData.postId)) return;
      const mode = getSaveModeFromEvent(e);
      button.childNodes[0].textContent = SAVE_MODES[mode].icon;

      menu.querySelectorAll('.archiver-menu-item').forEach(item => {
        item.classList.toggle('active', item.dataset.mode === mode);
      });
    }

    function resetButtonAppearance() {
      if (downloadingPosts.has(postData.postId)) return;
      button.childNodes[0].textContent = '⬇️';
      menu.querySelectorAll('.archiver-menu-item').forEach(item => {
        item.classList.toggle('active', item.dataset.mode === 'full');
      });
    }

    button.addEventListener('mouseenter', updateButtonForModifier);
    button.addEventListener('mousemove', updateButtonForModifier);
    button.addEventListener('mouseleave', resetButtonAppearance);

    button.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (downloadingPosts.has(postData.postId)) return;

      const saveMode = getSaveModeFromEvent(e);
      downloadingPosts.add(postData.postId);
      button.innerHTML = '⏳';
      button.style.opacity = '1';

      try {
        let screenshot = null;
        if (saveMode !== 'quick') {
          screenshot = await captureElement(postElement);
        }

        const response = await browserAPI.runtime.sendMessage({
          action: 'archive',
          url: postData.permalink,
          saveMode: saveMode,
          screenshot: screenshot,
          options: {
            pageContext: window.location.href,
            mediaType: 'reddit',
            redditContent: {
              subreddit: postData.subreddit,
              title: postData.title,
              author: postData.author,
              score: postData.score,
              hasVideo: postData.hasVideo,
              hasGallery: postData.hasGallery,
              imageUrls: postData.imageUrls,
              mediaCount: postData.mediaCount
            }
          }
        });

        if (response?.success) {
          button.childNodes[0].textContent = '✓';
          button.style.backgroundColor = 'rgba(34, 197, 94, 0.2)';
          button.style.border = '1px solid rgba(34, 197, 94, 0.4)';

          setTimeout(() => {
            button.childNodes[0].textContent = '⬇️';
            button.style.backgroundColor = 'rgba(255, 69, 0, 0.1)';
            button.style.border = '1px solid rgba(255, 69, 0, 0.2)';
            downloadingPosts.delete(postData.postId);
          }, 2500);
        } else {
          throw new Error(response?.error || 'Archive failed');
        }
      } catch (error) {
        console.error('Archive error:', error);
        button.childNodes[0].textContent = '✗';
        button.style.backgroundColor = 'rgba(239, 68, 68, 0.2)';
        button.style.border = '1px solid rgba(239, 68, 68, 0.4)';

        setTimeout(() => {
          button.childNodes[0].textContent = '⬇️';
          button.style.backgroundColor = 'rgba(255, 69, 0, 0.1)';
          button.style.border = '1px solid rgba(255, 69, 0, 0.2)';
          downloadingPosts.delete(postData.postId);
        }, 3000);
      }
    });

    return button;
  }

  // Process new Reddit post
  function processNewRedditPost(postElement) {
    if (processedPosts.has(postElement)) return;

    const postData = extractNewRedditPost(postElement);
    if (!postData.hasMedia || !postData.postId) return;

    // Find suitable container for button
    let container = postElement;
    if (postElement.tagName.toLowerCase() === 'shreddit-post') {
      container = postElement.shadowRoot?.querySelector('[slot="credit-bar"]')?.parentElement || postElement;
    }

    // Ensure container has relative positioning
    const computedStyle = window.getComputedStyle(container);
    if (computedStyle.position === 'static') {
      container.style.position = 'relative';
    }

    const archiveBtn = createArchiveButton(postData, postElement);
    container.appendChild(archiveBtn);

    // Show on hover
    let hoverTimeout;
    postElement.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimeout);
      archiveBtn.style.opacity = '0.8';
      archiveBtn.style.transform = 'scale(1)';
    });

    postElement.addEventListener('mouseleave', () => {
      hoverTimeout = setTimeout(() => {
        if (!downloadingPosts.has(postData.postId)) {
          archiveBtn.style.opacity = '0';
          archiveBtn.style.transform = 'scale(0.9)';
        }
      }, 100);
    });

    processedPosts.add(postElement);
  }

  // Process old Reddit post
  function processOldRedditPost(postElement) {
    if (processedPosts.has(postElement)) return;

    const postData = extractOldRedditPost(postElement);
    if (!postData.hasMedia || !postData.postId) return;

    // Find the entry element
    const entry = postElement.querySelector('.entry') || postElement;
    entry.style.position = 'relative';

    const archiveBtn = createArchiveButton(postData, postElement);
    entry.appendChild(archiveBtn);

    // Show on hover
    let hoverTimeout;
    postElement.addEventListener('mouseenter', () => {
      clearTimeout(hoverTimeout);
      archiveBtn.style.opacity = '0.8';
      archiveBtn.style.transform = 'scale(1)';
    });

    postElement.addEventListener('mouseleave', () => {
      hoverTimeout = setTimeout(() => {
        if (!downloadingPosts.has(postData.postId)) {
          archiveBtn.style.opacity = '0';
          archiveBtn.style.transform = 'scale(0.9)';
        }
      }, 100);
    });

    processedPosts.add(postElement);
  }

  // Process all visible posts
  function processAllPosts() {
    if (isOldReddit()) {
      const posts = document.querySelectorAll('.thing.link');
      posts.forEach(processOldRedditPost);
    } else {
      // New Reddit - shreddit-post elements
      const shredditPosts = document.querySelectorAll('shreddit-post');
      shredditPosts.forEach(processNewRedditPost);

      // Fallback for article-based layout
      const articlePosts = document.querySelectorAll('article');
      articlePosts.forEach(processNewRedditPost);
    }
  }

  // MutationObserver for dynamic content
  const observer = new MutationObserver(() => {
    requestAnimationFrame(processAllPosts);
  });

  // Initialize
  function initialize() {
    const mainContent = document.querySelector('main, #siteTable, .listing-page');
    if (mainContent) {
      observer.observe(mainContent, { childList: true, subtree: true });
      processAllPosts();
    } else {
      setTimeout(initialize, 500);
    }
  }

  // Add styles
  const style = document.createElement('style');
  style.textContent = `
    .media-archiver-reddit-btn {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
      box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
    }

    .media-archiver-reddit-btn:hover {
      box-shadow: 0 3px 6px rgba(0,0,0,0.16), 0 3px 6px rgba(0,0,0,0.23);
    }

    /* Hover menu */
    .media-archiver-reddit-btn .archiver-menu {
      position: absolute;
      bottom: 100%;
      right: 0;
      margin-bottom: 6px;
      background: rgba(0, 0, 0, 0.85);
      backdrop-filter: blur(12px);
      border-radius: 8px;
      padding: 6px 0;
      min-width: 140px;
      opacity: 0;
      transform: translateY(4px);
      transition: all 0.15s ease;
      pointer-events: none;
      font-size: 12px;
      color: white;
      white-space: nowrap;
    }

    .media-archiver-reddit-btn:hover .archiver-menu {
      opacity: 1;
      transform: translateY(0);
    }

    .archiver-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 5px 12px;
      opacity: 0.7;
    }

    .archiver-menu-item.active {
      opacity: 1;
      background: rgba(255, 255, 255, 0.1);
    }

    .archiver-menu-item kbd {
      font-family: inherit;
      font-size: 10px;
      padding: 1px 4px;
      background: rgba(255,255,255,0.15);
      border-radius: 3px;
      margin-left: auto;
    }

    @media (prefers-color-scheme: dark) {
      .media-archiver-reddit-btn {
        background-color: rgba(255, 69, 0, 0.15) !important;
        border-color: rgba(255, 69, 0, 0.3) !important;
      }
    }

    @media print {
      .media-archiver-reddit-btn, .archiver-menu {
        display: none !important;
      }
    }
  `;
  document.head.appendChild(style);

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

})();
