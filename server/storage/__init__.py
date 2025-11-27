"""
Storage management for archived media

Structure: ~/MediaArchive/YYYY-MM/YYYY-MM-DD-HHMM-platform-slug.ext
"""

from pathlib import Path
from datetime import datetime
import json
import hashlib
import shutil
import re
from typing import Dict, Optional
from urllib.parse import urlparse
import logging

logger = logging.getLogger(__name__)

# Platform detection from URL
PLATFORM_DOMAINS = {
    'twitter.com': 'twitter',
    'x.com': 'twitter',
    'youtube.com': 'youtube',
    'youtu.be': 'youtube',
    'instagram.com': 'instagram',
    'tiktok.com': 'tiktok',
    'vimeo.com': 'vimeo',
    'twitch.tv': 'twitch',
    'reddit.com': 'reddit',
    'facebook.com': 'facebook',
    'dailymotion.com': 'dailymotion',
    'soundcloud.com': 'soundcloud',
    'bandcamp.com': 'bandcamp',
    'flickr.com': 'flickr',
    'pixiv.net': 'pixiv',
    'artstation.com': 'artstation',
    'deviantart.com': 'deviantart',
    'tumblr.com': 'tumblr',
    'pinterest.com': 'pinterest',
}


def detect_platform(url: str) -> str:
    """Extract platform name from URL"""
    try:
        parsed = urlparse(url)
        domain = parsed.netloc.lower().replace('www.', '')

        for domain_pattern, platform in PLATFORM_DOMAINS.items():
            if domain_pattern in domain or domain.endswith(domain_pattern):
                return platform

        # Fallback: use domain without TLD
        parts = domain.split('.')
        if len(parts) >= 2:
            return parts[-2]
        return 'unknown'
    except Exception:
        return 'unknown'


