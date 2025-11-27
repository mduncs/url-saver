# Quick Start: Google Arts & Culture Downloads

Get ultra-high-resolution artworks from Google Arts & Culture in 3 steps.

## 1. Install dezoomify-rs

Choose one method:

### Option A: Cargo (Recommended)
```bash
cargo install dezoomify-rs
```

### Option B: Homebrew (macOS)
```bash
brew install dezoomify-rs
```

### Option C: Pre-built Binary
Download from: https://github.com/lovasoa/dezoomify-rs/releases

Verify installation:
```bash
dezoomify-rs --version
```

## 2. Update Server Dependencies

```bash
cd /Users/md/claudium/url-saver/server
source venv/bin/activate
pip install -r requirements.txt
```

This installs Pillow for image dimension detection.

## 3. Restart Server

```bash
cd /Users/md/claudium/url-saver/server
source venv/bin/activate
python3 -m uvicorn main:app --port 8888
```

Verify dezoomify-rs is detected:
```bash
curl http://localhost:8888/health
```

Should show: `"downloaders": ["dezoomify-rs", "gallery-dl", "yt-dlp"]`

## 4. Reload Extension

If extension is already loaded:
- Firefox: `about:debugging` → Reload
- Chrome: `chrome://extensions` → Reload icon

## 5. Test It!

Visit: https://artsandculture.google.com/asset/the-starry-night/bgEuwDxel93-Pg

1. Hover over the artwork
2. Click the archive button
3. Wait ~30 seconds
4. Check: `~/MediaArchive/2025-11/`

You should see:
```
HHMMSS-googlearts-the-starry-night.jpg  (~85MB, 10,868 × 8,604 pixels)
HHMMSS-googlearts-the-starry-night.md   (metadata)
```

## Troubleshooting

### "dezoomify-rs not found"
```bash
# Check PATH
which dezoomify-rs

# Add to PATH if needed
export PATH="$HOME/.cargo/bin:$PATH"

# Restart server after updating PATH
```

### Archive button doesn't appear
- Reload the extension
- Check browser console (F12) for errors
- Verify page is fully loaded

### Download fails
- Check server logs for errors
- Verify server is running: `curl http://localhost:8888/health`
- Try smaller image first

## What You Get

| Site | Resolution | File Size | Download Time |
|------|-----------|-----------|---------------|
| Google Arts | 10,000-40,000px | 50-200MB | 30s-5min |
| Museum IIIF | 5,000-20,000px | 20-100MB | 15s-2min |

## Next Steps

- Read [DEZOOMIFY.md](DEZOOMIFY.md) for full documentation
- See [TESTING.md](TESTING.md) for complete test procedures
- Browse Google Arts & Culture collections: https://artsandculture.google.com/

## Examples to Try

World-famous artworks in ultra-high resolution:

1. **The Starry Night** (Van Gogh)
   https://artsandculture.google.com/asset/the-starry-night/bgEuwDxel93-Pg

2. **Girl with a Pearl Earring** (Vermeer)
   https://artsandculture.google.com/asset/girl-with-a-pearl-earring/sQEb8BMVx-iaTQ

3. **The Great Wave** (Hokusai)
   https://artsandculture.google.com/asset/the-great-wave-off-kanagawa/fAGr7dYzeDpFgw

4. **Mona Lisa** (da Vinci)
   https://artsandculture.google.com/asset/mona-lisa/uQGZ28lYUJ3OGw

5. **The Scream** (Munch)
   https://artsandculture.google.com/asset/the-scream/fAFJI2NpDRJMbQ

Happy archiving!
