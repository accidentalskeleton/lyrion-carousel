"""LMS-only album ordering by the current library's track-added timestamps.

Unlike LMS sort:new, this uses titles.addedTime (library indexing time), not
tracks_persistent.added (a recording's first-known date across releases).
No direct LMS database access, ripper integration, or LMS patch is required.
"""
from __future__ import annotations

import json
import math
import sqlite3
from contextlib import closing
from pathlib import Path

PAGE_SIZE = 1000
# Below this threshold a few album-specific requests are cheaper than
# walking the entire track library. The first cold build uses one bulk walk.
BULK_THRESHOLD = 25


def _identity(album: dict) -> str:
    # Album IDs are stable across normal scans, but can be reused after a
    # rebuild. Refuse to reuse an index entry for a different-looking album.
    return json.dumps([album.get('artist'), album.get('album'),
                       album.get('year'), album.get('disc')],
                      ensure_ascii=False, separators=(',', ':'))


def _added(value) -> int | None:
    try:
        number = float(value)
        if not math.isfinite(number) or not 0 < number < 4_102_444_800:
            return None
        return int(number)
    except (TypeError, ValueError, OverflowError):
        return None


def _pages(rpc, album_id: str | None = None):
    offset = 0
    while True:
        command = ['titles', offset, PAGE_SIZE, 'tags:eD']
        if album_id is not None:
            command.append('album_id:' + album_id)
        result = rpc('0', command)
        if not isinstance(result, dict) or result.get('rescan'):
            raise ValueError('LMS scan in progress or invalid titles response')
        rows = result.get('titles_loop', [])
        if not isinstance(rows, list):
            raise ValueError('Invalid LMS titles page')
        try:
            count = int(result['count'])
        except (KeyError, TypeError, ValueError):
            raise ValueError('Missing LMS track count') from None
        if count < 0 or offset + len(rows) > count or (not rows and offset < count):
            raise ValueError('Incomplete LMS titles page')
        yield rows
        offset += len(rows)
        if offset >= count:
            return


def _earliest(dates: dict[str, int], album_id: str, value) -> None:
    timestamp = _added(value)
    if timestamp is not None:
        dates[album_id] = min(timestamp, dates.get(album_id, timestamp))


def _fetch_missing(rpc, missing: set[str]) -> dict[str, int]:
    dates: dict[str, int] = {}
    if len(missing) >= BULK_THRESHOLD:
        # Stream the entire library in bounded pages; do not materialize every
        # track or issue a separate request for thousands of album IDs.
        for page in _pages(rpc):
            for track in page:
                album_id = str(track.get('album_id', ''))
                if album_id in missing:
                    _earliest(dates, album_id, track.get('addedTime'))
    else:
        for album_id in sorted(missing):
            for page in _pages(rpc, album_id):
                for track in page:
                    if str(track.get('album_id', album_id)) == album_id:
                        _earliest(dates, album_id, track.get('addedTime'))
    return dates


def indexed_album_order(albums: list[dict], rpc, cache_path: Path) -> list[str]:
    """Return album IDs newest first, preserving first-observed dates on rescans.

    A separately namespaced SQLite index persists across Carousel restarts and
    ordinary catalogue snapshots. New LMS albums trigger targeted lookups;
    changing an existing album's audio/tags does not reset its cached date.
    Unknown dates sort last with a deterministic name/ID fallback.
    """
    identities = {str(a['id']): _identity(a) for a in albums
                  if a.get('id') is not None}
    if not identities:
        return []

    with closing(sqlite3.connect(cache_path, timeout=15)) as db:
        db.execute('CREATE TABLE IF NOT EXISTS album_dates ('
                   'album_id TEXT PRIMARY KEY, identity TEXT NOT NULL, added INTEGER)')
        cached = {album_id: (identity, added) for album_id, identity, added
                  in db.execute('SELECT album_id, identity, added FROM album_dates')}
        added = {album_id: cached[album_id][1] for album_id, identity
                 in identities.items()
                 if album_id in cached and cached[album_id][0] == identity}
        missing = set(identities) - set(added)
        if missing:
            found = _fetch_missing(rpc, missing)
            # Do not commit a partial index if an LMS page fails.
            with db:
                db.executemany(
                    'INSERT OR REPLACE INTO album_dates(album_id,identity,added) VALUES (?,?,?)',
                    [(album_id, identities[album_id], found.get(album_id))
                     for album_id in sorted(missing)]
                )
            added.update({album_id: found.get(album_id) for album_id in missing})

    def key(album):
        album_id = str(album['id'])
        timestamp = added.get(album_id)
        return (timestamp is None, -(timestamp or 0),
                str(album.get('artist', '')).casefold(),
                str(album.get('album', '')).casefold(), album_id)

    return [str(album['id']) for album in sorted(albums, key=key)
            if album.get('id') is not None]