class StorageManager:
    """Manages file storage and organization"""

    def __init__(self, base_path: Path):
        self.base = Path(base_path)
        self.ensure_directories()

    def ensure_directories(self):
        """Create required directory structure"""
        # Simplified: just ensure base and temp exist
        directories = [
            self.base,
            self.base / "temp"
        ]

        for directory in directories:
            directory.mkdir(parents=True, exist_ok=True)

        logger.info(f"Storage initialized at {self.base}")

    def get_dated_path(self) -> Path:
        """Get path organized by YYYY-MM format"""
        now = datetime.now()
        path = self.base / f"{now.year:04d}-{now.month:02d}"
        path.mkdir(parents=True, exist_ok=True)
        return path

    def generate_filename(self, platform: str, title: str, extension: str) -> str:
        """
        Generate filename: YYYY-MM-DD-HHMM-platform-slug.ext

        Args:
            platform: Platform name (twitter, youtube, etc)
            title: Original title to slugify
            extension: File extension (with or without dot)

        Returns:
            Formatted filename string
        """
        now = datetime.now()
        date_prefix = now.strftime('%Y-%m-%d-%H%M')  # includes 24hr time

        # Sanitize platform
        platform = platform.lower().strip() or 'unknown'
        platform = re.sub(r'[^a-z0-9]', '', platform)

        # Create slug from title
        slug = self._create_slug(title)

        # Ensure extension has dot
        if extension and not extension.startswith('.'):
            extension = f'.{extension}'

        return f"{date_prefix}-{platform}-{slug}{extension}"

    def generate_base_name(self, platform: str, title: str) -> str:
        """
        Generate base filename without extension: YYYY-MM-DD-HHMM-platform-slug
        Useful for outtmpl where yt-dlp adds extension
        """
        now = datetime.now()
        date_prefix = now.strftime('%Y-%m-%d-%H%M')  # includes 24hr time

        platform = platform.lower().strip() or 'unknown'
        platform = re.sub(r'[^a-z0-9]', '', platform)

        slug = self._create_slug(title)

        return f"{date_prefix}-{platform}-{slug}"

    def _create_slug(self, title: str, max_length: int = 150) -> str:
        """
        Create URL-safe slug from title

        - Lowercase
        - Replace spaces/underscores with hyphens
        - Remove special characters
        - Max 150 chars (safe for most filesystems, leaves room for path)
        - No trailing hyphens
        """
        if not title:
            return 'untitled'

        # Lowercase and strip
        slug = title.lower().strip()

        # Replace spaces and underscores with hyphens
        slug = re.sub(r'[\s_]+', '-', slug)

        # Remove anything that isn't alphanumeric or hyphen
        slug = re.sub(r'[^a-z0-9\-]', '', slug)

        # Collapse multiple hyphens
        slug = re.sub(r'-+', '-', slug)

        # Trim to max length
        if len(slug) > max_length:
            slug = slug[:max_length]

        # Remove trailing hyphens
        slug = slug.rstrip('-')

        return slug or 'untitled'

    async def save_context_screenshot(self, base_path: Path, png_bytes: bytes) -> Optional[Path]:
        """
        Save context screenshot alongside media file

        Args:
            base_path: Path to the media file (e.g., /path/143052-twitter-post.mp4)
            png_bytes: PNG image data as bytes

        Returns:
            Path to saved screenshot or None on failure
        """
        if not png_bytes:
            logger.warning("No screenshot data provided")
            return None

        # Create screenshot path: same as media but with .context.png
        screenshot_path = base_path.with_suffix('.context.png')

        try:
            with open(screenshot_path, 'wb') as f:
                f.write(png_bytes)
            logger.info(f"Saved context screenshot: {screenshot_path.name}")
            return screenshot_path
        except Exception as e:
            logger.error(f"Failed to save context screenshot: {e}")
            return None

    async def save_metadata(self, file_path: Path, metadata: Dict) -> Optional[Path]:
        """
        Save metadata as .md sidecar with YAML frontmatter (Obsidian-native)

        Args:
            file_path: Path to the media file
            metadata: Dictionary of metadata to save

        Returns:
            Path to saved metadata file or None on failure
        """
        if not file_path:
            return None

        meta_file = file_path.with_suffix('.md')
        now = datetime.now()

        # Build YAML frontmatter
        lines = ["---"]

        # Core fields
        if metadata.get('original_url'):
            lines.append(f"source: {metadata['original_url']}")
        if metadata.get('platform'):
            lines.append(f"platform: {metadata['platform']}")
        if metadata.get('title'):
            title = str(metadata['title']).replace('"', '\\"')
            lines.append(f'title: "{title}"')
        if metadata.get('author'):
            author = str(metadata['author']).replace('"', '\\"')
            lines.append(f'author: "{author}"')

        lines.append(f"archived: {now.isoformat()}")

        # Optional fields
        if metadata.get('page_url'):
            lines.append(f"page_url: {metadata['page_url']}")
        if metadata.get('description'):
            desc = str(metadata['description']).replace('"', '\\"').replace('\n', ' ')
            lines.append(f'description: "{desc}"')
        if metadata.get('save_mode'):
            lines.append(f"save_mode: {metadata['save_mode']}")
        if metadata.get('handler'):
            lines.append(f"handler: {metadata['handler']}")

        # File info
        if file_path.exists():
            lines.append(f"file_size: {file_path.stat().st_size}")

        lines.append("---")
        lines.append("")

        # Embed the media file
        lines.append(f"![[{file_path.name}]]")
        lines.append("")

        try:
            meta_file.write_text("\n".join(lines))
            logger.info(f"Saved metadata: {meta_file.name}")
            return meta_file
        except Exception as e:
            logger.error(f"Failed to save metadata: {e}")
            return None

    def get_metadata(self, file_path: Path) -> Optional[Dict]:
        """Retrieve metadata for a file (checks .md sidecar, falls back to .json)"""
        # Primary: .md sidecar with YAML frontmatter
        md_file = file_path.with_suffix('.md')
        if md_file.exists():
            try:
                content = md_file.read_text()
                return self._parse_yaml_frontmatter(content)
            except Exception as e:
                logger.error(f"Failed to parse .md metadata: {e}")

        # Fallback: legacy .json sidecar
        json_file = file_path.with_suffix('.json')
        if json_file.exists():
            try:
                with open(json_file, 'r') as f:
                    return json.load(f)
            except Exception as e:
                logger.error(f"Failed to load .json metadata: {e}")

        return None

    def _parse_yaml_frontmatter(self, content: str) -> Dict:
        """Parse YAML frontmatter from markdown content"""
        metadata = {}
        if not content.startswith('---'):
            return metadata

        # Find end of frontmatter
        end_idx = content.find('\n---', 3)
        if end_idx == -1:
            return metadata

        frontmatter = content[4:end_idx]  # Skip initial '---\n'

        for line in frontmatter.split('\n'):
            line = line.strip()
            if not line or ':' not in line:
                continue

            key, _, value = line.partition(':')
            key = key.strip()
            value = value.strip()

            # Remove quotes if present
            if value.startswith('"') and value.endswith('"'):
                value = value[1:-1].replace('\\"', '"')

            # Parse arrays like tags: ["a", "b"]
            if value.startswith('[') and value.endswith(']'):
                import ast
                try:
                    value = ast.literal_eval(value)
                except:
                    pass

            metadata[key] = value

        return metadata

    def get_storage_stats(self) -> Dict:
        """Get storage statistics across all YYYY-MM folders"""
        total_size = 0
        file_count = 0
        month_stats = {}

        # Scan all YYYY-MM directories
        for item in self.base.iterdir():
            if item.is_dir() and re.match(r'^\d{4}-\d{2}$', item.name):
                files = [f for f in item.iterdir() if f.is_file()]
                # Exclude metadata/sidecar files from count
                media_files = [f for f in files if f.suffix not in ('.json', '.md')]

                size = sum(f.stat().st_size for f in files)
                count = len(media_files)

                month_stats[item.name] = {
                    'count': count,
                    'size': size
                }

                total_size += size
                file_count += count

        return {
            'total_size': total_size,
            'file_count': file_count,
            'months': month_stats,
            'storage_path': str(self.base)
        }

    def cleanup_temp(self):
        """Clean temporary files"""
        temp_dir = self.base / "temp"
        if temp_dir.exists():
            for file in temp_dir.glob('*'):
                if file.is_file():
                    # Only delete files older than 1 day
                    age = datetime.now().timestamp() - file.stat().st_mtime
                    if age > 86400:  # 24 hours
                        file.unlink()
                        logger.info(f"Cleaned up temp file: {file.name}")

    def _get_file_hash(self, file_path: Path) -> str:
        """Calculate SHA256 hash of file"""
        if not file_path.exists():
            return hashlib.sha256(str(file_path).encode()).hexdigest()

        sha256_hash = hashlib.sha256()
        with open(file_path, "rb") as f:
            for byte_block in iter(lambda: f.read(4096), b""):
                sha256_hash.update(byte_block)
        return sha256_hash.hexdigest()


__all__ = ['StorageManager', 'detect_platform']