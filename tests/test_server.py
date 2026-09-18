"""Run with: python3 -m unittest discover -s tests -p 'test_*.py'."""
import hashlib
import io
import json
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
        self.handler.cache_dir = Path(self.temp.name)
        self.handler.lms_url = 'http://test:9000'
        self.responses = []
        self.handler._send_payload = lambda status, body, *args, **kwargs: self.responses.append((status, body))

    def paths(self, artwork_id):
        key = hashlib.sha256(f'{self.handler.lms_url}\0{artwork_id}'.encode()).hexdigest()
        return self.handler.cache_dir / f'{key}.img', self.handler.cache_dir / f'{key}.meta'

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
        self.assertEqual(json.loads(self.responses[-1][1])['text_color'], '#111417')

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

    def test_server_catalogue_ordering(self):
        albums=[{'id':1,'album':'Z','artist':'A','artwork_track_id':1},{'id':2,'album':'A','artist':'Z','artwork_track_id':2}]
        for mode,expected in [('artistAlbum',[1,2]),('album',[2,1]),('colour',[2,1])]:
            self.handler.path='/api/catalogue?order='+mode
            response=io.BytesIO(json.dumps({'result':{'count':2,'albums_loop':albums}}).encode())
            response.headers={}
            with patch.object(server,'urlopen',return_value=response),patch.object(self.handler,'_artwork_metadata',side_effect=lambda i:{'colour_index':3-int(i)}):
                self.handler._serve_catalogue()
            self.assertEqual([a['id'] for a in json.loads(self.responses[-1][1])['albums_loop']],expected)

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

    def test_malformed_rpc_log_does_not_crash_handler(self):
        with patch('builtins.print'):
            self.handler._log_lms_rpc([])
            self.handler._log_lms_rpc(None)


if __name__ == '__main__':
    unittest.main()
