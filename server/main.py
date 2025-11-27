#!/usr/bin/env python3
"""
Media Archiver Server
Local server for handling media downloads from browser extension
"""

from fastapi import FastAPI, HTTPException, BackgroundTasks
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse
from pydantic import BaseModel, HttpUrl
from datetime import datetime
from typing import List, Dict, Optional, Literal
import asyncio
from pathlib import Path
import uuid
import logging
import base64
import json
from urllib.parse import urlparse

from downloaders import DownloadManager
from storage import StorageManager, detect_platform
from database import Database

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

app = FastAPI(
    title="Media Archiver",
    description="Local media archival server with yt-dlp and gallery-dl support",
    version="1.0.0"
)

# CORS for browser extension
app.add_middleware(
    CORSMiddleware,
    allow_origins=[
        "moz-extension://*",
        "chrome-extension://*",
        "http://localhost:*"
    ],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"]
)

# Request/Response models
class Cookie(BaseModel):
    name: str
    value: str
    domain: str
    path: str = "/"

class ArchiveRequest(BaseModel):
    url: str
    page_title: Optional[str] = None
    page_url: Optional[str] = None
    timestamp: datetime
    cookies: List[Cookie] = []
    options: Optional[Dict] = {}
    screenshot: Optional[str] = None  # base64 encoded PNG
    save_mode: Literal["full", "quick", "text"] = "full"

class ArchiveResponse(BaseModel):
    success: bool
    message: str
    job_id: Optional[str] = None

class JobStatus(BaseModel):
    id: str
    status: str
    url: str
    created_at: datetime
    completed_at: Optional[datetime] = None
    file_path: Optional[str] = None
    error: Optional[str] = None
    metadata: Optional[Dict] = {}

class ImageMetadata(BaseModel):
    platform: str = "web"
    title: str = ""
    author: str = ""
    description: str = ""
    page_url: Optional[str] = None
    tags: List[str] = []
    dateTaken: str = ""

class CookieData(BaseModel):
    name: str
    value: str
    domain: str = ""
    path: str = "/"

class ImageArchiveRequest(BaseModel):
    image_url: str
    page_url: Optional[str] = None
    save_mode: Literal["full", "quick"] = "full"
    cookies: List[CookieData] = []
    metadata: ImageMetadata = ImageMetadata()
    options: Optional[Dict] = {}

class CheckArchivedRequest(BaseModel):
    url: str
    check_file_exists: bool = True

class CheckArchivedResponse(BaseModel):
    archived: bool
    job_id: Optional[str] = None
    file_path: Optional[str] = None
    file_exists: Optional[bool] = None
    archived_date: Optional[datetime] = None
    age_days: Optional[int] = None

# Initialize components
db = Database(Path.home() / "MediaArchive" / "archive.db")
storage = StorageManager(Path.home() / "MediaArchive")
downloader = DownloadManager()


def extract_content_id(url: str) -> Optional[str]:
    """Extract content ID from URL (tweet ID, video ID, etc.)"""
    import re
    patterns = [
        # Twitter/X: /status/1234567890
        (r'/status/(\d+)', lambda m: m.group(1)),
        # YouTube: watch?v=xxx or youtu.be/xxx
        (r'(?:youtube\.com/watch\?v=|youtu\.be/|youtube\.com/shorts/)([a-zA-Z0-9_-]+)', lambda m: m.group(1)),
        # Reddit: /comments/xxx
        (r'/comments/([a-zA-Z0-9]+)', lambda m: m.group(1)),
    ]
    for pattern, extractor in patterns:
        match = re.search(pattern, url)
        if match:
            return extractor(match)
    return None


# Platform detection now uses storage.detect_platform (single source of truth)


