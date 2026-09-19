#!/usr/bin/env python3
"""Serve Lyrion Carousel and proxy its requests to Lyrion Music Server."""
from __future__ import annotations
import io, random, argparse, colorsys, hashlib, json, os, re, shutil, socket, sys, threading
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlsplit, parse_qs
from urllib.request import Request, urlopen
from PIL import Image, ImageStat

METADATA_WORKERS=ThreadPoolExecutor(max_workers=6,thread_name_prefix="album-metadata")
MAX_RPC_BYTES=1_000_000
MAX_UPSTREAM_BYTES=8_000_000
MAX_ARTWORK_BYTES=10_000_000
MAX_ARTWORK_CACHE_BYTES=512_000_000
# Local font stacks keep the controller usable without external font downloads.
SPINE_FONTS=(
    'Arial, "Liberation Sans", sans-serif',
    'Verdana, "DejaVu Sans", sans-serif',
    '"Trebuchet MS", "Liberation Sans", sans-serif',
    'Georgia, "DejaVu Serif", serif',
    '"Palatino Linotype", "Book Antiqua", "Liberation Serif", serif',
)
ARTWORK_ID=re.compile(r"^[A-Za-z0-9._:@%-]+$")
def colour_sort_index(colour:str)->int:
    """Hue runs red through violet; near-neutral colours follow dark to light."""
    red,green,blue=(int(colour[offset:offset+2],16)/255 for offset in (1,3,5))
    hue,saturation,value=colorsys.rgb_to_hsv(red,green,blue)
    hue_band=360 if saturation<.12 else min(359,int(hue*360))
    return hue_band*1_000_000+round(value*1000)*1000+round(saturation*1000)

class UpstreamPayloadTooLarge(Exception):
    pass
def positive_int(value:str)->int:
    parsed=int(value)
    if parsed<1: raise argparse.ArgumentTypeError("must be at least 1")
    return parsed
def non_negative_int(value:str)->int:
    parsed=int(value)
    if parsed<0: raise argparse.ArgumentTypeError("must be zero or greater")
    return parsed

