// Media Archiver - Background Script

// Firefox compatibility: use browser API
const browser = window.browser || window.chrome;

const SERVER_URL = 'http://localhost:8888';
let serverAvailable = false;

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

// Periodic health check every 5 seconds
setInterval(checkServer, 5000);
checkServer(); // Initial check

// Create context menu for right-click saving
browser.runtime.onInstalled.addListener(() => {
  browser.contextMenus.create({
    id: "save-media",
    title: "Archive this media",
    contexts: ["image", "video", "audio", "link", "page"]
  });
});

browser.contextMenus.onClicked.addListener(async (info, tab) => {
  const targetUrl = info.srcUrl || info.linkUrl || info.pageUrl || tab.url;
  await archiveUrl(targetUrl, tab);
});

// Main archive function
async function archiveUrl(url, tab, options = {}) {
  console.log('[archiver-bg] archiveUrl called:', { url, saveMode: options.saveMode, hasScreenshot: !!options.screenshot });

  if (!serverAvailable) {
    console.log('[archiver-bg] server not available, checking...');
    // Try one more time
    const available = await checkServer();
    if (!available) {
      console.error('[archiver-bg] server offline!');
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
    // Get all cookies for the domain
    const urlObj = new URL(url);
    const cookies = await browser.cookies.getAll({ domain: urlObj.hostname });
    console.log('[archiver-bg] got', cookies.length, 'cookies for', urlObj.hostname);

    // Also get cookies for parent domain (for sites like x.com)
    const domainParts = urlObj.hostname.split('.');
    if (domainParts.length > 2) {
      const parentDomain = domainParts.slice(-2).join('.');
      const parentCookies = await browser.cookies.getAll({ domain: parentDomain });
      cookies.push(...parentCookies);
    }

    // Prepare archive request
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

    // Send to server
    console.log('[archiver-bg] sending POST to /archive with url:', payload.url);
    const response = await fetch(`${SERVER_URL}/archive`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    console.log('[archiver-bg] server response:', result);

    // Show notification
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

    // Get cookies for the image domain (needed for some sites like Flickr)
    let cookies = [];
    try {
      const urlObj = new URL(imageUrl);
      cookies = await browser.cookies.getAll({ domain: urlObj.hostname });
      // Also try parent domain
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

    console.log('[archiver] Sending to server:', payload.image_url, 'with', cookies.length, 'cookies');

    const response = await fetch(`${SERVER_URL}/archive-image`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    const result = await response.json();
    console.log('[archiver] Server result:', result);
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
    // Capture the visible tab as a data URL
    const dataUrl = await browser.tabs.captureVisibleTab(null, {
      format: 'png'
    });

    // If no bounds specified, return full screenshot
    if (!bounds) {
      return dataUrl;
    }

    // Create an offscreen canvas to crop the image
    const img = await createImageBitmap(await (await fetch(dataUrl)).blob());

    const canvas = new OffscreenCanvas(bounds.width, bounds.height);
    const ctx = canvas.getContext('2d');

    // Use viewportY for cropping (relative to visible viewport)
    const sourceY = bounds.viewportY * (bounds.dpr || 1);

    ctx.drawImage(
      img,
      bounds.x,           // source x
      sourceY,            // source y (viewport-relative, scaled by DPR)
      bounds.width,       // source width
      bounds.height,      // source height
      0,                  // dest x
      0,                  // dest y
      bounds.width,       // dest width
      bounds.height       // dest height
    );

    // Convert to base64 PNG
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

// Message handler for popup and content scripts
browser.runtime.onMessage.addListener((request, sender, sendResponse) => {
  console.log('[archiver-bg] message received:', request.action, request.url || '');

  if (request.action === 'captureScreenshot') {
    captureScreenshot(sender.tab?.id, request.bounds)
      .then(screenshot => sendResponse({ screenshot }))
      .catch(error => sendResponse({ screenshot: null, error: error.message }));
    return true; // Keep channel open for async response
  }

  if (request.action === 'archive') {
    console.log('[archiver-bg] handling archive action for:', request.url);
    archiveUrl(request.url, sender.tab || request.tab, {
      ...request.options,
      saveMode: request.saveMode,
      screenshot: request.screenshot
    })
      .then(result => {
        console.log('[archiver-bg] archive complete, sending response:', result?.success);
        sendResponse(result);
      })
      .catch(error => {
        console.error('[archiver-bg] archive failed:', error);
        sendResponse({success: false, error: error.message});
      });
    return true; // Keep channel open for async response
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
});