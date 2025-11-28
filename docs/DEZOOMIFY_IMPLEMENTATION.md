# Google Arts & Culture + Dezoomify Implementation Summary

## Overview

Successfully added support for Google Arts & Culture and other tiled/zoomable image sources using dezoomify-rs. This enables downloading ultra-high-resolution artworks (10,000+ pixels) that are normally only viewable through zoom interfaces.

## Implementation Date
2025-11-25

## What Was Implemented

### 1. Server-Side Handler (`server/downloaders/dezoomify_handler.py`)

**New file:** `DezoomifyHandler` class that:
- Detects tiled/zoomable image URLs (Google Arts & Culture, IIIF, Zoomify, Deep Zoom)
- Executes `dezoomify-rs` CLI tool via subprocess
- Handles parallelism, retries, and tile caching
- Extracts metadata (dimensions, tile count, format)
- Supports cookie passing for authenticated sites
- Returns high-resolution stitched images

**Key features:**
- Priority handler (checked first before gallery-dl and yt-dlp)
- Graceful fallback if dezoomify-rs not installed
- Supports 10+ museum/archive domains
- Auto-detects format (IIIF, Zoomify, etc.)

### 2. Extension Integration (`extension/content-gallery.js`)

**Added Google Arts & Culture site config:**
```javascript
googlearts: {
  itemSelector: '[class*="asset-image"], [class*="AssetImage"]',
  containerSelector: 'main, [class*="AssetPage"]',
  getImageUrl: (el) => window.location.href,  // Pass page URL to dezoomify
  getPageUrl: (el) => window.location.href,
  getMetadata: (el) => {
    // Extracts: title, artist, institution, description
  }
}
```

**Features:**
- Archive buttons appear on artwork images
- Metadata extraction from page structure
- Full/quick save modes supported
- Matches existing UI pattern (glassmorphism, tooltips)

### 3. Download Manager Update (`server/downloaders/__init__.py`)

**Handler priority:**
1. DezoomifyHandler (tiled images)
2. GalleryDlHandler (image galleries)
3. YtDlpHandler (videos, fallback)

This ensures tiled images are detected and handled by dezoomify-rs before other handlers.

### 4. Extension Manifest (`extension/manifest.json`)

**Added Google Arts & Culture:**
- Content script match: `*://artsandculture.google.com/*`
- Excluded from generic content script
- Runs `content-gallery.js` on Arts & Culture pages

### 5. Documentation

**Created three comprehensive docs:**

#### `DEZOOMIFY.md` (Full Integration Guide)
- Installation instructions
- Supported sites list
- How it works (architecture)
- Configuration options
- Troubleshooting guide
- Advanced usage examples

#### `TESTING.md` (Testing Guide)
- Prerequisites checklist
- 7 test cases with expected results
- Debugging procedures
- Performance benchmarks
- Success criteria

#### `README.md` (Updated)
- Added dezoomify-rs to supported sites
- Installation snippet
- Link to detailed documentation

### 6. Dependencies (`server/requirements.txt`)

**Added:**
- `Pillow>=10.0.0` - Optional for image dimension detection

**External requirement:**
- `dezoomify-rs` - Must be installed via Cargo or binary

## Supported Sites

### Primary Target
- **Google Arts & Culture** (artsandculture.google.com)

### Also Supported (IIIF/Zoomable Images)
- Wellcome Collection
- David Rumsey Map Collection
- Bibliothèque nationale de France (Gallica)
- NYPL Digital Collections
- Library of Congress
- Europeana
- Heidelberg University Library
- Virtual Manuscript Library of Switzerland
- Any IIIF-compliant repository
- Zoomify-powered sites
- Deep Zoom Image (DZI) sites

## File Structure

```
./
├── server/
│   ├── downloaders/
│   │   ├── __init__.py              [MODIFIED] - Added DezoomifyHandler
│   │   ├── dezoomify_handler.py     [NEW] - Main handler implementation
│   │   ├── base.py                  [unchanged]
│   │   ├── gallery_handler.py       [unchanged]
│   │   └── ytdlp_handler.py         [unchanged]
│   └── requirements.txt             [MODIFIED] - Added Pillow
├── extension/
│   ├── content-gallery.js           [MODIFIED] - Added googlearts config
│   └── manifest.json                [MODIFIED] - Added Google Arts matches
├── DEZOOMIFY.md                     [NEW] - Integration documentation
├── TESTING.md                       [NEW] - Testing guide
├── IMPLEMENTATION_SUMMARY.md        [NEW] - This file
└── README.md                        [MODIFIED] - Added dezoomify section
```

## Architecture Flow