def decode_and_save_screenshot(base64_data: str, output_path: Path) -> bool:
    """Decode base64 screenshot and save to file. Returns True on success."""
    try:
        # Handle data URL prefix if present
        if base64_data.startswith("data:"):
            base64_data = base64_data.split(",", 1)[1]

        image_data = base64.b64decode(base64_data)
        output_path.write_bytes(image_data)
        logger.info(f"Screenshot saved: {output_path}")
        return True
    except Exception as e:
        logger.error(f"Failed to decode/save screenshot: {e}")
        return False


def append_to_index(folder_path: Path, entry_data: Dict) -> None:
    """Append entry to index.md in the folder"""
    index_path = folder_path / "index.md"

    date_str = entry_data.get("date", datetime.now().strftime("%Y-%m-%d"))
    time_str = entry_data.get("time", datetime.now().strftime("%H:%M"))
    platform = entry_data.get("platform", "Web")
    url = entry_data.get("url", "")
    title = entry_data.get("title", "Untitled")
    filename = entry_data.get("filename", "")

    # Build entry line
    entry_line = f"- **{time_str}** [{platform}]({url}) - {title}\n"
    if filename:
        entry_line += f"  - `{filename}`\n"

    # Read existing content or start fresh
    existing_content = ""
    if index_path.exists():
        existing_content = index_path.read_text()

    date_header = f"## {date_str}\n\n"

    # Check if date header exists
    if date_header.strip() in existing_content:
        # Find position after the date header and insert entry
        header_pos = existing_content.find(date_header.strip())
        insert_pos = header_pos + len(date_header)
        new_content = (
            existing_content[:insert_pos] +
            entry_line +
            existing_content[insert_pos:]
        )
    else:
        # Add new date header at the top (after any existing content)
        if existing_content:
            new_content = date_header + entry_line + "\n" + existing_content
        else:
            new_content = date_header + entry_line

    index_path.write_text(new_content)
    logger.info(f"Updated index: {index_path}")


async def download_twitter_images(
    image_urls: List[str],
    output_dir: Path,
    basename: str,
    cookies: Dict[str, str]
) -> List[Path]:
    """
    Download Twitter images directly via HTTP.
    Returns list of downloaded file paths.
    """
    import httpx

    downloaded = []
    async with httpx.AsyncClient(follow_redirects=True, timeout=30.0) as client:
        for i, img_url in enumerate(image_urls, 1):
            try:
                response = await client.get(img_url, headers={
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                    'Referer': 'https://x.com/'
                })
                response.raise_for_status()

                # Determine extension from content-type
                content_type = response.headers.get('content-type', '')
                if 'jpeg' in content_type or 'jpg' in content_type:
                    ext = '.jpg'
                elif 'png' in content_type:
                    ext = '.png'
                elif 'gif' in content_type:
                    ext = '.gif'
                elif 'webp' in content_type:
                    ext = '.webp'
                else:
                    ext = '.jpg'

                # Name with index if multiple images
                if len(image_urls) > 1:
                    filename = f"{basename}-{i}{ext}"
                else:
                    filename = f"{basename}{ext}"

                file_path = output_dir / filename
                file_path.write_bytes(response.content)
                downloaded.append(file_path)
                logger.info(f"Downloaded Twitter image {i}/{len(image_urls)}: {filename}")

            except Exception as e:
                logger.error(f"Failed to download Twitter image {img_url}: {e}")

    return downloaded


