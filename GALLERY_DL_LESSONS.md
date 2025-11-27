# Gallery-DL Integration: Lessons Learned

**Date:** 2025-11-26
**Context:** Integrating gallery-dl for Twitter/X image downloads in Media Archiver

---

## The Hard Lessons

### 1. NEVER Kill Processes Without Checking First

**What happened:** Ran `lsof -ti:8888 | xargs kill -9` to restart the server. Killed Firefox along with all its cookies mid-session.

**The fix:**
```bash
# WRONG - kills everything on port
lsof -ti:8888 | xargs kill -9

# RIGHT - check first, kill specific PID
lsof -i :8888  # See what's there
ps -p <PID> -o pid,comm  # Verify it's not browser
kill <specific_python_pid>  # Kill only server
```

**Rule added to CLAUDE.md:**
- NEVER kill user's web browser without asking
- NEVER force-kill processes on ports without asking
- Track ports in use (`~/.claude/dotfiles/PORTS.md`)

---

### 2. Gallery-DL Cookie Format: Use Files, Not Dicts

**The error:**
```
TypeError: cannot use 'tuple' as a dict key (unhashable type: 'dict')
```

**Root cause:** gallery-dl has an internal cookie cache (`CACHE_COOKIES`) that breaks when you pass cookies as a dict directly to the config. The cache tries to use the cookies as a hash key.

**Wrong approach:**
```python
config["extractor"]["cookies"] = {"auth_token": "xyz", "ct0": "abc"}
```

**Correct approach:** Write to Netscape-format cookies.txt file:
```python
def _write_cookies_file(self, cookies: Dict, filepath: Path) -> None:
    with open(filepath, 'w') as f:
        f.write("# Netscape HTTP Cookie File\n")
        for name, value in cookies.items():
            # domain, tailmatch, path, secure, expiry, name, value
            f.write(f".x.com\tTRUE\t/\tTRUE\t0\t{name}\t{value}\n")
            f.write(f".twitter.com\tTRUE\t/\tTRUE\t0\t{name}\t{value}\n")

# Then in config:
config["extractor"]["cookies"] = str(cookies_file)
```

---

### 3. Gallery-DL Creates Subdirectories by Default

**The problem:** Downloads went to `twitter/username/filename.jpg` instead of flat `2025-11/filename.jpg`

**The fix:** Set `directory` to empty list:
```python
config = {
    "extractor": {
        "base-directory": str(output_dir),
        "parent-directory": False,
        "directory": [],  # CRITICAL: flat output, no subdirectories
        "filename": "...",
    }
}
```

---

### 4. Filename Format Must Match Project Convention

**Project standard (from PROJECT.md):**
```
HHMMSS-platform-username-title.ext
HHMMSS-platform-username-title.md   <- sidecar
```

**yt-dlp format:**
```python
'outtmpl': f'%(upload_date>%H%M%S|{timestamp})s-{platform}-%(uploader_id)s-%(title).150s.%(ext)s'
```

**gallery-dl equivalent:**
```python
f"{timestamp}-twitter-{{user[name]}}-{{content:.150}}{{_num}}.{{extension}}"
```

Key points:
- `{content:.150}` - truncate tweet text to 150 chars (matches yt-dlp)
- `{_num}` - append number for multi-image tweets
- `{user[name]}` - Twitter username
- Generate timestamp in Python, inject into format string

---

### 5. File Detection: Track BEFORE and AFTER

**The problem:** Server returned old cached filename (`googlearts-textile.jpg`) instead of newly downloaded Twitter image.

**Root cause:** `_find_downloaded_files()` searched the entire folder and returned files sorted by mtime. Old files could have newer mtime than expected.

**The fix:** Track files BEFORE download, return only NEW files:
```python
# BEFORE download
existing_files = set(self._find_all_media_files(output_dir))

# ... run gallery-dl ...

# AFTER download - only new files
all_files = set(self._find_all_media_files(output_dir))
new_files = list(all_files - existing_files)
new_files.sort(key=lambda x: x.stat().st_mtime, reverse=True)
```

---

### 6. Firefox Profile for Cookies

**For extension development with authenticated sites:**
```bash
npx web-ext run \
  --firefox=/Applications/Firefox.app/Contents/MacOS/firefox \
  --firefox-profile="$HOME/Library/Application Support/Firefox/Profiles/hoofy9fj.default-release" \
  --keep-profile-changes
```

Using main profile = access to existing Twitter login cookies.

---

### 7. SVG Elements: No Direct className Assignment

**The error:**
```
TypeError: setting getter-only property "className"
```

**Wrong:**
```javascript
svgElement.className = 'my-class';
```

**Right:**
```javascript
svgElement.setAttribute('class', 'my-class');
```

SVG elements have `className` as an `SVGAnimatedString` object, not a simple string.

---

## The Process Failures

### Reading Project Docs First

Before implementing gallery-dl filename format, should have checked:
- `PROJECT.md` - defines naming convention
- `IMPLEMENTATION_SUMMARY.md` - shows existing patterns
- `ytdlp_handler.py` - reference implementation

The naming format was documented. I didn't read it carefully enough.

### Testing the Full Flow

Changes to one part of the pipeline affect downstream:
1. gallery-dl downloads file with specific name
2. Server reads that filename for screenshot naming
3. Server writes metadata with that filename
4. Index.md references that filename

One wrong filename propagates everywhere.

---

## Configuration Reference

### Complete gallery-dl Config for Twitter
```python
config = {
    "extractor": {
        "base-directory": str(output_dir),
        "parent-directory": False,
        "directory": [],
        "filename": f"{timestamp}-twitter-{{user[name]}}-{{content:.150}}{{_num}}.{{extension}}",
        "cookies": str(cookies_file),  # Path to Netscape cookies.txt
        "postprocessors": [{
            "name": "metadata",
            "mode": "json",
            "filename": "{filename}.json"
        }],
        "skip": True,
        "sleep": 1,
        "user-agent": "Mozilla/5.0 ...",
        "retries": 3,
        "timeout": 30.0,
        "twitter": {
            "cards": True,
            "conversations": True,
            "replies": "self",
            "retweets": False,
            "videos": True
        }
    }
}
```

### Netscape Cookie File Format
```
# Netscape HTTP Cookie File
# domain    tailmatch    path    secure    expiry    name    value
.x.com      TRUE         /       TRUE      0         auth_token    xyz123
.twitter.com TRUE        /       TRUE      0         ct0           abc456
```

---

## Files Modified

| File | Changes |
|------|---------|
| `server/downloaders/gallery_handler.py` | Cookie file format, flat directory, filename template, file detection |
| `~/.claude/CLAUDE.md` | Hard rules about killing processes |
| `~/.claude/dotfiles/PORTS.md` | Port tracking |
| `extension/content-twitter.js` | SVG className fix, emotion wheel (paused) |

---

## What's Still Pending

1. **Test Twitter download end-to-end** - verify filename format works
2. **Emotion wheel feature** - on hold until core download fixed
3. **Save mode variations** - full/quick/text affect what gets saved, not filename

---

## Key Takeaways

1. **Read the docs first** - naming conventions are documented
2. **Check before killing** - processes on ports might be important
3. **Track state changes** - before/after for file detection
4. **Use file-based configs** - gallery-dl cookie cache is buggy with dicts
5. **Match existing patterns** - yt-dlp format is the reference
6. **Test the full pipeline** - changes propagate through the system
