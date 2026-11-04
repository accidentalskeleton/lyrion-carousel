"""Run with: python3 -m unittest discover -s tests -p 'test_*.py'."""
import hashlib
import io
import json
import sqlite3
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from PIL import Image
import server


class ServerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.handler = object.__new__(server.LyrionCarouselHandler)
        self.handler.cache_dir = Path(self.temp.name) / 'artwork'
        self.handler.cache_dir.mkdir()
        self.handler.lms_settings_path = Path(self.temp.name) / server.LMS_SETTINGS_FILENAME
        self.handler.lms_url = 'http://test:9000'
        self.responses = []
        self.handler._send_payload = lambda status, body, *args, **kwargs: self.responses.append((status, body))

    def paths(self, artwork_id):
        key = hashlib.sha256(f'{self.handler.lms_url}\0{artwork_id}'.encode()).hexdigest()
        return self.handler.cache_dir / f'{key}.img', self.handler.cache_dir / f'{key}.meta'

    def test_spine_coloured_text_meets_accessible_contrast(self):
        backgrounds=['#000000','#ffffff','#808080','#eacb43','#397da3',
                     '#63424f','#efe9df','#202628','#d02a3f','#32944e']
        all_colours=set()
        for background in backgrounds:
            colours={server.select_spine_text_colour(background,f'album-{i}')
                     for i in range(40)}
            all_colours.update(colours)
            for colour in colours:
                self.assertGreaterEqual(server.spine_contrast_ratio(colour,background),4.5)
                self.assertRegex(colour,r'#[0-9a-fA-F]{6}')
        self.assertGreater(len(all_colours),10)
        self.assertEqual(server.select_spine_text_colour('#234567','same-id'),
                         server.select_spine_text_colour('#234567','same-id'))
        self.assertEqual(server.SPINE_TEXT_STYLE_VERSION,3)
    def test_spine_text_style_uses_cover_metadata(self):
        css=(Path(__file__).resolve().parents[1]/'css/shelf.css').read_text()
        app=(Path(__file__).resolve().parents[1]/'js/app.js').read_text()
        self.assertIn('color:var(--spine-text,#f5f2ea)',css)
        self.assertIn('var(--spine-font-family,Arial,Helvetica,sans-serif)',css)
        self.assertIn("element.style.setProperty('--spine-text',meta.text_color)",app)
        self.assertIn("element.style.setProperty('--spine-font-family',meta.spine_font)",app)
        self.assertNotIn('color:#fff;',css.split('.bf-spine-label {',1)[1].split('}',1)[0])

    def test_spine_text_is_centered_independently_of_font(self):
        css=(Path(__file__).resolve().parents[1]/'css/shelf.css').read_text()
        label=css.split('.bf-spine-label {',1)[1].split('}',1)[0]
        self.assertIn('left:50%;',label)
        self.assertIn('transform:translateX(-50%)!important;',label)
        self.assertIn('width:max-content;',label)
        self.assertIn('writing-mode:vertical-rl;',label)
        self.assertNotIn('inset:19px 4px;',label)

    def test_open_case_wrapper_does_not_block_other_spine_clicks(self):
        css=(Path(__file__).resolve().parents[1]/'css/shelf.css').read_text()
        preview=css.split('.bf-front-preview {',1)[1].split('}',1)[0]
        case=css.split('.bf-front-case {',1)[1].split('}',1)[0]
        self.assertIn('pointer-events:none;',preview)
        self.assertIn('pointer-events:auto;',case)

    def test_lms_selection_survives_restart_and_artwork_cache_clear(self):
        self.handler.runtime_config={'lms_url':'http://test:9000'}
        body=json.dumps({'lms_url':'http://streamer:9000/'}).encode()
        self.handler.headers={'Content-Length':str(len(body))}
        self.handler.rfile=io.BytesIO(body)
        self.handler._update_lms_url()
        self.assertEqual(self.responses[-1][0],200)
        self.assertEqual(self.handler.runtime_config['lms_url'],'http://streamer:9000')
        self.assertEqual(self.handler.lms_url,'http://streamer:9000')
        path=self.handler.lms_settings_path
        self.assertTrue(path.is_file())
        self.assertEqual(server.load_saved_lms_url(path,'http://other-lms:9000'),
                         'http://streamer:9000')
        self.handler._clear_cache_files()
        self.assertTrue(path.exists(),'Clear artwork must never discard selected LMS')
        self.assertEqual(server.load_saved_lms_url(path,'http://other-lms:9000'),
                         'http://streamer:9000')

    def test_request_host_allowlist_and_private_ip_ranges(self):
        allowed_names=server.local_allowed_hosts('streamer,streamer.local,controller.home.arpa')
        for host in ('localhost','localhost:8088','127.0.0.1:8088',
                     '192.168.1.12','10.2.3.4','172.16.12.3',
                     '[::1]:8088','[fd12::1]','[fe80::1]',
                     'streamer','streamer.local','controller.home.arpa'):
            with self.subTest(allowed=host):
                self.assertTrue(server.is_local_request_host(host,allowed_names))
        for host in (None,'','attacker.example','attacker.local',
                     'attacker.lan','attacker.home.arpa',
                     'localhost.attacker.example','streamer.attacker.example',
                     '192.168.1.12.attacker.example','bad host',
                     'user@localhost','localhost:invalid-port','localhost:0',
                     'localhost:99999','localhost.','localhost,evil.example',
                     '127.1','0.0.0.0','192.0.2.1','198.51.100.3',
                     '8.8.8.8','224.0.0.1','169.254.1.1','[::]',
                     '[ff02::1]','[2001:db8::1]','[::ffff:192.168.1.9]',
                     'streamer@attacker.example','streamer#fragment'):
            with self.subTest(rejected=host):
                self.assertFalse(server.is_local_request_host(host,allowed_names))
        self.assertTrue(server.is_local_request_host(
            'othercontroller.lan',server.local_allowed_hosts('othercontroller.lan')))

    def test_request_parser_rejects_foreign_hosts_and_csrf_before_dispatch(self):
        from unittest.mock import Mock

        def parse(headers,method='POST'):
            handler=object.__new__(server.LyrionCarouselHandler)
            handler.allowed_hosts=server.local_allowed_hosts('streamer,streamer.local')
            handler.raw_requestline=f'{method} /api/lms HTTP/1.1\r\n'.encode()
            handler.rfile=io.BytesIO(
                ('\r\n'.join(headers)+'\r\n\r\n').encode())
            handler.send_error=Mock()
            handler.close_connection=True
            accepted=handler.parse_request()
            return accepted,handler.send_error

        valid=['Host: streamer:8088','Origin: http://streamer:8088',
               'X-Lyrion-Request: 1','Sec-Fetch-Site: same-origin',
               'Content-Type: application/json']
        accepted,error=parse(valid)
        self.assertTrue(accepted)
        error.assert_not_called()
        self.assertTrue(parse(['Host: 192.168.1.12:8088',
                               'X-Lyrion-Request: 1'])[0],
                        'Non-browser local clients may omit Origin')
        self.assertTrue(parse(['Host: streamer:8088'],method='GET')[0])
        blocked=[
            ['Host: attacker.example',*valid[1:]],
            ['Host: attacker.local',*valid[1:]],
            ['Host: streamer:8088','Host: attacker.example',*valid[1:]],
            ['Host: streamer:8088','Origin: http://evil.example',
             'X-Lyrion-Request: 1'],
            ['Host: streamer:8088','Origin: null',
             'X-Lyrion-Request: 1'],
            ['Host: streamer:8088','Origin: http://streamer:8088',
             'Origin: http://evil.example','X-Lyrion-Request: 1'],
            ['Host: streamer:8088','Sec-Fetch-Site: cross-site',
             'X-Lyrion-Request: 1'],
            ['Host: streamer:8088','Sec-Fetch-Site: same-site',
             'X-Lyrion-Request: 1'],
            ['Host: streamer:8088','Origin: http://streamer:8088'],
            [],
        ]
        for headers in blocked:
            with self.subTest(headers=headers):
                accepted,error=parse(headers)
                self.assertFalse(accepted)
                error.assert_called_once()
                self.assertEqual(error.call_args.args[0],403)
        accepted,error=parse(['Host: evil.example'],method='GET')
        self.assertFalse(accepted)
        error.assert_called_once()

    def test_browser_post_calls_include_non_simple_security_header(self):
        root=Path(__file__).resolve().parents[1]
        for path in ('js/app.js','js/settings.js','js/lms.js'):
            source=(root/path).read_text()
            with self.subTest(path=path):
                self.assertEqual(source.count("method:'POST'")+source.count("method: 'POST'"),
                                 source.count('X-Lyrion-Request'))

    def test_lms_defaults_use_local_streamer_everywhere(self):
        root=Path(__file__).resolve().parents[1]
        service=(root/'packaging/debian/lyrion-carousel.service').read_text()
        defaults=(root/'packaging/debian/lyrion-carousel.default').read_text()
        server_source=(root/'server.py').read_text()
        self.assertIn('Environment=LMS_URL=http://streamer:9000',service)
        self.assertIn('LMS_URL=http://streamer:9000',defaults)
        self.assertIn("parser.add_argument('--lms',default='http://streamer:9000'",server_source)

    def test_lms_settings_missing_or_corrupt_fall_back_to_service_default(self):
        path=self.handler.lms_settings_path
        self.assertEqual(server.load_saved_lms_url(path,'http://streamer:9000'),
                         'http://streamer:9000')
        for payload in [b'not-json',b'{}',
                        b'{"version":1,"lms_url":"file:///etc/passwd"}',
                        b'{"version":1,"lms_url":"http://user:secret@host:9000"}',
                        b'x'*5000]:
            path.write_bytes(payload)
            self.assertEqual(server.load_saved_lms_url(path,'http://streamer:9000'),
                             'http://streamer:9000')
        server.save_lms_url(path,'http://other-lms:9000')
        self.assertEqual(server.load_saved_lms_url(path,'http://streamer:9000'),
                         'http://other-lms:9000')

    def test_lms_change_rejects_bad_url_without_persisting(self):
        self.handler.runtime_config={'lms_url':'http://test:9000'}
        body=json.dumps({'lms_url':'http://user:password@bad:9000'}).encode()
        self.handler.headers={'Content-Length':str(len(body))}
        self.handler.rfile=io.BytesIO(body)
        with patch.object(self.handler,'send_error') as error:
            self.handler._update_lms_url()
        error.assert_called_once()
        self.assertEqual(error.call_args.args[0],400)
        self.assertFalse(self.handler.lms_settings_path.exists())
        self.assertEqual(self.handler.runtime_config['lms_url'],'http://test:9000')

    def test_lms_settings_write_failure_does_not_switch_live_target(self):
        self.handler.runtime_config={'lms_url':'http://test:9000'}
        body=json.dumps({'lms_url':'http://streamer:9000'}).encode()
        self.handler.headers={'Content-Length':str(len(body))}
        self.handler.rfile=io.BytesIO(body)
        with patch.object(server,'save_lms_url',side_effect=OSError('read only')):
            with patch.object(self.handler,'_send_upstream_error') as error:
                self.handler._update_lms_url()
        error.assert_called_once()
        self.assertEqual(self.handler.runtime_config['lms_url'],'http://test:9000')
        self.assertEqual(self.handler.lms_url,'http://test:9000')

    def test_observed_unchanged_scan_reuses_catalogue_without_background_work(self):
        rows=[{'id':1,'artist':'A','album':'Original','artwork_track_id':'art1'},
              {'id':2,'artist':'B','album':'Second','artwork_track_id':'art2'}]
        self.handler.runtime_config={'lms_url':self.handler.lms_url}
        with patch.object(self.handler,'_catalogue_pages',return_value=iter([rows])):
            self.handler.path='/api/catalogue?order=artistAlbum'
            self.handler._serve_catalogue()
        key=self.handler._catalogue_snapshot_key()
        snapshot=server._CATALOGUE_MEMORY[key]
        order_key=('artistAlbum',())
        original=snapshot['orders'][order_key]
        snapshot['genres']['7']=['1']
        snapshot['orders'][('album',(7,))]=b'temporary-genre-order'
        with patch.object(self.handler,'_catalogue_pages',return_value=iter([list(reversed(rows))])):
            with patch.object(server.COLOUR_INDEXER,'enqueue') as enqueue:
                self.handler.path='/api/catalogue/reconcile'
                self.handler._reconcile_catalogue()
        result=json.loads(self.responses[-1][1])
        self.assertFalse(result['changed'])
        self.assertEqual(result['count'],2)
        self.assertEqual(result['new_albums'],0)
        self.assertIs(server._CATALOGUE_MEMORY[key],snapshot)
        self.assertEqual(snapshot['orders'][order_key],original)
        self.assertNotIn(('album',(7,)),snapshot['orders'])
        self.assertFalse(snapshot['genres'])
        enqueue.assert_not_called()

    def test_observed_changed_scan_refreshes_snapshot_and_indexes_new_covers(self):
        old=[{'id':1,'artist':'A','album':'First','artwork_track_id':'first'}]
        updated=[old[0],{'id':2,'artist':'B','album':'New','artwork_track_id':'new-cover'}]
        self.handler.runtime_config={'lms_url':self.handler.lms_url}
        with patch.object(self.handler,'_catalogue_pages',return_value=iter([old])):
            self.handler.path='/api/catalogue?order=artistAlbum'
            self.handler._serve_catalogue()
        with patch.object(self.handler,'_catalogue_pages',return_value=iter([updated])):
            with patch.object(server.COLOUR_INDEXER,'enqueue') as enqueue:
                self.handler.path='/api/catalogue/reconcile'
                self.handler.do_POST()
        data=json.loads(self.responses[-1][1])
        self.assertTrue(data['changed'])
        self.assertEqual((data['count'],data['new_albums']),(2,1))
        enqueue.assert_called_once()
        self.assertEqual(list(enqueue.call_args.args[1]),['new-cover'])
        snapshot=server._CATALOGUE_MEMORY[self.handler._catalogue_snapshot_key()]
        self.assertEqual(len(snapshot['albums']),2)
        self.assertEqual(len(json.loads(self.handler._catalogue_snapshot_path().read_bytes())['albums']),2)

    def test_observed_scan_detects_artwork_id_change_on_existing_album(self):
        old=[{'id':1,'artist':'A','album':'Album','artwork_track_id':'previous'}]
        current=[{'id':1,'artist':'A','album':'Album','artwork_track_id':'new-cover'}]
        self.handler.runtime_config={'lms_url':self.handler.lms_url}
        with patch.object(self.handler,'_catalogue_pages',return_value=iter([old])):
            self.handler.path='/api/catalogue?order=artistAlbum'
            self.handler._serve_catalogue()
        with patch.object(self.handler,'_catalogue_pages',return_value=iter([current])):
            with patch.object(server.COLOUR_INDEXER,'enqueue') as enqueue:
                self.handler.path='/api/catalogue/reconcile'
                self.handler._reconcile_catalogue()
        result=json.loads(self.responses[-1][1])
        self.assertTrue(result['changed'])
        self.assertEqual(result['new_albums'],0)
        self.assertEqual(list(enqueue.call_args.args[1]),['new-cover'])

    def test_first_observed_snapshot_does_not_bulk_index_entire_library(self):
        rows=[{'id':i,'artist':'Artist','album':str(i),'artwork_track_id':str(i)}
              for i in range(1000)]
        self.handler.runtime_config={'lms_url':self.handler.lms_url}
        with patch.object(self.handler,'_catalogue_pages',return_value=iter([rows])):
            with patch.object(server.COLOUR_INDEXER,'enqueue') as enqueue:
                self.handler.path='/api/catalogue/reconcile'
                self.handler._reconcile_catalogue()
        data=json.loads(self.responses[-1][1])
        self.assertTrue(data['changed'])
        self.assertEqual(data['count'],1000)
        enqueue.assert_not_called()

    def test_observed_scan_detects_updates_when_catalogue_loaded_from_disk(self):
        old=[{'id':1,'artist':'A','album':'Album','artwork_track_id':'a'}]
        self.handler.runtime_config={'lms_url':self.handler.lms_url}
        with patch.object(self.handler,'_catalogue_pages',return_value=iter([old])):
            self.handler.path='/api/catalogue?order=album'
            self.handler._serve_catalogue()
        server._CATALOGUE_MEMORY.pop(self.handler._catalogue_snapshot_key(),None)
        with patch.object(self.handler,'_catalogue_pages',return_value=iter([old])):
            with patch.object(server.COLOUR_INDEXER,'enqueue') as enqueue:
                self.handler._reconcile_catalogue()
        self.assertFalse(json.loads(self.responses[-1][1])['changed'])
        enqueue.assert_not_called()

    def test_failed_observed_scan_keeps_original_snapshot(self):
        original=[{'id':10,'artist':'A','album':'Keep','artwork_track_id':'a'}]
        with patch.object(self.handler,'_catalogue_pages',return_value=iter([original])):
            self.handler.path='/api/catalogue'
            self.handler._serve_catalogue()
        snapshot_bytes=self.handler._catalogue_snapshot_path().read_bytes()
        key=self.handler._catalogue_snapshot_key()
        old=server._CATALOGUE_MEMORY[key]
        with patch.object(self.handler,'_catalogue_pages',side_effect=OSError('LMS unreachable')):
            with patch.object(self.handler,'_send_upstream_error') as fail:
                with patch.object(server.COLOUR_INDEXER,'enqueue') as enqueue:
                    self.handler._reconcile_catalogue()
        fail.assert_called_once()
        enqueue.assert_not_called()
        self.assertIs(server._CATALOGUE_MEMORY[key],old)
        self.assertEqual(self.handler._catalogue_snapshot_path().read_bytes(),snapshot_bytes)

    def test_background_indexer_can_restart_after_cancellation_for_same_lms(self):
        indexer=server.CarouselColourIndexer()
        # Ensure the old worker never reaches artwork I/O before cancellation.
        indexer.last_foreground=server.time.monotonic()+10
        metadata={'spine_color':'#00ff00','text_color':'#111417',
                  'spine_font':server.SPINE_FONTS[0],
                  'colour_index':server.colour_sort_index('#00ff00')}
        with patch.object(server.LyrionCarouselHandler,'_artwork_metadata',return_value=metadata) as analyse:
            with patch.object(server.LyrionCarouselHandler,'_remember_catalogue_colours',return_value=1):
                indexer.enqueue(self.handler,['stale'])
                indexer.stop()
                indexer.last_foreground=float('-inf')
                indexer.enqueue(self.handler,['current'])
                active_thread=indexer.thread
                active_thread.join(timeout=3)
        self.assertFalse(active_thread.is_alive())
        self.assertEqual(indexer.snapshot()['status'],'complete')
        self.assertEqual(indexer.snapshot()['completed'],1)
        self.assertEqual([call.args[0] for call in analyse.call_args_list],['current'])

    def test_background_indexer_resumes_after_finishing_previous_queue(self):
        indexer=server.CarouselColourIndexer()
        indexer.last_foreground=float('-inf')
        metadata={'spine_color':'#ff0000','text_color':'#111417',
                  'spine_font':server.SPINE_FONTS[0],
                  'colour_index':server.colour_sort_index('#ff0000')}
        with patch.object(server.LyrionCarouselHandler,'_artwork_metadata',return_value=metadata) as analyse:
            with patch.object(server.LyrionCarouselHandler,'_remember_catalogue_colours',return_value=1):
                indexer.enqueue(self.handler,['first'])
                first=indexer.thread
                first.join(timeout=3)
                self.assertFalse(first.is_alive())
                indexer.enqueue(self.handler,['second'])
                second=indexer.thread
                second.join(timeout=3)
                self.assertFalse(second.is_alive())
        self.assertIsNot(first,second)
        self.assertEqual(indexer.snapshot()['completed'],2)
        self.assertEqual([call.args[0] for call in analyse.call_args_list],['first','second'])

    def test_colour_indexer_runs_independently_and_processes_new_artwork(self):
        indexer=server.CarouselColourIndexer()
        indexer.last_foreground=float('-inf')
        colour='#00ff00'
        metadata={'spine_color':colour,'text_color':'#111417',
                  'spine_font':server.SPINE_FONTS[0],
                  'colour_index':server.colour_sort_index(colour)}
        with patch.object(server.LyrionCarouselHandler,'_artwork_metadata',return_value=metadata) as analyse:
            with patch.object(server.LyrionCarouselHandler,'_remember_catalogue_colours',return_value=1) as save:
                indexer.enqueue(self.handler,['new','new','../invalid'])
                active_thread=indexer.thread
                active_thread.join(timeout=3)
        self.assertFalse(active_thread.is_alive())
        self.assertEqual(indexer.snapshot()['completed'],1)
        self.assertEqual(indexer.snapshot()['failed'],0)
        self.assertEqual(indexer.snapshot()['status'],'complete')
        analyse.assert_called_once_with('new')
        save.assert_called_once_with({'new':metadata})

    def test_serialized_order_cache_evicts_by_bytes_and_lru(self):
        from collections import OrderedDict
        orders=OrderedDict()
        with patch.object(server,'CATALOGUE_SORT_CACHE_MAX_BYTES',10):
            self.assertTrue(server.remember_catalogue_order(orders,('artistAlbum',()),b'123456'))
            self.assertTrue(server.remember_catalogue_order(orders,('album',()),b'abcdef'))
            self.assertNotIn(('artistAlbum',()),orders)
            self.assertEqual(list(orders),[('album',())])
            self.assertTrue(server.remember_catalogue_order(orders,('colour',()),b'123'))
            self.assertEqual(sum(map(len,orders.values())),9)
            self.assertFalse(server.remember_catalogue_order(orders,('huge',()),b'12345678901'))
            self.assertNotIn(('huge',()),orders)
            self.assertEqual(sum(map(len,orders.values())),9)
            # Updating an existing key must not leave its old size counted.
            self.assertTrue(server.remember_catalogue_order(orders,('album',()),b'12'))
            self.assertEqual(sum(map(len,orders.values())),5)
            self.assertEqual(list(orders),[('colour',()),('album',())])

    def test_serialized_order_cache_respects_entry_limit(self):
        from collections import OrderedDict
        orders=OrderedDict()
        with patch.object(server,'CATALOGUE_SORT_CACHE_MAX_BYTES',1024):
            for index in range(server.CATALOGUE_SORT_CACHE_ENTRIES+2):
                self.assertTrue(server.remember_catalogue_order(
                    orders,('order',index),b'data'))
        self.assertEqual(len(orders),server.CATALOGUE_SORT_CACHE_ENTRIES)
        self.assertNotIn(('order',0),orders)
        self.assertNotIn(('order',1),orders)

    def test_oversized_catalogue_order_is_served_but_not_cached(self):
        rows=[{'id':1,'artist':'Artist','album':'Long Album Title'}]
        with patch.object(server,'CATALOGUE_SORT_CACHE_MAX_BYTES',16):
            with patch.object(self.handler,'_catalogue_pages',return_value=iter([rows])):
                self.handler.path='/api/catalogue?order=artistAlbum'
                self.handler._serve_catalogue()
            response=json.loads(self.responses[-1][1])
            self.assertEqual(response['count'],1)
            snapshot=server._CATALOGUE_MEMORY[self.handler._catalogue_snapshot_key()]
            self.assertFalse(snapshot['orders'])

    def test_catalogue_snapshot_reuses_one_lms_scan_across_sort_orders(self):
        pages=[[{'id':1,'artist':'Zebra','album':'Alpha','artwork_track_id':'a'},
                {'id':2,'artist':'Alpha','album':'Zulu','artwork_track_id':'b'}]]
        calls=[]
        def fetch_pages(genre_id=None):
            calls.append(genre_id)
            return iter(pages)
        with patch.object(self.handler,'_catalogue_pages',side_effect=fetch_pages):
            self.handler.path='/api/catalogue?order=artistAlbum'
            self.handler._serve_catalogue()
            self.handler.path='/api/catalogue?order=album'
            self.handler._serve_catalogue()
            self.handler.path='/api/catalogue?order=artistAlbum'
            self.handler._serve_catalogue()
        self.assertEqual(calls,[None])
        self.assertEqual([a['id'] for a in json.loads(self.responses[0][1])['albums_loop']],[2,1])
        self.assertEqual([a['id'] for a in json.loads(self.responses[1][1])['albums_loop']],[1,2])
        self.assertEqual(self.responses[0][1],self.responses[2][1])
        self.assertTrue(self.handler._catalogue_snapshot_path().exists())

    def test_snapshot_survives_memory_reset_and_recovers_when_invalidated(self):
        pages=[[{'id':1,'artist':'Z','album':'First'}]]
        with patch.object(self.handler,'_catalogue_pages',return_value=iter(pages)) as upstream:
            self.handler.path='/api/catalogue?order=album'
            self.handler._serve_catalogue()
        upstream.assert_called_once()
        key=self.handler._catalogue_snapshot_key()
        server._CATALOGUE_MEMORY.pop(key,None)
        with patch.object(self.handler,'_catalogue_pages',side_effect=AssertionError('Unexpected LMS scan')):
            self.handler._serve_catalogue()
        self.assertEqual(json.loads(self.responses[-1][1])['albums_loop'][0]['album'],'First')
        self.handler._invalidate_catalogue_data()
        self.assertFalse(self.handler._catalogue_snapshot_path().exists())
        newer=[[{'id':2,'artist':'A','album':'New Album'}]]
        with patch.object(self.handler,'_catalogue_pages',return_value=iter(newer)):
            self.handler._serve_catalogue()
        self.assertEqual(json.loads(self.responses[-1][1])['albums_loop'][0]['id'],2)

    def test_excluded_genres_are_indexed_once_and_persisted(self):
        albums=[{'id':i,'artist':'Artist','album':str(i)} for i in (1,2,3,4)]
        calls=[]
        def pages(genre_id=None):
            calls.append(genre_id)
            if genre_id is None:return iter([albums])
            if genre_id==7:return iter([[albums[1],albums[2]]])
            if genre_id==9:return iter([[albums[2]]])
            raise AssertionError('unexpected genre request')
        with patch.object(self.handler,'_catalogue_pages',side_effect=pages):
            self.handler.path='/api/catalogue?order=album&exclude_genre_id=7'
            self.handler._serve_catalogue()
            self.assertEqual([a['id'] for a in json.loads(self.responses[-1][1])['albums_loop']],[1,4])
            self.handler.path='/api/catalogue?order=artistAlbum&exclude_genre_id=7&exclude_genre_id=9'
            self.handler._serve_catalogue()
        self.assertEqual(calls,[None,7,9])
        server._CATALOGUE_MEMORY.pop(self.handler._catalogue_snapshot_key(),None)
        with patch.object(self.handler,'_catalogue_pages',side_effect=AssertionError('Unexpected genre rescan')):
            self.handler._serve_catalogue()
        self.assertEqual([a['id'] for a in json.loads(self.responses[-1][1])['albums_loop']],[1,4])

    def test_corrupt_saved_catalogue_falls_back_to_lms(self):
        path=self.handler._catalogue_snapshot_path()
        path.write_bytes(b'not-json')
        pages=[[{'id':5,'artist':'A','album':'Recovered'}]]
        with patch.object(self.handler,'_catalogue_pages',return_value=iter(pages)):
            self.handler.path='/api/catalogue?order=album'
            self.handler._serve_catalogue()
        self.assertEqual(json.loads(self.responses[-1][1])['albums_loop'][0]['id'],5)
        self.assertEqual(json.loads(path.read_bytes())['version'],server.CATALOGUE_SNAPSHOT_VERSION)

    def test_invalidation_endpoint_and_cache_clear_drop_snapshots(self):
        path=self.handler._catalogue_snapshot_path()
        pages=[[{'id':1,'artist':'A','album':'Example'}]]
        with patch.object(self.handler,'_catalogue_pages',return_value=iter(pages)):
            self.handler.path='/api/catalogue'
            self.handler._serve_catalogue()
        self.assertTrue(path.exists())
        self.handler.path='/api/catalogue/invalidate'
        self.handler.do_POST()
        self.assertEqual(json.loads(self.responses[-1][1]),{'invalidated':True})
        self.assertFalse(path.exists())
        with patch.object(self.handler,'_catalogue_pages',return_value=iter(pages)):
            self.handler._serve_catalogue()
        self.handler._clear_cache_files()
        self.assertFalse(path.exists())
        self.assertNotIn(self.handler._catalogue_snapshot_key(),server._CATALOGUE_MEMORY)

    def test_snapshot_status_does_not_scan_lms(self):
        self.handler.path='/api/catalogue/status'
        self.handler._serve_catalogue_status()
        self.assertEqual(json.loads(self.responses[-1][1])['source'],'none')
        pages=[[{'id':1,'artist':'Artist','album':'Example'}]]
        with patch.object(self.handler,'_catalogue_pages',return_value=iter(pages)):
            self.handler.path='/api/catalogue'
            self.handler._serve_catalogue()
        self.handler._serve_catalogue_status()
        status=json.loads(self.responses[-1][1])
        self.assertTrue(status['cached'])
        self.assertEqual(status['albums'],1)
        self.assertEqual(status['source'],'memory')

    def test_expired_snapshot_refreshes_instead_of_using_old_disk_data(self):
        first=[[{'id':1,'artist':'A','album':'Expired'}]]
        with patch.object(self.handler,'_catalogue_pages',return_value=iter(first)):
            self.handler.path='/api/catalogue'
            self.handler._serve_catalogue()
        snapshot=server._CATALOGUE_MEMORY[self.handler._catalogue_snapshot_key()]
        snapshot['created']=server.time.time()-server.CATALOGUE_SNAPSHOT_TTL_SECONDS-30
        self.handler._save_catalogue_snapshot(snapshot)
        replacement=[[{'id':2,'artist':'B','album':'Fresh'}]]
        with patch.object(self.handler,'_catalogue_pages',return_value=iter(replacement)) as remote:
            self.handler._serve_catalogue()
        remote.assert_called_once()
        self.assertEqual(json.loads(self.responses[-1][1])['albums_loop'][0]['album'],'Fresh')

    def test_large_catalogue_sorting_does_not_rescan_upstream(self):
        rows=[{'id':i,'artist':f'Artist {i%79:03d}','album':f'Album {10000-i:05d}'}
              for i in range(10000)]
        calls=[]
        def pages(genre_id=None):
            calls.append(genre_id)
            for start in range(0,len(rows),200):yield rows[start:start+200]
        with patch.object(self.handler,'_catalogue_pages',side_effect=pages):
            self.handler.path='/api/catalogue?order=artistAlbum'
            self.handler._serve_catalogue()
            self.handler.path='/api/catalogue?order=album'
            self.handler._serve_catalogue()
        self.assertEqual(calls,[None])
        self.assertEqual(json.loads(self.responses[-1][1])['count'],10000)
        self.assertEqual(len(json.loads(self.responses[-1][1])['albums_loop']),10000)

    def test_new_metadata_is_stable_and_persisted(self):
        fonts = set()
        for i in range(20):
            artwork_id = str(i)
            image_path, meta_path = self.paths(artwork_id)
            Image.new('RGB', (8, 8), 'red').save(image_path, format='PNG')
            self.handler._serve_artwork_meta(artwork_id)
            status, body = self.responses[-1]
            data = json.loads(body)
            self.assertEqual(status, 200)
            self.assertEqual(data['spine_color'], '#ff0000')
            self.assertEqual(data['colour_index'], server.colour_sort_index('#ff0000'))
            self.assertIn(data['spine_font'], server.SPINE_FONTS)
            self.assertEqual(data, json.loads(meta_path.read_bytes()))
            self.handler._serve_artwork_meta(artwork_id)
            self.assertEqual(body, self.responses[-1][1])
            fonts.add(data['spine_font'])
        self.assertEqual(len(fonts), len(server.SPINE_FONTS))

    def test_old_metadata_upgrades_without_artwork(self):
        _, meta_path = self.paths('legacy')
        meta_path.write_text('{"spine_color":"#abcdef","text_color":"#111417"}')
        self.handler._serve_artwork_meta('legacy')
        status, body = self.responses[-1]
        self.assertEqual(status, 200)
        data = json.loads(body)
        self.assertEqual(data['spine_color'], '#abcdef')
        self.assertIn(data['spine_font'], server.SPINE_FONTS)
        self.assertEqual(data, json.loads(meta_path.read_bytes()))

    def test_colour_sqlite_connections_are_closed_on_success_and_errors(self):
        """sqlite3's transaction context does not close connections in Python 3.13."""
        colour='#00ff00'
        details={'spine_color':colour,'text_color':'#111417',
                 'spine_font':server.SPINE_FONTS[0],
                 'colour_index':server.colour_sort_index(colour)}
        original_connect=sqlite3.connect
        connections=[]

        class TrackingConnection(sqlite3.Connection):
            was_closed=False

            def close(self):
                self.was_closed=True
                return super().close()

        def tracked_connect(*args,**kwargs):
            kwargs['factory']=TrackingConnection
            db=original_connect(*args,**kwargs)
            connections.append(db)
            return db

        with patch.object(server.sqlite3,'connect',side_effect=tracked_connect):
            self.handler._save_colour_index({'a':details})
            self.assertEqual(self.handler._load_colour_index(),{'a':details})
            self.assertEqual(self.handler._colour_index_count(),1)
            path=self.handler._colour_index_path()
            path.write_bytes(b'not a sqlite database')
            self.assertEqual(self.handler._load_colour_index(),{})
            self.assertEqual(self.handler._colour_index_count(),0)

        self.assertGreaterEqual(len(connections),5)
        self.assertTrue(all(db.was_closed for db in connections),
                        'Every SQLite connection must be explicitly closed')

    def test_spine_metadata_post_populates_persistent_colour_index(self):
        colour='#ff00ff'
        meta={'spine_color':colour,'text_color':'#f5f2ea',
              'spine_font':server.SPINE_FONTS[0],
              'colour_index':server.colour_sort_index(colour)}
        body=json.dumps({'artwork_ids':['first','first','missing']}).encode()
        self.handler.headers={'Content-Length':str(len(body))}
        self.handler.rfile=io.BytesIO(body)
        with patch.object(self.handler,'_artwork_metadata',
                          side_effect=lambda key: meta if key=='first' else None):
            self.handler._serve_metadata_batch()
        self.assertEqual(self.handler._colour_index_count(),1)
        self.assertEqual(self.handler._load_colour_index(),{'first':meta})
        payload=json.loads(self.responses[-1][1])
        self.assertEqual(payload['metadata']['first'],meta)
        self.assertIsNone(payload['metadata']['missing'])

    def test_damaged_colour_database_falls_back_to_metadata_files(self):
        path=self.handler._colour_index_path()
        path.write_bytes(b'not SQLite data')
        self.assertEqual(self.handler._load_colour_index(),{})
        self.assertEqual(self.handler._colour_index_count(),0)
        rows=[[{'id':1,'artist':'A','album':'Album','artwork_track_id':'art'}]]
        colour='#ffff00'
        meta={'spine_color':colour,'text_color':'#111417',
              'spine_font':server.SPINE_FONTS[0],
              'colour_index':server.colour_sort_index(colour)}
        with patch.object(self.handler,'_catalogue_pages',return_value=iter(rows)):
            self.handler.path='/api/catalogue?order=colour'
            with patch.object(self.handler,'_artwork_metadata',return_value=meta):
                self.handler._serve_catalogue()
        self.assertEqual(json.loads(self.responses[-1][1])['count'],1)

    def test_colour_sort_reuses_index_and_only_computes_missing_spines(self):
        albums=[[{'id':1,'artist':'A','album':'Red','artwork_track_id':'red'},
                 {'id':2,'artist':'B','album':'Green','artwork_track_id':'green'},
                 {'id':3,'artist':'C','album':'Blue','artwork_track_id':'blue'}]]
        def metadata(colour):
            return {'spine_color':colour,'text_color':'#f5f2ea',
                    'spine_font':server.SPINE_FONTS[0],
                    'colour_index':server.colour_sort_index(colour)}
        values={'red':metadata('#ff0000'),'green':metadata('#00ff00'),
                'blue':metadata('#0000ff')}
        with patch.object(self.handler,'_catalogue_pages',return_value=iter(albums)):
            self.handler.path='/api/catalogue?order=artistAlbum'
            self.handler._serve_catalogue()
        self.assertEqual(self.handler._remember_catalogue_colours({'red':values['red']}),1)
        with patch.object(self.handler,'_artwork_metadata',side_effect=lambda key: values[key]) as compute:
            self.handler.path='/api/catalogue?order=colour'
            self.handler._serve_catalogue()
        self.assertEqual(compute.call_count,2)
        self.assertEqual({call.args[0] for call in compute.call_args_list},{'green','blue'})
        self.assertEqual([a['id'] for a in json.loads(self.responses[-1][1])['albums_loop']],[1,2,3])
        self.assertEqual(self.handler._load_colour_index(),values)
        # Memory cleared to emulate service restart; SQLite is authoritative.
        server._CATALOGUE_MEMORY.pop(self.handler._catalogue_snapshot_key(),None)
        with patch.object(self.handler,'_artwork_metadata',side_effect=AssertionError('Recomputed indexed colour')):
            self.handler._serve_catalogue()
        self.assertEqual(json.loads(self.responses[-1][1])['count'],3)
        self.handler._serve_catalogue_status()
        self.assertEqual(json.loads(self.responses[-1][1])['colour_indexes'],3)

    def test_colour_batch_persists_without_rewriting_large_catalogue(self):
        rows=[[{'id':i,'artist':'A','album':str(i),'artwork_track_id':str(i)}
               for i in range(1000)]]
        with patch.object(self.handler,'_catalogue_pages',return_value=iter(rows)):
            self.handler.path='/api/catalogue?order=album'
            self.handler._serve_catalogue()
        catalogue_path=self.handler._catalogue_snapshot_path()
        original=catalogue_path.read_bytes()
        def metadata():
            color='#888888'
            return {'spine_color':color,'text_color':'#f5f2ea',
                    'spine_font':server.SPINE_FONTS[0],
                    'colour_index':server.colour_sort_index(color)}
        first={str(i):metadata() for i in range(100)}
        second={str(i):metadata() for i in range(100,200)}
        self.assertEqual(self.handler._remember_catalogue_colours(first),100)
        self.assertEqual(self.handler._remember_catalogue_colours(second),100)
        self.assertEqual(catalogue_path.read_bytes(),original)
        self.assertEqual(self.handler._colour_index_count(),200)
        server._CATALOGUE_MEMORY.pop(self.handler._catalogue_snapshot_key(),None)
        with patch.object(self.handler,'_catalogue_pages',side_effect=AssertionError('Unnecessary LMS scan')):
            snapshot=self.handler._load_catalogue_snapshot()
        self.assertEqual(len(snapshot['colours']),200)
        self.assertEqual(len(snapshot['albums']),1000)

    def test_colour_metadata_change_invalidates_prepared_colour_order(self):
        albums=[[{'id':1,'artist':'A','album':'One','artwork_track_id':'one'},
                 {'id':2,'artist':'B','album':'Two','artwork_track_id':'two'}]]
        def metadata(colour):
            return {'spine_color':colour,'text_color':'#111417',
                    'spine_font':server.SPINE_FONTS[0],
                    'colour_index':server.colour_sort_index(colour)}
        with patch.object(self.handler,'_catalogue_pages',return_value=iter(albums)):
            self.handler.path='/api/catalogue?order=artistAlbum'
            self.handler._serve_catalogue()
        self.handler._remember_catalogue_colours({'one':metadata('#ff0000'),
                                                  'two':metadata('#0000ff')})
        self.handler.path='/api/catalogue?order=colour'
        with patch.object(self.handler,'_artwork_metadata',side_effect=AssertionError('All colours indexed')):
            self.handler._serve_catalogue()
            self.assertEqual([a['id'] for a in json.loads(self.responses[-1][1])['albums_loop']],[1,2])
            self.handler._remember_catalogue_colours({'one':metadata('#00ffff')})
            self.handler._remember_catalogue_colours({'two':metadata('#ff0000')})
            self.handler._serve_catalogue()
            self.assertEqual([a['id'] for a in json.loads(self.responses[-1][1])['albums_loop']],[2,1])

    def test_invalid_colour_metadata_is_not_indexed(self):
        rows=[[{'id':1,'artist':'A','album':'First','artwork_track_id':'x'}]]
        with patch.object(self.handler,'_catalogue_pages',return_value=iter(rows)):
            self.handler.path='/api/catalogue?order=artistAlbum'
            self.handler._serve_catalogue()
        bogus={'spine_color':'#ff0000','text_color':'#ffffff',
               'spine_font':server.SPINE_FONTS[0],'colour_index':-1}
        self.assertEqual(self.handler._remember_catalogue_colours({'x':bogus}),0)
        cache=server._CATALOGUE_MEMORY[self.handler._catalogue_snapshot_key()]
        self.assertFalse(cache['colours'])
        self.assertEqual(self.handler._colour_index_count(),0)
        self.assertFalse(server.valid_colour_metadata(bogus))

    def test_colour_index_orders_rainbow_then_neutrals(self):
        colours = ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#000000', '#888888', '#ffffff']
        indexes = [server.colour_sort_index(colour) for colour in colours]
        self.assertEqual(indexes, sorted(set(indexes)))

    def test_font_cache_gains_colour_index_without_artwork(self):
        _, meta_path = self.paths('font-cache')
        meta_path.write_text(json.dumps({'spine_color': '#00ff00', 'text_color': '#111417', 'spine_font': server.SPINE_FONTS[0]}))
        self.handler._serve_artwork_meta('font-cache')
        data = json.loads(self.responses[-1][1])
        self.assertEqual(data['colour_index'], server.colour_sort_index('#00ff00'))
        self.assertEqual(data, json.loads(meta_path.read_bytes()))

    def test_cold_cache_and_corrupt_metadata_recover(self):
        with patch.object(server, 'urlopen', side_effect=OSError('Unavailable')):
            self.handler._serve_artwork_meta('cold')
        self.assertEqual(self.responses[-1][0], 404)
        image_path, meta_path = self.paths('cold')
        Image.new('RGB', (8, 8), 'white').save(image_path, format='PNG')
        meta_path.write_text('broken')
        self.handler._serve_artwork_meta('cold')
        self.assertEqual(self.responses[-1][0], 200)
        metadata=json.loads(self.responses[-1][1])
        self.assertEqual(metadata['text_style_version'],server.SPINE_TEXT_STYLE_VERSION)
        self.assertGreaterEqual(server.spine_contrast_ratio(
            metadata['text_color'],metadata['spine_color']),4.5)

    def test_cold_metadata_fetches_artwork_once_and_returns_only_metadata(self):
        from email.message import Message
        image = io.BytesIO()
        Image.new('RGB', (64, 64), 'blue').save(image, format='PNG')
        artwork = image.getvalue()
        response = io.BytesIO(artwork)
        response.headers = Message()
        response.headers['Content-Type'] = 'image/png'
        with patch.object(server, 'urlopen', return_value=response) as upstream:
            self.handler._serve_artwork_meta('new')
            self.handler._serve_artwork_meta('new')
        self.assertEqual(upstream.call_count, 1)
        self.assertEqual(len(self.responses), 2)
        self.assertTrue(all(status == 200 for status, _ in self.responses))
        self.assertEqual(json.loads(self.responses[-1][1])['spine_color'], '#0000ff')
        self.assertEqual(self.paths('new')[0].read_bytes(), artwork)

    def test_metadata_batch_deduplicates_ids_and_keeps_missing_results(self):
        body=json.dumps({'artwork_ids':['one','two','one']}).encode()
        self.handler.headers={'Content-Length':str(len(body))}
        self.handler.rfile=io.BytesIO(body)
        with patch.object(self.handler, '_artwork_metadata', side_effect=lambda i: {'colour_index':123} if i=='one' else None) as calculate:
            self.handler._serve_metadata_batch()
        self.assertEqual(calculate.call_count, 2)
        self.assertEqual(json.loads(self.responses[-1][1]), {'metadata':{'one':{'colour_index':123},'two':None}})

    def test_metadata_batch_rejects_invalid_ids_and_oversized_batches(self):
        for ids in [['../bad'], ['one']*65, [None]]:
            body=json.dumps({'artwork_ids':ids}).encode()
            self.handler.headers={'Content-Length':str(len(body))}
            self.handler.rfile=io.BytesIO(body)
            with patch.object(self.handler, 'send_error') as error:
                self.handler._serve_metadata_batch()
                self.assertEqual(error.call_args.args[0],400)

    def test_resized_cover_is_cached_and_preserves_aspect(self):
        image_path,_=self.paths('resize')
        Image.new('RGB',(800,400),'red').save(image_path,format='PNG')
        self.handler._serve_sized_artwork('resize',256)
        status,body=self.responses[-1]
        self.assertEqual(status,200)
        self.assertEqual(Image.open(io.BytesIO(body)).size,(256,128))
        with patch.object(self.handler,'_ensure_artwork',side_effect=AssertionError('Cache should be reused')):
            self.handler._serve_sized_artwork('resize',256)
        self.assertEqual(body,self.responses[-1][1])

    def test_realistic_case_preserves_booklet_and_caches_separately(self):
        image_path,_=self.paths('case')
        Image.new('RGB',(600,600),(230,40,30)).save(image_path,format='PNG')
        self.handler._serve_sized_artwork('case',512,case=True)
        status,body=self.responses[-1]
        image=Image.open(io.BytesIO(body))
        self.assertEqual(status,200)
        self.assertEqual(image.mode,'RGBA')
        self.assertEqual(image.width,512)
        self.assertEqual(image.getpixel((280,220)),(230,40,30,255))
        self.assertLess(image.getchannel('A').getextrema()[0],255)
        with patch.object(self.handler,'_ensure_artwork',side_effect=AssertionError('Reuse cached composition')):
            self.handler._serve_sized_artwork('case',512,case=True)
        self.assertEqual(body,self.responses[-1][1])
        self.handler._serve_sized_artwork('case',512)
        self.assertEqual(Image.open(io.BytesIO(self.responses[-1][1])).format,'JPEG')

    def test_server_catalogue_ordering(self):
        albums=[{'id':1,'album':'Z','artist':'A','artwork_track_id':1},{'id':2,'album':'A','artist':'Z','artwork_track_id':2}]
        for mode,expected in [('artistAlbum',[1,2]),('album',[2,1]),('colour',[2,1])]:
            self.handler.path='/api/catalogue?order='+mode
            response=io.BytesIO(json.dumps({'result':{'count':2,'albums_loop':albums}}).encode())
            response.headers={}
            with patch.object(server,'urlopen',return_value=response),patch.object(self.handler,'_artwork_metadata',side_effect=lambda i:{'colour_index':3-int(i)}):
                self.handler._serve_catalogue()
            self.assertEqual([a['id'] for a in json.loads(self.responses[-1][1])['albums_loop']],expected)

    def test_server_catalogue_excludes_requested_genres(self):
        albums=[{'id':1,'album':'Keep','artist':'A'},{'id':2,'album':'Hide','artist':'B'}]
        self.handler.path='/api/catalogue?order=artistAlbum&exclude_genre_id=7'
        with patch.object(self.handler,'_catalogue_pages',side_effect=lambda genre_id=None: iter([albums if genre_id is None else [{'id':2}]])):
            self.handler._serve_catalogue()
        result=json.loads(self.responses[-1][1])
        self.assertEqual(result['count'],1)
        self.assertEqual([album['id'] for album in result['albums_loop']],[1])

    def test_background_warming_deduplicates_and_reports_progress(self):
        warmer=server.ArtworkWarmer()
        with patch.object(self.handler,'_catalogue_pages',return_value=iter([[{'artwork_track_id':1},{'artwork_track_id':1},{'artwork_track_id':2}]])),patch.object(self.handler,'_ensure_artwork'),patch.object(self.handler,'_artwork_metadata',return_value={'colour_index':1}),patch.object(self.handler,'_prepare_sized_artwork') as prepare:
            warmer.run(self.handler,256)
        self.assertEqual(prepare.call_count,2)
        self.assertEqual(warmer.snapshot(),{'status':'complete','completed':2,'total':2,'failed':0})

    def test_background_warming_cancels_and_stops_at_capacity(self):
        for cancel in (False,True):
            warmer=server.ArtworkWarmer()
            if cancel: warmer.stop()
            with patch.object(self.handler,'_catalogue_pages',return_value=iter([[{'artwork_track_id':1}]])),patch.object(self.handler,'_ensure_artwork',side_effect=server.CacheFull()),patch.object(self.handler,'_prepare_sized_artwork') as prepare:
                warmer.run(self.handler,512)
            self.assertEqual(warmer.snapshot()['status'],'cancelled' if cancel else 'cache_full')
            prepare.assert_not_called()

    def test_background_write_does_not_evict_existing_cache(self):
        self.handler.background_warming=True
        image_path,_=self.paths('existing')
        image_path.write_bytes(b'12345')
        new_path,_=self.paths('new')
        with patch.object(server,'MAX_ARTWORK_CACHE_BYTES',6):
            with self.assertRaises(server.CacheFull):
                self.handler._store_artwork(new_path,new_path.with_suffix('.type'),b'123','image/png')
        self.assertEqual(image_path.read_bytes(),b'12345')
        self.assertFalse(new_path.exists())

    def test_cache_usage_counts_images_and_metadata_separately(self):
        image_path,meta_path=self.paths('usage')
        image_path.write_bytes(b'12345')
        meta_path.write_bytes(b'{}')
        image_path.with_suffix('.type').write_bytes(b'png')
        (self.handler.cache_dir/'unfinished.tmp').write_bytes(b'ignored')
        usage=self.handler._cache_usage()
        self.assertEqual(usage,{'image_bytes':5,'metadata_bytes':5,'total_bytes':10,'files':3,'limit_bytes':server.MAX_ARTWORK_CACHE_BYTES})
        image_path.unlink()
        self.assertEqual(self.handler._cache_usage()['image_bytes'],0)

    def test_client_cache_limit_cannot_exceed_server_hard_limit(self):
        self.handler.runtime_config={'cache_limit_bytes':5,'cache_hard_limit_bytes':10}
        body=json.dumps({'cache_limit_bytes':7}).encode()
        self.handler.headers={'Content-Length':str(len(body))}
        self.handler.rfile=io.BytesIO(body)
        with patch.object(self.handler,'_prune_artwork_cache') as prune:
            self.handler._update_cache_limit()
        self.assertEqual(self.handler.runtime_config['cache_limit_bytes'],7)
        self.assertEqual(json.loads(self.responses[-1][1])['cache_hard_limit_bytes'],10)
        prune.assert_called_once()

        body=json.dumps({'cache_limit_bytes':11}).encode()
        self.handler.headers={'Content-Length':str(len(body))}
        self.handler.rfile=io.BytesIO(body)
        with patch.object(self.handler,'send_error') as error:
            self.handler._update_cache_limit()
        self.assertEqual(error.call_args.args[0],400)
        self.assertEqual(self.handler.runtime_config['cache_limit_bytes'],7)

    def test_cache_is_partitioned_by_lms(self):
        first = self.paths('same-id')
        self.handler.lms_url = 'http://different:9000'
        self.assertNotEqual(first, self.paths('same-id'))

    def test_pruning_removes_metadata_and_content_type(self):
        image_path, meta_path = self.paths('prune')
        image_path.write_bytes(b'12345')
        image_path.with_suffix('.type').write_text('image/png')
        meta_path.write_text('{}')
        with patch.object(server, 'MAX_ARTWORK_CACHE_BYTES', 1):
            self.handler._prune_artwork_cache()
        self.assertFalse(image_path.exists())
        self.assertFalse(meta_path.exists())
        self.assertFalse(image_path.with_suffix('.type').exists())

    def test_incremental_cache_bytes_and_overwrite(self):
        image_path, _ = self.paths('accounting')
        self.handler._store_artwork(image_path, image_path.with_suffix('.type'), b'12345', 'image/png')
        self.assertEqual(self.handler._cache_image_bytes(), 5)
        self.handler._store_artwork(image_path, image_path.with_suffix('.type'), b'12', 'image/png')
        self.assertEqual(self.handler._cache_image_bytes(), 2)
        image2, _ = self.paths('accounting-two')
        self.handler._store_artwork(image2, image2.with_suffix('.type'), b'1234', 'image/png')
        self.assertEqual(self.handler._cache_image_bytes(), 6)
        # Under budget, pruning must never enumerate the on-disk cache.
        with patch.object(Path, 'glob', side_effect=AssertionError('Unexpected cache scan')):
            self.handler._prune_artwork_cache(force=False)
        self.assertTrue(image_path.exists())
        self.assertTrue(image2.exists())

    def test_incremental_counter_prunes_on_budget_and_reconciles(self):
        first, _ = self.paths('prune-first')
        second, _ = self.paths('prune-second')
        self.handler._store_artwork(first, first.with_suffix('.type'), b'12345', 'image/png')
        self.handler._store_artwork(second, second.with_suffix('.type'), b'12345', 'image/png')
        with patch.object(server, 'MAX_ARTWORK_CACHE_BYTES', 6):
            self.handler._prune_artwork_cache(force=False)
            self.assertLessEqual(self.handler._cache_image_bytes(), 6)
        self.assertEqual(sum(p.stat().st_size for p in self.handler.cache_dir.glob('*.img')),
                         self.handler._cache_image_bytes())

    def test_cache_clear_resets_accounting(self):
        image_path, _ = self.paths('clear-tracked')
        self.handler._store_artwork(image_path, image_path.with_suffix('.type'), b'12345', 'image/png')
        self.assertEqual(self.handler._cache_image_bytes(), 5)
        self.handler._clear_cache_files()
        self.assertFalse(image_path.exists())
        self.assertEqual(self.handler._cache_image_bytes(), 0)

    def test_response_limit_with_and_without_length(self):
        for headers in ({'Content-Length': '11'}, {}, {'Content-Length': 'not-a-number'}):
            response = io.BytesIO(b'x' * 11)
            response.headers = headers
            with self.assertRaises(server.UpstreamPayloadTooLarge):
                self.handler._read_limited(response, 10)
        response = io.BytesIO(b'x' * 10)
        response.headers = {}
        self.assertEqual(self.handler._read_limited(response, 10), b'x' * 10)

    def test_static_files_revalidate_but_artwork_keeps_its_cache_policy(self):
        headers = []
        self.handler.send_header = lambda key, value: headers.append((key, value))
        with patch.object(server.SimpleHTTPRequestHandler, 'end_headers'):
            self.handler.path = '/css/shelf.css'
            self.handler.end_headers()
            self.assertIn(('Cache-Control', 'no-cache'), headers)
            headers.clear()
            self.handler.path = '/api/art/123?server=test'
            self.handler.end_headers()
            self.assertEqual(headers, [])


    def test_spotty_diagnostic_discovers_album_node_dynamically(self):
        calls=[]
        def rpc(player, command):
            calls.append(command)
            if command == ['players',0,100]:
                return {'players_loop':[{'playerid':'p1','name':'Test','connected':1}]}
            if command == ['spotty','items',0,200]:
                return {'items_loop':[{'id':42,'name':'Albums'},{'id':2,'name':'Search'}]}
            if command == ['spotty','items',0,200,'item_id:42']:
                return {'items_loop':[{'id':'a1','name':'Album by Artist'}]}
            raise AssertionError(command)
        with patch.object(self.handler,'_lms_rpc',side_effect=rpc):
            self.handler._serve_spotty_diagnostic()
        payload=json.loads(self.responses[-1][1])
        self.assertTrue(payload['available'])
        self.assertIn(['spotty','items',0,200,'item_id:42'],calls)
        self.assertNotIn(['spotty','items',0,200,'item_id:7'],calls)

    def test_spotty_artwork_metadata_is_cached_from_remote_cover(self):
        image=io.BytesIO()
        Image.new('RGB',(8,8),'red').save(image,format='PNG')
        self.handler.path='/api/spotty-art-meta?path=%2Fimageproxy%2Fcover'
        key='spotty-test'
        with patch.object(self.handler,'_spotty_artwork',return_value=(key,image.getvalue(),'image/png')):
            self.handler._serve_spotty_art_meta()
            first=json.loads(self.responses[-1][1])
            self.handler._serve_spotty_art_meta()
            second=json.loads(self.responses[-1][1])
        self.assertEqual(first['spine_color'],'#ff0000')
        self.assertEqual(first,second)
        self.assertTrue((self.handler.cache_dir/f'{key}.meta').exists())

    def test_malformed_rpc_log_does_not_crash_handler(self):
        with patch('builtins.print'):
            self.handler._log_lms_rpc([])
            self.handler._log_lms_rpc(None)


if __name__ == '__main__':
    unittest.main()
