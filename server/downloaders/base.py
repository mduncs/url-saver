"""
Base classes for media downloaders
"""

from abc import ABC, abstractmethod
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, Optional, Any

@dataclass
class DownloadResult:
    """Result of a download operation"""
    file_path: Optional[Path]
    metadata: Dict[str, Any]
    success: bool = True
    error: Optional[str] = None

class BaseDownloader(ABC):
    """Abstract base class for all downloaders"""

    name: str = "base"

    @abstractmethod
    def can_handle(self, url: str) -> bool:
        """Check if this downloader can handle the given URL"""
        pass

    @abstractmethod
    async def download(
        self,
        url: str,
        cookies: Dict[str, str],
        output_dir: Path,
        options: Optional[Dict] = None
    ) -> DownloadResult:
        """
        Download media from URL

        Args:
            url: URL to download from
            cookies: Dictionary of cookies
            output_dir: Directory to save files to
            options: Additional options for the downloader

        Returns:
            DownloadResult with file path and metadata
        """
        pass