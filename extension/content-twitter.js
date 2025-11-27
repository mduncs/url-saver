// Twitter/X specific content script with minimally invasive UI
// Uses EmotionWheel module loaded from modules/emotion-wheel.js

(function() {
  'use strict';

  // Firefox compatibility - content scripts have browser/chrome as globals
  const browserAPI = (typeof browser !== 'undefined') ? browser : chrome;

  // Icon paths only - size is applied dynamically
  // NOTE: X's native icons use fill, not stroke. Our stroke-based approach
  // needs stroke-width 2 to have similar visual weight.
  const ICON_PATHS = {
    download: 'M12 3v12m0 0l-4-4m4 4l4-4M5 17v2a2 2 0 002 2h10a2 2 0 002-2v-2',
    quick: 'M12 4v12m0 0l-4-4m4 4l4-4',
    text: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 012-2h2a2 2 0 012 2M9 5h6',
    loading: null, // special case
    success: 'M5 13l4 4L19 7',
    error: 'M6 18L18 6M6 6l12 12',
    archived: 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z', // checkmark in circle
    tooSmall: 'M4 14l6-6m0 0v5m0-5H5M20 10l-6 6m0 0v-5m0 5h5' // shrink arrows
  };

  // Check if error is about content being too small
  function isTooSmallError(error) {
    const msg = (error?.message || error || '').toLowerCase();
    return msg.includes('too small') || msg.includes('minimum');
  }

  // X icon style reference (Nov 2024):
  // - Size: dynamically read from X's SVG (typically 18.75-20px)
  // - X's native icons use fill="currentColor", ours use stroke
  // - Stroke: 2 gives similar visual weight to X's filled icons
  const X_STROKE_WIDTH = 2;

  // Generate icon SVG with dynamic size
  function getIcon(type, size = 20) {
    if (type === 'loading') {
      return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${X_STROKE_WIDTH}" class="archiver-spin"><circle cx="12" cy="12" r="9" stroke-dasharray="40 20"/></svg>`;
    }
    return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="${X_STROKE_WIDTH}" stroke-linecap="round" stroke-linejoin="round"><path d="${ICON_PATHS[type]}"/></svg>`;
  }

  // Clone X's native button wrapper for perfect styling match
  function cloneXButtonWrapper(actionBar) {
    // Find any existing button wrapper in the action bar (like bookmark or share)
    // X's structure: div[role="group"] > div (button wrapper) > button > div > svg
    const existingWrapper = actionBar.querySelector(':scope > div:last-child');
    if (existingWrapper) {
      const clone = existingWrapper.cloneNode(true);
      // Clear the clone's inner content
      clone.innerHTML = '';
      // Remove any data attributes that might cause issues
      clone.removeAttribute('data-testid');
      return clone;
    }
    return null;
  }

  // Copy computed styles from a reference element
  function copyStyles(source, target, properties) {
    const computed = window.getComputedStyle(source);
    properties.forEach(prop => {
      target.style[prop] = computed[prop];
    });
  }

  // Track processed posts - map to track mode ('timeline' or 'portal')
  const processedPosts = new WeakMap();
  const downloadingPosts = new Set();
  // Track archive status for tweets (tweetId -> {archived, age_days, file_exists})
  const archiveStatusCache = new Map();

  // Check if a URL has been archived
  async function checkArchiveStatus(url, tweetId) {
    // Check cache first
    if (archiveStatusCache.has(tweetId)) {
      return archiveStatusCache.get(tweetId);
    }

    try {
      const response = await browserAPI.runtime.sendMessage({
        action: 'checkArchived',
        url: url
      });

      const status = {
        archived: response?.archived || false,
        age_days: response?.age_days || 0,
        file_exists: response?.file_exists || false,
        file_path: response?.file_path || null
      };

      archiveStatusCache.set(tweetId, status);
      return status;
    } catch (e) {
      console.log('[archiver] Could not check archive status:', e);
      return { archived: false };
    }
  }

  // Show re-archive prompt dialog
  function showReArchivePrompt(tweetData, archiveStatus) {
    return new Promise((resolve) => {
      // Create modal overlay
      const overlay = document.createElement('div');
      overlay.className = 'archiver-modal-overlay';
      overlay.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        bottom: 0;
        background: rgba(0, 0, 0, 0.6);
        backdrop-filter: blur(4px);
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: center;
      `;

      const ageStr = archiveStatus.age_days === 0 ? 'today' :
                     archiveStatus.age_days === 1 ? 'yesterday' :
                     `${archiveStatus.age_days} days ago`;

      const modal = document.createElement('div');
      modal.className = 'archiver-modal';
      modal.style.cssText = `
        background: rgb(22, 24, 28);
        border-radius: 16px;
        padding: 24px;
        max-width: 320px;
        color: white;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
        box-shadow: 0 8px 32px rgba(0,0,0,0.4);
      `;

      modal.innerHTML = `
        <div style="font-size: 16px; font-weight: 600; margin-bottom: 8px;">Already Archived</div>
        <div style="font-size: 14px; color: rgb(139, 148, 158); margin-bottom: 16px;">
          This tweet was archived ${ageStr}.
          ${archiveStatus.file_exists ? '✓ File exists on disk.' : '⚠ File may have been moved.'}
        </div>
        <div style="display: flex; flex-direction: column; gap: 8px;">
          <button class="archiver-modal-btn" data-action="redownload" style="
            background: rgb(29, 155, 240);
            color: white;
            border: none;
            padding: 12px 16px;
            border-radius: 9999px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
          ">Re-download fresh copy</button>
          <button class="archiver-modal-btn" data-action="cancel" style="
            background: transparent;
            color: rgb(139, 148, 158);
            border: 1px solid rgb(56, 68, 77);
            padding: 12px 16px;
            border-radius: 9999px;
            font-size: 14px;
            font-weight: 600;
            cursor: pointer;
          ">Cancel</button>
        </div>
      `;

      overlay.appendChild(modal);
      document.body.appendChild(overlay);

      // Handle clicks
      modal.querySelectorAll('.archiver-modal-btn').forEach(btn => {
        btn.addEventListener('click', () => {
          const action = btn.dataset.action;
          overlay.remove();
          resolve(action === 'redownload');
        });
      });

      // Click outside to cancel
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) {
          overlay.remove();
          resolve(false);
        }
      });

      // ESC to cancel
      const handleEsc = (e) => {
        if (e.key === 'Escape') {
          overlay.remove();
          document.removeEventListener('keydown', handleEsc);
          resolve(false);
        }
      };
      document.addEventListener('keydown', handleEsc);
    });
  }

  // Save mode config
  const SAVE_MODES = {
    full: { icon: 'download', label: 'Full save', desc: 'media + screenshot' },
    quick: { icon: 'quick', label: 'Quick', desc: 'media only' },
    text: { icon: 'text', label: 'Text', desc: 'screenshot + meta' }
  };

  // Create hover menu HTML (uses smaller 16px icons for menu)
  function createHoverMenu() {
    const menu = document.createElement('div');
    menu.className = 'archiver-menu';
    menu.innerHTML = `
      <div class="archiver-menu-item active" data-mode="full">
        ${getIcon('download', 16)} Full save <kbd>click</kbd>
      </div>
      <div class="archiver-menu-item" data-mode="quick">
        ${getIcon('quick', 16)} Quick <kbd>⇧</kbd>
      </div>
      <div class="archiver-menu-item" data-mode="text">
        ${getIcon('text', 16)} Text only <kbd>⌥</kbd>
      </div>
      <div class="archiver-menu-divider"></div>
      <div class="archiver-menu-item emotion-wheel-hint" data-mode="emotion">
        <span class="emotion-wheel-icon">🎨</span> React sort <kbd>⌥+hold</kbd>
      </div>
    `;
    return menu;
  }

  // Capture element screenshot via background script
  async function captureElement(element) {
    const rect = element.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;

    // Get device pixel ratio for high-DPI displays
    const dpr = window.devicePixelRatio || 1;

    const bounds = {
      x: Math.round((rect.x + scrollX) * dpr),
      y: Math.round(rect.y * dpr),  // y relative to viewport for captureVisibleTab
      width: Math.round(rect.width * dpr),
      height: Math.round(rect.height * dpr),
      viewportY: Math.round(rect.y),  // original viewport-relative y
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

  // Extract tweet text and metadata
  function extractTweetContent(article) {
    const tweetText = article.querySelector('[data-testid="tweetText"]')?.innerText || '';
    const userName = article.querySelector('[data-testid="User-Name"]')?.innerText || '';
    const timeElement = article.querySelector('time');
    const timestamp = timeElement?.getAttribute('datetime') || '';

    // Get tweet URL
    const tweetLink = article.querySelector('a[href*="/status/"]')?.href || '';
    const tweetId = tweetLink.match(/status\/(\d+)/)?.[1] || '';

    // Check for media
    const hasImage = article.querySelector('img[src*="pbs.twimg.com/media"]') !== null;
    const hasVideo = article.querySelector('video, [data-testid="videoPlayer"]') !== null;
    const hasGif = article.querySelector('[data-testid="gifPlayer"]') !== null;

    // Get image URLs if present
    const images = Array.from(article.querySelectorAll('img[src*="pbs.twimg.com/media"]'))
      .map(img => img.src.replace(/name=\w+/, 'name=orig'));

    return {
      text: tweetText,
      userName,
      timestamp,
      tweetId,
      tweetUrl: tweetLink,
      hasMedia: hasImage || hasVideo || hasGif,
      hasImage,
      hasVideo,
      hasGif,
      imageUrls: images,
      mediaCount: images.length + (hasVideo ? 1 : 0) + (hasGif ? 1 : 0)
    };
  }

  // Create archive button by cloning X's native button structure
  function createArchiveButton(tweetData, article, actionBar) {
    // Find X's native SVG to match its exact size
    const refSvg = actionBar.querySelector('svg');
    let iconSize = 20; // default fallback
    if (refSvg) {
      const rect = refSvg.getBoundingClientRect();
      iconSize = Math.max(rect.width, rect.height) || 20;
    }

    const refButton = actionBar.querySelector(':scope > div button');

    const button = document.createElement('button');
    button.className = 'media-archiver-twitter-btn';
    button.setAttribute('aria-label', 'Archive tweet');
    button.innerHTML = getIcon('download', iconSize);
    button.dataset.iconSize = iconSize; // store for later icon swaps
    button.title = '';

    // Copy styles from X's native button if available
    if (refButton) {
      const computed = window.getComputedStyle(refButton);
      button.style.cssText = `
        background: transparent;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: ${computed.padding};
        margin: 0;
        min-width: ${computed.minWidth || '36px'};
        min-height: ${computed.minHeight || '36px'};
        border-radius: 9999px;
        transition: background-color 0.2s, color 0.2s;
        color: rgb(113, 118, 123);
      `;
    } else {
      // Fallback minimal styles
      button.style.cssText = `
        background: transparent;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 12px;
        min-width: 36px;
        min-height: 36px;
        border-radius: 9999px;
        transition: background-color 0.2s, color 0.2s;
        color: rgb(113, 118, 123);
      `;
    }

    // Add hover menu
    const menu = createHoverMenu();
    button.appendChild(menu);

    let menuTimeout;

    // Update button appearance based on modifier keys
    function updateButtonForModifier(e) {
      if (downloadingPosts.has(tweetData.tweetId)) return;

      const mode = getSaveModeFromEvent(e);
      const size = button.dataset.iconSize || 20;
      // Update button icon (first child is SVG)
      const iconContainer = button.querySelector('svg:first-child') || button.firstChild;
      if (iconContainer) {
        iconContainer.outerHTML = getIcon(SAVE_MODES[mode].icon, size);
      }

      // Update menu highlight
      menu.querySelectorAll('.archiver-menu-item').forEach(item => {
        item.classList.toggle('active', item.dataset.mode === mode);
      });
    }

    // Reset button to default appearance
    function resetButtonAppearance() {
      if (downloadingPosts.has(tweetData.tweetId)) return;

      const size = button.dataset.iconSize || 20;
      const iconContainer = button.querySelector('svg:first-child') || button.firstChild;
      if (iconContainer) {
        iconContainer.outerHTML = getIcon('download', size);
      }
      menu.querySelectorAll('.archiver-menu-item').forEach(item => {
        item.classList.toggle('active', item.dataset.mode === 'full');
      });
    }

    // Show menu after 1s hover delay
    button.addEventListener('mouseenter', (e) => {
      updateButtonForModifier(e);
      button.style.color = 'rgb(29, 155, 240)';
      menuTimeout = setTimeout(() => {
        // If in portal, position menu with fixed coords
        if (button.closest('.media-archiver-portal')) {
          const btnRect = button.getBoundingClientRect();
          menu.style.position = 'fixed';
          menu.style.left = `${btnRect.left + btnRect.width / 2 - 75}px`; // center menu (150px/2)
          menu.style.top = `${btnRect.top - 8}px`; // above button
          menu.style.transform = 'translateY(-100%)';
        }
        menu.classList.add('visible');
      }, 1000);
    });

    button.addEventListener('mousemove', updateButtonForModifier);

    button.addEventListener('mouseleave', () => {
      clearTimeout(menuTimeout);
      menu.classList.remove('visible');
      resetButtonAppearance();
      if (!downloadingPosts.has(tweetData.tweetId)) {
        button.style.color = 'rgb(113, 118, 123)';
      }
    });

    // ═══════════════════════════════════════════════════════════════════════
    // EMOTION WHEEL: Alt+click triggers radial emotion selector for react images
    // ═══════════════════════════════════════════════════════════════════════

    let emotionWheelActive = false;

    // Perform download with optional emotion data
    async function performDownload(saveMode, emotionData = null) {
      console.log('[archiver] performDownload called:', { saveMode, emotionData, tweetId: tweetData.tweetId, url: tweetData.tweetUrl });

      const size = button.dataset.iconSize || 20;
      downloadingPosts.add(tweetData.tweetId);

      menu.classList.remove('visible');
      clearTimeout(menuTimeout);

      button.innerHTML = getIcon('loading', size) + menu.outerHTML;
      button.style.color = 'rgb(29, 155, 240)';

      try {
        let screenshot = null;
        if (saveMode !== 'quick') {
          console.log('[archiver] capturing screenshot...');
          screenshot = await captureElement(article);
          console.log('[archiver] screenshot captured:', screenshot ? `${screenshot.length} chars` : 'null');
        }

        // Build tweet content with optional emotion metadata
        const tweetContent = {
          text: tweetData.text,
          userName: tweetData.userName,
          timestamp: tweetData.timestamp,
          mediaCount: tweetData.mediaCount,
          imageUrls: tweetData.imageUrls,
          hasVideo: tweetData.hasVideo,
          hasGif: tweetData.hasGif,
          hasImage: tweetData.hasImage
        };

        // Add emotion tag if present (emotionData is now just a string: 'joy', 'fear', etc.)
        if (emotionData) {
          tweetContent.emotion = emotionData;
        }

        console.log('[archiver] sending to background:', { action: 'archive', url: tweetData.tweetUrl, saveMode, emotion: emotionData });
        const response = await browserAPI.runtime.sendMessage({
          action: 'archive',
          url: tweetData.tweetUrl,
          saveMode: saveMode,
          screenshot: screenshot,
          options: {
            pageContext: window.location.href,
            mediaType: 'twitter',
            tweetContent: tweetContent,
            emotionTag: emotionData || null
          }
        });

        console.log('[archiver] response from background:', response);

        if (response?.success) {
          console.log('[archiver] SUCCESS - file:', response.file || response.path || 'unknown');
          button.innerHTML = getIcon('success', size) + menu.outerHTML;
          button.style.color = 'rgb(34, 197, 94)';

          setTimeout(() => {
            button.innerHTML = getIcon('download', size) + menu.outerHTML;
            button.style.color = 'rgb(113, 118, 123)';
            downloadingPosts.delete(tweetData.tweetId);
          }, 2500);
        } else {
          console.error('[archiver] FAILED - response:', response);
          throw new Error(response?.error || 'Archive failed');
        }
      } catch (error) {
        console.error('[archiver] Archive error:', error);
        // Use different icon for "too small" vs other errors
        if (isTooSmallError(error)) {
          button.innerHTML = getIcon('tooSmall', size) + menu.outerHTML;
          button.style.color = 'rgb(251, 191, 36)'; // amber
          button.title = 'Media too small - may be a placeholder';
        } else {
          button.innerHTML = getIcon('error', size) + menu.outerHTML;
          button.style.color = 'rgb(239, 68, 68)';
        }

        setTimeout(() => {
          button.innerHTML = getIcon('download', size) + menu.outerHTML;
          button.style.color = 'rgb(113, 118, 123)';
          button.title = '';
          downloadingPosts.delete(tweetData.tweetId);
        }, 3000);
      }
    }

    // Handle mousedown for emotion wheel activation
    button.addEventListener('mousedown', (e) => {
      console.log('[archiver] mousedown:', { altKey: e.altKey, metaKey: e.metaKey, ctrlKey: e.ctrlKey, button: e.button });

      if (downloadingPosts.has(tweetData.tweetId)) return;

      // Alt/Option+click opens emotion wheel (altKey on Mac = Option key)
      if (e.altKey) {
        console.log('[archiver] Alt+click detected, showing emotion wheel');
        e.preventDefault();
        e.stopPropagation();

        emotionWheelActive = true;
        menu.classList.remove('visible');
        clearTimeout(menuTimeout);

        // Show emotion wheel centered on click position (uses EmotionWheel module)
        EmotionWheel.show(e.clientX, e.clientY, (emotionData) => {
          console.log('[archiver] Emotion selected:', emotionData);
          // Emotion selected - perform quick download with emotion tag
          emotionWheelActive = false;
          performDownload('quick', emotionData);
        });

        // Setup mouseup handler to capture release
        const handleMouseUp = () => {
          console.log('[archiver] mouseup - releasing wheel');
          EmotionWheel.release();
          emotionWheelActive = false;
          document.removeEventListener('mouseup', handleMouseUp);
        };
        document.addEventListener('mouseup', handleMouseUp);
      }
    });

    // Handle click (only if not using emotion wheel)
    button.addEventListener('click', async (e) => {
      e.preventDefault();
      e.stopPropagation();

      // Skip if emotion wheel was used (alt+click)
      if (e.altKey || emotionWheelActive) return;

      if (downloadingPosts.has(tweetData.tweetId)) return;

      // Check if already archived - show prompt if so
      const archiveStatus = await checkArchiveStatus(tweetData.tweetUrl, tweetData.tweetId);
      if (archiveStatus.archived) {
        const shouldRedownload = await showReArchivePrompt(tweetData, archiveStatus);
        if (!shouldRedownload) return;
        // Clear cache so button updates after re-download
        archiveStatusCache.delete(tweetData.tweetId);
      }

      const saveMode = getSaveModeFromEvent(e);
      performDownload(saveMode);
    });

    // Check archive status asynchronously and update button appearance
    checkArchiveStatus(tweetData.tweetUrl, tweetData.tweetId).then(status => {
      if (status.archived && !downloadingPosts.has(tweetData.tweetId)) {
        const size = button.dataset.iconSize || 20;
        // Show archived indicator
        button.innerHTML = getIcon('archived', size) + menu.outerHTML;
        button.style.color = 'rgb(34, 197, 94)'; // green
        button.style.opacity = '0.7';

        const ageStr = status.age_days === 0 ? 'today' :
                       status.age_days === 1 ? 'yesterday' :
                       `${status.age_days} days ago`;
        button.title = `Already archived ${ageStr}`;
      }
    });

    return button;
  }

  // Track portal wrappers for cleanup
  const portalWrappers = new WeakMap();

  // Check if we're in detail/modal view (clicked into a specific tweet)
  // Returns: 'main' for main tweet needing portal, 'reply' for replies, false for timeline
  function getViewType(article) {
    const isModal = !!article.closest('[role="dialog"]') || !!article.closest('[aria-modal="true"]');
    const isStatusPage = window.location.pathname.includes('/status/');

    if (!isStatusPage && !isModal) return 'timeline';

    // Check if this is the main tweet (first article in the thread)
    const primaryColumn = article.closest('[data-testid="primaryColumn"]');
    if (!primaryColumn) return 'timeline';

    // Main tweet has no previous article sibling and is at the top
    const allArticles = primaryColumn.querySelectorAll('article[data-testid="tweet"]');
    const isFirstArticle = allArticles[0] === article;

    if (isModal || isFirstArticle) return 'main';
    return 'reply';
  }

  // Legacy helper
  function isDetailView(article) {
    return getViewType(article) === 'main';
  }

  // Update portal position to track action bar
  function updatePortalPosition(wrapper, actionBar, archiveBtn) {
    if (!wrapper || !actionBar) return;
    const rect = actionBar.getBoundingClientRect();
    wrapper.style.top = `${rect.top}px`;
    wrapper.style.left = `${rect.left}px`;
    wrapper.style.width = `${rect.width}px`;
    wrapper.style.height = `${rect.height}px`;
  }

  // Process individual tweet
  function processTweet(article) {
    const viewType = getViewType(article);
    const needsPortal = viewType === 'main';
    const currentMode = processedPosts.get(article);

    // Already processed in correct mode
    if (currentMode === (needsPortal ? 'portal' : 'timeline')) return;

    // If was timeline mode but now needs portal, upgrade
    if (currentMode === 'timeline' && needsPortal) {
      // Remove old button/wrapper from action bar
      const oldWrapper = article.querySelector('.media-archiver-wrapper');
      if (oldWrapper) oldWrapper.remove();
      const oldBtn = article.querySelector('.media-archiver-twitter-btn');
      if (oldBtn) oldBtn.remove();
      processedPosts.delete(article);
    }

    // Skip if already portal mode (don't downgrade)
    if (currentMode === 'portal') return;

    const tweetData = extractTweetContent(article);

    // Only add button if tweet has content worth archiving
    if (!tweetData.text && !tweetData.hasMedia) return;

    // Find the action bar (like, retweet buttons area)
    const actionBar = article.querySelector('[role="group"]');
    if (!actionBar) return;

    // Check if already has our button (in case WeakMap failed)
    if (actionBar.querySelector('.media-archiver-wrapper') ||
        actionBar.querySelector('.media-archiver-twitter-btn')) {
      processedPosts.set(article, 'timeline');
      return;
    }

    const archiveBtn = createArchiveButton(tweetData, article, actionBar);

    if (needsPortal) {
      // Portal pattern: append to body with fixed positioning
      const rect = actionBar.getBoundingClientRect();
      const wrapper = document.createElement('div');
      wrapper.className = 'media-archiver-portal';
      wrapper.style.cssText = `
        position: fixed;
        top: ${rect.top}px;
        left: ${rect.left}px;
        width: ${rect.width}px;
        height: ${rect.height}px;
        pointer-events: none;
        z-index: 2147483647;
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding-right: 40px;
      `;

      // Make button work inside pointer-events: none wrapper
      archiveBtn.style.pointerEvents = 'auto';

      wrapper.appendChild(archiveBtn);
      document.body.appendChild(wrapper);

      // Store reference for cleanup and position updates
      portalWrappers.set(article, { wrapper, actionBar, archiveBtn });

      // Update position on scroll
      const scrollContainer = article.closest('[data-testid="primaryColumn"]') || window;
      const updatePosition = () => updatePortalPosition(wrapper, actionBar, archiveBtn);

      if (scrollContainer !== window) {
        scrollContainer.addEventListener('scroll', updatePosition, { passive: true });
      }
      window.addEventListener('scroll', updatePosition, { passive: true });
      window.addEventListener('resize', updatePosition, { passive: true });

      // Cleanup when article is removed
      const cleanup = () => {
        wrapper.remove();
        window.removeEventListener('scroll', updatePosition);
        window.removeEventListener('resize', updatePosition);
        if (scrollContainer !== window) {
          scrollContainer.removeEventListener('scroll', updatePosition);
        }
        processedPosts.delete(article);
      };

      // Use MutationObserver to detect article removal
      const observer = new MutationObserver((mutations) => {
        if (!document.contains(article)) {
          cleanup();
          observer.disconnect();
        }
      });
      observer.observe(document.body, { childList: true, subtree: true });

      // Mark as processed in portal mode
      processedPosts.set(article, 'portal');

    } else {
      // Timeline/reply view: insert before share button with matching wrapper
      const bookmarkBtn = actionBar.querySelector('[data-testid="bookmark"]') ||
                          actionBar.querySelector('[aria-label*="ookmark"]');
      const shareBtn = actionBar.querySelector('[aria-label="Share post"]') ||
                       actionBar.querySelector('[aria-label*="Share"]');

      // Find bookmark and share wrappers (direct children of actionBar)
      let shareWrapper = shareBtn;
      while (shareWrapper && shareWrapper.parentElement !== actionBar) {
        shareWrapper = shareWrapper.parentElement;
      }

      let bookmarkWrapper = bookmarkBtn;
      while (bookmarkWrapper && bookmarkWrapper.parentElement !== actionBar) {
        bookmarkWrapper = bookmarkWrapper.parentElement;
      }

      // Clone share's wrapper - it has no extra margin classes unlike bookmark
      const wrapper = shareWrapper
        ? shareWrapper.cloneNode(false)
        : document.createElement('div');

      // Clear cloned attributes
      wrapper.innerHTML = '';
      wrapper.removeAttribute('aria-label');
      wrapper.removeAttribute('aria-expanded');
      wrapper.removeAttribute('aria-haspopup');
      wrapper.classList.add('media-archiver-wrapper');

      // Reset button to minimal styling, let wrapper handle layout
      archiveBtn.style.cssText = `
        background: transparent;
        border: none;
        cursor: pointer;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0;
        margin: 0;
        min-height: 20px;
        border-radius: 9999px;
        transition: background-color 0.2s, color 0.2s;
        color: rgb(113, 118, 123);
      `;

      wrapper.appendChild(archiveBtn);

      // Insert AFTER bookmark (use bookmark.nextSibling), not before share
      // This ensures: ... | bookmark | OURS | share
      if (bookmarkWrapper?.nextSibling) {
        actionBar.insertBefore(wrapper, bookmarkWrapper.nextSibling);
      } else if (shareWrapper) {
        actionBar.insertBefore(wrapper, shareWrapper);
      } else {
        actionBar.appendChild(wrapper);
      }

      // Fix spacing: bookmark has 9px marginRight that creates uneven gaps
      // Also fix inner elements with negative margins
      setTimeout(() => {
        const bm = actionBar.querySelector('[data-testid="bookmark"], [data-testid="removeBookmark"]');
        if (bm) {
          let bmWrapper = bm;
          while (bmWrapper && bmWrapper.parentElement !== actionBar) {
            bmWrapper = bmWrapper.parentElement;
          }
          if (bmWrapper) {
            bmWrapper.style.marginRight = '0';
            bmWrapper.querySelectorAll('*').forEach(el => {
              if (window.getComputedStyle(el).marginRight !== '0px') {
                el.style.marginRight = '0';
              }
            });
          }
        }
      }, 50);

      // Mark as processed in timeline mode
      processedPosts.set(article, 'timeline');
    }
  }

  // Process all visible tweets
  function processAllTweets() {
    const tweets = document.querySelectorAll('article[data-testid="tweet"]');
    tweets.forEach(processTweet);
  }

  // Efficient observer for new tweets
  const observer = new MutationObserver((mutations) => {
    // Batch processing to avoid performance issues
    requestAnimationFrame(() => {
      processAllTweets();
    });
  });

  // Start observing when timeline is ready
  function initialize() {
    const timeline = document.querySelector('main');
    if (timeline) {
      observer.observe(timeline, {
        childList: true,
        subtree: true
      });
      processAllTweets();
    } else {
      // Retry if timeline not ready
      setTimeout(initialize, 500);
    }
  }

  // Add custom styles for better integration
  const style = document.createElement('style');
  style.textContent = `
    .media-archiver-twitter-btn {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
    }

    .media-archiver-twitter-btn:hover {
      background: rgba(29, 155, 240, 0.1);
    }

    .media-archiver-twitter-btn svg {
      display: block;
    }

    /* Spinning animation for loading */
    .archiver-spin {
      animation: archiver-spin 1s linear infinite;
    }

    @keyframes archiver-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }

    /* Hover menu - hidden by default, shown via .visible class after delay */
    .media-archiver-twitter-btn .archiver-menu {
      position: absolute;
      bottom: 100%;
      left: 50%;
      transform: translateX(-50%) translateY(4px) scale(0.95);
      margin-bottom: 8px;
      background: rgba(0, 0, 0, 0.9);
      backdrop-filter: blur(12px);
      border-radius: 12px;
      padding: 8px 0;
      min-width: 150px;
      opacity: 0;
      transform: translateY(4px) scale(0.95);
      transition: all 0.15s ease;
      pointer-events: none;
      font-size: 13px;
      color: white;
      white-space: nowrap;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }

    .media-archiver-twitter-btn .archiver-menu.visible {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
      pointer-events: auto;
    }

    .archiver-menu-item {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 8px 12px;
      opacity: 0.6;
      transition: all 0.1s;
    }

    .archiver-menu-item:hover {
      opacity: 1;
      background: rgba(255, 255, 255, 0.1);
    }

    .archiver-menu-item.active {
      opacity: 1;
      background: rgba(29, 155, 240, 0.2);
    }

    .archiver-menu-item svg {
      flex-shrink: 0;
    }

    .archiver-menu-item kbd {
      font-family: inherit;
      font-size: 11px;
      padding: 2px 6px;
      background: rgba(255,255,255,0.1);
      border-radius: 4px;
      margin-left: auto;
      opacity: 0.7;
    }

    /* Menu divider */
    .archiver-menu-divider {
      height: 1px;
      background: rgba(255, 255, 255, 0.1);
      margin: 6px 0;
    }

    /* Emotion wheel menu hint */
    .emotion-wheel-hint {
      font-size: 12px;
      opacity: 0.5;
    }

    .emotion-wheel-icon {
      font-size: 14px;
    }

    /* Emotion wheel overlay */
    .emotion-wheel {
      user-select: none;
      -webkit-user-select: none;
    }

    .emotion-wheel path {
      transform-origin: center;
      transform-box: fill-box;
    }

    /* Portal wrapper for detail view */
    .media-archiver-portal {
      pointer-events: none;
    }

    .media-archiver-portal .media-archiver-twitter-btn {
      pointer-events: auto;
    }

    /* Menu in portal needs fixed positioning to escape any clipping */
    .media-archiver-portal .archiver-menu {
      position: fixed !important;
      bottom: auto !important;
      transform: none !important;
    }

    .media-archiver-portal .archiver-menu.visible {
      transform: none !important;
    }

    /* Hide on print */
    @media print {
      .media-archiver-twitter-btn, .archiver-menu, .media-archiver-portal {
        display: none !important;
      }
    }
  `;
  document.head.appendChild(style);

  // Initialize when ready
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initialize);
  } else {
    initialize();
  }

})();