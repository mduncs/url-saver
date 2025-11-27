# Testing Guide - Google Arts & Culture Integration

This guide walks through testing the dezoomify-rs integration for Google Arts & Culture.

## Prerequisites

### 1. Install dezoomify-rs

```bash
# Option 1: Install via Cargo (Rust)
cargo install dezoomify-rs

# Option 2: Download pre-built binary
# Visit: https://github.com/lovasoa/dezoomify-rs/releases

# Verify installation
dezoomify-rs --version
```

### 2. Install Server Dependencies

```bash
cd /Users/md/claudium/url-saver/server
source venv/bin/activate
pip install -r requirements.txt
```

### 3. Start the Server

```bash
cd /Users/md/claudium/url-saver/server
source venv/bin/activate
python3 -m uvicorn main:app --port 8888
```

Check server health:
```bash
curl http://localhost:8888/health
```

Expected output should include `"dezoomify-rs"` in the handlers list:
```json
{
  "status": "healthy",
  "server": "Media Archiver v1.0",
  "downloaders": ["dezoomify-rs", "gallery-dl", "yt-dlp"]
}
```

### 4. Load Extension

**Firefox:**
1. Navigate to `about:debugging`
2. Click "This Firefox"
3. Click "Load Temporary Add-on"
4. Select `/Users/md/claudium/url-saver/extension/manifest.json`

**Chrome:**
1. Navigate to `chrome://extensions`
2. Enable "Developer mode"
3. Click "Load unpacked"
4. Select `/Users/md/claudium/url-saver/extension/` directory

## Test Cases

### Test 1: Basic Google Arts & Culture Download

**URL to test:**
https://artsandculture.google.com/asset/the-starry-night/bgEuwDxel93-Pg

**Steps:**
1. Open the URL in your browser
2. Wait for the page to fully load
3. Hover over the main artwork image
4. You should see an archive button appear (circular, glass effect)
5. Click the archive button
6. Button should show loading spinner
7. Wait for download to complete (30-60 seconds for large images)
8. Button should show success checkmark

**Expected result:**
```
~/MediaArchive/2025-11/
├── HHMMSS-googlearts-the-starry-night.jpg      (~85MB, 10,000+ pixels)
└── HHMMSS-googlearts-the-starry-night.md       (metadata with frontmatter)
```

**Verify:**
```bash
cd ~/MediaArchive/$(date +%Y-%m)
ls -lh *googlearts*.jpg
file *googlearts*.jpg  # Should show high resolution
cat *googlearts*.md    # Check metadata
```

### Test 2: Quick Mode (No Sidecar)

**Steps:**
1. Visit any Google Arts & Culture artwork
2. Hold SHIFT and click the archive button
3. Only the image file should be downloaded (no .md sidecar)

**Expected result:**
```
~/MediaArchive/2025-11/
└── HHMMSS-googlearts-artwork-title.jpg
```

### Test 3: Metadata Extraction

**URL to test:**
https://artsandculture.google.com/asset/girl-with-a-pearl-earring/sQEb8BMVx-iaTQ

**Steps:**
1. Archive the artwork (full mode)
2. Check the .md sidecar file

**Expected metadata:**
```markdown
---
source: https://artsandculture.google.com/asset/...
platform: googlearts
author: Johannes Vermeer
title: "Girl with a Pearl Earring"
archived: 2025-11-25T14:30:52
page_url: https://artsandculture.google.com/asset/...
description: "Mauritshuis. ..."
---

![[HHMMSS-googlearts-girl-with-a-pearl-earring.jpg]]
```

### Test 4: Multiple Museums

Test with different museum sites to verify broad compatibility:

**URLs to test:**
```
# Met Museum (IIIF)
https://www.metmuseum.org/art/collection/search/436532

# Rijksmuseum (IIIF)
https://www.rijksmuseum.nl/en/collection/SK-C-5

# National Gallery of Art (IIIF)
https://www.nga.gov/collection/art-object-page.46329.html
```

Each should use the appropriate handler (dezoomify-rs for IIIF, gallery-dl otherwise).

### Test 5: Fallback Behavior

**Test with dezoomify-rs not installed:**

```bash
# Temporarily rename dezoomify-rs
sudo mv /usr/local/bin/dezoomify-rs /usr/local/bin/dezoomify-rs.bak

# Or remove from PATH
export PATH=$(echo $PATH | sed 's|:.*cargo/bin||g')

# Try to archive
# Expected: Should fall back to gallery-dl or direct download
# Check server logs for: "dezoomify-rs not found in PATH"

# Restore
sudo mv /usr/local/bin/dezoomify-rs.bak /usr/local/bin/dezoomify-rs
```