def create_twitter_sidecar_from_content(
    output_dir: Path,
    files: List[Path],
    tweet_content: Dict,
    url: str,
    basename: str
) -> Path:
    """
    Create .md sidecar for Twitter from extension-provided content.
    """
    if not files:
        return None

    # Extract tweet info from tweetContent
    username = tweet_content.get('userName', '')
    tweet_text = tweet_content.get('text', '')
    timestamp = tweet_content.get('timestamp', '')
    emotion = tweet_content.get('emotion')  # Emotion tag from wheel

    md_path = output_dir / f"{basename}.md"

    # Build frontmatter
    now = datetime.now()
    lines = [
        "---",
        f"source: {url}",
        "platform: twitter",
    ]
    if username:
        # Clean username (may have newlines from X's layout)
        clean_username = username.split('\n')[0].strip()
        lines.append(f'author: "{clean_username}"')
    if timestamp:
        lines.append(f"tweet_date: \"{timestamp}\"")
    lines.append(f"archived: {now.isoformat()}")
    lines.append(f"media_count: {len(files)}")
    if emotion:
        lines.append(f"tags: [\"{emotion}\"]")
    lines.append("---")
    lines.append("")

    # Add tweet text if present
    if tweet_text:
        lines.append(tweet_text)
        lines.append("")

    # Embed all media files
    for f in files:
        lines.append(f"![[{f.name}]]")

    lines.append("")

    md_path.write_text("\n".join(lines))
    logger.info(f"Created Twitter sidecar: {md_path.name} ({len(files)} media files)")
    return md_path


async def create_twitter_sidecar(
    output_dir: Path,
    files: List[str],
    tweet_content: Dict,
    url: str,
    emotion_tag: Optional[str] = None
):
    """
    Create a single .md sidecar for a Twitter download (gallery-dl path).
    One .md per tweet, referencing all media files.
    Uses tweet_content from extension instead of gallery-dl metadata.
    """
    if not files:
        return

    # Extract tweet info from extension-provided content
    username = tweet_content.get('userName', '').split('\n')[0].strip() if tweet_content.get('userName') else ''
    tweet_text = tweet_content.get('text', '')
    tweet_date = tweet_content.get('timestamp', '')

    # Extract tweet_id from URL
    tweet_id = ''
    import re
    match = re.search(r'/status/(\d+)', url)
    if match:
        tweet_id = match.group(1)

    # Format tweet date if it's a timestamp
    if isinstance(tweet_date, (int, float)):
        from datetime import datetime as dt
        tweet_date = dt.fromtimestamp(tweet_date).isoformat()

    # Generate sidecar filename (matches media but without -N suffix)
    # Files are like: 2025-11-26-twitter-user-tweetid-1.jpg
    first_file = Path(files[0])
    # Remove the -N suffix to get base name for .md
    stem = first_file.stem
    # Pattern: ...-tweetid-N -> ...-tweetid
    import re
    md_stem = re.sub(r'-\d+$', '', stem)
    md_path = output_dir / f"{md_stem}.md"

    # Build frontmatter
    now = datetime.now()
    lines = [
        "---",
        f"source: {url}",
        "platform: twitter",
    ]
    if username:
        lines.append(f'author: "{username}"')
    if tweet_id:
        lines.append(f"tweet_id: {tweet_id}")
    if tweet_date:
        lines.append(f"tweet_date: {tweet_date}")
    lines.append(f"archived: {now.isoformat()}")
    if emotion_tag:
        lines.append(f"tags: [\"{emotion_tag}\"]")
    lines.append("---")
    lines.append("")

    # Add tweet text if present
    if tweet_text:
        lines.append(tweet_text)
        lines.append("")

    # Embed all media files
    for f in files:
        fname = Path(f).name
        lines.append(f"![[{fname}]]")

    lines.append("")

    md_path.write_text("\n".join(lines))
    logger.info(f"Created Twitter sidecar: {md_path.name} ({len(files)} media files)")


@app.on_event("startup")
async def startup():
    """Initialize server components"""
    await db.initialize()
    storage.ensure_directories()
    logger.info("Media Archiver server started")

@app.on_event("shutdown")
async def shutdown():
    """Cleanup on server shutdown"""
    await db.close()
    logger.info("Media Archiver server stopped")

@app.get("/health")
async def health_check():
    """Health check endpoint for extension"""
    return {
        "status": "healthy",
        "server": "Media Archiver v1.0",
        "downloaders": downloader.list_handlers()
    }

