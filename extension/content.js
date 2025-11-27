// Content script for in-page media detection and archival

// Firefox compatibility - content scripts have browser/chrome as globals
const browserAPI = (typeof browser !== 'undefined') ? browser : chrome;

// Add floating archive button for media elements
function addArchiveButton(element, mediaUrl) {
  // Check if button already exists
  if (element.dataset.archiveButton) return;

  const button = document.createElement('button');
  button.className = 'media-archive-btn';
  button.innerHTML = '📥';
  button.title = 'Archive this media';

  // Style the button
  Object.assign(button.style, {
    position: 'absolute',
    top: '10px',
    right: '10px',
    width: '32px',
    height: '32px',
    borderRadius: '50%',
    background: 'rgba(102, 126, 234, 0.9)',
    color: 'white',
    border: 'none',
    cursor: 'pointer',
    fontSize: '16px',
    zIndex: '9999',
    display: 'none',
    alignItems: 'center',
    justifyContent: 'center',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)'
  });

  // Position button relative to media element
  const wrapper = document.createElement('div');
  wrapper.style.position = 'relative';
  wrapper.style.display = 'inline-block';

  element.parentNode.insertBefore(wrapper, element);
  wrapper.appendChild(element);
  wrapper.appendChild(button);

  // Show/hide on hover
  wrapper.addEventListener('mouseenter', () => {
    button.style.display = 'flex';
  });

  wrapper.addEventListener('mouseleave', () => {
    button.style.display = 'none';
  });

  // Archive on click
  button.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();

    button.innerHTML = '⏳';
    browserAPI.runtime.sendMessage({
      action: 'archive',
      url: mediaUrl || element.src || element.href,
      options: {
        pageContext: window.location.href,
        mediaType: element.tagName.toLowerCase()
      }
    }, response => {
      if (response?.success) {
        button.innerHTML = '✓';
        setTimeout(() => {
          button.innerHTML = '📥';
        }, 2000);
      } else {
        button.innerHTML = '✗';
        setTimeout(() => {
          button.innerHTML = '📥';
        }, 2000);
      }
    });
  });

  element.dataset.archiveButton = 'true';
}

// Find and tag media elements
function findMedia() {
  // Images
  document.querySelectorAll('img').forEach(img => {
    if (img.naturalWidth > 200 && img.naturalHeight > 200) {
      addArchiveButton(img, img.src);
    }
  });

  // Videos
  document.querySelectorAll('video').forEach(video => {
    addArchiveButton(video, video.src);
  });

  // Audio
  document.querySelectorAll('audio').forEach(audio => {
    addArchiveButton(audio, audio.src);
  });

  // Twitter/X specific media
  if (window.location.hostname.includes('twitter.com') || window.location.hostname.includes('x.com')) {
    // Twitter images in articles
    document.querySelectorAll('article img').forEach(img => {
      const highResUrl = img.src.replace(/name=\w+/, 'name=orig');
      addArchiveButton(img, highResUrl);
    });

    // Twitter videos
    document.querySelectorAll('article video').forEach(video => {
      // Get tweet URL for video extraction
      const article = video.closest('article');
      const tweetLink = article?.querySelector('a[href*="/status/"]')?.href;
      if (tweetLink) {
        addArchiveButton(video, tweetLink);
      }
    });
  }

  // Flickr specific
  if (window.location.hostname.includes('flickr.com')) {
    document.querySelectorAll('.photo-list-photo-view img').forEach(img => {
      const photoId = img.closest('.photo-list-photo-view')?.dataset?.photoId;
      if (photoId) {
        const photoUrl = `https://www.flickr.com/photos/${photoId}`;
        addArchiveButton(img, photoUrl);
      }
    });
  }
}

// Initial scan
findMedia();

// Watch for new media elements
const observer = new MutationObserver(() => {
  findMedia();
});

observer.observe(document.body, {
  childList: true,
  subtree: true
});

// Listen for keyboard shortcut from user
document.addEventListener('keydown', (e) => {
  // Alt+S to save current page
  if (e.altKey && e.key === 's') {
    e.preventDefault();
    browserAPI.runtime.sendMessage({
      action: 'archive',
      url: window.location.href,
      options: {
        pageContext: document.title
      }
    });
  }
});