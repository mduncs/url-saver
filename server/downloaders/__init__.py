"""
Downloader module for handling various media types
"""

from .base import DownloadResult
from .ytdlp_handler import YtDlpHandler
from .gallery_handler import GalleryDlHandler
from .dezoomify_handler import DezoomifyHandler
from typing import Optional
import logging

logger = logging.getLogger(__name__)

class DownloadManager:
    """Manages different download handlers"""

    def __init__(self):
        self.handlers = [
            DezoomifyHandler(),  # Check dezoomify first for tiled images
            GalleryDlHandler(),  # Then gallery-dl for image galleries
            YtDlpHandler()       # Finally yt-dlp as fallback
        ]

    def get_handler(self, url: str):
        """Get appropriate handler for URL"""
        for handler in self.handlers:
            if handler.can_handle(url):
                logger.info(f"Using {handler.name} for {url}")
                return handler

        # Default to yt-dlp as it supports the most sites
        logger.info(f"Using default yt-dlp handler for {url}")
        return self.handlers[-1]  # Use last handler (yt-dlp) as default

    def list_handlers(self):
        """List available handlers"""
        return [h.name for h in self.handlers]

__all__ = ['DownloadManager', 'DownloadResult']