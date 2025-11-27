// Simple popup script with better error handling

// Get browser API
const browserAPI = (typeof browser !== 'undefined') ? browser : chrome;

document.addEventListener('DOMContentLoaded', async () => {
  const statusDot = document.getElementById('statusDot');
  const statusText = document.getElementById('statusText');
  const currentUrl = document.getElementById('currentUrl');
  const archiveBtn = document.getElementById('archiveBtn');
  const dashboardBtn = document.getElementById('dashboardBtn');
  const helpLink = document.getElementById('helpLink');

  let currentTab = null;

  // Get current tab
  try {
    const tabs = await browserAPI.tabs.query({active: true, currentWindow: true});
    currentTab = tabs[0];
    currentUrl.textContent = currentTab.url || 'No URL';
  } catch (error) {
    console.error('Error getting tab:', error);
    currentUrl.textContent = 'Error getting current tab';
  }

  // Check server status
  async function checkServer() {
    try {
      const response = await fetch('http://localhost:8888/health');
      if (response.ok) {
        statusDot.classList.remove('offline');
        statusText.textContent = 'Server connected';
        archiveBtn.disabled = false;
        return true;
      }
    } catch (error) {
      // Server not running
    }

    statusDot.classList.add('offline');
    statusText.textContent = 'Server offline';
    archiveBtn.disabled = true;
    return false;
  }

  // Archive current page
  archiveBtn.addEventListener('click', async () => {
    if (!currentTab) return;

    archiveBtn.disabled = true;
    archiveBtn.textContent = 'Archiving...';

    try {
      // Send to background script
      browserAPI.runtime.sendMessage({
        action: 'archive',
        url: currentTab.url,
        tab: currentTab
      }, response => {
        if (response && response.success) {
          archiveBtn.textContent = '✅ Archived!';
        } else {
          archiveBtn.textContent = '❌ Failed';
        }

        setTimeout(() => {
          archiveBtn.textContent = 'Archive This Page';
          archiveBtn.disabled = false;
        }, 2000);
      });
    } catch (error) {
      console.error('Archive error:', error);
      archiveBtn.textContent = 'Error';
      setTimeout(() => {
        archiveBtn.textContent = 'Archive This Page';
        archiveBtn.disabled = false;
      }, 2000);
    }
  });

  // Open dashboard
  dashboardBtn.addEventListener('click', () => {
    browserAPI.tabs.create({url: 'http://localhost:8888/dashboard'});
  });

  // Help link
  helpLink.addEventListener('click', (e) => {
    e.preventDefault();
    browserAPI.tabs.create({url: 'https://github.com/yourusername/media-archiver'});
  });

  // Initial server check
  checkServer();
});