"""
yt-dlp handler for video/audio downloads

User's preferred settings (from ~/.zshrc):
- format: bestvideo+bestaudio/best
- merge_output_format: mp4
- concurrent_fragments: 4
- add_metadata, embed_thumbnail, embed_subs
"""

import yt_dlp
import asyncio
from pathlib import Path
from typing import Dict, Optional
import logging
from .base import BaseDownloader, DownloadResult
from storage import detect_platform

logger = logging.getLogger(__name__)


class YtDlpHandler(BaseDownloader):
    """Handler for yt-dlp supported sites"""

    name = "yt-dlp"

    # Domains that yt-dlp handles well
    SUPPORTED_DOMAINS = [
        'youtube.com', 'youtu.be',
        'twitter.com', 'x.com',
        'instagram.com',
        'tiktok.com',
        'vimeo.com',
        'twitch.tv',
        'reddit.com',
        'facebook.com',
        'dailymotion.com',
        'soundcloud.com',
        'bandcamp.com'
    ]

    # Domains to exclude (handled by gallery-dl instead)
    EXCLUDED_DOMAINS = [
        'flickr.com',
        'pixiv.net',
        'artstation.com',
        'deviantart.com',
        'tumblr.com',
        'pinterest.com',
        'danbooru.donmai.us',
        'gelbooru.com'
    ]

    def can_handle(self, url: str) -> bool:
        """Check if yt-dlp can handle this URL"""
        url_lower = url.lower()

        # Check exclusions first
        if any(exclude in url_lower for exclude in self.EXCLUDED_DOMAINS):
            return False

        # Check known domains
        for domain in self.SUPPORTED_DOMAINS:
            if domain in url_lower:
                return True

        # For unknown domains, let yt-dlp try (it supports 1000+ sites)
        return True

    async def download(
        self,
        url: str,
        cookies: Dict[str, str],
        output_dir: Path,
        options: Optional[Dict] = None
    ) -> DownloadResult:
        """Download media using yt-dlp"""
        loop = asyncio.get_event_loop()

        # Detect platform for filename
        platform = detect_platform(url)

        # Prepare cookie file if cookies provided
        cookie_file = None
        if cookies:
            cookie_file = output_dir / '.cookies.txt'
            self._write_netscape_cookies(cookie_file, cookies, url)

        # Configure yt-dlp options (user's preferred settings from ~/.zshrc)
        ydl_opts = {
            # Output template: HHMMSS-platform-title.ext
            # yt-dlp will fill in title and ext; we use restrictfilenames for safety
            # Title capped at 150 chars for filesystem safety
            'outtmpl': str(output_dir / f'%(upload_date>%H%M%S|{self._get_time_prefix()})s-{platform}-%(title).150s.%(ext)s'),
            'restrictfilenames': True,  # Sanitize filenames (replaces spaces with _)
            'windowsfilenames': True,   # Cross-platform safe filenames

            # Format selection (user's preferred: bestvideo+bestaudio/best)
            'format': 'bestvideo+bestaudio/best',
            'merge_output_format': 'mp4',

            # Concurrent downloads (user prefers 4, not 5)
            'concurrent_fragment_downloads': 4,

            # Thumbnail handling
            'writethumbnail': True,

            # Subtitles (user wants embedded)
            'writesubtitles': True,
            'writeautomaticsub': True,
            'subtitleslangs': ['en', 'en-US'],
            'embedsubtitles': True,

            # Post-processing (metadata only - thumbnail embed often fails)
            'postprocessors': [
                {
                    'key': 'FFmpegMetadata',
                    'add_metadata': True,
                },
            ],

            # We don't write separate info.json - metadata saved via storage layer
            'writeinfojson': False,
            'writedescription': False,

            # Download options
            'quiet': False,
            'no_warnings': False,
            'extract_flat': False,
            'no_color': True,
            'progress_hooks': [self._progress_hook],

            # Reliability - tolerate post-processing failures
            'retries': 10,
            'fragment_retries': 10,
            'skip_unavailable_fragments': False,
            'ignoreerrors': 'only_download',
            'ignore_no_formats_error': True,

            # Enable remote components for JS challenges (YouTube)
            'enable_remote_components': 'ejs:github'
        }

        # Add cookie file if available
        if cookie_file and cookie_file.exists():
            ydl_opts['cookiefile'] = str(cookie_file)
            logger.info(f"Using cookies for {url}")

        # Platform-specific options
        if platform == 'twitter':
            # Twitter often needs simpler format selection
            ydl_opts['format'] = 'best[ext=mp4]/best'
            # Include username (@handle) in filename for twitter
            ydl_opts['outtmpl'] = str(output_dir / f'%(upload_date>%H%M%S|{self._get_time_prefix()})s-{platform}-%(uploader_id)s-%(title).150s.%(ext)s')

        try:
            # Run download in thread pool to avoid blocking
            result = await loop.run_in_executor(
                None,
                self._download_sync,
                url, ydl_opts
            )

            # Cleanup cookie file
            if cookie_file and cookie_file.exists():
                cookie_file.unlink()

            return result

        except Exception as e:
            logger.error(f"yt-dlp download failed: {e}")
            # Cleanup on error
            if cookie_file and cookie_file.exists():
                cookie_file.unlink()

            return DownloadResult(
                file_path=None,
                metadata={},
                success=False,
                error=str(e)
            )

    def _download_sync(self, url: str, opts: Dict) -> DownloadResult:
        """Synchronous download function"""
        with yt_dlp.YoutubeDL(opts) as ydl:
            try:
                # Extract info and download
                info = ydl.extract_info(url, download=True)

                # Find the downloaded file
                filename = ydl.prepare_filename(info)
                actual_path = Path(filename)

                # Check for different extensions (yt-dlp might change extension)
                if not actual_path.exists():
                    for ext in ['.mp4', '.webm', '.mkv', '.mp3', '.m4a', '.opus', '.wav']:
                        test_path = actual_path.with_suffix(ext)
                        if test_path.exists():
                            actual_path = test_path
                            break

                # Extract useful metadata
                metadata = {
                    'title': info.get('title', 'Unknown'),
                    'uploader': info.get('uploader'),
                    'uploader_id': info.get('uploader_id'),
                    'duration': info.get('duration'),
                    'view_count': info.get('view_count'),
                    'like_count': info.get('like_count'),
                    'description': info.get('description'),
                    'upload_date': info.get('upload_date'),
                    'webpage_url': info.get('webpage_url'),
                    'extractor': info.get('extractor'),
                    'format': info.get('format'),
                    'width': info.get('width'),
                    'height': info.get('height'),
                    'fps': info.get('fps'),
                    'vcodec': info.get('vcodec'),
                    'acodec': info.get('acodec'),
                    'filesize': info.get('filesize'),
                    'categories': info.get('categories'),
                    'tags': info.get('tags')
                }

                # Clean None values
                metadata = {k: v for k, v in metadata.items() if v is not None}

                return DownloadResult(
                    file_path=actual_path if actual_path.exists() else None,
                    metadata=metadata,
                    success=actual_path.exists()
                )

            except Exception as e:
                logger.warning(f"yt-dlp error (may be partial): {e}")
                # Check if files were downloaded despite the error (e.g., post-processing failed)
                output_dir = Path(opts['outtmpl']).parent
                downloaded_files = list(output_dir.glob('*'))
                media_files = [f for f in downloaded_files if f.suffix in ['.mp4', '.webm', '.mkv', '.mp3', '.m4a', '.opus', '.wav'] and f.stat().st_size > 0]

                if media_files:
                    # Sort by modification time, newest first
                    media_files.sort(key=lambda f: f.stat().st_mtime, reverse=True)
                    actual_path = media_files[0]
                    logger.info(f"Recovered file despite error: {actual_path}")
                    return DownloadResult(
                        file_path=actual_path,
                        metadata={'title': actual_path.stem, 'error_note': str(e)},
                        success=True
                    )
                raise

    def _get_time_prefix(self) -> str:
        """Get current date as YYYY-MM-DD for filename"""
        from datetime import datetime
        return datetime.now().strftime('%Y-%m-%d')

    def _write_netscape_cookies(self, path: Path, cookies: Dict[str, str], url: str):
        """Write cookies in Netscape format for yt-dlp"""
        from urllib.parse import urlparse

        parsed = urlparse(url)
        domain = parsed.netloc

        with open(path, 'w') as f:
            f.write("# Netscape HTTP Cookie File\n")
            f.write("# This file was generated by Media Archiver\n\n")

            for name, value in cookies.items():
                # Format: domain flag path secure expiry name value
                # Use sensible defaults for missing info
                domain_str = f".{domain}" if not domain.startswith('.') else domain
                f.write(f"{domain_str}\tTRUE\t/\tFALSE\t0\t{name}\t{value}\n")

        logger.info(f"Wrote {len(cookies)} cookies to {path}")

    def _progress_hook(self, d):
        """Progress hook for yt-dlp"""
        if d['status'] == 'downloading':
            percent = d.get('_percent_str', 'N/A')
            speed = d.get('_speed_str', 'N/A')
            logger.debug(f"Downloading: {percent} at {speed}")
        elif d['status'] == 'finished':
            logger.info(f"Download finished: {d.get('filename', 'unknown')}")