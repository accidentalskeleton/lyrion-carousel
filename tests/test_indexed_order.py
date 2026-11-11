"""Regression coverage for the optional Recently Indexed shelf order."""
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

import indexed_order


class IndexedOrderTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.path = Path(self.temp.name) / 'indexed.sqlite3'
        self.tracks = {}
        self.calls = []

    def rpc(self, player, command):
        self.assertEqual(player, '0')
        self.assertEqual(command[0], 'titles')
        self.assertIn('tags:eD', command)
        self.calls.append(command)
        album_arg = next((x for x in command[3:] if x.startswith('album_id:')), None)
        if album_arg:
            rows = self.tracks.get(album_arg.split(':', 1)[1], [])
        else:
            rows = [track for page in self.tracks.values() for track in page]
        start, length = command[1:3]
        return {'count': len(rows), 'titles_loop': rows[start:start + length]}

    @staticmethod
    def album(id, name):
        return {'id': id, 'artist': 'Artist', 'album': name, 'year': 2026}

    def test_new_compilation_beats_old_recording_history(self):
        albums = [self.album(1, 'Previous rip'),
                  self.album(2, 'New compilation'),
                  self.album(3, 'New greatest hits')]
        self.tracks = {
            '1': [{'album_id': 1, 'addedTime': 100}],
            # Both new albums have a recording that LMS might have known
            # months earlier. titles.addedTime still reflects today's index.
            '2': [{'album_id': 2, 'addedTime': 300},
                  {'album_id': 2, 'addedTime': 301}],
            '3': [{'album_id': 3, 'addedTime': 400},
                  {'album_id': 3, 'addedTime': 401}],
        }
        self.assertEqual(indexed_order.indexed_album_order(albums, self.rpc, self.path),
                         ['3', '2', '1'])
        self.assertEqual(len(self.calls), 3)
        # Re-selecting the shelf uses the durable index, not another LMS scan.
        self.calls.clear()
        self.assertEqual(indexed_order.indexed_album_order(albums, self.rpc, self.path),
                         ['3', '2', '1'])
        self.assertEqual(self.calls, [])

    def test_new_album_is_fetched_without_reindexing_repaired_album(self):
        albums = [self.album(1, 'Existing'), self.album(2, 'New')]
        self.tracks = {
            '1': [{'album_id': 1, 'addedTime': 100}],
            '2': [{'album_id': 2, 'addedTime': 200}],
        }
        indexed_order.indexed_album_order(albums, self.rpc, self.path)
        self.calls.clear()
        # Repaired tracks can have newer indexes, but this album was already
        # in Carousel's catalogue and must keep its earlier date.
        self.tracks['1'] = [{'album_id': 1, 'addedTime': 1000}]
        self.tracks['3'] = [{'album_id': 3, 'addedTime': 300}]
        albums.append(self.album(3, 'Fresh'))
        self.assertEqual(indexed_order.indexed_album_order(albums, self.rpc, self.path),
                         ['3', '2', '1'])
        self.assertEqual([c[-1] for c in self.calls], ['album_id:3'])
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute(
                "SELECT added FROM album_dates WHERE album_id='1'").fetchone()[0], 100)

    def test_different_album_reusing_id_is_refetched(self):
        self.tracks = {'1': [{'album_id': 1, 'addedTime': 100}]}
        indexed_order.indexed_album_order([self.album(1, 'First')], self.rpc, self.path)
        self.tracks['1'] = [{'album_id': 1, 'addedTime': 700}]
        self.calls.clear()
        indexed_order.indexed_album_order([self.album(1, 'Replacement')], self.rpc, self.path)
        self.assertEqual(len(self.calls), 1)
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute(
                "SELECT added FROM album_dates WHERE album_id='1'").fetchone()[0], 700)

    def test_initial_large_catalogue_streams_bounded_pages(self):
        albums = [self.album(i, f'Album {i}') for i in range(1, 26)]
        self.tracks = {'bulk': [
            {'album_id': i % 25 + 1, 'addedTime': 1000 + i}
            for i in range(1051)
        ]}
        result = indexed_order.indexed_album_order(albums, self.rpc, self.path)
        self.assertEqual((result[0], result[-1]), ('25', '1'))
        self.assertEqual([call[1] for call in self.calls], [0, 1000])
        self.assertTrue(all(call[2] == 1000 for call in self.calls))

    def test_missing_dates_sort_last_and_do_not_repeat_requests(self):
        albums = [self.album(1, 'Unknown'), self.album(2, 'Known')]
        self.tracks = {
            '1': [{'album_id': 1}],
            '2': [{'album_id': 2, 'addedTime': 50}],
        }
        self.assertEqual(indexed_order.indexed_album_order(albums, self.rpc, self.path),
                         ['2', '1'])
        self.calls.clear()
        indexed_order.indexed_album_order(albums, self.rpc, self.path)
        self.assertFalse(self.calls)

    def test_upstream_error_cannot_commit_partial_bulk_index(self):
        albums = [self.album(i, f'Album {i}') for i in range(1, 26)]
        rows = [{'album_id': i % 25 + 1, 'addedTime': 1000 + i}
                for i in range(1002)]
        calls = []
        def interrupted(player, command):
            calls.append(command)
            if command[1] == 1000:
                raise OSError('LMS disconnected')
            return {'count': len(rows), 'titles_loop': rows[:1000]}
        with self.assertRaises(OSError):
            indexed_order.indexed_album_order(albums, interrupted, self.path)
        with sqlite3.connect(self.path) as db:
            self.assertEqual(db.execute('SELECT COUNT(*) FROM album_dates').fetchone()[0], 0)
        self.tracks = {'bulk': rows}
        self.assertEqual(len(indexed_order.indexed_album_order(albums, self.rpc, self.path)), 25)


if __name__ == '__main__':
    unittest.main()
