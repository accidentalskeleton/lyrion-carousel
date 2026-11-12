"""One persistent SQLite store for Carousel metadata.

Artwork image bytes remain disposable files in the artwork cache directory.
The metadata database lives in its parent directory; image-cache clearing
does not discard first-observed album dates.

This is a fresh v1 store: legacy *.meta, colour-index-v1-*,
indexed-order-v1-* and catalogue-v2-*.json are intentionally not imported.
"""
from __future__ import annotations

import json
import sqlite3
from contextlib import closing
from pathlib import Path


DB_FILENAME = "carousel-metadata.sqlite3"
SCHEMA_VERSION = 1


def database_path(artwork_cache_dir: Path) -> Path:
    return artwork_cache_dir.parent / DB_FILENAME


def connect(path: Path) -> sqlite3.Connection:
    """Return a connection with the schema ready; caller must close it."""
    path.parent.mkdir(parents=True, exist_ok=True)
    db = sqlite3.connect(path, timeout=15)
    try:
        db.execute("PRAGMA busy_timeout = 15000")
        with db:
            version = db.execute("PRAGMA user_version").fetchone()[0]
            if version not in (0, SCHEMA_VERSION):
                raise ValueError(f"Unsupported Carousel metadata schema: {version}")
            db.execute(
                "CREATE TABLE IF NOT EXISTS album_dates ("
                "lms_url TEXT NOT NULL, album_id TEXT NOT NULL, "
                "identity TEXT NOT NULL, added INTEGER, "
                "PRIMARY KEY(lms_url, album_id))"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS artwork_metadata ("
                "lms_url TEXT NOT NULL, source TEXT NOT NULL, "
                "artwork_id TEXT NOT NULL, metadata TEXT NOT NULL, "
                "PRIMARY KEY(lms_url, source, artwork_id))"
            )
            db.execute(
                "CREATE TABLE IF NOT EXISTS catalogue_snapshots ("
                "lms_url TEXT PRIMARY KEY, payload TEXT NOT NULL)"
            )
            if version == 0:
                db.execute(f"PRAGMA user_version = {SCHEMA_VERSION}")
        return db
    except BaseException:
        db.close()
        raise


def artwork_get(path: Path, lms_url: str, artwork_id: str, source: str = 'library') -> dict | None:
    with closing(connect(path)) as db:
        row = db.execute(
            "SELECT metadata FROM artwork_metadata WHERE lms_url=? AND source=? AND artwork_id=?",
            (lms_url, source, artwork_id),
        ).fetchone()
    if row is None:
        return None
    try:
        value = json.loads(row[0])
    except (ValueError, TypeError):
        return None
    return value if isinstance(value, dict) else None


def artwork_all(path: Path, lms_url: str, source: str = 'library') -> dict[str, dict]:
    values = {}
    with closing(connect(path)) as db:
        for artwork_id, raw in db.execute(
            "SELECT artwork_id, metadata FROM artwork_metadata WHERE lms_url=? AND source=?",
            (lms_url, source),
        ):
            try:
                value = json.loads(raw)
            except (ValueError, TypeError):
                continue
            if isinstance(value, dict):
                values[artwork_id] = value
    return values


def artwork_put_many(path: Path, lms_url: str, metadata: dict, source: str = 'library') -> None:
    if not metadata:
        return
    rows = [
        (lms_url, source, str(artwork_id), json.dumps(value, separators=(",", ":")))
        for artwork_id, value in metadata.items()
    ]
    with closing(connect(path)) as db, db:
        db.executemany(
            "INSERT INTO artwork_metadata(lms_url, source, artwork_id, metadata) "
            "VALUES (?, ?, ?, ?) ON CONFLICT(lms_url, source, artwork_id) "
            "DO UPDATE SET metadata=excluded.metadata",
            rows,
        )


def artwork_count(path: Path, lms_url: str, source: str = 'library') -> int:
    with closing(connect(path)) as db:
        return int(db.execute(
            "SELECT count(*) FROM artwork_metadata WHERE lms_url=? AND source=?", (lms_url, source)
        ).fetchone()[0])


def snapshot_get(path: Path, lms_url: str) -> dict | None:
    with closing(connect(path)) as db:
        row = db.execute(
            "SELECT payload FROM catalogue_snapshots WHERE lms_url=?", (lms_url,)
        ).fetchone()
    if row is None:
        return None
    try:
        value = json.loads(row[0])
    except (ValueError, TypeError):
        return None
    return value if isinstance(value, dict) else None


def snapshot_put(path: Path, lms_url: str, payload: dict) -> None:
    raw = json.dumps(payload, ensure_ascii=False, separators=(",", ":"))
    with closing(connect(path)) as db, db:
        db.execute(
            "INSERT INTO catalogue_snapshots(lms_url,payload) VALUES (?,?) "
            "ON CONFLICT(lms_url) DO UPDATE SET payload=excluded.payload",
            (lms_url, raw),
        )


def snapshot_delete(path: Path, lms_url: str) -> None:
    with closing(connect(path)) as db, db:
        db.execute("DELETE FROM catalogue_snapshots WHERE lms_url=?", (lms_url,))


def clear_generated(path: Path) -> None:
    """Discard artwork and catalogue data, preserving durable album dates."""
    with closing(connect(path)) as db, db:
        db.execute("DELETE FROM artwork_metadata")
        db.execute("DELETE FROM catalogue_snapshots")
