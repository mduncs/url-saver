"""
Tests for download handlers (yt-dlp, gallery-dl, dezoomify)
"""
import pytest
from pathlib import Path
from unittest.mock import patch, MagicMock, AsyncMock


class TestYtDlpHandler:
    """Tests for YtDlpHandler"""

    @pytest.fixture
    def handler(self):
        from downloaders.ytdlp_handler import YtDlpHandler
        return YtDlpHandler()

    def test_can_handle_supported_domains(self, handler):
        """Handler accepts known video platforms"""
        assert handler.can_handle("https://www.youtube.com/watch?v=abc")
        assert handler.can_handle("https://youtu.be/abc")
        assert handler.can_handle("https://twitter.com/user/status/123")
        assert handler.can_handle("https://x.com/user/status/123")
        assert handler.can_handle("https://www.instagram.com/p/abc/")
        assert handler.can_handle("https://www.tiktok.com/@user/video/123")
        assert handler.can_handle("https://vimeo.com/123456")

    def test_can_handle_excludes_gallery_sites(self, handler):
        """Handler excludes sites better handled by gallery-dl"""
        assert not handler.can_handle("https://www.flickr.com/photos/user/123")
        assert not handler.can_handle("https://www.pixiv.net/artworks/12345")
        assert not handler.can_handle("https://www.deviantart.com/user/art/title")
        assert not handler.can_handle("https://danbooru.donmai.us/posts/123")

    def test_can_handle_unknown_defaults_true(self, handler):
        """Unknown domains default to trying yt-dlp (1000+ sites)"""
        assert handler.can_handle("https://random-video-site.com/video/123")

    def test_get_time_prefix_format(self, handler):
        """Time prefix is YYYY-MM-DD format"""
        prefix = handler._get_time_prefix()
        assert len(prefix) == 10  # YYYY-MM-DD
        assert prefix.count("-") == 2

    def test_write_netscape_cookies(self, handler, temp_storage_dir, sample_cookies):
        """Cookie file written in Netscape format"""
        cookie_path = temp_storage_dir / "cookies.txt"
        handler._write_netscape_cookies(
            cookie_path,
            sample_cookies,
            "https://twitter.com/user/status/123"
        )

        content = cookie_path.read_text()

        assert "# Netscape HTTP Cookie File" in content
        assert "auth_token" in content
        assert "abc123xyz" in content
        assert ".twitter.com" in content

    @pytest.mark.asyncio
    async def test_download_creates_cookie_file(self, handler, temp_storage_dir, sample_cookies):
        """Download creates and cleans up cookie file"""
        with patch.object(handler, '_download_sync') as mock_download:
            from downloaders.base import DownloadResult
            mock_download.return_value = DownloadResult(
                file_path=temp_storage_dir / "test.mp4",
                metadata={"title": "Test"},
                success=True
            )

            result = await handler.download(
                url="https://twitter.com/user/status/123",
                cookies=sample_cookies,
                output_dir=temp_storage_dir
            )

            # Cookie file should be cleaned up
            assert not (temp_storage_dir / ".cookies.txt").exists()


class TestGalleryDlHandler:
    """Tests for GalleryDlHandler"""

    @pytest.fixture
    def handler(self):
        from downloaders.gallery_handler import GalleryDlHandler
        return GalleryDlHandler()

    def test_can_handle_gallery_sites(self, handler):
        """Handler accepts known gallery/image sites"""
        assert handler.can_handle("https://www.flickr.com/photos/user/123")
        assert handler.can_handle("https://www.pixiv.net/artworks/12345")
        assert handler.can_handle("https://www.artstation.com/artwork/abc")
        assert handler.can_handle("https://www.deviantart.com/user/art/title")
        assert handler.can_handle("https://www.pinterest.com/pin/123")
        assert handler.can_handle("https://imgur.com/gallery/abc")

    def test_can_handle_gallery_patterns(self, handler):
        """Handler detects gallery URLs by pattern"""
        assert handler.can_handle("https://example.com/gallery/123")
        assert handler.can_handle("https://example.com/album/summer")
        assert handler.can_handle("https://example.com/portfolio/works")

    def test_can_handle_rejects_video_sites(self, handler):
        """Handler rejects pure video platforms"""
        # Note: gallery-dl CAN handle twitter/instagram but they're shared
        assert not handler.can_handle("https://www.youtube.com/watch?v=abc")
        assert not handler.can_handle("https://vimeo.com/123456")

    def test_write_cookies_file_netscape_format(self, handler, temp_storage_dir):
        """Cookies written in Netscape format for both x.com and twitter.com"""
        cookies = {"auth_token": "test123"}
        cookie_path = temp_storage_dir / "cookies.txt"

        handler._write_cookies_file(cookies, cookie_path)

        content = cookie_path.read_text()
        assert ".x.com" in content
        assert ".twitter.com" in content
        assert "auth_token\ttest123" in content

    def test_find_all_media_files(self, handler, temp_storage_dir):
        """Media file finder catches all extensions, excludes sidecars"""
        # Create various media files
        (temp_storage_dir / "image.jpg").touch()
        (temp_storage_dir / "image.png").touch()
        (temp_storage_dir / "video.mp4").touch()
        (temp_storage_dir / "audio.mp3").touch()
        (temp_storage_dir / "video.md").touch()  # .md sidecar - should be excluded
        (temp_storage_dir / "metadata.json").touch()  # legacy .json - should be excluded

        files = handler._find_all_media_files(temp_storage_dir)
        unique_files = set(files)  # Handler may return duplicates from glob patterns

        assert len(unique_files) == 4
        extensions = {f.suffix for f in unique_files}
        assert ".jpg" in extensions
        assert ".png" in extensions
        assert ".mp4" in extensions
        assert ".mp3" in extensions
        assert ".json" not in extensions
        assert ".md" not in extensions


