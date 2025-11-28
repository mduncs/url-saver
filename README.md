# Media Archiver

**Local-first media archival.** Save videos, images, and galleries from the web to organized folders with rich metadata. Built for Obsidian users who want their archives queryable.

## Features

- **One-click archiving** - Browser button or right-click on any media
- **Smart downloads** - Uses yt-dlp, gallery-dl, and dezoomify-rs under the hood
- **Obsidian-native** - YAML frontmatter sidecars with wiki links
- **Duplicate detection** - Shows if you've already archived something
- **Ultra-high-res images** - Downloads tiled images from Google Arts, museums
- **Twitter integration** - Archive tweets with screenshots and metadata

## Supported Sites

| Tool | Sites |
|------|-------|
| **yt-dlp** | YouTube, Twitter/X, Instagram, TikTok, Vimeo, Reddit, [1000+ more](https://github.com/yt-dlp/yt-dlp/blob/master/supportedsites.md) |
| **gallery-dl** | Flickr, Pixiv, DeviantArt, Tumblr, Pinterest, Imgur, [many more](https://github.com/mikf/gallery-dl/blob/master/docs/supportedsites.md) |
| **dezoomify-rs** | Google Arts & Culture, IIIF, Zoomify, museums ([details](DEZOOMIFY.md)) |

## Installation

```bash
# 1. Clone and install dependencies
git clone https://github.com/YOUR_USERNAME/media-archiver
cd media-archiver
./install.sh

# 2. Start server (or use launchd for auto-start)
cd server && source venv/bin/activate
python3 -m uvicorn main:app --port 8888

# 3. Install browser extension
# Firefox: about:debugging → Load Temporary Add-on → extension/manifest.json
# Chrome: chrome://extensions → Load unpacked → extension/
```

### Optional: High-res museum images

```bash
brew install dezoomify-rs  # or: cargo install dezoomify-rs
```

## Usage

### Save Modes

| Action | Mode | What's saved |
|--------|------|--------------|
| **Click** | Full | Media + metadata sidecar |
| **Shift+Click** | Quick | Media only |
| **Alt+Click** | Text | Screenshot + metadata (Twitter) |

### Google Arts & Culture

Downloads ultra-high-resolution paintings from Google Arts:

- **Click** → 4K (~5-15MB)
- **Shift+Click** → 8K (~20-60MB)
- **Alt+Click** → Full resolution (50-500MB+)

### Duplicate Detection

Already archived something? The button turns green. Click to re-download or skip.

## Storage

Files organized by month with Obsidian-compatible sidecars:

```
~/MediaArchive/
├── 2024-11/
│   ├── 2024-11-26-1430-twitter-interesting-thread.mp4
│   ├── 2024-11-26-1430-twitter-interesting-thread.md   # YAML frontmatter
│   ├── 2024-11-26-1815-googlearts-starry-night.jpg     # 10,868 × 8,604px
│   └── 2024-11-26-1815-googlearts-starry-night.md
├── 2024-12/
│   └── ...
└── archive.db                                          # SQLite tracking
```

### Sidecar Format

```yaml
---
source: https://x.com/user/status/123456789
platform: twitter
author: "username"
archived: 2024-11-26T14:30:52
tags: ["inspiration"]
---

Tweet text here...

![[143052-twitter-interesting-thread.mp4]]
```

## API

```bash
curl http://localhost:8888/health      # Server status
curl http://localhost:8888/jobs        # Recent archives
curl http://localhost:8888/stats       # Statistics
curl http://localhost:8888/dashboard   # Web UI
```

## Auto-start (macOS)

```bash
cp com.mediaarchiver.server.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.mediaarchiver.server.plist
```

Logs: `/tmp/media-archiver.log`

## Architecture

```
Browser Extension → POST /archive → FastAPI Server → downloaders
                                         ↓
                              ~/MediaArchive/YYYY-MM/
```

The server selects the right tool automatically:
1. **dezoomify-rs** - Tiled/zoomable images (Google Arts, IIIF)
2. **gallery-dl** - Image galleries (Flickr, DeviantArt)
3. **yt-dlp** - Everything else (fallback)

## Opinionated Choices

- **Flat by month** - No nested folders, just `YYYY-MM/`. Indexing via database.
- **Sidecar metadata** - Every media file gets a `.md` with YAML frontmatter.
- **Wiki links** - `![[filename]]` for Obsidian graph compatibility.
- **Local-only** - No cloud, no sync, no telemetry. Your archives stay yours.
- **Fail fast on bad downloads** - Rejects images under 2000px (catches placeholder/failed downloads).

## License

MIT