class LyrionCarouselHandler(SimpleHTTPRequestHandler):
    server_version="LyrionCarousel/1.0"
    def __init__(self,*args,directory:str,lms_url:str,cache_dir:Path,runtime_config:dict[str,object],**kwargs):
        self.lms_url=lms_url.rstrip('/'); self.cache_dir=cache_dir; self.runtime_config=runtime_config
        super().__init__(*args,directory=directory,**kwargs)
    def end_headers(self)->None:
        if urlsplit(self.path).path not in {'/api/config','/api/lms','/api/cometd','/api/config/lms','/api/cache/clear'} and not urlsplit(self.path).path.startswith(('/api/art/','/api/art-meta/')):
            self.send_header('Cache-Control','no-cache')
        super().end_headers()
    def do_POST(self)->None:
        path=urlsplit(self.path).path
        if path=='/api/art-meta': self._serve_metadata_batch(); return
        if path=='/api/cache/clear': self._clear_cache(); return
        if path=='/api/config/lms': self._update_lms_url(); return
        if path not in {'/api/lms','/api/cometd'}: self.send_error(404); return
        try: length=int(self.headers.get('Content-Length','0'))
        except ValueError: self.send_error(400,'Invalid Content-Length'); return
        if length<1 or length>MAX_RPC_BYTES: self.send_error(413,'Invalid request size'); return
        body=self.rfile.read(length)
        try: payload=json.loads(body)
        except (UnicodeDecodeError,json.JSONDecodeError): self.send_error(400,'Request body must be JSON'); return
        if path=='/api/cometd':
            self._log_cometd(payload); self._relay(Request(f'{self.lms_url}/cometd',data=body,headers={'Content-Type':'application/json'},method='POST'),70); return
        self._log_lms_rpc(payload); self._relay(Request(f'{self.lms_url}/jsonrpc.js',data=body,headers={'Content-Type':'application/json'},method='POST'))
    def _clear_cache(self)->None:
        removed=0
        try:
            for path in self.cache_dir.rglob('*'):
                if path.is_file() or path.is_symlink(): path.unlink(); removed+=1
            self._send_payload(200,json.dumps({'removed':removed}).encode(),'application/json; charset=utf-8',cache_control='no-store')
        except OSError as error: self._send_upstream_error(error)
    def _update_lms_url(self)->None:
        try:
            length=int(self.headers.get('Content-Length','0'))
            if length<1 or length>MAX_RPC_BYTES: self.send_error(413,'Invalid request size'); return
            payload=json.loads(self.rfile.read(length))
            value=payload.get('lms_url') if isinstance(payload,dict) else None
            lms_url=str(value).strip().rstrip('/')
            parsed=urlsplit(lms_url)
            if parsed.scheme not in {'http','https'} or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment: raise ValueError
            self.runtime_config['lms_url']=lms_url
            self.lms_url=lms_url
            self._send_payload(200,json.dumps({'lms_url':lms_url}).encode(),'application/json; charset=utf-8',cache_control='no-store')
        except (ValueError,TypeError,UnicodeDecodeError,json.JSONDecodeError): self.send_error(400,'Invalid LMS URL')
    def _log_lms_rpc(self,payload:object)->None:
        try:
            params=payload.get('params') if isinstance(payload,dict) else None
            if not isinstance(params,list) or len(params)<2 or not isinstance(params[1],list) or not params[1]: raise ValueError
            print(f"LMS RPC [{params[0] or 'server'}] -> {' '.join(str(p) for p in params[1])}",flush=True)
        except (AttributeError,TypeError,ValueError): print('LMS RPC -> <unrecognised request>',flush=True)
    def _log_cometd(self,payload:object)->None:
        messages=payload if isinstance(payload,list) else [payload]; channels=[str(m.get('channel','?')) for m in messages if isinstance(m,dict)]
        print(f"LMS CometD -> {', '.join(channels) or '<unrecognised request>'}",flush=True)
    def do_GET(self)->None:
        path=urlsplit(self.path).path
        if path=='/api/catalogue': self._serve_catalogue(); return
        if path=='/api/diagnostics/spotty': self._serve_spotty_diagnostic(); return
        if path=='/api/config': self._send_payload(200,json.dumps(self.runtime_config).encode(),'application/json; charset=utf-8',cache_control='no-store'); return
        if path.startswith('/api/art-meta/'):
            artwork_id=unquote(path.removeprefix('/api/art-meta/'))
            if not ARTWORK_ID.fullmatch(artwork_id): self.send_error(400,'Invalid artwork ID'); return
            self._serve_artwork_meta(artwork_id); return
        if path.startswith('/api/art/'):
            artwork_id=unquote(path.removeprefix('/api/art/'))
            if not ARTWORK_ID.fullmatch(artwork_id): self.send_error(400,'Invalid artwork ID'); return
            size=parse_qs(urlsplit(self.path).query).get('size',[''])[0]
            if size:
                try:
                    size=int(size)
                    if size not in (128,256,384,512,768,1024): raise ValueError
                except ValueError: self.send_error(400,'Invalid cover size'); return
                self._serve_sized_artwork(artwork_id,size)
            else: self._serve_artwork(artwork_id)
            return
        super().do_GET()
    def _lms_rpc(self,player_id:str,command:list[object])->dict:
        body=json.dumps({'id':1,'method':'slim.request','params':[player_id,command]}).encode()
        with urlopen(Request(f'{self.lms_url}/jsonrpc.js',data=body,headers={'Content-Type':'application/json'}),timeout=15) as response:
            payload=json.loads(self._read_limited(response,MAX_UPSTREAM_BYTES))
        return payload.get('result',{}) if isinstance(payload,dict) else {}

    def _serve_spotty_diagnostic(self)->None:
        """Discover a player and return the real LMS BrowseLibrary/Spotty payload."""
        try:
            players_result=self._lms_rpc('', ['players',0,100])
            players=players_result.get('players_loop',[]) if isinstance(players_result,dict) else []
            connected=[p for p in players if str(p.get('connected','1')) not in ('0','false','False')]
            player=(connected or players or [None])[0]
            if not player:
                result={'available':False,'stage':'player-discovery','error':'LMS returned no players','lms':self.lms_url,'players':[]}
            else:
                player_id=str(player.get('playerid') or player.get('id') or '')
                if not player_id: raise ValueError('LMS player has no playerid')
                commands=[
                    ['browselibrary','items',0,200,'menu:spotty'],
                    ['browselibrary','items',0,200,'menu:plugins/Spotty'],
                ]
                attempts=[]; chosen=None
                for command in commands:
                    try:
                        response=self._lms_rpc(player_id,command)
                        attempts.append({'command':command,'result':response})
                        loops=[]
                        if isinstance(response,dict):
                            for key in ('item_loop','items_loop','items'):
                                value=response.get(key)
                                if isinstance(value,list): loops.extend(value)
                        if loops and chosen is None: chosen=response
                    except Exception as error:
                        attempts.append({'command':command,'error':str(error)})
                result={'available':chosen is not None,'lms':self.lms_url,'player':{'playerid':player_id,'name':player.get('name','')},'attempts':attempts}
                if chosen is None: result['error']='No Spotty BrowseLibrary menu was returned by the tested LMS menu identifiers'
            self._send_payload(200,json.dumps(result,indent=2,default=str).encode(),'application/json; charset=utf-8',cache_control='no-store')
        except (OSError,ValueError,KeyError,URLError,UpstreamPayloadTooLarge) as error:
            payload={'available':False,'stage':'request','lms':self.lms_url,'error':str(error)}
            self._send_payload(200,json.dumps(payload,indent=2).encode(),'application/json; charset=utf-8',cache_control='no-store')

    def _serve_catalogue(self)->None:
        mode=parse_qs(urlsplit(self.path).query).get('order',['artistAlbum'])[0]
        if mode not in ('artistAlbum','album','colour','random'):
            self.send_error(400,'Invalid album order'); return
        try:
            albums=[]
            while True:
                body=json.dumps({'id':1,'method':'slim.request','params':['0',['albums',len(albums),200,'sort:artflow','tags:ajlys']]}).encode()
                with urlopen(Request(f'{self.lms_url}/jsonrpc.js',data=body,headers={'Content-Type':'application/json'}),timeout=10) as response:
                    result=json.loads(self._read_limited(response,MAX_UPSTREAM_BYTES))['result']
                page=result.get('albums_loop',[])
                albums.extend(page)
                if len(albums)>=int(result.get('count',len(albums))): break
                if not page: raise ValueError('Incomplete catalogue')
            if mode=='colour':
                ids=list(dict.fromkeys(str(a['artwork_track_id']) for a in albums if a.get('artwork_track_id')))
                metadata=dict(zip(ids,METADATA_WORKERS.map(self._artwork_metadata,ids)))
                for album in albums: album['spine_metadata']=metadata.get(str(album.get('artwork_track_id')))
            def key(album):
                artist=str(album.get('artist','')).casefold(); title=str(album.get('album',album.get('title',''))).casefold()
                tie=(artist,title,str(album.get('id','')))
                if mode=='colour': return ((album.get('spine_metadata') or {}).get('colour_index',float('inf')),*tie)
                return tie if mode=='artistAlbum' else (title,artist,tie[2])
            if mode=='random': random.shuffle(albums)
            else: albums.sort(key=key)
            self._send_payload(200,json.dumps({'count':len(albums),'albums_loop':albums}).encode(),'application/json; charset=utf-8',cache_control='no-store')
        except (OSError,ValueError,KeyError,URLError,UpstreamPayloadTooLarge) as error: self._send_upstream_error(error)

    def _serve_sized_artwork(self,artwork_id:str,size:int)->None:
        key=hashlib.sha256(f'{self.lms_url}\0{artwork_id}'.encode()).hexdigest()
        variant=self.cache_dir/f'{key}-{size}.img'
        try:
            if not variant.exists():
                self._ensure_artwork(artwork_id)
                with Image.open(self.cache_dir/f'{key}.img') as image:
                    image=image.convert('RGB')
                    image.thumbnail((size,size),getattr(Image,'Resampling',Image).LANCZOS)
                    output=io.BytesIO(); image.save(output,format='JPEG',quality=85)
                self._store_artwork(variant,variant.with_suffix('.type'),output.getvalue(),'image/jpeg')
                self._prune_artwork_cache()
            self._send_payload(200,variant.read_bytes(),'image/jpeg',cache_control='public, max-age=86400')
        except (OSError,ValueError,URLError,UpstreamPayloadTooLarge) as error: self._send_upstream_error(error)

    def _serve_artwork_meta(self,artwork_id:str)->None:
        metadata=self._artwork_metadata(artwork_id)
        self._send_payload(200 if metadata else 404,json.dumps(metadata or {'error':'Artwork metadata unavailable'}).encode(),'application/json; charset=utf-8',cache_control='public, max-age=86400' if metadata else 'no-store')

    def _serve_metadata_batch(self)->None:
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=MAX_RPC_BYTES: raise ValueError
            payload=json.loads(self.rfile.read(length))
            ids=payload.get('artwork_ids') if isinstance(payload,dict) else None
            if not isinstance(ids,list) or len(ids)>64 or any(not isinstance(i,str) or not ARTWORK_ID.fullmatch(i) for i in ids): raise ValueError
        except (ValueError,UnicodeError):
            self.send_error(400,'Expected up to 64 artwork IDs'); return
        ids=list(dict.fromkeys(ids))
        metadata=dict(zip(ids,METADATA_WORKERS.map(self._artwork_metadata,ids)))
        self._send_payload(200,json.dumps({'metadata':metadata}).encode(),'application/json; charset=utf-8',cache_control='no-store')

    def _artwork_metadata(self,artwork_id:str):
        key=hashlib.sha256(f'{self.lms_url}\0{artwork_id}'.encode()).hexdigest();meta_path=self.cache_dir/f'{key}.meta'
        font=SPINE_FONTS[int(hashlib.sha256(artwork_id.encode()).hexdigest()[:8],16)%len(SPINE_FONTS)]
        try:
            metadata=json.loads(meta_path.read_bytes())
            if not isinstance(metadata,dict) or not all(k in metadata for k in ('spine_color','text_color')) or not re.fullmatch(r'#[0-9a-fA-F]{6}',str(metadata.get('spine_color',''))):
                metadata=None
        except (OSError,ValueError,UnicodeError): metadata=None
        if metadata is not None and metadata.get('spine_font')==font and metadata.get('colour_index')==colour_sort_index(metadata['spine_color']):
            return metadata
        try:
            # Upgrade existing colour caches without decoding or fetching artwork again.
            if metadata is None:
                self._ensure_artwork(artwork_id)
                with Image.open(self.cache_dir/f'{key}.img') as image:
                    sample=image.convert('RGB').resize((1,1),getattr(Image,'Resampling',Image).BILINEAR)
                    red,green,blue=ImageStat.Stat(sample).mean
                spine_color=f'#{round(red):02x}{round(green):02x}{round(blue):02x}'
                luminance=(0.299*red+0.587*green+0.114*blue)/255
                metadata={'spine_color':spine_color,'text_color':'#111417' if luminance>.62 else '#f5f2ea'}
            metadata['spine_font']=font
            metadata['colour_index']=colour_sort_index(metadata['spine_color'])
            payload=json.dumps(metadata).encode()
            meta_temp=meta_path.with_name(meta_path.name+f'.{os.getpid()}.{threading.get_ident()}.tmp')
            try:
                meta_temp.write_bytes(payload); meta_temp.replace(meta_path)
            finally:
                meta_temp.unlink(missing_ok=True)
            return metadata
        except (OSError,ValueError,URLError,UpstreamPayloadTooLarge): return None
    def _ensure_artwork(self,artwork_id:str)->None:
        """Populate the disk cache without sending full artwork to a metadata client."""
        key=hashlib.sha256(f'{self.lms_url}\0{artwork_id}'.encode()).hexdigest()
        cache_path=self.cache_dir/f'{key}.img'
        if cache_path.is_file(): return
        with urlopen(Request(f"{self.lms_url}/music/{quote(artwork_id,safe='')}/cover.jpg",method='GET'),timeout=10) as response:
            payload=self._read_limited(response,MAX_ARTWORK_BYTES)
            content_type=response.headers.get_content_type() or 'image/jpeg'
        self._store_artwork(cache_path,cache_path.with_suffix('.type'),payload,content_type)
        self._prune_artwork_cache()

    def _serve_artwork(self,artwork_id:str)->None:
        key=hashlib.sha256(f'{self.lms_url}\0{artwork_id}'.encode()).hexdigest(); cache_path=self.cache_dir/f'{key}.img'; type_path=self.cache_dir/f'{key}.type'
        try: payload=cache_path.read_bytes(); content_type=type_path.read_text(encoding='ascii').strip() or 'image/jpeg'
        except (FileNotFoundError,OSError,UnicodeError): payload=None
        if payload is not None: self._send_payload(200,payload,content_type,cache_control='public, max-age=86400',extra_headers={'X-Album-Art-Cache':'HIT'}); return
        try:
            with urlopen(Request(f"{self.lms_url}/music/{quote(artwork_id,safe='')}/cover.jpg",method='GET'),timeout=10) as response:
                payload=self._read_limited(response,MAX_ARTWORK_BYTES); content_type=response.headers.get_content_type() or 'image/jpeg'; self._store_artwork(cache_path,type_path,payload,content_type); self._prune_artwork_cache(); self._send_payload(response.status,payload,content_type,cache_control='public, max-age=86400',extra_headers={'X-Album-Art-Cache':'MISS'})
        except HTTPError as error: self._send_http_error(error)
        except UpstreamPayloadTooLarge as error: self._send_upstream_error(error)
        except (URLError,TimeoutError,OSError) as error: self._send_upstream_error(error)
    def _store_artwork(self,cache_path:Path,type_path:Path,payload:bytes,content_type:str)->None:
        suffix=f'.{os.getpid()}.{threading.get_ident()}.tmp'; image_temp=cache_path.with_name(cache_path.name+suffix); type_temp=type_path.with_name(type_path.name+suffix)
        try: image_temp.write_bytes(payload); type_temp.write_text(content_type,encoding='ascii'); image_temp.replace(cache_path); type_temp.replace(type_path)
        finally: image_temp.unlink(missing_ok=True); type_temp.unlink(missing_ok=True)
    def _prune_artwork_cache(self)->None:
        entries=[]; total=0
        for path in self.cache_dir.glob('*.img'):
            try:
                size=path.stat().st_size; entries.append((path.stat().st_mtime,path,size)); total+=size
            except OSError: continue
        for _,path,size in sorted(entries):
            if total<=MAX_ARTWORK_CACHE_BYTES: break
            try:
                path.unlink(); path.with_suffix('.type').unlink(missing_ok=True); path.with_suffix('.meta').unlink(missing_ok=True); total-=size
            except OSError: continue
    def _read_limited(self,response,limit:int)->bytes:
        content_length=response.headers.get('Content-Length')
        try:
            if content_length is not None and int(content_length)>limit: raise UpstreamPayloadTooLarge(f'Upstream response exceeds {limit} bytes')
        except ValueError: pass
        chunks=[]; total=0
        while True:
            chunk=response.read(min(65536,limit-total+1))
            if not chunk: break
            chunks.append(chunk); total+=len(chunk)
            if total>limit: raise UpstreamPayloadTooLarge(f'Upstream response exceeds {limit} bytes')
        return b''.join(chunks)
    def _relay(self,request:Request,timeout:int=10)->None:
        try:
            with urlopen(request,timeout=timeout) as response: self._send_payload(response.status,self._read_limited(response,MAX_UPSTREAM_BYTES),response.headers.get('Content-Type','application/octet-stream'),cache_control='no-store')
        except HTTPError as error: self._send_http_error(error)
        except UpstreamPayloadTooLarge as error: self._send_upstream_error(error)
        except (URLError,TimeoutError,OSError) as error: self._send_upstream_error(error)
    def _send_http_error(self,error:HTTPError)->None:
        try: payload=self._read_limited(error,MAX_UPSTREAM_BYTES)
        except UpstreamPayloadTooLarge as too_large: self._send_upstream_error(too_large); return
        self._send_payload(error.code,payload,error.headers.get('Content-Type','text/plain'),cache_control='no-store')
    def _send_upstream_error(self,error:Exception)->None: self._send_payload(502,f'Could not contact LMS: {error}'.encode('utf-8','replace'),'text/plain; charset=utf-8',cache_control='no-store')
    def _send_payload(self,status:int,payload:bytes,content_type:str,*,cache_control:str,extra_headers:dict[str,str]|None=None)->None:
        self.send_response(status); self.send_header('Content-Type',content_type); self.send_header('Content-Length',str(len(payload))); self.send_header('Cache-Control',cache_control)
        for name,value in (extra_headers or {}).items(): self.send_header(name,value)
        self.end_headers(); self.wfile.write(payload)

