# Dezoomify Integration for Media Archiver

This document explains the dezoomify-rs integration for downloading high-resolution tiled/zoomable images from Google Arts & Culture and other sources.

## Overview

Many museum and art websites (including Google Arts & Culture) display ultra-high-resolution images using tiling technology. These images are split into thousands of small tiles that are loaded on-demand as you zoom and pan. This integration uses [dezoomify-rs](https://github.com/lovasoa/dezoomify-rs) to download all tiles and stitch them into a single high-resolution image.

## Installation

### 1. Install dezoomify-rs

**macOS/Linux (with Rust):**
```bash
cargo install dezoomify-rs
```

**macOS (with Homebrew):**
```bash
brew install dezoomify-rs
```

**Pre-built binaries:**
Download from [GitHub Releases](https://github.com/lovasoa/dezoomify-rs/releases)

### 2. Verify Installation

```bash
dezoomify-rs --version
```

### 3. Update Python Dependencies

```bash
cd server
source venv/bin/activate
pip install -r requirements.txt
```

## Supported Sites

The DezoomifyHandler automatically detects and handles:

### Primary Support
- **Google Arts & Culture** (artsandculture.google.com)
- **IIIF** protocol (iiif.io)
- **Zoomify** format
- **Deep Zoom Image** (DZI) format

### Museum Collections
- Wellcome Collection
- David Rumsey Map Collection
- Bibliothèque nationale de France (Gallica)
- NYPL Digital Collections
- Library of Congress
- Europeana
- Heidelberg University Library
- Virtual Manuscript Library of Switzerland

## How It Works

### 1. Browser Extension Detection

When you visit a supported site (e.g., Google Arts & Culture), the extension:
- Detects the site via `getCurrentSite()` in `content-gallery.js`
- Adds archive buttons to artwork images
- Extracts metadata (title, artist, institution)

### 2. Download Request

When you click the archive button:
- The extension sends the page URL to the server
- The server's `DownloadManager` checks handlers in order:
  1. **DezoomifyHandler** (checks first for tiled images)
  2. GalleryDlHandler (for image galleries)
  3. YtDlpHandler (fallback for videos/other media)

### 3. Tiled Image Download

If DezoomifyHandler matches:
- Runs `dezoomify-rs <url> <output-file>`
- Downloads all tiles in parallel (default: 4 concurrent)
- Stitches tiles into single high-resolution image
- Extracts dimensions and metadata
- Returns DownloadResult to server

### 4. File Storage

Files are saved with the format:
```
~/MediaArchive/YYYY-MM/
├── HHMMSS-googlearts-artwork-title.jpg
└── HHMMSS-googlearts-artwork-title.md  (full mode only)
```

## Usage Examples

### Google Arts & Culture

1. Visit: https://artsandculture.google.com/asset/the-starry-night/bgEuwDxel93-Pg
2. Archive button appears on the image (gallery view) or top-right (asset page)
3. Click to download:

| Action | Resolution | Typical Size | Use Case |
|--------|------------|--------------|----------|
| **Click** | 4K (max 4000px) | ~5-15MB | Quick reference, web use |
| **Shift+Click** | 8K (max 8000px) | ~20-60MB | Print, detailed study |
| **Alt/Opt+Click** | Full resolution | 50-500MB+ | Archival, professional |

> **Note:** Full resolution shows a confirmation dialog. Google Arts images can exceed 40,000 pixels and 500MB.

### IIIF Manifest

For sites using IIIF:
```bash
# The extension will detect IIIF URLs like:
https://example.org/iiif/2/image/info.json
```

### Custom Downloads (Command Line)

You can also use dezoomify-rs directly:
```bash
cd ~/MediaArchive/$(date +%Y-%m)
dezoomify-rs "https://artsandculture.google.com/asset/..." output.jpg
```

## Configuration Options

The DezoomifyHandler supports these options (passed via the extension):

```javascript
{
  max_width: 4000,     // Max width in pixels (null for full resolution)
  parallelism: 4,      // Concurrent tile downloads
  retries: 3,          // Retry failed tiles
  tile_cache: true,    // Cache tiles for resumable downloads
  headers: {           // Custom headers
    "Authorization": "Bearer token"
  }
}
```

### Resolution Presets

The extension uses these presets for Google Arts:

| Preset | max_width | Triggered by |
|--------|-----------|--------------|
| Default | 4000 | Click |
| Large | 8000 | Shift+Click |
| Full | null (unlimited) | Alt+Click |

When `max_width` is `null`, dezoomify-rs uses `--largest` flag for full resolution.

## Image Quality

### Expected Resolutions

| Site | Typical Resolution | File Size | Tile Count |
|------|-------------------|-----------|------------|
| Google Arts & Culture | 10,000-40,000px | 50-200MB | 1,000-5,000 |
| IIIF Collections | 5,000-20,000px | 20-100MB | 500-2,000 |
| Museum Collections | 3,000-15,000px | 10-80MB | 300-1,500 |

### Example: The Starry Night

From Google Arts & Culture:
- Resolution: 10,868 × 8,604 pixels
- File size: ~85 MB
- Tiles downloaded: 2,156
- Download time: ~30 seconds

## Fallback Behavior

If dezoomify-rs is not installed or fails:

1. **DezoomifyHandler** returns `can_handle() = False`
2. **DownloadManager** tries next handler (GalleryDlHandler)
3. If all handlers fail, the extension falls back to:
   - Screenshot + metadata (if available)
   - Direct image download (lower resolution)

## Troubleshooting

### dezoomify-rs not found

```bash
# Check if dezoomify-rs is in PATH
which dezoomify-rs

# If not found, install:
cargo install dezoomify-rs

# Or add to PATH:
export PATH="$HOME/.cargo/bin:$PATH"
```

### Download fails with "No tiles found"

Some sites require authentication or have anti-scraping measures:
- Ensure you're logged in to the site in your browser
- The extension passes cookies automatically
- Some sites may still block automated downloads

### Slow downloads

Adjust parallelism in the handler:
```python
# In dezoomify_handler.py, line 142
cmd.extend(['--parallelism', '8'])  # Increase from 4 to 8
```

### Out of memory errors

Very large images (>30,000px) may exhaust memory:
- Close other applications
- Consider downloading tiles only (use `--tile-cache`)
- Stitch manually later

## Advanced Usage

### Tile Caching for Resumable Downloads

```python
# Enable tile caching in options
options = {
    'tile_cache': True
}
```

This creates `.dezoomify-cache/` with individual tiles. If download fails, re-run to resume.

### IIIF Output Format

For IIIF compliance:
```bash
dezoomify-rs <url> output.iiif
```

Creates a folder with IIIF structure and a `viewer.html` for local viewing.

### Manual Tile Downloads

```bash
# Download tiles only
dezoomify-rs --tile-cache tiles/ <url>

# Later, stitch manually
dezoomify-rs --tile-cache tiles/ --largest output.jpg
```

## Integration Details

### File Structure

```
server/downloaders/
├── __init__.py          # DownloadManager (registers DezoomifyHandler)
├── base.py              # BaseDownloader interface
├── dezoomify_handler.py # DezoomifyHandler implementation
├── gallery_handler.py   # GalleryDlHandler
└── ytdlp_handler.py     # YtDlpHandler

extension/
└── content-gallery.js   # Frontend integration (googlearts config)
```

### Handler Priority

Handlers are checked in order:
1. **DezoomifyHandler** - Tiled images (Google Arts, IIIF, Zoomify)
2. **GalleryDlHandler** - Image galleries (Flickr, DeviantArt)
3. **YtDlpHandler** - Videos and fallback

### Metadata Extraction

DezoomifyHandler extracts:
- Image dimensions (width, height)
- Tile count
- Format (google-arts-culture, iiif, zoomify, deepzoom)
- Source URL

Combined with extension metadata:
- Title, artist, institution
- Page URL
- Archive timestamp

## References

- [dezoomify-rs GitHub](https://github.com/lovasoa/dezoomify-rs)
- [dezoomify-rs Documentation](https://dezoomify-rs.ophir.dev/)
- [IIIF Specification](https://iiif.io/)
- [Google Arts & Culture](https://artsandculture.google.com/)

## Future Enhancements

Potential improvements:
- [ ] Progress tracking for large downloads
- [ ] Automatic retry with exponential backoff
- [ ] Parallel download of multiple artworks
- [ ] IIIF manifest processing for collections
- [ ] Custom dezoomer selection (auto-detect may fail)
- [ ] GPU-accelerated stitching for huge images
