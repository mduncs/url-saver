// Media Archiver - Background Script
console.log('[archiver] background loaded');

const browser = window.browser || window.chrome;
const SERVER_URL = 'http://localhost:8888';
let serverAvailable = false;

// Update extension icon based on server status
function updateIcon(available) {
  const path = available ? 'icons/archive' : 'icons/archive-offline';
  browser.action.setIcon({
    path: {
      "16": `${path}-16.png`,
      "48": `${path}-48.png`,
      "128": `${path}-128.png`
    }
  });
}

// Check server availability
async function checkServer() {
  try {
    const response = await fetch(`${SERVER_URL}/health`);
    serverAvailable = response.ok;
    updateIcon(serverAvailable);
    return serverAvailable;
  } catch {
    serverAvailable = false;
    updateIcon(false);
    return false;
  }
}

// Periodic health check every 30 seconds
setInterval(checkServer, 30000);
checkServer();

// Create context menu for right-click saving
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "save-media",
    title: "Archive this media",
    contexts: ["image", "link", "page"]
  });
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  const targetUrl = info.srcUrl || info.linkUrl || info.pageUrl || tab.url;
  await archiveUrl(targetUrl, tab);
});

// Handle clicking the extension icon
browser.action.onClicked.addListener(async (tab) => {
  await archiveUrl(tab.url, tab);
});

// Main archive function
async function archiveUrl(url, tab, options = {}) {
  console.log('[archiver-bg] archiveUrl called:', { url, saveMode: options.saveMode });

  if (!serverAvailable) {
    const available = await checkServer();
    if (!available) {
      browser.notifications.create({
        type: 'basic',
        iconUrl: 'icons/archive-48.png',
        title: 'Archive Server Offline',
        message: 'Please start the local archive server'
      });
      return { success: false, error: 'Server offline' };
    }
  }

  try {
    const urlObj = new URL(url);
    const cookies = await browser.cookies.getAll({ domain: urlObj.hostname });

    const domainParts = urlObj.hostname.split('.');
    if (domainParts.length > 2) {
      const parentDomain = domainParts.slice(-2).join('.');
      const parentCookies = await browser.cookies.getAll({ domain: parentDomain });
      cookies.push(...parentCookies);
    }

    const payload = {
      url: url,
      page_title: tab?.title || '',
      page_url: tab?.url || url,
      timestamp: new Date().toISOString(),
      cookies: cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/'
      })),
      save_mode: options.saveMode || 'full',
      screenshot: options.screenshot || null,
      options: options
    };

    const response = await fetch(`${SERVER_URL}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();

    browser.notifications.create({
      type: 'basic',
      iconUrl: 'icons/archive-48.png',
      title: result.success ? 'Archived!' : 'Archive Failed',
      message: result.message || 'Check server logs for details'
    });

    return result;
  } catch (error) {
    console.error('[archiver-bg] Archive error:', error);
    browser.notifications.create({
      type: 'basic',
      iconUrl: 'icons/archive-48.png',
      title: 'Archive Error',
      message: error.message
    });
  }
}

// Archive image with .md sidecar (for gallery sites)
async function archiveImage(request, tab) {
  if (!serverAvailable) {
    const available = await checkServer();
    if (!available) {
      return { success: false, error: 'Server offline' };
    }
  }

  try {
    const imageUrl = request.imageUrl || request.url;

    let cookies = [];
    try {
      const urlObj = new URL(imageUrl);
      cookies = await browser.cookies.getAll({ domain: urlObj.hostname });
      const parts = urlObj.hostname.split('.');
      if (parts.length > 2) {
        const parentCookies = await browser.cookies.getAll({ domain: parts.slice(-2).join('.') });
        cookies.push(...parentCookies);
      }
    } catch (e) {
      console.log('Could not get cookies:', e);
    }

    const payload = {
      image_url: imageUrl,
      page_url: request.metadata?.pageUrl || tab?.url || request.url,
      save_mode: request.saveMode || 'full',
      cookies: cookies.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain,
        path: c.path || '/'
      })),
      metadata: {
        platform: request.metadata?.platform || 'web',
        title: request.metadata?.title || tab?.title || '',
        author: request.metadata?.author || '',
        description: request.metadata?.description || '',
        page_url: request.metadata?.pageUrl || tab?.url
      },
      options: request.options || {}
    };

    const response = await fetch(`${SERVER_URL}/archive-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    return result;
  } catch (error) {
    console.error('Archive image error:', error);
    return { success: false, error: error.message };
  }
}

// Handle keyboard shortcuts
browser.commands.onCommand.addListener(async (command) => {
  if (command === "quick-save") {
    const [tab] = await browser.tabs.query({active: true, currentWindow: true});
    if (tab) {
      await archiveUrl(tab.url, tab);
    }
  }
});

// Capture and crop screenshot to specified bounds
async function captureScreenshot(tabId, bounds) {
  try {
    const dataUrl = await browser.tabs.captureVisibleTab(null, {
      format: 'png'
    });

    if (!bounds) {
      return dataUrl;
    }

    const img = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const canvas = new OffscreenCanvas(bounds.width, bounds.height);
    const ctx = canvas.getContext('2d');
    const sourceY = bounds.viewportY * (bounds.dpr || 1);

    ctx.drawImage(
      img,
      bounds.x, sourceY, bounds.width, bounds.height,
      0, 0, bounds.width, bounds.height
    );

    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch (error) {
    console.error('Screenshot capture error:', error);
    return null;
  }
}

// Message handler for content scripts
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[archiver-bg] message received:', request.action);

  if (request.action === 'captureScreenshot') {
    captureScreenshot(sender.tab?.id, request.bounds)
      .then(screenshot => sendResponse({ screenshot }))
      .catch(error => sendResponse({ screenshot: null, error: error.message }));
    return true;
  }

  if (request.action === 'archive') {
    archiveUrl(request.url, sender.tab || request.tab, {
      ...request.options,
      saveMode: request.saveMode,
      screenshot: request.screenshot
    })
      .then(sendResponse)
      .catch(error => sendResponse({success: false, error: error.message}));
    return true;
  }

  if (request.action === 'archiveImage') {
    archiveImage(request, sender.tab)
      .then(sendResponse)
      .catch(error => sendResponse({success: false, error: error.message}));
    return true;
  }

  if (request.action === 'checkServer') {
    sendResponse({available: serverAvailable});
  }

  if (request.action === 'getJobs') {
    fetch(`${SERVER_URL}/jobs?limit=50`)
      .then(r => r.json())
      .then(sendResponse)
      .catch(error => sendResponse({error: error.message}));
    return true;
  }

  if (request.action === 'checkArchived') {
    fetch(`${SERVER_URL}/check-archived`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url: request.url,
        check_file_exists: true
      })
    })
      .then(r => r.json())
      .then(sendResponse)
      .catch(error => sendResponse({ archived: false, error: error.message }));
    return true;
  }
});