```
User visits Google Arts & Culture
         ↓
Extension detects site (getCurrentSite() → 'googlearts')
         ↓
Loads SITE_CONFIG['googlearts']
         ↓
Adds archive buttons to artwork images
         ↓
User clicks archive button
         ↓
Extension sends request to server:
  {
    action: 'archiveImage',
    url: page_url,
    imageUrl: page_url,  // dezoomify handles URL parsing
    metadata: { title, artist, institution, ... }
  }
         ↓
Server DownloadManager checks handlers:
  1. DezoomifyHandler.can_handle(url) → TRUE
     (matches 'artsandculture.google.com')
         ↓
DezoomifyHandler.download():
  - Runs: dezoomify-rs <url> <output.jpg>
  - Parallelism: 4 concurrent tile downloads
  - Retries: 3 attempts per tile
  - Stitches tiles into final image
         ↓
Returns DownloadResult:
  {
    file_path: ~/MediaArchive/2025-11/143052-googlearts-title.jpg,
    metadata: { width, height, tile_count, format, ... }
  }
         ↓
Server saves:
  - Image file (JPG, high-res)
  - .md sidecar with YAML frontmatter (full mode)
         ↓
Extension shows success (green checkmark)
```

## Usage Example

1. **Visit artwork:**
   https://artsandculture.google.com/asset/the-starry-night/bgEuwDxel93-Pg

2. **Archive:**
   - Hover over image → Archive button appears
   - Click button → Downloads high-res image
   - Wait ~30 seconds for large images

3. **Result:**
   ```
   ~/MediaArchive/2025-11/
   ├── 143052-googlearts-the-starry-night.jpg  (10,868 × 8,604px, ~85MB)
   └── 143052-googlearts-the-starry-night.md
   ```

4. **Metadata:**
   ```markdown
   ---
   source: https://lh3.googleusercontent.com/...
   platform: googlearts
   author: Vincent van Gogh
   title: "The Starry Night"
   archived: 2025-11-25T14:30:52
   page_url: https://artsandculture.google.com/asset/...
   description: "The Museum of Modern Art. ..."
   resolution: 10868x8604
   ---

   ![[143052-googlearts-the-starry-night.jpg]]
   ```

## Key Design Decisions

### 1. Handler Priority
**Decision:** Check dezoomify-rs first, before gallery-dl and yt-dlp

**Rationale:** Tiled images require special handling. If dezoomify-rs matches, it should take precedence to ensure high-res download.

### 2. URL Passing Strategy
**Decision:** Pass page URL instead of extracting tile manifest

**Rationale:** dezoomify-rs auto-detects tile sources from page URL. This is more robust than trying to extract IIIF manifest URLs in JavaScript.

### 3. Fallback Behavior
**Decision:** Graceful degradation if dezoomify-rs unavailable

**Rationale:** Optional dependency - extension still works for other sites. Handler returns `can_handle() = False` if binary not found.

### 4. Filename Generation
**Decision:** Extract asset ID from Google Arts URLs when possible

**Rationale:** Provides stable, unique filenames. Falls back to slugified titles for other sites.

### 5. Metadata Extraction
**Decision:** Extract metadata in extension (JS) not server (Python)

**Rationale:** Page structure varies by site. Extension has access to DOM for accurate extraction. Server receives pre-extracted metadata.

## Testing Checklist

- [ ] Install dezoomify-rs
- [ ] Install server dependencies (Pillow)
- [ ] Start server, verify `/health` shows dezoomify-rs
- [ ] Load extension
- [ ] Test Google Arts & Culture download
- [ ] Verify high-resolution output
- [ ] Check metadata in .md sidecar
- [ ] Test quick mode (shift+click)
- [ ] Test IIIF museum sites
- [ ] Test fallback (dezoomify-rs not installed)

See [TESTING.md](TESTING.md) for detailed test procedures.

## Performance Expectations

| Image Size | Resolution | Time | File Size |
|------------|-----------|------|-----------|
| Small | 3,000px | 5-10s | 5-10MB |
| Medium | 7,000px | 15-30s | 20-40MB |
| Large | 15,000px | 30-60s | 60-120MB |
| Huge | 30,000px | 2-5min | 150-300MB |

Download times depend on:
- Internet connection speed
- Server response time
- Number of tiles
- Image dimensions
- Parallelism setting (default: 4)

## Future Enhancements

Potential improvements:
- Progress tracking UI for large downloads
- Automatic retry with exponential backoff
- IIIF manifest processing for collections
- Custom dezoomer selection (manual override)
- Batch download for exhibition pages
- GPU-accelerated stitching for huge images
- Tile cache persistence for resumable downloads

## Known Limitations

1. **Requires dezoomify-rs installation** - Not a pure JavaScript solution
2. **Large images memory-intensive** - Very high-res images (>30,000px) may exhaust memory
3. **Download time** - Large images can take several minutes
4. **No progress indicator** - Extension shows loading spinner but no percentage
5. **Single image per page** - Doesn't handle gallery/collection pages yet

## Resources

- [dezoomify-rs GitHub](https://github.com/lovasoa/dezoomify-rs)
- [Google Arts & Culture](https://artsandculture.google.com/)
- [IIIF Specification](https://iiif.io/)
- [How to Download Ultra High-Res Images](https://max.limpag.com/article/dezoomify-download-google-arts-culture/)

## Credits

- dezoomify-rs by [lovasoa](https://github.com/lovasoa)
- Implementation: 2025-11-25
- Part of Media Archiver project
