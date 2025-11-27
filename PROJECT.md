# Media Archiver

## Goal
Zotero/Obsidian for media. Browser extension → local archive.

## Flow
```
Extension → POST /archive → FastAPI → yt-dlp/gallery-dl → ~/MediaArchive/
```

## yt-dlp Defaults (from ~/.zshrc)
```bash
yt-dlp -f bestvideo+bestaudio/best \
  --merge-output-format mp4 \
  --concurrent-fragments 4 \
  --add-metadata \
  --embed-thumbnail \
  --embed-subs
```

## Design Direction (WIP)

**Storage:**
```
~/MediaArchive/YYYY-MM/
├── HHMMSS-platform-slug.mp4
├── HHMMSS-platform-slug.context.png
├── HHMMSS-platform-slug.json
└── index.md
```

**Save modes:**
- Click = full (media + context.png + json)
- Shift+Click = quick (media only)
- Alt+Click = text-only (context.png + json)

## Key Files
- `server/main.py` — FastAPI
- `server/downloaders/ytdlp_handler.py` — yt-dlp
- `extension/background.js` — server comms
- `extension/content-twitter.js` — twitter UI

## Commands
```bash
./install.sh
cd server && source venv/bin/activate && python3 -m uvicorn main:app --port 8888
```

## Generic Image Downloader Design (WIP)

### Principles from Twitter Implementation

**UI Integration:**
- Match native UI styling (icon size, colors, spacing)
- Clone existing button wrappers for perfect flex alignment
- Fix spacing quirks (lazy-loaded elements, margin overrides)
- Single action: click to download (no modes for generic images)
- Shift+click: download without sidecar (quick mode)

**Filename Format:**
```
HHMMSS-platform-username-title.ext
HHMMSS-platform-username-title.md   ← sidecar
```
- Time prefix: chronological sorting within day
- Platform: quick visual identification
- Username: attribution (where available)
- Title: up to 150 chars, slugified
- Metadata in `.md` sidecar with YAML frontmatter (Obsidian-native)

**Sidecar Format (.md):**
```markdown
---
source: https://flickr.com/photos/...
platform: flickr
author: profzucker
title: Brass Bowl with Inlay
archived: 2025-11-25T14:30:52
resolution: 6000x4000
---

![[143052-flickr-profzucker-brass-bowl.jpg]]
```
- Participates in Obsidian graph
- Human readable/editable
- Can add notes below frontmatter
- Future-proof plain text

**Image Quality:**
- Always fetch highest resolution available
- gallery-dl: `size-max: 6000` for Flickr
- yt-dlp: `format: best`
- Museums: look for "download original" links, zoom tiles

**Target Sites:**
1. **Flickr** — gallery-dl, high-res originals
2. **Museums** (Met, British Museum, Rijks, etc.) — IIIF/zoom tiles
3. **Art sites** (ArtStation, DeviantArt, Pixiv) — gallery-dl
4. **Image boards** (Imgur, etc.) — gallery-dl
5. **General web** — largest `<img>` or `srcset` parsing

### Implementation Approach

**Option A: Site-specific content scripts**
- `content-flickr.js`, `content-museum.js`, etc.
- Pros: tailored UI per site
- Cons: maintenance burden

**Option B: Generic content script + site configs**
- Single `content-generic.js` with site detection
- Config object per domain for selectors
- Pros: DRY, easier to add sites
- Cons: may not handle edge cases

**Option C: Context menu + keyboard shortcut**
- Right-click → "Archive image"
- Ctrl+Shift+S on any page
- Pros: works everywhere immediately
- Cons: no inline UI feedback

**Recommended: B + C**
- Generic script with site configs for major sites
- Context menu fallback for unsupported sites
- Keyboard shortcut for power users

## Gallery Implementation (content-gallery.js)

Single content script handles all gallery/image sites with per-site configs.

**Supported sites:**
- Flickr, DeviantArt, ArtStation, Pinterest
- Museums: Met, British Museum, Rijksmuseum, NGA, Wikimedia Commons
- Google Arts & Culture (via dezoomify-rs)

**Site config structure:**
```javascript
SITE_CONFIG[siteName] = {
  itemSelector: '.photo-card, .thumbnail',  // Elements to add buttons to
  containerSelector: '.gallery, main',       // MutationObserver target
  getImageUrl: (el) => el.querySelector('img')?.src,
  getPageUrl: (el) => el.querySelector('a')?.href,
  getMetadata: (el) => ({ title, artist, description })
}
```

**Rich metadata fetching (Flickr):**
When archiving from gallery view, fetches single photo page to extract:
- Title, author, description
- Tags (up to 10)
- Date taken

```javascript
async function fetchFlickrPhotoMetadata(pageUrl) {
  const html = await fetch(pageUrl).then(r => r.text());
  const doc = new DOMParser().parseFromString(html, 'text/html');
  return {
    title: doc.querySelector('.photo-title')?.textContent,
    artist: doc.querySelector('.owner-name a')?.textContent,
    tags: [...doc.querySelectorAll('.tags-list a.tag')].map(t => t.textContent),
    dateTaken: doc.querySelector('.date-taken-label')?.textContent
  };
}
```

**Server endpoint:** `POST /archive-image`
```python
class ImageMetadata(BaseModel):
    platform: str = "web"
    title: str = ""
    author: str = ""
    description: str = ""
    page_url: Optional[str] = None
    tags: List[str] = []
    dateTaken: str = ""
```

**Sidecar output (.md):**
```yaml
---
source: https://live.staticflickr.com/...
platform: flickr
author: "Steven Zucker"
title: "Brass Bowl with Inlay"
archived: 2025-11-25T14:30:52
page_url: https://www.flickr.com/photos/profzucker/...
tags: ["art", "metalwork", "islamic"]
date_taken: "November 15, 2024"
---

![[143052-flickr-profzucker-brass-bowl.jpg]]
```
