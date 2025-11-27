# Media Archiver

Local media archival with browser extension. Downloads videos, images, and galleries using yt-dlp and gallery-dl.

## Quick Start

```bash
./install.sh

# Start server
cd server && source venv/bin/activate && python3 -m uvicorn main:app --port 8888
```

**Install extension:**
- Firefox: `about:debugging` → Load Temporary Add-on → `extension/manifest.json`
- Chrome: `chrome://extensions` → Load unpacked → `extension/`

## How It Works

```
Browser Extension → POST /archive → FastAPI Server → yt-dlp/gallery-dl
                                          ↓
                                  ~/MediaArchive/{type}/{year}/{month}/
```

- Click extension icon or right-click media to archive
- Cookies passed through for private content
- Files organized by type and date

## Supported Sites

**yt-dlp**: YouTube, Twitter/X, Instagram, TikTok, Vimeo, Reddit, [1000+ more](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md)

**gallery-dl**: Flickr, Pixiv, DeviantArt, Tumblr, Pinterest, Imgur, [many more](https://github.com/mikf/gallery-dl/blob/master/docs/supportedsites.md)

**dezoomify-rs**: Google Arts & Culture, IIIF, Zoomify, Deep Zoom - downloads ultra-high-resolution tiled images (see [DEZOOMIFY.md](DEZOOMIFY.md))

### High-Resolution Image Support

For tiled/zoomable images (requires [dezoomify-rs](https://github.com/lovasoa/dezoomify-rs)):
```bash
brew install dezoomify-rs  # or: cargo install dezoomify-rs
```

**Google Arts & Culture** download options:
- **Click** → 4K (~5-15MB) - quick reference
- **Shift+Click** → 8K (~20-60MB) - detailed study
- **Alt+Click** → Full res (50-500MB+) - archival quality

Also supports IIIF collections, Met, British Museum, Rijksmuseum, NGA, and more.

See [DEZOOMIFY.md](DEZOOMIFY.md) for full documentation.

## API

```bash
curl http://localhost:8888/health
curl http://localhost:8888/jobs
curl http://localhost:8888/dashboard
```

## Storage

Files stored flat by month with consistent naming:

```
~/MediaArchive/
├── 2024-11/
│   ├── 143052-twitter-interesting-thread.mp4
│   ├── 143052-twitter-interesting-thread.md      # sidecar metadata
│   ├── 181523-googlearts-the-starry-night.jpg
│   └── 181523-googlearts-the-starry-night.md
├── 2024-12/
│   └── ...
└── archive.db
```

Naming: `HHMMSS-platform-slug.ext`
