"""Fresh unified-metadata database tests; no legacy-cache migration."""
import json
import sqlite3
import tempfile
import unittest
from concurrent.futures import ThreadPoolExecutor
from contextlib import closing
from pathlib import Path

import metadata_db


class UnifiedMetadataTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.artwork_dir = Path(self.temp.name) / 'artwork'
        self.artwork_dir.mkdir()
        self.db_path = metadata_db.database_path(self.artwork_dir)
        self.one = 'http://first-lms:9000'
        self.two = 'http://second-lms:9000'

    def test_new_database_has_expected_schema_and_lives_outside_artwork_cache(self):
        self.assertEqual(self.db_path, self.artwork_dir.parent / metadata_db.DB_FILENAME)
        self.assertFalse(self.db_path.exists())
        with closing(metadata_db.connect(self.db_path)) as db:
            self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0],
                             metadata_db.SCHEMA_VERSION)
            names = {row[0] for row in db.execute(
                "SELECT name FROM sqlite_master WHERE type='table'")}
            self.assertEqual(names, {'album_dates', 'artwork_metadata',
                                     'catalogue_snapshots'})
        self.assertTrue(self.db_path.is_file())
        self.assertEqual(list(self.artwork_dir.iterdir()), [])

    def test_artwork_is_isolated_by_lms_and_source(self):
        data = {'spine_color':'#123456', 'text_color':'#ffffff', 'spine_font':'Arial'}
        other = {'spine_color':'#abcdef'}
        metadata_db.artwork_put_many(self.db_path, self.one, {'reused':data})
        metadata_db.artwork_put_many(self.db_path, self.one, {'reused':other},
                                     source='spotify')
        metadata_db.artwork_put_many(self.db_path, self.two, {'reused':other})
        self.assertEqual(metadata_db.artwork_get(self.db_path,self.one,'reused'),data)
        self.assertEqual(metadata_db.artwork_get(self.db_path,self.one,'reused',
                                                source='spotify'),other)
        self.assertEqual(metadata_db.artwork_get(self.db_path,self.two,'reused'),other)
        self.assertEqual(metadata_db.artwork_all(self.db_path,self.one),{'reused':data})
        self.assertEqual(metadata_db.artwork_count(self.db_path,self.one),1)
        self.assertEqual(metadata_db.artwork_count(self.db_path,self.one,
                                                   source='spotify'),1)

    def test_snapshots_are_isolated_and_invalidation_is_targeted(self):
        first={'version':2,'albums':[{'id':1}], 'genres':{},'created':100}
        second={'version':2,'albums':[{'id':2}], 'genres':{},'created':200}
        metadata_db.snapshot_put(self.db_path,self.one,first)
        metadata_db.snapshot_put(self.db_path,self.two,second)
        self.assertEqual(metadata_db.snapshot_get(self.db_path,self.one),first)
        self.assertEqual(metadata_db.snapshot_get(self.db_path,self.two),second)
        metadata_db.snapshot_delete(self.db_path,self.one)
        self.assertIsNone(metadata_db.snapshot_get(self.db_path,self.one))
        self.assertEqual(metadata_db.snapshot_get(self.db_path,self.two),second)

    def test_clear_artwork_keeps_historical_album_dates(self):
        with closing(metadata_db.connect(self.db_path)) as db, db:
            db.execute("INSERT INTO album_dates VALUES (?,?,?,?)",
                       (self.one,'99','identity',123))
        metadata_db.artwork_put_many(self.db_path,self.one,{'cover':{'x':1}})
        metadata_db.artwork_put_many(self.db_path,self.one,{'cover':{'x':2}},
                                     source='spotify')
        metadata_db.snapshot_put(self.db_path,self.one,{'albums':[]})
        metadata_db.clear_generated(self.db_path)
        self.assertEqual(metadata_db.artwork_all(self.db_path,self.one),{})
        self.assertEqual(metadata_db.artwork_all(self.db_path,self.one,'spotify'),{})
        self.assertIsNone(metadata_db.snapshot_get(self.db_path,self.one))
        with closing(metadata_db.connect(self.db_path)) as db:
            row=db.execute("SELECT identity,added FROM album_dates WHERE lms_url=? "
                           "AND album_id='99'",(self.one,)).fetchone()
        self.assertEqual(row,('identity',123))

    def test_invalid_metadata_is_read_as_missing(self):
        with closing(metadata_db.connect(self.db_path)) as db, db:
            db.execute("INSERT INTO artwork_metadata VALUES (?,?,?,?)",
                       (self.one,'library','bad','not valid JSON'))
        self.assertIsNone(metadata_db.artwork_get(self.db_path,self.one,'bad'))
        self.assertEqual(metadata_db.artwork_all(self.db_path,self.one),{})
        with closing(metadata_db.connect(self.db_path)) as db, db:
            db.execute("INSERT INTO catalogue_snapshots VALUES (?,?)",
                       (self.one,'broken JSON'))
        self.assertIsNone(metadata_db.snapshot_get(self.db_path,self.one))

    def test_unrecognized_schema_rejected_without_modifying_data(self):
        with closing(metadata_db.connect(self.db_path)) as db, db:
            db.execute('PRAGMA user_version = 11')
        with self.assertRaises(ValueError):
            metadata_db.connect(self.db_path)
        with sqlite3.connect(self.db_path) as db:
            self.assertEqual(db.execute('PRAGMA user_version').fetchone()[0],11)

    def test_legacy_cache_is_not_imported(self):
        # Old files can exist; the new database never reads them.
        (self.artwork_dir/'abc.meta').write_text('{"spine_color":"#ffffff"}')
        (self.artwork_dir/'colour-index-v1-old.sqlite3').write_bytes(b'legacy')
        (self.artwork_dir/'catalogue-v2-old.json').write_text('{"albums":[1]}')
        self.assertEqual(metadata_db.artwork_all(self.db_path,self.one),{})
        self.assertIsNone(metadata_db.snapshot_get(self.db_path,self.one))
        self.assertEqual(metadata_db.artwork_count(self.db_path,self.one),0)

    def test_concurrent_metadata_writes_keep_every_row(self):
        def write(i):
            metadata_db.artwork_put_many(self.db_path,self.one,
                                         {str(i):{'index':i}})
        with ThreadPoolExecutor(max_workers=8) as pool:
            list(pool.map(write,range(80)))
        rows=metadata_db.artwork_all(self.db_path,self.one)
        self.assertEqual(len(rows),80)
        self.assertEqual(rows['79'],{'index':79})


if __name__ == '__main__':
    unittest.main()