@app.post("/archive", response_model=ArchiveResponse)
async def archive_media(request: ArchiveRequest, background_tasks: BackgroundTasks):
    """Queue a new media download"""
    try:
        # Generate job ID
        job_id = str(uuid.uuid4())

        # Create job record in database
        await db.create_job(
            job_id=job_id,
            url=request.url,
            page_title=request.page_title,
            page_url=request.page_url,
            timestamp=request.timestamp
        )

        # Queue download task
        background_tasks.add_task(
            process_download,
            job_id=job_id,
            url=request.url,
            cookies=request.cookies,
            options=request.options,
            screenshot=request.screenshot,
            save_mode=request.save_mode,
            page_title=request.page_title,
            timestamp=request.timestamp
        )

        logger.info(f"Archive job queued: {job_id} for {request.url} (mode: {request.save_mode})")

        return ArchiveResponse(
            success=True,
            message=f"Archive job queued ({request.save_mode} mode)",
            job_id=job_id
        )
    except Exception as e:
        logger.error(f"Error creating archive job: {e}")
        return ArchiveResponse(
            success=False,
            message=str(e)
        )

async def process_download(
    job_id: str,
    url: str,
    cookies: List[Cookie],
    options: Dict,
    screenshot: Optional[str] = None,
    save_mode: str = "full",
    page_title: Optional[str] = None,
    timestamp: Optional[datetime] = None
):
    """Background task to process media download"""
    try:
        logger.info(f"Processing download {job_id}: {url} (mode: {save_mode})")

        # Update job status
        await db.update_job_status(job_id, "downloading")

        # Create output directory
        output_dir = storage.get_dated_path()
        output_dir.mkdir(parents=True, exist_ok=True)

        # Generate base filename: YYYY-MM-DD-platform-slug
        platform = detect_platform(url)
        title = page_title or "Untitled"
        now = timestamp or datetime.now()
        basename = storage.generate_base_name(platform, title)

        final_path = None
        media_filename = None

        # Handle based on save_mode
        if save_mode == "text":
            # Text mode: screenshot + metadata only, no media download
            if screenshot:
                screenshot_path = output_dir / f"{basename}.context.png"
                decode_and_save_screenshot(screenshot, screenshot_path)

            # Save metadata JSON
            metadata = {
                "original_url": url,
                "download_date": now.isoformat(),
                "save_mode": save_mode,
                "title": title,
                "platform": platform
            }
            metadata_path = output_dir / f"{basename}.json"
            metadata_path.write_text(json.dumps(metadata, indent=2))

            final_path = screenshot_path if screenshot else metadata_path

            await db.update_job_complete(
                job_id=job_id,
                file_path=str(final_path),
                metadata=metadata
            )
            logger.info(f"Text-only save complete {job_id}: {final_path}")

        else:
            # Full or quick mode: download media
            # Convert cookies to dict format
            cookie_dict = {}
            for cookie in cookies:
                cookie_dict[cookie.name] = cookie.value

            # Check for Twitter with image URLs - use direct HTTP download
            tweet_content = options.get('tweetContent', {}) if options else {}
            image_urls = tweet_content.get('imageUrls', [])
            has_video = tweet_content.get('hasVideo', False) or tweet_content.get('hasGif', False)

            if platform == 'twitter' and image_urls and not has_video:
                # Twitter image-only tweet: download images directly via HTTP
                logger.info(f"Twitter image tweet detected: {len(image_urls)} images")
                downloaded_files = await download_twitter_images(
                    image_urls=image_urls,
                    output_dir=output_dir,
                    basename=basename,
                    cookies=cookie_dict
                )

                if downloaded_files:
                    final_path = downloaded_files[0]
                    media_filename = final_path.name

                    # Save screenshot for "full" mode
                    if save_mode == "full" and screenshot:
                        screenshot_path = output_dir / f"{basename}.context.png"
                        decode_and_save_screenshot(screenshot, screenshot_path)

                    # Create .md sidecar for full mode
                    if save_mode == "full":
                        create_twitter_sidecar_from_content(
                            output_dir=output_dir,
                            files=downloaded_files,
                            tweet_content=tweet_content,
                            url=url,
                            basename=basename
                        )

                    # Build metadata
                    metadata = {
                        "original_url": url,
                        "download_date": now.isoformat(),
                        "downloader": "direct-http",
                        "save_mode": save_mode,
                        "title": title,
                        "platform": platform,
                        "media_count": len(downloaded_files),
                        "files": [str(f) for f in downloaded_files]
                    }

                    await db.update_job_complete(
                        job_id=job_id,
                        file_path=str(final_path),
                        metadata=metadata
                    )
                    logger.info(f"Twitter image download complete {job_id}: {len(downloaded_files)} files")
                else:
                    raise ValueError("Failed to download Twitter images")

            else:
                # Use yt-dlp/gallery-dl for video tweets or other platforms
                handler = downloader.get_handler(url)
                if not handler:
                    raise ValueError(f"No handler available for URL: {url}")

                # Execute download
                result = await handler.download(
                    url=url,
                    cookies=cookie_dict,
                    output_dir=output_dir,
                    options=options
                )

                if result.file_path:
                    media_filename = Path(result.file_path).name

                    # Update title from metadata if available
                    if result.metadata.get('title'):
                        title = result.metadata['title']

                    # Save screenshot for "full" mode only
                    if save_mode == "full" and screenshot:
                        # Use same basename as media file
                        media_stem = Path(result.file_path).stem
                        screenshot_path = output_dir / f"{media_stem}.context.png"
                        decode_and_save_screenshot(screenshot, screenshot_path)

                    # Build metadata
                    metadata = {
                        "original_url": url,
                        "download_date": now.isoformat(),
                        "downloader": handler.name,
                        "save_mode": save_mode,
                        "title": title,
                        "platform": platform,
                        **result.metadata
                    }

                    # Save metadata for "full" mode
                    if save_mode == "full":
                        # For Twitter, use .md sidecar instead of JSON
                        if platform == 'twitter' and handler.name == 'gallery-dl':
                            emotion_tag = options.get('emotionTag') if options else None
                            tweet_content = options.get('tweetContent', {}) if options else {}
                            await create_twitter_sidecar(
                                output_dir=output_dir,
                                files=result.metadata.get('files', []),
                                tweet_content=tweet_content,
                                url=url,
                                emotion_tag=emotion_tag
                            )
                        else:
                            # Non-Twitter: save JSON metadata
                            await storage.save_metadata(result.file_path, metadata)

                    # File is already in the right place (yt-dlp writes to dated folder)
                    final_path = result.file_path

                    # Update job with success
                    await db.update_job_complete(
                        job_id=job_id,
                        file_path=str(final_path),
                        metadata=metadata
                    )

                    logger.info(f"Download complete {job_id}: {final_path}")
                else:
                    # No media downloaded - fallback to screenshot+metadata if available
                    logger.warning(f"No media file from {handler.name}, falling back to screenshot")

                    if screenshot:
                        screenshot_path = output_dir / f"{basename}.context.png"
                        decode_and_save_screenshot(screenshot, screenshot_path)
                        final_path = screenshot_path

                        # Save metadata
                        metadata = {
                            "original_url": url,
                            "download_date": now.isoformat(),
                            "save_mode": save_mode,
                            "title": title,
                            "platform": platform,
                            "fallback": True,
                            "reason": "no_media_found"
                        }
                        metadata_path = output_dir / f"{basename}.json"
                        metadata_path.write_text(json.dumps(metadata, indent=2))

                        await db.update_job_complete(
                            job_id=job_id,
                            file_path=str(final_path),
                            metadata=metadata
                        )
                        logger.info(f"Fallback save complete {job_id}: {final_path}")
                    else:
                        raise ValueError("Download failed and no screenshot available")

        # Append to index.md
        append_to_index(output_dir, {
            "date": now.strftime("%Y-%m-%d"),
            "time": now.strftime("%H:%M"),
            "platform": platform,
            "url": url,
            "title": title,
            "filename": media_filename or ""
        })

    except Exception as e:
        logger.error(f"Download failed {job_id}: {e}")
        await db.update_job_failed(job_id, str(e))


