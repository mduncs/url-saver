"""
Database module for tracking archives
"""

from pathlib import Path
from datetime import datetime, timedelta, timezone
from typing import Optional, List, Dict
import aiosqlite
import json
import logging

logger = logging.getLogger(__name__)

class Database:
    """SQLite database for tracking archive jobs and media files"""

    def __init__(self, db_path: Path):
        self.db_path = Path(db_path)
        self.db_path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = None

    async def initialize(self):
        """Initialize database and create tables"""
        self.conn = await aiosqlite.connect(str(self.db_path))

        # Create archive_jobs table
        await self.conn.execute("""
            CREATE TABLE IF NOT EXISTS archive_jobs (
                id TEXT PRIMARY KEY,
                url TEXT NOT NULL,
                status TEXT DEFAULT 'pending',
                page_title TEXT,
                page_url TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                completed_at TIMESTAMP,
                file_path TEXT,
                file_size INTEGER,
                file_hash TEXT,
                metadata TEXT,
                error TEXT
            )
        """)

        # Create media_files table
        await self.conn.execute("""
            CREATE TABLE IF NOT EXISTS media_files (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                path TEXT UNIQUE NOT NULL,
                url TEXT,
                media_type TEXT,
                mime_type TEXT,
                title TEXT,
                description TEXT,
                author TEXT,
                file_size INTEGER,
                duration INTEGER,
                width INTEGER,
                height INTEGER,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                archived_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                accessed_at TIMESTAMP,
                tags TEXT,
                metadata TEXT
            )
        """)

        # Create indexes
        await self.conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_status ON archive_jobs(status)")
        await self.conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_created ON archive_jobs(created_at)")
        await self.conn.execute("CREATE INDEX IF NOT EXISTS idx_jobs_url ON archive_jobs(url)")
        await self.conn.execute("CREATE INDEX IF NOT EXISTS idx_files_url ON media_files(url)")
        await self.conn.execute("CREATE INDEX IF NOT EXISTS idx_files_type ON media_files(media_type)")

        await self.conn.commit()
        logger.info(f"Database initialized at {self.db_path}")

    async def close(self):
        """Close database connection"""
        if self.conn:
            await self.conn.close()

    async def create_job(
        self,
        job_id: str,
        url: str,
        page_title: Optional[str] = None,
        page_url: Optional[str] = None,
        timestamp: Optional[datetime] = None
    ):
        """Create a new archive job"""
        await self.conn.execute("""
            INSERT INTO archive_jobs (id, url, status, page_title, page_url, created_at)
            VALUES (?, ?, 'pending', ?, ?, ?)
        """, (job_id, url, page_title, page_url, timestamp or datetime.now()))

        await self.conn.commit()

    async def update_job_status(self, job_id: str, status: str):
        """Update job status"""
        await self.conn.execute("""
            UPDATE archive_jobs
            SET status = ?
            WHERE id = ?
        """, (status, job_id))

        await self.conn.commit()

    async def update_job_complete(
        self,
        job_id: str,
        file_path: str,
        metadata: Dict
    ):
        """Update job when download completes"""
        await self.conn.execute("""
            UPDATE archive_jobs
            SET status = 'completed',
                completed_at = ?,
                file_path = ?,
                metadata = ?
            WHERE id = ?
        """, (datetime.now(), file_path, json.dumps(metadata), job_id))

        await self.conn.commit()

        # Also create media_file record
        await self._create_media_file(file_path, metadata)

    async def update_job_failed(self, job_id: str, error: str):
        """Update job when download fails"""
        await self.conn.execute("""
            UPDATE archive_jobs
            SET status = 'failed',
                completed_at = ?,
                error = ?
            WHERE id = ?
        """, (datetime.now(), error, job_id))

        await self.conn.commit()

    async def get_job(self, job_id: str) -> Optional[Dict]:
        """Get single job by ID"""
        async with self.conn.execute("""
            SELECT * FROM archive_jobs WHERE id = ?
        """, (job_id,)) as cursor:
            row = await cursor.fetchone()

            if row:
                return self._row_to_job_dict(row)

        return None

    async def get_jobs(
        self,
        limit: int = 50,
        status: Optional[str] = None
    ) -> List[Dict]:
        """Get list of jobs"""
        query = "SELECT * FROM archive_jobs"
        params = []

        if status:
            query += " WHERE status = ?"
            params.append(status)

        query += " ORDER BY created_at DESC LIMIT ?"
        params.append(limit)

        jobs = []
        async with self.conn.execute(query, params) as cursor:
            async for row in cursor:
                jobs.append(self._row_to_job_dict(row))

        return jobs

    async def search(self, query: str, limit: int = 50) -> List[Dict]:
        """Search for archived media"""
        search_term = f"%{query}%"

        results = []
        async with self.conn.execute("""
            SELECT * FROM media_files
            WHERE url LIKE ? OR title LIKE ? OR description LIKE ? OR author LIKE ?
            ORDER BY archived_at DESC
            LIMIT ?
        """, (search_term, search_term, search_term, search_term, limit)) as cursor:
            async for row in cursor:
                results.append(self._row_to_media_dict(row))

        return results

    async def check_url_archived(
        self,
        url: str,
        months: int = 3
    ) -> Optional[Dict]:
        """
        Check if URL has been successfully archived recently.
        Returns the most recent completed archive for this URL, or None.

        Args:
            url: The URL to check
            months: Only check archives from last N months (default: 3)

        Returns:
            Dict with job info and file verification status, or None
        """
        since_date = datetime.now() - timedelta(days=months * 30)

        async with self.conn.execute("""
            SELECT * FROM archive_jobs
            WHERE url = ?
              AND status = 'completed'
              AND created_at >= ?
            ORDER BY created_at DESC
            LIMIT 1
        """, (url, since_date)) as cursor:
            row = await cursor.fetchone()

            if not row:
                return None

            job_dict = self._row_to_job_dict(row)

            # Verify file actually exists on disk
            file_exists = False
            if job_dict.get('file_path'):
                file_path = Path(job_dict['file_path'])
                file_exists = file_path.exists()

            # Calculate age in days
            created_at = job_dict.get('created_at')
            if isinstance(created_at, str):
                created_at = datetime.fromisoformat(created_at.replace('Z', '+00:00'))
            age_days = (datetime.now(timezone.utc) - created_at).days if created_at else 0

            return {
                **job_dict,
                'file_exists': file_exists,
                'verified': file_exists,
                'age_days': age_days
            }

    async def get_stats(self) -> Dict:
        """Get archive statistics"""
        stats = {}

        # Total archives
        async with self.conn.execute("SELECT COUNT(*) FROM archive_jobs WHERE status = 'completed'") as cursor:
            row = await cursor.fetchone()
            stats['total_archives'] = row[0] if row else 0

        # Today's count
        today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
        async with self.conn.execute("""
            SELECT COUNT(*) FROM archive_jobs
            WHERE status = 'completed' AND created_at >= ?
        """, (today,)) as cursor:
            row = await cursor.fetchone()
            stats['today_count'] = row[0] if row else 0

        # This week's count
        week_ago = datetime.now() - timedelta(days=7)
        async with self.conn.execute("""
            SELECT COUNT(*) FROM archive_jobs
            WHERE status = 'completed' AND created_at >= ?
        """, (week_ago,)) as cursor:
            row = await cursor.fetchone()
            stats['week_count'] = row[0] if row else 0

        # Total size
        async with self.conn.execute("SELECT SUM(file_size) FROM media_files") as cursor:
            row = await cursor.fetchone()
            stats['total_size'] = row[0] if row and row[0] else 0

        # By type
        async with self.conn.execute("""
            SELECT media_type, COUNT(*), SUM(file_size)
            FROM media_files
            GROUP BY media_type
        """) as cursor:
            type_stats = {}
            async for row in cursor:
                if row[0]:
                    type_stats[row[0]] = {
                        'count': row[1],
                        'size': row[2] or 0
                    }
            stats['by_type'] = type_stats

        return stats

    async def _create_media_file(self, file_path: str, metadata: Dict):
        """Create media file record"""
        path = Path(file_path)

        # Determine media type
        ext = path.suffix.lower()
        if ext in ['.mp4', '.webm', '.mkv', '.avi', '.mov']:
            media_type = 'video'
        elif ext in ['.mp3', '.m4a', '.flac', '.wav', '.ogg']:
            media_type = 'audio'
        elif ext in ['.jpg', '.jpeg', '.png', '.gif', '.webp']:
            media_type = 'images'
        elif ext in ['.pdf', '.txt', '.html', '.epub']:
            media_type = 'documents'
        else:
            media_type = 'other'

        try:
            file_size = path.stat().st_size if path.exists() else 0

            await self.conn.execute("""
                INSERT OR REPLACE INTO media_files
                (path, url, media_type, title, description, author, file_size, duration, width, height, metadata)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                str(file_path),
                metadata.get('original_url'),
                media_type,
                metadata.get('title'),
                metadata.get('description'),
                metadata.get('uploader') or metadata.get('author'),
                file_size,
                metadata.get('duration'),
                metadata.get('width'),
                metadata.get('height'),
                json.dumps(metadata)
            ))

            await self.conn.commit()
        except Exception as e:
            logger.error(f"Failed to create media file record: {e}")

    def _row_to_job_dict(self, row) -> Dict:
        """Convert database row to job dictionary"""
        return {
            'id': row[0],
            'url': row[1],
            'status': row[2],
            'page_title': row[3],
            'page_url': row[4],
            'created_at': row[5],
            'completed_at': row[6],
            'file_path': row[7],
            'file_size': row[8],
            'file_hash': row[9],
            'metadata': json.loads(row[10]) if row[10] else {},
            'error': row[11]
        }

    def _row_to_media_dict(self, row) -> Dict:
        """Convert database row to media dictionary"""
        return {
            'id': row[0],
            'path': row[1],
            'url': row[2],
            'media_type': row[3],
            'mime_type': row[4],
            'title': row[5],
            'description': row[6],
            'author': row[7],
            'file_size': row[8],
            'duration': row[9],
            'width': row[10],
            'height': row[11],
            'created_at': row[12],
            'archived_at': row[13],
            'accessed_at': row[14],
            'tags': json.loads(row[15]) if row[15] else [],
            'metadata': json.loads(row[16]) if row[16] else {}
        }

__all__ = ['Database']