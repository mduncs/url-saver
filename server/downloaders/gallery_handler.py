"""
gallery-dl handler for image galleries and art sites
"""

import subprocess
import asyncio
import json
from pathlib import Path
from typing import Dict, Optional
import logging
from .base import BaseDownloader, DownloadResult

logger = logging.getLogger(__name__)

class GalleryDlHandler(BaseDownloader):
    """Handler for gallery-dl supported sites"""

    name = "gallery-dl"

    # Sites that gallery-dl handles well
    SUPPORTED_DOMAINS = [
        'flickr.com',
        'pixiv.net',
        'artstation.com',
        'deviantart.com',
        'tumblr.com',
        'pinterest.com',
        'danbooru.donmai.us',
        'gelbooru.com',
        'instagram.com',  # Also supports Instagram
        'twitter.com',    # Can handle Twitter images better than yt-dlp for galleries
        'x.com',
        'reddit.com',     # Good for image galleries
        'imgur.com',
        'behance.net',
        'unsplash.com',
        'pexels.com',
        '500px.com',
        'weibo.com',
        'mangadex.org',
        'nhentai.net',
        'rule34.xxx',
        'safebooru.org'
    ]

    def can_handle(self, url: str) -> bool:
        """Check if gallery-dl should handle this URL"""
        url_lower = url.lower()

        # Check if it's an image gallery site
        for domain in self.SUPPORTED_DOMAINS:
            if domain in url_lower:
                return True

        # Check for specific patterns that indicate galleries
        gallery_patterns = [
            '/gallery/',
            '/album/',
            '/collection/',
            '/portfolio/',
            '/user/',
            '/artist/'
        ]

        return any(pattern in url_lower for pattern in gallery_patterns)

    async def download(
        self,
        url: str,
        cookies: Dict[str, str],
        output_dir: Path,
        options: Optional[Dict] = None
    ) -> DownloadResult:
        """Download media using gallery-dl"""

        # Track existing files BEFORE download to identify new ones
        existing_files = set(self._find_all_media_files(output_dir))
        logger.info(f"Found {len(existing_files)} existing files before download")

        # Generate timestamp for filename
        from datetime import datetime
        timestamp = datetime.now().strftime("%Y-%m-%d")

        # Prepare configuration
        # Filename: YYYY-MM-DD-twitter-username-tweetid-N.ext
        # - tweet_id: unique identifier (clean, no special chars)
        # - num: image number within tweet (1, 2, 3 for multi-image posts)
        # Content has colons/slashes that break paths, tweet_id is safer
        config = {
            "extractor": {
                "base-directory": str(output_dir),
                "parent-directory": False,
                "directory": [],  # Flat output, no subdirectories
                "filename": f"{timestamp}-twitter-{{user[name]}}-{{tweet_id}}-{{num}}.{{extension}}",
                "skip": True,  # Skip already downloaded files
                "sleep": 1,    # Be polite to servers
                "user-agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
                "retries": 3,
                "timeout": 30.0,
                "verify": True,
                "fallback": True
            },
            "output": {
                "mode": "terminal",
                "progress": True,
                "log": {
                    "level": "info"
                }
            }
        }

        # Add site-specific configurations
        if 'twitter.com' in url or 'x.com' in url:
            config["extractor"]["twitter"] = {
                "cards": True,
                "conversations": True,
                "replies": "self",
                "retweets": False,
                "videos": True
            }

        if 'flickr.com' in url:
            # Use max_width from options, default to 8000 (8K cap), None = original
            max_width = options.get('max_width') if options else 8000
            flickr_config = {
                "videos": True
            }
            if max_width is not None:
                # gallery-dl size-max limits the maximum dimension
                flickr_config["size-max"] = max_width
                logger.info(f"Flickr: size-max set to {max_width}")
            else:
                # No limit - get true original
                # Use a very high value to effectively get original
                flickr_config["size-max"] = 99999
                logger.info("Flickr: downloading at full original resolution (no cap)")
            config["extractor"]["flickr"] = flickr_config
            # Flickr-specific filename: YYYY-MM-DD-flickr-username-photoid.ext
            config["extractor"]["filename"] = f"{timestamp}-flickr-{{user[username]}}-{{id}}.{{extension}}"

        if 'instagram.com' in url:
            config["extractor"]["instagram"] = {
                "posts": True,
                "stories": True,
                "highlights": True,
                "tagged": False,
                "reels": True,
                "videos": True
            }

        if 'pixiv.net' in url:
            config["extractor"]["pixiv"] = {
                "ugoira": True,  # Download animations
                "metadata": True
            }

        # Write cookies to Netscape-format file (gallery-dl has cache bugs with dict cookies)
        cookies_file = output_dir / '.cookies.txt'
        if cookies:
            self._write_cookies_file(cookies, cookies_file, url)
            config["extractor"]["cookies"] = str(cookies_file)

        # Write config to temp file
        config_file = output_dir / '.gallery-dl.conf'
        with open(config_file, 'w') as f:
            json.dump(config, f, indent=2)

        try:
            # Prepare command - use sys.executable to run gallery_dl module
            # This ensures we use the same Python environment as the server
            import sys
            cmd = [
                sys.executable, '-m', 'gallery_dl',
                '--config', str(config_file),
                '--no-part',  # Don't use .part files
                url
            ]

            # Run gallery-dl
            logger.info(f"Running gallery-dl for {url}")
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(output_dir)
            )

            stdout, stderr = await process.communicate()

            # Log output
            if stdout:
                logger.debug(f"gallery-dl stdout: {stdout.decode('utf-8')}")
            if stderr and process.returncode != 0:
                logger.error(f"gallery-dl stderr: {stderr.decode('utf-8')}")

            # Find NEW downloaded files (exclude pre-existing ones)
            all_files = set(self._find_all_media_files(output_dir))
            new_files = list(all_files - existing_files)
            new_files.sort(key=lambda x: x.stat().st_mtime, reverse=True)
            logger.info(f"Found {len(new_files)} NEW files after download")

            if new_files:
                return DownloadResult(
                    file_path=new_files[0],  # Return first new file as primary
                    metadata={
                        'file_count': len(new_files),
                        'files': [str(f.relative_to(output_dir)) for f in new_files],
                        'extractor': 'gallery-dl'
                    },
                    success=True
                )
            else:
                return DownloadResult(
                    file_path=None,
                    metadata={},
                    success=False,
                    error="No files downloaded"
                )

        except Exception as e:
            logger.error(f"gallery-dl error: {e}")
            return DownloadResult(
                file_path=None,
                metadata={},
                success=False,
                error=str(e)
            )
        finally:
            # Cleanup temp files
            if config_file.exists():
                config_file.unlink()
            if cookies_file.exists():
                cookies_file.unlink()

    def _write_cookies_file(self, cookies: Dict, filepath: Path, url: str = "") -> None:
        """Write cookies to Netscape-format cookies.txt file"""
        with open(filepath, 'w') as f:
            f.write("# Netscape HTTP Cookie File\n")

            # Determine domains based on URL
            domains = []
            url_lower = url.lower()
            if 'flickr.com' in url_lower:
                domains = ['.flickr.com', '.staticflickr.com']
            elif 'twitter.com' in url_lower or 'x.com' in url_lower:
                domains = ['.x.com', '.twitter.com']
            elif 'instagram.com' in url_lower:
                domains = ['.instagram.com']
            elif 'pinterest' in url_lower:
                domains = ['.pinterest.com']
            else:
                # Fallback: write for common domains
                domains = ['.flickr.com', '.x.com', '.twitter.com']

            for name, value in cookies.items():
                # Format: domain, tailmatch, path, secure, expiry, name, value
                for domain in domains:
                    f.write(f"{domain}\tTRUE\t/\tTRUE\t0\t{name}\t{value}\n")

    def _get_domain_from_url(self, url: str) -> str:
        """Extract domain from URL"""
        from urllib.parse import urlparse
        parsed = urlparse(url)
        return parsed.netloc

    def _find_all_media_files(self, output_dir: Path) -> list:
        """Find all media files in output_dir and subdirectories"""
        media_extensions = [
            '.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
            '.mp4', '.webm', '.mkv', '.avi', '.mov',
            '.mp3', '.m4a', '.flac', '.wav', '.ogg'
        ]

        media_files = []
        for ext in media_extensions:
            media_files.extend(output_dir.glob(f'*{ext}'))
            media_files.extend(output_dir.glob(f'**/*{ext}'))  # Check subdirectories

        return media_files