@app.post("/archive-image")
async def archive_image(request: ImageArchiveRequest):
    """
    Archive a single image with optional .md sidecar (Obsidian-native)

    - full mode: downloads image + creates .md sidecar with YAML frontmatter
    - quick mode: downloads image only

    For tiled/zoomable images (Google Arts & Culture, IIIF, etc.), uses dezoomify-rs.
    """
    import httpx

    try:
        logger.info(f"Archiving image: {request.image_url} (mode: {request.save_mode})")

        # Create output directory
        output_dir = storage.get_dated_path()

        # Generate filename from metadata
        platform = request.metadata.platform or "web"
        title = request.metadata.title or "untitled"
        author = request.metadata.author or ""

        # Include author in filename if available
        if author:
            basename = storage.generate_base_name(platform, f"{author}-{title}")
        else:
            basename = storage.generate_base_name(platform, title)

        # Check if a specialized handler should handle this URL
        handler = downloader.get_handler(request.image_url)
        options = request.options or {}

        # Use dezoomify-rs for tiled/zoomable images (Google Arts & Culture, etc.)
        if handler and handler.name == "dezoomify-rs":
            max_width = options.get('max_width')
            logger.info(f"Using dezoomify-rs for tiled image: {request.image_url} (max_width={max_width})")
            result = await handler.download(
                url=request.image_url,
                cookies={},
                output_dir=output_dir,
                options=options
            )

            if result.success and result.file_path:
                image_path = Path(result.file_path)
                # Rename to match our naming convention
                ext = image_path.suffix or '.jpg'
                new_path = output_dir / f"{basename}{ext}"
                if image_path != new_path:
                    image_path.rename(new_path)
                    image_path = new_path
                logger.info(f"dezoomify-rs saved: {image_path.name}")
            else:
                raise ValueError(f"dezoomify-rs failed: {result.error}")

        # Use gallery-dl for Flickr (to get original/full resolution)
        elif handler and handler.name == "gallery-dl" and 'flickr.com' in request.image_url:
            # Build cookies dict
            cookies_dict = {c.name: c.value for c in request.cookies}
            max_width = options.get('max_width')
            logger.info(f"Using gallery-dl for Flickr: {request.image_url} (max_width={max_width})")

            # Use page_url if available (better for gallery-dl to parse)
            download_url = request.page_url or request.image_url

            result = await handler.download(
                url=download_url,
                cookies=cookies_dict,
                output_dir=output_dir,
                options=options
            )

            if result.success and result.file_path:
                image_path = Path(result.file_path)
                # Rename to match our naming convention
                ext = image_path.suffix or '.jpg'
                new_path = output_dir / f"{basename}{ext}"
                if image_path != new_path and image_path.exists():
                    image_path.rename(new_path)
                    image_path = new_path
                logger.info(f"gallery-dl saved: {image_path.name}")
            else:
                raise ValueError(f"gallery-dl failed: {result.error}")
        else:
            # Direct HTTP download for regular images
            # Build cookies dict from request
            cookies_dict = {c.name: c.value for c in request.cookies}
            logger.info(f"Downloading with {len(cookies_dict)} cookies")

            async with httpx.AsyncClient(follow_redirects=True, timeout=30.0, cookies=cookies_dict) as client:
                response = await client.get(request.image_url, headers={
                    'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
                    'Referer': request.page_url or request.image_url
                })
                response.raise_for_status()

                # Determine extension from content-type or URL
                content_type = response.headers.get('content-type', '')
                if 'jpeg' in content_type or 'jpg' in content_type:
                    ext = '.jpg'
                elif 'png' in content_type:
                    ext = '.png'
                elif 'gif' in content_type:
                    ext = '.gif'
                elif 'webp' in content_type:
                    ext = '.webp'
                else:
                    # Try from URL
                    url_path = request.image_url.split('?')[0]
                    ext = Path(url_path).suffix or '.jpg'

                image_path = output_dir / f"{basename}{ext}"
                image_path.write_bytes(response.content)
                logger.info(f"Saved image: {image_path.name}")

        # Create .md sidecar for full mode
        if request.save_mode == "full":
            md_path = output_dir / f"{basename}.md"
            now = datetime.now()

            # Build YAML frontmatter
            frontmatter_lines = [
                "---",
                f"source: {request.image_url}",
                f"platform: {platform}",
            ]
            if author:
                frontmatter_lines.append(f"author: \"{author}\"")
            if title:
                frontmatter_lines.append(f"title: \"{title}\"")
            frontmatter_lines.append(f"archived: {now.isoformat()}")
            if request.metadata.page_url:
                frontmatter_lines.append(f"page_url: {request.metadata.page_url}")
            if request.metadata.description:
                # Escape quotes and newlines in description
                desc = request.metadata.description.replace('"', '\\"').replace('\n', ' ')
                frontmatter_lines.append(f"description: \"{desc}\"")
            if request.metadata.dateTaken:
                frontmatter_lines.append(f"date_taken: \"{request.metadata.dateTaken}\"")
            if request.metadata.tags:
                # Format tags as YAML array
                tags_str = ", ".join(f'"{tag}"' for tag in request.metadata.tags)
                frontmatter_lines.append(f"tags: [{tags_str}]")
            frontmatter_lines.append("---")
            frontmatter_lines.append("")
            frontmatter_lines.append(f"![[{image_path.name}]]")
            frontmatter_lines.append("")

            md_content = "\n".join(frontmatter_lines)
            md_path.write_text(md_content)
            logger.info(f"Saved sidecar: {md_path.name}")

        return {
            "success": True,
            "message": f"Archived: {image_path.name}",
            "file_path": str(image_path)
        }

    except Exception as e:
        logger.error(f"Image archive failed: {e}")
        return {
            "success": False,
            "message": str(e)
        }