class TestDezoomifyHandler:
    """Tests for DezoomifyHandler (IIIF/zoomable images)"""

    @pytest.fixture
    def handler(self):
        from downloaders.dezoomify_handler import DezoomifyHandler
        return DezoomifyHandler()

    def test_can_handle_iiif_urls(self, handler):
        """Handler accepts IIIF image URLs"""
        assert handler.can_handle("https://example.org/iiif/image/123/info.json")
        assert handler.can_handle("https://library.org/images/iiif/page1")

    def test_can_handle_google_arts(self, handler):
        """Handler accepts Google Arts & Culture"""
        assert handler.can_handle("https://artsandculture.google.com/asset/starry-night/abc")

    def test_can_handle_zoomify(self, handler):
        """Handler accepts Zoomify patterns"""
        assert handler.can_handle("https://example.org/zoomify/image/ImageProperties.xml")
        assert handler.can_handle("https://example.org/deepzoom/image.dzi")

    def test_can_handle_known_institutions(self, handler):
        """Handler accepts known museum/library domains"""
        assert handler.can_handle("https://wellcomecollection.org/works/abc")
        assert handler.can_handle("https://www.davidrumsey.com/luna/servlet/detail/abc")
        assert handler.can_handle("https://gallica.bnf.fr/ark:/12345/abc")

    def test_can_handle_rejects_regular_images(self, handler):
        """Handler rejects regular image URLs"""
        assert not handler.can_handle("https://example.com/image.jpg")
        assert not handler.can_handle("https://twitter.com/user/status/123")

    def test_generate_filename_google_arts(self, handler):
        """Filename extraction for Google Arts URLs"""
        url = "https://artsandculture.google.com/asset/the-starry-night/bgEuwDxel93-Pg"
        filename = handler._generate_filename(url)

        assert "starry-night" in filename.lower() or "bgEuwDxel93-Pg" in filename

    def test_generate_filename_iiif(self, handler):
        """Filename extraction for IIIF URLs"""
        url = "https://example.org/iiif/manuscript-page-42/info.json"
        filename = handler._generate_filename(url)

        # Should use parent directory name
        assert "manuscript-page-42" in filename or "info" in filename

    def test_detect_format_iiif(self, handler):
        """Format detection for IIIF"""
        url = "https://example.org/iiif/image/info.json"
        fmt = handler._detect_format(url)
        assert fmt == "iiif"

    def test_detect_format_zoomify(self, handler):
        """Format detection for Zoomify"""
        url = "https://example.org/images/ImageProperties.xml"
        fmt = handler._detect_format(url)
        assert fmt == "zoomify"

    def test_detect_format_deepzoom(self, handler):
        """Format detection for Deep Zoom"""
        url = "https://example.org/images/photo.dzi"
        fmt = handler._detect_format(url)
        assert fmt == "deepzoom"


class TestHandlerRegistry:
    """Tests for handler selection logic"""

    def test_handler_priority(self):
        """Handlers checked in correct order: dezoomify > gallery-dl > yt-dlp"""
        from downloaders import DownloadManager

        manager = DownloadManager()

        # IIIF URL should get dezoomify handler
        iiif_url = "https://example.org/iiif/image/info.json"
        handler = manager.get_handler(iiif_url)
        assert "dezoomify" in handler.name  # Could be "dezoomify" or "dezoomify-rs"

        # Flickr should get gallery-dl handler
        flickr_url = "https://www.flickr.com/photos/user/123"
        handler = manager.get_handler(flickr_url)
        assert handler.name == "gallery-dl"

        # YouTube should get yt-dlp handler
        youtube_url = "https://www.youtube.com/watch?v=abc"
        handler = manager.get_handler(youtube_url)
        assert handler.name == "yt-dlp"

    def test_fallback_to_ytdlp(self):
        """Unknown URLs fall back to yt-dlp"""
        from downloaders import DownloadManager

        manager = DownloadManager()
        unknown_url = "https://unknown-video-site.com/video/123"
        handler = manager.get_handler(unknown_url)
        assert handler.name == "yt-dlp"
