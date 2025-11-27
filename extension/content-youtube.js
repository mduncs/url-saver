// YouTube specific content script with minimally invasive UI

(function() {
  'use strict';

  // Firefox compatibility
  const browserAPI = (typeof browser !== 'undefined') ? browser : chrome;

  // Configuration - YouTube red theme
  const BUTTON_STYLES = {
    position: 'absolute',
    width: '28px',
    height: '28px',
    borderRadius: '50%',
    backgroundColor: 'rgba(255, 0, 0, 0.1)',
    backdropFilter: 'blur(12px)',
    border: '1px solid rgba(255, 0, 0, 0.2)',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    fontSize: '14px',
    zIndex: '2000',
    transition: 'all 0.2s ease',
    opacity: '0',
    transform: 'scale(0.9)'
  };

  // Track processed elements
  const processedVideos = new WeakSet();
  const processedThumbnails = new WeakSet();
  const downloadingVideos = new Set();

  // Save mode config with distinct arrows
  const SAVE_MODES = {
    full: { icon: '⬇️', label: 'Full save', desc: 'video + screenshot' },
    quick: { icon: '↓', label: 'Quick', desc: 'video only' },
    text: { icon: '📋', label: 'Text', desc: 'screenshot + meta' }
  };

  // Capture element screenshot via background script
  async function captureElement(element) {
    const rect = element.getBoundingClientRect();
    const scrollX = window.scrollX;
    const scrollY = window.scrollY;
    const dpr = window.devicePixelRatio || 1;

    const bounds = {
      x: Math.round((rect.x + scrollX) * dpr),
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

  // Extract video ID from various URL formats
  function extractVideoId(url) {
    if (!url) return null;
    const patterns = [
      /(?:youtube\.com\/watch\?v=|youtu\.be\/|youtube\.com\/embed\/|youtube\.com\/v\/)([^&?#]+)/,
      /youtube\.com\/shorts\/([^&?#]+)/
    ];
    for (const pattern of patterns) {
      const match = url.match(pattern);
      if (match) return match[1];
    }
    return null;
  }

  // Get canonical watch URL
  function getWatchUrl(videoId) {
    return `https://www.youtube.com/watch?v=${videoId}`;
  }

  // Extract metadata from main video player page
  function extractPlayerMetadata() {
    const title = document.querySelector('h1.ytd-video-primary-info-renderer yt-formatted-string')?.textContent
      || document.querySelector('h1.ytd-watch-metadata yt-formatted-string')?.textContent
      || document.querySelector('#title h1')?.textContent
      || document.title.replace(' - YouTube', '');

    const channel = document.querySelector('#channel-name a')?.textContent
      || document.querySelector('ytd-channel-name yt-formatted-string a')?.textContent
      || document.querySelector('.ytd-channel-name a')?.textContent
      || '';

    const viewCount = document.querySelector('#count .view-count')?.textContent
      || document.querySelector('ytd-video-view-count-renderer span')?.textContent
      || '';

    const duration = document.querySelector('.ytp-time-duration')?.textContent || '';

    return { title: title.trim(), channel: channel.trim(), viewCount: viewCount.trim(), duration };
  }

  // Extract metadata from thumbnail element
  function extractThumbnailMetadata(container) {
    // Title from various possible locations
    const title = container.querySelector('#video-title')?.textContent
      || container.querySelector('a#video-title')?.textContent
      || container.querySelector('[id="video-title"]')?.getAttribute('title')
      || '';

    // Channel name
    const channel = container.querySelector('#channel-name a')?.textContent
      || container.querySelector('ytd-channel-name a')?.textContent
      || container.querySelector('.ytd-channel-name')?.textContent
      || '';

    // View count
    const viewCount = container.querySelector('#metadata-line span')?.textContent || '';

    // Duration from overlay
    const duration = container.querySelector('ytd-thumbnail-overlay-time-status-renderer span')?.textContent
      || container.querySelector('.ytd-thumbnail-overlay-time-status-renderer')?.textContent
      || '';

    return { title: title.trim(), channel: channel.trim(), viewCount: viewCount.trim(), duration: duration.trim() };
  }

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

  // Create archive button
  function createArchiveButton(videoId, getMetadata, captureTarget) {
    const button = document.createElement('button');
    button.className = 'media-archiver-youtube-btn';
    button.setAttribute('aria-label', 'Archive video');
    button.innerHTML = '⬇️';
    button.title = '';

    Object.assign(button.style, BUTTON_STYLES);

    // Add hover menu
    const menu = createHoverMenu();
    button.appendChild(menu);

    function updateButtonForModifier(e) {
      if (downloadingVideos.has(videoId)) return;
      const mode = getSaveModeFromEvent(e);
      button.childNodes[0].textContent = SAVE_MODES[mode].icon;

      // Update menu highlight
      menu.querySelectorAll('.archiver-menu-item').forEach(item => {
        item.classList.toggle('active', item.dataset.mode === mode);
      });
    }

    function resetButtonAppearance() {
      if (downloadingVideos.has(videoId)) return;
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

      if (downloadingVideos.has(videoId)) return;

      const saveMode = getSaveModeFromEvent(e);
      downloadingVideos.add(videoId);
      button.innerHTML = '⏳';
      button.style.opacity = '1';

      try {
        let screenshot = null;
        if (saveMode !== 'quick') {
          screenshot = await captureElement(captureTarget);
        }

        const metadata = getMetadata();
        const response = await browserAPI.runtime.sendMessage({
          action: 'archive',
          url: getWatchUrl(videoId),
          saveMode: saveMode,
          screenshot: screenshot,
          options: {
            pageContext: window.location.href,
            mediaType: 'youtube',
            videoContent: {
              videoId: videoId,
              title: metadata.title,
              channel: metadata.channel,
              viewCount: metadata.viewCount,
              duration: metadata.duration
            }
          }
        });

        if (response?.success) {
          button.childNodes[0].textContent = '✓';
          button.style.backgroundColor = 'rgba(34, 197, 94, 0.2)';
          button.style.border = '1px solid rgba(34, 197, 94, 0.4)';

          setTimeout(() => {
            button.childNodes[0].textContent = '⬇️';
            button.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
            button.style.border = '1px solid rgba(255, 0, 0, 0.2)';
            downloadingVideos.delete(videoId);
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
          button.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
          button.style.border = '1px solid rgba(255, 0, 0, 0.2)';
          downloadingVideos.delete(videoId);
        }, 3000);
      }
    });

    return button;
  }

  // Add button to main video player
  function processVideoPlayer() {
    const player = document.querySelector('#movie_player');
    if (!player || processedVideos.has(player)) return;

    const videoId = extractVideoId(window.location.href);
    if (!videoId) return;

    // Find the controls area
    const controls = player.querySelector('.ytp-chrome-bottom');
    if (!controls) return;

    const button = createArchiveButton(videoId, extractPlayerMetadata, player);
    button.style.position = 'absolute';
    button.style.right = '12px';
    button.style.bottom = '60px';

    player.style.position = 'relative';
    player.appendChild(button);

    // Show on player hover
    player.addEventListener('mouseenter', () => {
      button.style.opacity = '0.9';
      button.style.transform = 'scale(1)';
    });

    player.addEventListener('mouseleave', () => {
      if (!downloadingVideos.has(videoId)) {
        button.style.opacity = '0';
        button.style.transform = 'scale(0.9)';
      }
    });

    processedVideos.add(player);
  }

  // Add button to video thumbnail
  function processThumbnail(container) {
    if (processedThumbnails.has(container)) return;

    // Find the thumbnail element
    const thumbnail = container.querySelector('ytd-thumbnail, #thumbnail');
    if (!thumbnail) return;

    // Get video URL from link
    const link = container.querySelector('a#thumbnail, a[href*="watch"]');
    if (!link) return;

    const videoId = extractVideoId(link.href);
    if (!videoId) return;

    const button = createArchiveButton(
      videoId,
      () => extractThumbnailMetadata(container),
      container
    );
    button.style.right = '4px';
    button.style.top = '4px';

    // Position relative to thumbnail
    thumbnail.style.position = 'relative';
    thumbnail.appendChild(button);

    // Show on container hover
    container.addEventListener('mouseenter', () => {
      button.style.opacity = '0.9';
      button.style.transform = 'scale(1)';
    });

    container.addEventListener('mouseleave', () => {
      if (!downloadingVideos.has(videoId)) {
        button.style.opacity = '0';
        button.style.transform = 'scale(0.9)';
      }
    });

    processedThumbnails.add(container);
  }

  // Process all video thumbnails
  function processAllThumbnails() {
    // Video renderers in feeds, search, recommendations
    const selectors = [
      'ytd-video-renderer',
      'ytd-grid-video-renderer',
      'ytd-compact-video-renderer',
      'ytd-rich-item-renderer',
      'ytd-playlist-video-renderer'
    ];

    selectors.forEach(selector => {
      document.querySelectorAll(selector).forEach(processThumbnail);
    });
  }

  // Process all elements
  function processAll() {
    processVideoPlayer();
    processAllThumbnails();
  }

  // Observer for dynamic content
  const observer = new MutationObserver(() => {
    requestAnimationFrame(processAll);
  });

  // Initialize
  function initialize() {
    const main = document.querySelector('ytd-app, body');
    if (main) {
      observer.observe(main, { childList: true, subtree: true });
      processAll();
    } else {
      setTimeout(initialize, 500);
    }
  }

  // Add custom styles
  const style = document.createElement('style');
  style.textContent = `
    .media-archiver-youtube-btn {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
      box-shadow: 0 1px 3px rgba(0,0,0,0.12), 0 1px 2px rgba(0,0,0,0.24);
    }

    .media-archiver-youtube-btn:hover {
      box-shadow: 0 3px 6px rgba(0,0,0,0.16), 0 3px 6px rgba(0,0,0,0.23);
    }

    /* Hover menu */
    .media-archiver-youtube-btn .archiver-menu {
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

    .media-archiver-youtube-btn:hover .archiver-menu {
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

    /* Dark mode support */
    @media (prefers-color-scheme: dark) {
      .media-archiver-youtube-btn {
        background-color: rgba(255, 0, 0, 0.15) !important;
        border-color: rgba(255, 0, 0, 0.3) !important;
      }
    }

    /* Hide on print */
    @media print {
      .media-archiver-youtube-btn, .archiver-menu {
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