@app.get("/jobs")
async def list_jobs(limit: int = 50, status: Optional[str] = None):
    """Get list of archive jobs"""
    jobs = await db.get_jobs(limit=limit, status=status)
    return {"jobs": jobs}

@app.get("/jobs/{job_id}")
async def get_job(job_id: str):
    """Get specific job details"""
    job = await db.get_job(job_id)
    if not job:
        raise HTTPException(status_code=404, detail="Job not found")
    return job

@app.get("/search")
async def search_archives(q: str, limit: int = 50):
    """Search archived media"""
    results = await db.search(query=q, limit=limit)
    return {"results": results}

@app.post("/check-archived", response_model=CheckArchivedResponse)
async def check_archived(request: CheckArchivedRequest):
    """
    Check if a URL has been archived in the last 3 months.
    Optionally verifies the file still exists on disk.
    """
    result = await db.check_url_archived(request.url)

    if not result:
        return CheckArchivedResponse(archived=False)

    return CheckArchivedResponse(
        archived=True,
        job_id=result.get('id'),
        file_path=result.get('file_path') if request.check_file_exists else None,
        file_exists=result.get('file_exists') if request.check_file_exists else None,
        archived_date=result.get('created_at'),
        age_days=result.get('age_days')
    )

@app.get("/stats")
async def get_stats():
    """Get archival statistics"""
    stats = await db.get_stats()
    return stats