def main()->int:
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lms',default='http://mrlazy:9000',help='LMS base URL'); parser.add_argument('--bind',default='127.0.0.1',help='Address to listen on'); parser.add_argument('--port',type=int,default=8088,help='HTTP port')
    parser.add_argument('--batch-size',type=positive_int,default=40,help='Albums per LMS batch'); parser.add_argument('--idle-return-seconds',type=non_negative_int,default=30,help='Idle time before returning to the playing album; 0 disables')
    parser.add_argument('--reconnect-max-seconds',type=positive_int,default=30,help='Maximum reconnect backoff'); parser.add_argument('--random-scroll-max-seconds',type=positive_int,default=3,help='Maximum random and idle-return scroll duration'); parser.add_argument('--search-limit',type=positive_int,default=100,help='Maximum albums returned by a search'); parser.add_argument('--cache-dir',help='Persistent artwork cache directory (default: .cache/album-art)'); parser.add_argument('--clear-cache',action='store_true',help='Clear the persistent artwork cache before starting'); args=parser.parse_args()
    static_dir=Path(__file__).resolve().parent; cache_dir=Path(args.cache_dir).expanduser().resolve() if args.cache_dir else static_dir/'.cache'/'album-art'
    if args.clear_cache and cache_dir.exists():
        removed=sum(1 for path in cache_dir.rglob('*') if path.is_file()); shutil.rmtree(cache_dir); print(f"Cleared artwork cache: {removed} file{'s' if removed!=1 else ''} removed from {cache_dir}")
    cache_dir.mkdir(parents=True,exist_ok=True)
    runtime_config={'batch_size':args.batch_size,'idle_return_ms':args.idle_return_seconds*1000,'library_check_ms':0,'reconnect_max_ms':args.reconnect_max_seconds*1000,'random_scroll_max_ms':args.random_scroll_max_seconds*1000,'search_limit':args.search_limit,'lms_url':args.lms.rstrip('/')}
    def handler(*handler_args,**handler_kwargs): return LyrionCarouselHandler(*handler_args,directory=str(static_dir),lms_url=runtime_config['lms_url'],cache_dir=cache_dir,runtime_config=runtime_config,**handler_kwargs)
    server=ThreadingHTTPServer((args.bind,args.port),handler)
    if args.bind in {'0.0.0.0','::'}: print('Lyrion Carousel listening on all network interfaces.'); print(f'Open: http://{socket.gethostname()}:{args.port}/ or http://<server-ip>:{args.port}/')
    else: print(f'Lyrion Carousel: http://{args.bind}:{args.port}/')
    print(f'Lyrion server: {args.lms}'); print(f'Artwork cache: {cache_dir}'); print(f'Runtime config: batch={args.batch_size}, idle={args.idle_return_seconds}s, library-events=CometD, live-status=CometD, album-index=lightweight, random-scroll-max={args.random_scroll_max_seconds}s')
    try: server.serve_forever()
    except KeyboardInterrupt: print('\nStopping.')
    finally: server.server_close()
    return 0
if __name__=='__main__': sys.exit(main())
