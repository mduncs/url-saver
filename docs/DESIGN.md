# Media Archiver

## Goal
Zotero/Obsidian for media. Browser extension → local archive.

## Architecture
```
┌─────────────────────────────────────────────────────────────┐
│  Firefox Extension                                          │
│  - cmd+shift+s / icon click / right-click menu              │
│  - content scripts: twitter, youtube, reddit, galleries     │
│  - grabs cookies, page metadata, optional screenshot        │
│  - POSTs to localhost:8888                                  │
└──────────────────────┬──────────────────────────────────────┘
                       │
          POST /archive ──────────────────┐
          POST /archive-image             │
          GET /health, /jobs, /stats      │
          POST /check-archived            │
                       │                  │
                       ▼                  │
┌─────────────────────────────────────────┴───────────────────┐
│  FastAPI Server (localhost:8888)                            │
│                                                             │
│  main.py:                                                   │
│  - ArchiveRequest model (url, cookies, screenshot, mode)    │
│  - ImageArchiveRequest model (for gallery sites)            │
│  - process_download() background task                       │
│  - Twitter special handling (direct HTTP for images)        │
│  - .md sidecar generation (Obsidian-native)                 │
│  - /dashboard HTML UI                                       │
│                                                             │
│  storage.py: ~/MediaArchive/YYYY-MM-DD/ structure           │
│  database/: SQLite job tracking (archive.db)                │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  Downloaders (server/downloaders/)                          │
│                                                             │
│  ytdlp_handler.py    - videos (youtube, twitter, etc)       │
│  gallery_handler.py  - images (flickr, deviantart, etc)     │
│  dezoomify_handler.py - tiled/zoomable (google arts, IIIF)  │
│  base.py             - DownloadManager picks handler by URL │
└─────────────────────────────────────────────────────────────┘
                       │
                       ▼
              ~/MediaArchive/
              ├── archive.db
              └── 2024-12-16/
                  ├── index.md
                  ├── twitter-user-123456.jpg
                  ├── twitter-user-123456.md   (sidecar)
                  └── youtube-video-abc.mp4
```

## Storage
```
~/MediaArchive/YYYY-MM-DD/
├── YYYY-MM-DD-platform-slug.mp4
├── YYYY-MM-DD-platform-slug.context.png  (screenshot)
├── YYYY-MM-DD-platform-slug.md           (sidecar)
└── index.md                              (daily log)
```

## Save Modes
- **full**: media + .md sidecar + optional screenshot
- **quick**: media only (shift+click)
- **text**: screenshot + metadata only, no download (alt+click)

## Special Handling
- **twitter images**: direct HTTP download (faster than gallery-dl)
- **twitter video/gif**: falls back to gallery-dl/yt-dlp
- **flickr**: gallery-dl → URL size variants → page HTML scraping for high-res
- **google arts/IIIF**: dezoomify-rs for tiled zoomable images

## Extension Notes

**No popup** - Firefox has a bug where popup scripts break certain Next.js sites
(depop.com, possibly others). Icon click archives directly instead.

**Content scripts:**
- `content-twitter.js` - tweet archiving with emotion wheel
- `content-youtube.js` - video page archiving
- `content-reddit.js` - post/comment archiving
- `content-gallery.js` - flickr, museums, art sites

## Key Files
- `server/main.py` — FastAPI routes and download logic
- `server/downloaders/` — yt-dlp, gallery-dl, dezoomify handlers
- `server/storage/` — file organization
- `server/database/` — SQLite job tracking
- `extension/background.js` — server comms, no popup
- `extension/content-*.js` — per-site UI integration

## Commands
```bash
# install
./install.sh

# run server manually
cd server && source venv/bin/activate && python3 -m uvicorn main:app --port 8888

# launchd (auto-start)
launchctl load ~/Library/LaunchAgents/com.mediaarchiver.server.plist
launchctl list | grep mediaarchiver

# logs
cat /tmp/media-archiver.log
```

## Sidecar Format (.md)
```yaml
---
source: https://flickr.com/photos/...
platform: flickr
author: "Steven Zucker"
title: "Brass Bowl with Inlay"
archived: 2025-11-25T14:30:52
page_url: https://www.flickr.com/photos/profzucker/...
tags: ["art", "metalwork", "islamic"]
---

![[143052-flickr-profzucker-brass-bowl.jpg]]
```

Obsidian-native: participates in graph, human readable, future-proof plain text.

## Gallery Sites (content-gallery.js)

Single content script with per-site configs:

**Supported:**
- Flickr, DeviantArt, ArtStation, Pinterest
- Museums: Met, British Museum, Rijksmuseum, NGA, Wikimedia Commons
- Google Arts & Culture (dezoomify-rs)

**Config structure:**
```javascript
SITE_CONFIG[siteName] = {
  itemSelector: '.photo-card',
  containerSelector: '.gallery',
  getImageUrl: (el) => el.querySelector('img')?.src,
  getPageUrl: (el) => el.querySelector('a')?.href,
  getMetadata: (el) => ({ title, artist, description })
}
```
