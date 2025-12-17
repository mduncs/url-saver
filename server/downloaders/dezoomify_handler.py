"""
dezoomify-rs handler for tiled/zoomable images (IIIF, Zoomify, Google Arts & Culture, etc.)
"""

import subprocess
import asyncio
import shutil
from pathlib import Path
from typing import Dict, Optional
import logging
from .base import BaseDownloader, DownloadResult

logger = logging.getLogger(__name__)

class DezoomifyHandler(BaseDownloader):
    """Handler for dezoomify-rs supported sites (tiled/zoomable images)"""

    name = "dezoomify-rs"

    # Sites that use tiled/zoomable images
    SUPPORTED_DOMAINS = [
        'artsandculture.google.com',  # Google Arts & Culture
        'iiif.io',                     # IIIF protocol
        'wellcomecollection.org',      # Wellcome Collection
        'davidrumsey.com',             # David Rumsey Map Collection
        'gallica.bnf.fr',              # Bibliothèque nationale de France
        'digitalcollections.nypl.org', # NYPL Digital Collections
        'loc.gov',                     # Library of Congress
        'europeana.eu',                # Europeana
        'digi.ub.uni-heidelberg.de',  # Heidelberg University Library
        'e-codices.unifr.ch',          # Virtual Manuscript Library of Switzerland
    ]

    # Patterns that indicate IIIF or zoomable images
    ZOOMABLE_PATTERNS = [
        '/iiif/',
        '/info.json',
        '/ImageProperties.xml',  # Zoomify
        '/deepzoom',             # Deep Zoom Image
        '/zoomify',
        '/dzc/',
        '/dzi/',
    ]

    def __init__(self):
        """Initialize and check for dezoomify-rs"""
        self.dezoomify_path = shutil.which('dezoomify-rs')
        if not self.dezoomify_path:
            logger.warning("dezoomify-rs not found in PATH. Install with: cargo install dezoomify-rs")
        else:
            logger.info(f"Found dezoomify-rs at {self.dezoomify_path}")

    def can_handle(self, url: str) -> bool:
        """Check if dezoomify-rs should handle this URL"""
        if not self.dezoomify_path:
            return False

        url_lower = url.lower()

        # Check for supported domains
        for domain in self.SUPPORTED_DOMAINS:
            if domain in url_lower:
                return True

        # Check for zoomable image patterns
        for pattern in self.ZOOMABLE_PATTERNS:
            if pattern in url_lower:
                return True

        return False

    async def download(
        self,
        url: str,
        cookies: Dict[str, str],
        output_dir: Path,
        options: Optional[Dict] = None
    ) -> DownloadResult:
        """Download tiled/zoomable image using dezoomify-rs"""

        if not self.dezoomify_path:
            return DownloadResult(
                file_path=None,
                metadata={},
                success=False,
                error="dezoomify-rs not installed. Install with: cargo install dezoomify-rs"
            )

        try:
            # Generate output filename based on URL
            output_filename = self._generate_filename(url)
            output_path = output_dir / output_filename

            # Prepare command
            cmd = [
                self.dezoomify_path,
                url,
                str(output_path),
            ]

            # Add default options first
            options = options or {}

            # Resolution control:
            # - Default: ~4K (4000px) - quick reference quality
            # - Shift+click: ~8K (8000px) - detailed study
            # - Alt+click: full resolution (--largest) - archival quality
            # Min check (2000px) catches failed/placeholder downloads
            max_width = options.get('max_width', 4000)
            if max_width == 0 or max_width is None:
                cmd.append('--largest')  # Full resolution
            else:
                cmd.extend(['--max-width', str(max_width)])

            # Parallelism for faster downloads
            parallelism = options.get('parallelism', 4)
            cmd.extend(['--parallelism', str(parallelism)])

            # Max retries
            retries = options.get('retries', 3)
            cmd.extend(['--retries', str(retries)])

            # Tile cache for resumable downloads
            if options.get('tile_cache'):
                cache_dir = output_dir / '.dezoomify-cache'
                cache_dir.mkdir(exist_ok=True)
                cmd.extend(['--tile-cache', str(cache_dir)])

            # Custom headers (for authentication if needed)
            if options.get('headers'):
                for key, value in options['headers'].items():
                    cmd.extend(['--header', f"{key}: {value}"])

            # Add cookies if provided
            if cookies:
                # dezoomify-rs accepts cookies in "name=value; name2=value2" format
                cookie_str = '; '.join([f"{k}={v}" for k, v in cookies.items()])
                cmd.extend(['--header', f"Cookie: {cookie_str}"])

            # Add user agent
            cmd.extend(['--header', 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36'])

            logger.info(f"Running dezoomify-rs for {url}")
            logger.debug(f"Command: {' '.join(cmd)}")

            # Run dezoomify-rs
            process = await asyncio.create_subprocess_exec(
                *cmd,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
                cwd=str(output_dir)
            )

            stdout, stderr = await process.communicate()

            # Log output
            if stdout:
                logger.info(f"dezoomify-rs stdout: {stdout.decode('utf-8', errors='ignore')}")
            if stderr:
                logger.debug(f"dezoomify-rs stderr: {stderr.decode('utf-8', errors='ignore')}")

            # Check if download was successful
            if process.returncode == 0 and output_path.exists():
                file_size = output_path.stat().st_size

                # Extract metadata from output
                metadata = self._parse_metadata(stdout.decode('utf-8', errors='ignore'))
                metadata['file_size'] = file_size
                metadata['url'] = url
                metadata['extractor'] = 'dezoomify-rs'
                metadata['format'] = self._detect_format(url)

                # Get image dimensions and check minimum resolution
                try:
                    from PIL import Image
                    with Image.open(output_path) as img:
                        metadata['width'] = img.width
                        metadata['height'] = img.height
                        metadata['resolution'] = f"{img.width}x{img.height}"

                        # Check minimum pixel dimensions (default 2000px on shortest side)
                        # Mark small images but don't delete - let user review later
                        min_pixels = options.get('min_pixels', 2000)
                        shortest_side = min(img.width, img.height)

                        if shortest_side < min_pixels:
                            logger.warning(f"Downloaded image small: {img.width}x{img.height} (min: {min_pixels}px)")
                            metadata['is_small'] = True
                except ImportError:
                    logger.debug("PIL not available, skipping dimension check")
                except Exception as e:
                    logger.debug(f"Could not read image dimensions: {e}")

                logger.info(f"Successfully downloaded: {output_path}")

                return DownloadResult(
                    file_path=output_path,
                    metadata=metadata,
                    success=True
                )
            else:
                error_msg = stderr.decode('utf-8', errors='ignore') if stderr else "Unknown error"
                logger.error(f"dezoomify-rs failed: {error_msg}")

                return DownloadResult(
                    file_path=None,
                    metadata={'url': url},
                    success=False,
                    error=error_msg
                )

        except Exception as e:
            logger.error(f"dezoomify-rs error: {e}")
            return DownloadResult(
                file_path=None,
                metadata={'url': url},
                success=False,
                error=str(e)
            )

    def _generate_filename(self, url: str) -> str:
        """Generate appropriate filename from URL"""
        from urllib.parse import urlparse, unquote

        parsed = urlparse(url)

        # Try to extract meaningful filename from URL
        path_parts = [p for p in parsed.path.split('/') if p]

        if 'artsandculture.google.com' in parsed.netloc:
            # Google Arts & Culture: extract asset ID
            if '/asset/' in url:
                # Format: /asset/title/assetId
                asset_parts = [p for p in path_parts if p != 'asset']
                if asset_parts:
                    filename = asset_parts[-1]  # Use asset ID
                else:
                    filename = 'google-arts-culture'
            else:
                filename = 'google-arts-culture'
        elif 'info.json' in url:
            # IIIF: use parent directory name
            if len(path_parts) > 1:
                filename = path_parts[-2]
            else:
                filename = 'iiif-image'
        elif 'ImageProperties.xml' in url:
            # Zoomify: use parent directory name
            if len(path_parts) > 1:
                filename = path_parts[-2]
            else:
                filename = 'zoomify-image'
        else:
            # Generic: use last path component
            if path_parts:
                filename = path_parts[-1].split('.')[0]
            else:
                filename = parsed.netloc.replace('.', '-')

        # Clean filename
        filename = unquote(filename)
        filename = ''.join(c if c.isalnum() or c in '-_' else '-' for c in filename)
        filename = filename[:100]  # Limit length

        # Add extension (dezoomify-rs will auto-detect, but we default to jpg)
        if not any(filename.endswith(ext) for ext in ['.jpg', '.png', '.tif', '.tiff']):
            filename += '.jpg'

        return filename

    def _detect_format(self, url: str) -> str:
        """Detect the zoomable image format from URL"""
        url_lower = url.lower()

        if 'artsandculture.google.com' in url_lower:
            return 'google-arts-culture'
        elif '/iiif/' in url_lower or 'info.json' in url_lower:
            return 'iiif'
        elif 'imageproperties.xml' in url_lower or '/zoomify' in url_lower:
            return 'zoomify'
        elif '/deepzoom' in url_lower or '.dzi' in url_lower or '/dzc/' in url_lower:
            return 'deepzoom'
        else:
            return 'unknown'

    def _parse_metadata(self, output: str) -> Dict:
        """Parse metadata from dezoomify-rs output"""
        metadata = {}

        # Look for image dimensions in output
        # dezoomify-rs typically outputs: "Image size: WIDTHxHEIGHT"
        for line in output.split('\n'):
            if 'image size' in line.lower():
                parts = line.split(':')
                if len(parts) > 1:
                    size_str = parts[1].strip()
                    if 'x' in size_str:
                        try:
                            width, height = size_str.split('x')
                            metadata['width'] = int(width.strip())
                            metadata['height'] = int(height.strip())
                            metadata['resolution'] = size_str.strip()
                        except:
                            pass

            # Look for tile count
            if 'tile' in line.lower() and any(word in line.lower() for word in ['total', 'tiles', 'count']):
                try:
                    # Extract number from line
                    import re
                    numbers = re.findall(r'\d+', line)
                    if numbers:
                        metadata['tile_count'] = int(numbers[0])
                except:
                    pass

        return metadata