### Test 6: Error Handling

**Test with invalid URL:**
1. Visit a Google Arts page with no high-res image
2. Click archive button
3. Should show error state (red X icon)
4. Check server logs for error message

### Test 7: Concurrent Downloads

**Test parallel downloads:**
1. Open multiple Google Arts tabs
2. Archive multiple artworks quickly
3. All should queue and download sequentially
4. No file conflicts or corruption

## Debugging

### Check Server Logs

```bash
cd /Users/md/claudium/url-saver/server
source venv/bin/activate
python3 -m uvicorn main:app --port 8888 --log-level debug
```

Look for log messages:
```
INFO:     Using dezoomify-rs for https://artsandculture.google.com/...
INFO:     Running dezoomify-rs for ...
INFO:     Successfully downloaded: ...
```

### Check Browser Console

Open browser DevTools (F12) and check the Console:
```javascript
// Should see:
[archiver] content-gallery.js loaded, hostname: artsandculture.google.com
[archiver] Gallery script active for: googlearts
[archiver] Config loaded for: googlearts
[archiver] Found N items with selector: ...
```

### Manual dezoomify-rs Test

Test dezoomify-rs directly from command line:

```bash
cd ~/MediaArchive/$(date +%Y-%m)

# Test Google Arts & Culture
dezoomify-rs \
  "https://artsandculture.google.com/asset/the-starry-night/bgEuwDxel93-Pg" \
  starry-night-test.jpg

# Should output:
# Image size: 10868x8604
# Downloading tiles...
# Progress bar...
# Successfully saved to starry-night-test.jpg
```

### Check Handler Selection

Test which handler is selected for a URL:

```bash
# In Python shell
cd /Users/md/claudium/url-saver/server
source venv/bin/activate
python3

>>> from downloaders import DownloadManager
>>> dm = DownloadManager()
>>> url = "https://artsandculture.google.com/asset/test/123"
>>> handler = dm.get_handler(url)
>>> print(handler.name)
# Expected: dezoomify-rs
```

### Common Issues

**Issue: Archive button not appearing**
- Check browser console for errors
- Verify content-gallery.js is loaded
- Check if site selectors match current DOM structure

**Issue: "dezoomify-rs not found"**
- Verify installation: `which dezoomify-rs`
- Check PATH includes cargo bin directory
- Restart server after installing dezoomify-rs

**Issue: Download fails silently**
- Check server logs for errors
- Verify server is running (`curl http://localhost:8888/health`)
- Check browser console for extension errors

**Issue: Low resolution image instead of high-res**
- Verify dezoomify-rs is in PATH
- Check handler priority in DownloadManager
- Test dezoomify-rs directly with the URL

**Issue: Out of memory**
- Very large images (>30,000px) may exhaust memory
- Try with smaller image first
- Consider using tile caching

## Performance Benchmarks

Expected download times (depends on internet speed):

| Image Size | Resolution | Tiles | Time | File Size |
|------------|-----------|-------|------|-----------|
| Small | 3,000px | 200 | 5-10s | 5-10MB |
| Medium | 7,000px | 1,000 | 15-30s | 20-40MB |
| Large | 15,000px | 3,000 | 30-60s | 60-120MB |
| Huge | 30,000px | 8,000 | 2-5min | 150-300MB |

## Success Criteria

All tests passing means:
- ✅ dezoomify-rs detected by server
- ✅ Extension loads on Google Arts & Culture pages
- ✅ Archive buttons appear on artwork images
- ✅ Downloads complete with high-resolution images
- ✅ Metadata correctly extracted and saved
- ✅ Files organized in dated folders
- ✅ Fallback works when dezoomify-rs unavailable
- ✅ Error states handled gracefully

## Next Steps

After successful testing:
1. Test with other IIIF museum sites
2. Fine-tune selectors if needed for Google Arts updates
3. Optimize download parallelism for faster downloads
4. Add progress tracking for large downloads
5. Consider automatic retry logic for failed tiles

## Resources

- [dezoomify-rs GitHub](https://github.com/lovasoa/dezoomify-rs)
- [Google Arts & Culture](https://artsandculture.google.com/)
- [IIIF Specification](https://iiif.io/)
- [DEZOOMIFY.md](DEZOOMIFY.md) - Full integration documentation