@app.get("/dashboard", response_class=HTMLResponse)
async def dashboard():
    """Simple web dashboard"""
    return """
    <!DOCTYPE html>
    <html>
    <head>
        <title>Media Archiver Dashboard</title>
        <style>
            body {
                font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                max-width: 1200px;
                margin: 0 auto;
                padding: 20px;
                background: #f5f5f5;
            }
            h1 {
                color: #667eea;
            }
            .stats {
                display: grid;
                grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
                gap: 20px;
                margin: 20px 0;
            }
            .stat-card {
                background: white;
                padding: 20px;
                border-radius: 8px;
                box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            }
            .stat-value {
                font-size: 32px;
                font-weight: bold;
                color: #667eea;
            }
            .stat-label {
                color: #6b7280;
                margin-top: 5px;
            }
            .jobs {
                background: white;
                border-radius: 8px;
                padding: 20px;
                margin-top: 20px;
            }
            table {
                width: 100%;
                border-collapse: collapse;
            }
            th {
                text-align: left;
                padding: 10px;
                border-bottom: 2px solid #e5e7eb;
                color: #374151;
            }
            td {
                padding: 10px;
                border-bottom: 1px solid #f3f4f6;
            }
            .status {
                padding: 4px 8px;
                border-radius: 4px;
                font-size: 12px;
                font-weight: 500;
            }
            .status.completed { background: #d1fae5; color: #065f46; }
            .status.downloading { background: #fed7aa; color: #92400e; }
            .status.failed { background: #fee2e2; color: #991b1b; }
            .status.pending { background: #e0e7ff; color: #3730a3; }
        </style>
    </head>
    <body>
        <h1>Media Archiver Dashboard</h1>

        <div class="stats" id="stats">
            <div class="stat-card">
                <div class="stat-value">-</div>
                <div class="stat-label">Total Archives</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">-</div>
                <div class="stat-label">Today</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">-</div>
                <div class="stat-label">This Week</div>
            </div>
            <div class="stat-card">
                <div class="stat-value">-</div>
                <div class="stat-label">Storage Used</div>
            </div>
        </div>

        <div class="jobs">
            <h2>Recent Archives</h2>
            <table id="jobsTable">
                <thead>
                    <tr>
                        <th>Time</th>
                        <th>URL</th>
                        <th>Status</th>
                        <th>File</th>
                    </tr>
                </thead>
                <tbody id="jobsBody">
                    <tr><td colspan="4">Loading...</td></tr>
                </tbody>
            </table>
        </div>

        <script>
            async function loadDashboard() {
                // Load stats
                const statsRes = await fetch('/stats');
                const stats = await statsRes.json();

                const statCards = document.querySelectorAll('.stat-card');
                statCards[0].querySelector('.stat-value').textContent = stats.total_archives || '0';
                statCards[1].querySelector('.stat-value').textContent = stats.today_count || '0';
                statCards[2].querySelector('.stat-value').textContent = stats.week_count || '0';
                statCards[3].querySelector('.stat-value').textContent = formatBytes(stats.total_size || 0);

                // Load jobs
                const jobsRes = await fetch('/jobs?limit=20');
                const jobsData = await jobsRes.json();

                const tbody = document.getElementById('jobsBody');
                if (jobsData.jobs && jobsData.jobs.length > 0) {
                    tbody.innerHTML = jobsData.jobs.map(job => `
                        <tr>
                            <td>${new Date(job.created_at).toLocaleString()}</td>
                            <td>${new URL(job.url).hostname}</td>
                            <td><span class="status ${job.status}">${job.status}</span></td>
                            <td>${job.file_path ? '✓' : '-'}</td>
                        </tr>
                    `).join('');
                } else {
                    tbody.innerHTML = '<tr><td colspan="4">No archives yet</td></tr>';
                }
            }

            function formatBytes(bytes) {
                if (bytes === 0) return '0 B';
                const k = 1024;
                const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
                const i = Math.floor(Math.log(bytes) / Math.log(k));
                return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
            }

            // Load on page load
            loadDashboard();

            // Refresh every 5 seconds
            setInterval(loadDashboard, 5000);
        </script>
    </body>
    </html>
    """

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=8888)