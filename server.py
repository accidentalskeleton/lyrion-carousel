#!/usr/bin/env python3
"""Serve Lyrion Carousel and proxy its requests to Lyrion Music Server."""
from __future__ import annotations
import time, io, random, argparse, colorsys, hashlib, json, os, re, shutil, socket, sys, threading
from concurrent.futures import ThreadPoolExecutor
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlsplit, parse_qs
from urllib.request import Request, urlopen
from PIL import Image, ImageStat, ImageOps
from disc_artwork import extract_disc

# Architecture: HTTP threads serve static files and a small set of LMS proxy APIs.
# Image processing and catalogue ordering happen here, leaving the browser to
# render and interact. Disk caches survive restarts; job progress does not.
# The pool below is shared across metadata requests; the optional artwork warmer
# has its own single daemon thread so it does not occupy this foreground pool.
METADATA_WORKERS=ThreadPoolExecutor(max_workers=6,thread_name_prefix="album-metadata")
# Bound incoming JSON, upstream responses and stored image bytes separately.
MAX_RPC_BYTES=1_000_000
MAX_UPSTREAM_BYTES=8_000_000
MAX_ARTWORK_BYTES=10_000_000
MAX_ARTWORK_CACHE_BYTES=512_000_000
MAX_ARTWORK_CACHE_HARD_BYTES=2_000_000_000
# Local font stacks keep the controller usable without external font downloads.
SPINE_FONTS=(
    'Arial, "Liberation Sans", sans-serif',
    'Verdana, "DejaVu Sans", sans-serif',
    '"Trebuchet MS", "Liberation Sans", sans-serif',
    'Georgia, "DejaVu Serif", serif',
    '"Palatino Linotype", "Book Antiqua", "Liberation Serif", serif',
)
# Accept LMS identifiers, but never path separators supplied in an artwork URL.
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
    """Parse CLI counts/durations that must be greater than zero."""
    parsed=int(value)
    if parsed<1: raise argparse.ArgumentTypeError("must be at least 1")
    return parsed
def non_negative_int(value:str)->int:
    """Parse CLI durations for which zero means disabled."""
    parsed=int(value)
    if parsed<0: raise argparse.ArgumentTypeError("must be zero or greater")
    return parsed

class CacheFull(Exception):
    pass

class ArtworkWarmer:
    """One server-wide, cancellable worker; cached files make subsequent runs resumable."""
    def __init__(self):
        # Progress and start/stop operations share a lock; start calls snapshot,
        # so it must be re-entrant. io_lock only coordinates warming with clearing.
        self.lock=threading.RLock()
        self.io_lock=threading.Lock()
        self.cancel=threading.Event()
        self.thread=None
        self.last_foreground=0
        self.state={'status':'idle','completed':0,'total':0,'failed':0}

    def snapshot(self):
        """Copy progress under the lock so HTTP clients see a consistent snapshot."""
        with self.lock: return dict(self.state)

    def stop(self):
        """Request cancellation; the current network request or image operation may finish."""
        with self.lock:
            self.cancel.set()
            if self.thread and self.thread.is_alive(): self.state['status']='cancelling'

    def start(self,handler,size):
        """Start one job, or return the existing job when another browser already started it."""
        with self.lock:
            if self.thread and self.thread.is_alive(): return self.snapshot()
            self.cancel.clear()
            self.state={'status':'running','completed':0,'total':0,'failed':0,'size':size}
            # Do not retain a request socket after its HTTP handler finishes.
            worker=object.__new__(LyrionCarouselHandler)
            worker.lms_url=handler.lms_url
            worker.cache_dir=handler.cache_dir
            worker.runtime_config=getattr(handler,'runtime_config',{})
            worker.background_warming=True
            self.thread=threading.Thread(target=self.run,args=(worker,size),daemon=True,name='artwork-warmer')
            self.thread.start()
            return self.snapshot()

    def run(self,worker,size):
        """Walk unique artwork IDs, recording attempted items and failures for Settings."""
        status='complete'
        try:
            ids=[]
            for page in worker._catalogue_pages():
                if self.cancel.is_set(): break
                ids.extend(str(a['artwork_track_id']) for a in page if a.get('artwork_track_id'))
            # Multiple albums can share one artwork ID; prepare that image once.
            ids=list(dict.fromkeys(ids))
            with self.lock: self.state['total']=len(ids)
            for artwork_id in ids:
                # Event.wait keeps throttling interruptible. Foreground cover requests
                # postpone the next item; they do not interrupt an in-flight download.
                if self.cancel.wait(.15): break
                while time.monotonic()-self.last_foreground<1:
                    if self.cancel.wait(.25): break
                if self.cancel.is_set(): break
                try:
                    with self.io_lock:
                        if self.cancel.is_set(): break
                        worker._ensure_artwork(artwork_id)
                        if worker._artwork_metadata(artwork_id) is None: raise ValueError('Metadata unavailable')
                        worker._prepare_sized_artwork(artwork_id,size,case=True)
                # Warming must stop rather than evict the images it just prepared.
                except CacheFull:
                    status='cache_full'; break
                except (OSError,ValueError,URLError,UpstreamPayloadTooLarge):
                    with self.lock: self.state['failed']+=1
                # Completed counts attempts, including those recorded as failed.
                with self.lock: self.state['completed']+=1
        except Exception:
            status='error'
        finally:
            with self.lock: self.state['status']='cancelled' if self.cancel.is_set() else status

ARTWORK_WARMER=ArtworkWarmer()

class LyrionCarouselHandler(SimpleHTTPRequestHandler):
    server_version="LyrionCarousel/1.0"
    def __init__(self,*args,directory:str,lms_url:str,cache_dir:Path,runtime_config:dict[str,object],**kwargs):
        self.lms_url=lms_url.rstrip('/'); self.cache_dir=cache_dir; self.runtime_config=runtime_config
        super().__init__(*args,directory=directory,**kwargs)
    def end_headers(self)->None:
        """Revalidate application assets; image endpoints supply their own cache policy."""
        if urlsplit(self.path).path not in {'/api/config','/api/lms','/api/cometd','/api/config/lms','/api/config/cache','/api/cache/clear'} and not urlsplit(self.path).path.startswith(('/api/art/','/api/art-meta/')):
            self.send_header('Cache-Control','no-cache')
        super().end_headers()
    def do_POST(self)->None:
        """Dispatch state-changing/cache APIs or forward bounded JSON to LMS."""
        path=urlsplit(self.path).path
        if path=='/api/cache/warm': self._warm_cache(); return
        if path=='/api/art-meta': self._serve_metadata_batch(); return
        if path=='/api/cache/clear': self._clear_cache(); return
        if path=='/api/config/lms': self._update_lms_url(); return
        if path=='/api/config/cache': self._update_cache_limit(); return
        if path not in {'/api/lms','/api/cometd'}: self.send_error(404); return
        try: length=int(self.headers.get('Content-Length','0'))
        except ValueError: self.send_error(400,'Invalid Content-Length'); return
        if length<1 or length>MAX_RPC_BYTES: self.send_error(413,'Invalid request size'); return
        body=self.rfile.read(length)
        try: payload=json.loads(body)
        except (UnicodeDecodeError,json.JSONDecodeError): self.send_error(400,'Request body must be JSON'); return
        # CometD long polling needs a longer timeout than ordinary LMS RPCs.
        if path=='/api/cometd':
            self._log_cometd(payload); self._relay(Request(f'{self.lms_url}/cometd',data=body,headers={'Content-Type':'application/json'},method='POST'),70); return
        self._log_lms_rpc(payload); self._relay(Request(f'{self.lms_url}/jsonrpc.js',data=body,headers={'Content-Type':'application/json'},method='POST'))
    def _warm_cache(self)->None:
        """Validate a start/cancel command and return job progress plus cache usage."""
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=1024: raise ValueError
            payload=json.loads(self.rfile.read(length))
            if not isinstance(payload,dict): raise ValueError
            if payload.get('action')=='cancel':
                ARTWORK_WARMER.stop(); state=ARTWORK_WARMER.snapshot()
            elif payload.get('action')=='start':
                size=payload.get('size',512)
                if type(size) is not int or size not in (128,256,384,512,768,1024): raise ValueError
                state=ARTWORK_WARMER.start(self,size)
            else: raise ValueError
        except (ValueError,UnicodeError): self.send_error(400,'Invalid warming request'); return
        state['cache']=self._cache_usage()
        self._send_payload(200,json.dumps(state).encode(),'application/json; charset=utf-8',cache_control='no-store')

    def _clear_cache(self)->None:
        """Stop warming and wait for its current write before deleting cached files."""
        ARTWORK_WARMER.stop()
        with ARTWORK_WARMER.io_lock: self._clear_cache_files()

    def _clear_cache_files(self)->None:
        """Delete cache files and report the number removed to the Settings UI."""
        removed=0
        try:
            for path in self.cache_dir.rglob('*'):
                if path.is_file() or path.is_symlink(): path.unlink(); removed+=1
            self._send_payload(200,json.dumps({'removed':removed}).encode(),'application/json; charset=utf-8',cache_control='no-store')
        except OSError as error: self._send_upstream_error(error)
    def _update_lms_url(self)->None:
        """Update the shared proxy target; subsequent HTTP handlers use the new URL."""
        try:
            length=int(self.headers.get('Content-Length','0'))
            if length<1 or length>MAX_RPC_BYTES: self.send_error(413,'Invalid request size'); return
            payload=json.loads(self.rfile.read(length))
            value=payload.get('lms_url') if isinstance(payload,dict) else None
            lms_url=str(value).strip().rstrip('/')
            parsed=urlsplit(lms_url)
            if parsed.scheme not in {'http','https'} or not parsed.netloc or parsed.username or parsed.password or parsed.query or parsed.fragment: raise ValueError
            ARTWORK_WARMER.stop()
            self.runtime_config['lms_url']=lms_url
            self.lms_url=lms_url
            self._send_payload(200,json.dumps({'lms_url':lms_url}).encode(),'application/json; charset=utf-8',cache_control='no-store')
        except (ValueError,TypeError,UnicodeDecodeError,json.JSONDecodeError): self.send_error(400,'Invalid LMS URL')
    def _update_cache_limit(self)->None:
        """Update the soft artwork-cache limit without exceeding the server ceiling."""
        try:
            length=int(self.headers.get('Content-Length','0'))
            if length<1 or length>1024: raise ValueError
            payload=json.loads(self.rfile.read(length))
            limit=payload.get('cache_limit_bytes') if isinstance(payload,dict) else None
            if type(limit) is not int or limit<1 or limit>self._cache_hard_limit_bytes(): raise ValueError
            self.runtime_config['cache_limit_bytes']=limit
            self._prune_artwork_cache()
            self._send_payload(200,json.dumps({'cache_limit_bytes':limit,'cache_hard_limit_bytes':self._cache_hard_limit_bytes(),'cache':self._cache_usage()}).encode(),'application/json; charset=utf-8',cache_control='no-store')
        except (ValueError,TypeError,UnicodeDecodeError,json.JSONDecodeError): self.send_error(400,'Invalid cache size')
    def _log_lms_rpc(self,payload:object)->None:
        """Log the player and LMS command without failing on malformed request shapes."""
        try:
            params=payload.get('params') if isinstance(payload,dict) else None
            if not isinstance(params,list) or len(params)<2 or not isinstance(params[1],list) or not params[1]: raise ValueError
            print(f"LMS RPC [{params[0] or 'server'}] -> {' '.join(str(p) for p in params[1])}",flush=True)
        except (AttributeError,TypeError,ValueError): print('LMS RPC -> <unrecognised request>',flush=True)
    def _log_cometd(self,payload:object)->None:
        """Log CometD channel names without dumping full event payloads."""
        messages=payload if isinstance(payload,list) else [payload]; channels=[str(m.get('channel','?')) for m in messages if isinstance(m,dict)]
        print(f"LMS CometD -> {', '.join(channels) or '<unrecognised request>'}",flush=True)
    def _cache_usage(self):
        """Count committed cache files; image bytes alone are subject to the cache limit."""
        image_bytes=metadata_bytes=files=0
        for path in self.cache_dir.iterdir():
            if path.suffix not in ('.img','.meta','.type'): continue
            try:
                if not path.is_file() or path.is_symlink(): continue
                size=path.stat().st_size
            except OSError: continue  # Files may be pruned while counting.
            files+=1
            if path.suffix=='.img': image_bytes+=size
            else: metadata_bytes+=size
        return {'image_bytes':image_bytes,'metadata_bytes':metadata_bytes,'total_bytes':image_bytes+metadata_bytes,'limit_bytes':self._cache_limit_bytes(),'files':files}

    def _cache_limit_bytes(self)->int:
        """Read the current soft cache limit, retaining the established default."""
        configured=getattr(self,'runtime_config',{}).get('cache_limit_bytes',MAX_ARTWORK_CACHE_BYTES)
        return configured if type(configured) is int and 0<configured<=self._cache_hard_limit_bytes() else MAX_ARTWORK_CACHE_BYTES

    def _cache_hard_limit_bytes(self)->int:
        """Read the server-configured cache ceiling; clients cannot change this value."""
        configured=getattr(self,'runtime_config',{}).get('cache_hard_limit_bytes',MAX_ARTWORK_CACHE_HARD_BYTES)
        return configured if type(configured) is int and configured>0 else MAX_ARTWORK_CACHE_HARD_BYTES

    def do_GET(self)->None:
        """Serve status, prepared catalogues and artwork, or fall through to static files."""
        path=urlsplit(self.path).path
        if path=='/api/cache/warm':
            self._send_payload(200,json.dumps({**ARTWORK_WARMER.snapshot(),'cache':self._cache_usage()}).encode(),'application/json; charset=utf-8',cache_control='no-store'); return
        if path.startswith('/api/art/'):
            ARTWORK_WARMER.last_foreground=time.monotonic()
        if path=='/api/catalogue': self._serve_catalogue(); return
        if path=='/api/diagnostics/spotty': self._serve_spotty_diagnostic(); return
        if path=='/api/diagnostics/now-playing': self._serve_now_playing_diagnostic(); return
        if path.startswith('/api/processed-disc/'):
            self._serve_processed_disc(path); return
        if path.startswith('/api/local-artwork/'):
            self._serve_local_artwork(path); return
        if path=='/api/spotty-art': self._serve_spotty_art(); return
        if path=='/api/spotty-art-meta': self._serve_spotty_art_meta(); return
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
                self._serve_sized_artwork(artwork_id,size,case=parse_qs(urlsplit(self.path).query).get('case',[''])[0]=='realistic-v1')
            else: self._serve_artwork(artwork_id)
            return
        # SimpleHTTPRequestHandler serves index.html, scripts, styles and assets.
        super().do_GET()
    def _lms_rpc(self,player_id:str,command:list[object])->dict:
        body=json.dumps({'id':1,'method':'slim.request','params':[player_id,command]}).encode()
        with urlopen(Request(f'{self.lms_url}/jsonrpc.js',data=body,headers={'Content-Type':'application/json'}),timeout=15) as response:
            payload=json.loads(self._read_limited(response,MAX_UPSTREAM_BYTES))
        return payload.get('result',{}) if isinstance(payload,dict) else {}

    def _serve_processed_disc(self,path:str)->None:
        """Serve a cached, isolated CD label, or 404 when detection is uncertain."""
        match=re.fullmatch(r'/api/processed-disc/([a-fA-F0-9]{32})',path)
        if not match:
            self.send_error(400,'Invalid disc artwork identifier'); return
        identifier=match.group(1).lower()
        key=hashlib.sha256((self.lms_url+'\\0disc-v1\\0'+identifier).encode()).hexdigest()
        cache=self.cache_dir/(key+'.disc.png')
        try:
            if cache.is_file():
                self._send_payload(200,cache.read_bytes(),'image/png',cache_control='public, max-age=86400'); return
            url=self.lms_url+'/imageproxy/mai/localartwork/'+identifier+'/image.png'
            with urlopen(Request(url,headers={'Accept':'image/*'}),timeout=12) as response:
                if response.headers.get_content_type() not in ('image/png','image/jpeg','image/webp'):
                    raise ValueError('Unsupported image type')
                payload=self._read_limited(response,MAX_ARTWORK_BYTES)
            processed=extract_disc(payload)
            if processed is None:
                self.send_error(404,'Disc circle not confidently detected'); return
            temporary=cache.with_name(cache.name+'.'+str(threading.get_ident())+'.tmp')
            try:
                temporary.write_bytes(processed)
                os.replace(temporary,cache)
            finally:
                temporary.unlink(missing_ok=True)
            self._send_payload(200,processed,'image/png',cache_control='public, max-age=86400')
        except (OSError,URLError,ValueError) as exc:
            self.send_error(502,'Disc processing unavailable')

    def _serve_local_artwork(self,path:str)->None:
        """Proxy only LMS Album Information local-artwork image identifiers."""
        match=re.fullmatch(r'/api/local-artwork/([a-fA-F0-9]{32})',path)
        if not match:
            self.send_error(400,'Invalid local artwork identifier'); return
        try:
            url=self.lms_url.rstrip('/')+'/imageproxy/mai/localartwork/'+match.group(1)+'/image.png'
            with urlopen(Request(url,headers={'Accept':'image/*'}),timeout=12) as response:
                content_type=response.headers.get_content_type()
                if content_type not in ('image/png','image/jpeg','image/webp','image/gif'):
                    raise ValueError('Unexpected artwork content type')
                payload=response.read(MAX_ARTWORK_BYTES+1)
                if len(payload)>MAX_ARTWORK_BYTES: raise ValueError('Artwork too large')
            self._send_payload(200,payload,content_type,cache_control='private, max-age=3600')
        except (OSError,URLError,ValueError) as exc:
            self.send_error(502,'LMS artwork unavailable')

    def _serve_spotty_art(self)->None:
        """Proxy/cache Spotty artwork and optionally render the same jewel-case variant as local albums."""
        try:
            query=parse_qs(urlsplit(self.path).query)
            raw=query.get('path',[''])[0]
            size_raw=query.get('size',[''])[0]
            case=query.get('case',[''])[0]=='realistic-v1'
            key,payload,content_type=self._spotty_artwork(raw)
            if size_raw or case:
                size=int(size_raw or 512)
                if size not in (128,256,384,512,768,1024): raise ValueError('Invalid cover size')
                variant=self.cache_dir/f'{key}-{size}{"-case-v1" if case else ""}.img'
                type_path=variant.with_suffix('.type')
                if variant.exists():
                    payload=variant.read_bytes()
                    try: content_type=type_path.read_text(encoding='ascii').strip() or ('image/png' if case else 'image/jpeg')
                    except (OSError,UnicodeError): content_type='image/png' if case else 'image/jpeg'
                else:
                    with Image.open(io.BytesIO(payload)) as source:
                        image=source.convert('RGB')
                        if case:
                            with Image.open(Path(__file__).resolve().parent/'assets'/'jewel-case-realistic-v1.png') as texture:
                                overlay=texture.convert('RGBA')
                            canvas=Image.new('RGBA',overlay.size)
                            booklet=ImageOps.fit(image,(1110,1090),method=getattr(Image,'Resampling',Image).LANCZOS)
                            canvas.paste(booklet,(175,45))
                            image=Image.alpha_composite(canvas,overlay)
                        image.thumbnail((size,size),getattr(Image,'Resampling',Image).LANCZOS)
                        output=io.BytesIO()
                        if case: image.save(output,format='PNG')
                        else: image.save(output,format='JPEG',quality=85)
                        payload=output.getvalue(); content_type='image/png' if case else 'image/jpeg'
                    self._store_artwork(variant,type_path,payload,content_type); self._prune_artwork_cache()
            self._send_payload(200,payload,content_type,cache_control='public, max-age=86400')
        except ValueError as error: self.send_error(400,str(error))
        except HTTPError as error: self._send_http_error(error)
        except (URLError,TimeoutError,OSError,UpstreamPayloadTooLarge) as error: self._send_upstream_error(error)

    def _spotty_artwork(self,raw:str):
        """Return cached Spotty artwork bytes and content type, fetching through LMS if needed."""
        if not raw.startswith('/imageproxy/') or len(raw)>4096: raise ValueError('Invalid Spotty artwork path')
        key=hashlib.sha256(f'{self.lms_url}\\0spotty\\0{raw}'.encode()).hexdigest()
        cache_path=self.cache_dir/f'{key}.img'; type_path=self.cache_dir/f'{key}.type'
        try: return key,cache_path.read_bytes(),type_path.read_text(encoding='ascii').strip() or 'image/png'
        except (FileNotFoundError,OSError,UnicodeError): pass
        with urlopen(Request(self.lms_url+raw,method='GET'),timeout=15) as response:
            payload=self._read_limited(response,MAX_ARTWORK_BYTES); content_type=response.headers.get_content_type() or 'image/png'
        self._store_artwork(cache_path,type_path,payload,content_type); self._prune_artwork_cache()
        return key,payload,content_type

    def _serve_spotty_art_meta(self)->None:
        """Derive shelf-spine colour metadata from the same cached Spotty cover image."""
        try:
            raw=parse_qs(urlsplit(self.path).query).get('path',[''])[0]
            key,payload,_=self._spotty_artwork(raw); meta_path=self.cache_dir/f'{key}.meta'
            try:
                metadata=json.loads(meta_path.read_bytes())
                if not isinstance(metadata,dict) or not re.fullmatch(r'#[0-9a-fA-F]{6}',str(metadata.get('spine_color',''))): raise ValueError
            except (OSError,ValueError,UnicodeError,json.JSONDecodeError):
                with Image.open(io.BytesIO(payload)) as image:
                    red,green,blue=ImageStat.Stat(image.convert('RGB').resize((1,1),getattr(Image,'Resampling',Image).BILINEAR)).mean
                spine_color=f'#{round(red):02x}{round(green):02x}{round(blue):02x}'; luminance=(.299*red+.587*green+.114*blue)/255
                font=SPINE_FONTS[int(hashlib.sha256(raw.encode()).hexdigest()[:8],16)%len(SPINE_FONTS)]
                metadata={'spine_color':spine_color,'text_color':'#111417' if luminance>.62 else '#f5f2ea','spine_font':font,'colour_index':colour_sort_index(spine_color)}
                temp=meta_path.with_name(meta_path.name+f'.{os.getpid()}.{threading.get_ident()}.tmp')
                try: temp.write_bytes(json.dumps(metadata).encode()); temp.replace(meta_path)
                finally: temp.unlink(missing_ok=True)
            self._send_payload(200,json.dumps(metadata).encode(),'application/json; charset=utf-8',cache_control='public, max-age=86400')
        except ValueError as error: self.send_error(400,str(error))
        except HTTPError as error: self._send_http_error(error)
        except (URLError,TimeoutError,OSError,UpstreamPayloadTooLarge) as error: self._send_upstream_error(error)

    def _serve_now_playing_diagnostic(self)->None:
        """Return the raw LMS status payload needed to map Spotty now-playing metadata."""
        try:
            players_result=self._lms_rpc('', ['players',0,100])
            players=players_result.get('players_loop',[]) if isinstance(players_result,dict) else []
            connected=[p for p in players if str(p.get('connected','1')) not in ('0','false','False')]
            player=(connected or players or [None])[0]
            if not player: raise ValueError('LMS returned no players')
            player_id=str(player.get('playerid') or player.get('id') or '')
            if not player_id: raise ValueError('LMS player has no playerid')
            status=self._lms_rpc(player_id,['status','-',5,'tags:alJenKNR'])
            result={'lms':self.lms_url,'player':{'playerid':player_id,'name':player.get('name','')},'status':status}
            self._send_payload(200,json.dumps(result,indent=2).encode(),'application/json; charset=utf-8',cache_control='no-store')
        except (ValueError,TypeError,UnicodeError,json.JSONDecodeError) as error: self.send_error(500,str(error))
        except HTTPError as error: self._send_http_error(error)
        except (URLError,TimeoutError,OSError,UpstreamPayloadTooLarge) as error: self._send_upstream_error(error)

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
                # Spotty registers tag='spotty', menu='radios' with LMS's
                # XMLBrowser plugin API. Query its CLI tag directly; the previous
                # BrowseLibrary menu guesses could wait on an unrelated handler.
                root_command=['spotty','items',0,200]
                attempts=[]; chosen=None
                try:
                    root_response=self._lms_rpc(player_id,root_command)
                    attempts.append({'command':root_command,'result':root_response})
                    root_items=[]
                    if isinstance(root_response,dict):
                        for key in ('loop_loop','item_loop','items_loop','items'):
                            value=root_response.get(key)
                            if isinstance(value,list): root_items.extend(value)
                    if root_items: chosen=root_response
                    albums_node=next((item for item in root_items if str(item.get('name') or item.get('text') or '').strip().casefold()=='albums'),None)
                    if albums_node is not None and albums_node.get('id') is not None:
                        albums_command=['spotty','items',0,200,f"item_id:{albums_node['id']}"]
                        try:
                            albums_response=self._lms_rpc(player_id,albums_command)
                            attempts.append({'command':albums_command,'result':albums_response})
                        except Exception as error:
                            attempts.append({'command':albums_command,'error':str(error)})
                except Exception as error:
                    attempts.append({'command':root_command,'error':str(error)})
                result={'available':chosen is not None,'lms':self.lms_url,'player':{'playerid':player_id,'name':player.get('name','')},'attempts':attempts}
                if chosen is None: result['error']="No Spotty menu was returned by the registered LMS 'spotty' CLI endpoint"
            self._send_payload(200,json.dumps(result,indent=2,default=str).encode(),'application/json; charset=utf-8',cache_control='no-store')
        except (OSError,ValueError,KeyError,URLError,UpstreamPayloadTooLarge) as error:
            payload={'available':False,'stage':'request','lms':self.lms_url,'error':str(error)}
            self._send_payload(200,json.dumps(payload,indent=2).encode(),'application/json; charset=utf-8',cache_control='no-store')

    def _catalogue_pages(self,genre_id:int|None=None):
        """Yield bounded LMS album pages; callers decide how to process the full library."""
        start=0
        while True:
            command=['albums',start,200,'sort:artflow','tags:ajlys']
            if genre_id is not None: command.append(f'genre_id:{genre_id}')
            body=json.dumps({'id':1,'method':'slim.request','params':['0',command]}).encode()
            with urlopen(Request(f'{self.lms_url}/jsonrpc.js',data=body,headers={'Content-Type':'application/json'}),timeout=10) as response:
                result=json.loads(self._read_limited(response,MAX_UPSTREAM_BYTES))['result']
            page=result.get('albums_loop',[])
            yield page
            start+=len(page)
            if start>=int(result.get('count',start)): return
            if not page: raise ValueError('Incomplete catalogue')

    def _serve_catalogue(self)->None:
        """Fetch a fresh catalogue and return the requested order, prepared on the server."""
        query=parse_qs(urlsplit(self.path).query)
        mode=query.get('order',['artistAlbum'])[0]
        excluded_genre_ids={int(genre_id) for genre_id in query.get('exclude_genre_id',[]) if genre_id.isdecimal() and int(genre_id)>0}
        if mode not in ('artistAlbum','album','colour','random'):
            self.send_error(400,'Invalid album order'); return
        try:
            albums=[album for page in self._catalogue_pages() for album in page]
            library_count=len(albums)
            if excluded_genre_ids:
                excluded_album_ids={str(album.get('id')) for genre_id in excluded_genre_ids for page in self._catalogue_pages(genre_id) for album in page}
                albums=[album for album in albums if str(album.get('id')) not in excluded_album_ids]
            if mode=='colour':
                ids=list(dict.fromkeys(str(a['artwork_track_id']) for a in albums if a.get('artwork_track_id')))
                metadata=dict(zip(ids,METADATA_WORKERS.map(self._artwork_metadata,ids)))
                for album in albums: album['spine_metadata']=metadata.get(str(album.get('artwork_track_id')))
            # Album IDs break name ties deterministically; missing colours sort last.
            def key(album):
                artist=str(album.get('artist','')).casefold(); title=str(album.get('album',album.get('title',''))).casefold()
                tie=(artist,title,str(album.get('id','')))
                if mode=='colour': return ((album.get('spine_metadata') or {}).get('colour_index',float('inf')),*tie)
                return tie if mode=='artistAlbum' else (title,artist,tie[2])
            if mode=='random': random.shuffle(albums)
            else: albums.sort(key=key)
            self._send_payload(200,json.dumps({'count':len(albums),'library_count':library_count,'albums_loop':albums}).encode(),'application/json; charset=utf-8',cache_control='no-store')
        except (OSError,ValueError,KeyError,URLError,UpstreamPayloadTooLarge) as error: self._send_upstream_error(error)

    def _serve_sized_artwork(self,artwork_id:str,size:int,case:bool=False)->None:
        """Serve a cached resized/composited image, preparing it on the first request."""
        try:
            variant,content_type=self._prepare_sized_artwork(artwork_id,size,case)
            self._send_payload(200,variant.read_bytes(),content_type,cache_control='public, max-age=86400')
        except (OSError,ValueError,URLError,UpstreamPayloadTooLarge) as error: self._send_upstream_error(error)

    def _prepare_sized_artwork(self,artwork_id:str,size:int,case:bool=False):
        """Return a cache path and MIME type without writing to an HTTP connection."""
        key=hashlib.sha256(f'{self.lms_url}\0{artwork_id}'.encode()).hexdigest()
        # Variant names include both resolution and template revision, so original
        # artwork, plain thumbnails and photographic cases never overwrite each other.
        variant=self.cache_dir/f'{key}-{size}{"-case-v1" if case else ""}.img'
        content_type='image/png' if case else 'image/jpeg'
        if not variant.exists():
            self._ensure_artwork(artwork_id)
            with Image.open(self.cache_dir/f'{key}.img') as image:
                image=image.convert('RGB')
                if case:
                    with Image.open(Path(__file__).resolve().parent/'assets'/'jewel-case-realistic-v1.png') as texture:
                        # Coordinates of the booklet aperture beneath the moulded rim.
                        overlay=texture.convert('RGBA')
                    # Fill the template aperture, then retain the shell alpha outside it.
                    canvas=Image.new('RGBA',overlay.size)
                    booklet=ImageOps.fit(image,(1110,1090),method=getattr(Image,'Resampling',Image).LANCZOS)
                    canvas.paste(booklet,(175,45))
                    image=Image.alpha_composite(canvas,overlay)
                # Preserve aspect ratio; PNG retains case transparency, JPEG saves space
                # for plain covers. Resampling fallback supports older Pillow releases.
                image.thumbnail((size,size),getattr(Image,'Resampling',Image).LANCZOS)
                output=io.BytesIO()
                if case: image.save(output,format='PNG')
                else: image.save(output,format='JPEG',quality=85)
            self._store_artwork(variant,variant.with_suffix('.type'),output.getvalue(),content_type)
            self._prune_artwork_cache()
        return variant,content_type

    def _serve_artwork_meta(self,artwork_id:str)->None:
        """Return cached/generated spine metadata, or a non-cacheable 404 when unavailable."""
        metadata=self._artwork_metadata(artwork_id)
        self._send_payload(200 if metadata else 404,json.dumps(metadata or {'error':'Artwork metadata unavailable'}).encode(),'application/json; charset=utf-8',cache_control='public, max-age=86400' if metadata else 'no-store')

    def _serve_metadata_batch(self)->None:
        """Prepare at most 64 requested artwork IDs using the shared worker pool."""
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
        """Reuse or upgrade cached spine metadata; return None for unavailable artwork."""
        key=hashlib.sha256(f'{self.lms_url}\0{artwork_id}'.encode()).hexdigest();meta_path=self.cache_dir/f'{key}.meta'
        # Hash the artwork ID for a repeatable local font choice, not a new random
        # choice on each load. Cache keys also include LMS to isolate servers.
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
                    # A one-pixel filtered sample approximates the overall cover colour;
                    # use the original cover, not the dark plastic case composition.
                    sample=image.convert('RGB').resize((1,1),getattr(Image,'Resampling',Image).BILINEAR)
                    red,green,blue=ImageStat.Stat(sample).mean
                spine_color=f'#{round(red):02x}{round(green):02x}{round(blue):02x}'
                luminance=(0.299*red+0.587*green+0.114*blue)/255
                metadata={'spine_color':spine_color,'text_color':'#111417' if luminance>.62 else '#f5f2ea'}
            metadata['spine_font']=font
            metadata['colour_index']=colour_sort_index(metadata['spine_color'])
            payload=json.dumps(metadata).encode()
            # Per-thread temporary names avoid collisions; readers see a whole JSON
            # document after replace, rather than a partially written cache entry.
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
        """Serve original LMS artwork from disk, fetching it only on a cache miss."""
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
        """Publish image bytes and their MIME sidecar via temporary-file replacements."""
        if getattr(self,'background_warming',False):
            used=sum(path.stat().st_size for path in self.cache_dir.glob('*.img') if path.exists())
            if used+len(payload)>self._cache_limit_bytes(): raise CacheFull()
        # Each file replacement is atomic; image and MIME sidecar are separate files.
        suffix=f'.{os.getpid()}.{threading.get_ident()}.tmp'; image_temp=cache_path.with_name(cache_path.name+suffix); type_temp=type_path.with_name(type_path.name+suffix)
        try: image_temp.write_bytes(payload); type_temp.write_text(content_type,encoding='ascii'); image_temp.replace(cache_path); type_temp.replace(type_path)
        finally: image_temp.unlink(missing_ok=True); type_temp.unlink(missing_ok=True)
    def _prune_artwork_cache(self)->None:
        """Evict oldest-written images and matching sidecars until within the byte limit."""
        if getattr(self,'background_warming',False): return
        entries=[]; total=0
        for path in self.cache_dir.glob('*.img'):
            try:
                size=path.stat().st_size; entries.append((path.stat().st_mtime,path,size)); total+=size
            except OSError: continue
        # This is oldest-write eviction, not LRU: cache hits do not touch mtime.
        for _,path,size in sorted(entries):
            if total<=self._cache_limit_bytes(): break
            try:
                path.unlink(); path.with_suffix('.type').unlink(missing_ok=True); path.with_suffix('.meta').unlink(missing_ok=True); total-=size
            except OSError: continue
    def _read_limited(self,response,limit:int)->bytes:
        """Bound buffered response bytes even when Content-Length is absent or incorrect."""
        content_length=response.headers.get('Content-Length')
        try:
            if content_length is not None and int(content_length)>limit: raise UpstreamPayloadTooLarge(f'Upstream response exceeds {limit} bytes')
        except ValueError: pass
        # Read at most one byte past the limit to detect an oversized streamed body.
        chunks=[]; total=0
        while True:
            chunk=response.read(min(65536,limit-total+1))
            if not chunk: break
            chunks.append(chunk); total+=len(chunk)
            if total>limit: raise UpstreamPayloadTooLarge(f'Upstream response exceeds {limit} bytes')
        return b''.join(chunks)
    def _relay(self,request:Request,timeout:int=10)->None:
        """Forward an LMS response with a size bound and no browser response caching."""
        try:
            with urlopen(request,timeout=timeout) as response: self._send_payload(response.status,self._read_limited(response,MAX_UPSTREAM_BYTES),response.headers.get('Content-Type','application/octet-stream'),cache_control='no-store')
        except HTTPError as error: self._send_http_error(error)
        except UpstreamPayloadTooLarge as error: self._send_upstream_error(error)
        except (URLError,TimeoutError,OSError) as error: self._send_upstream_error(error)
    def _send_http_error(self,error:HTTPError)->None:
        """Preserve an upstream HTTP status and body, subject to the response size limit."""
        try: payload=self._read_limited(error,MAX_UPSTREAM_BYTES)
        except UpstreamPayloadTooLarge as too_large: self._send_upstream_error(too_large); return
        self._send_payload(error.code,payload,error.headers.get('Content-Type','text/plain'),cache_control='no-store')
    # Network/processing failures become a gateway error; upstream HTTP errors above
    # keep their original status instead.
    def _send_upstream_error(self,error:Exception)->None: self._send_payload(502,f'Could not contact LMS: {error}'.encode('utf-8','replace'),'text/plain; charset=utf-8',cache_control='no-store')
    def _send_payload(self,status:int,payload:bytes,content_type:str,*,cache_control:str,extra_headers:dict[str,str]|None=None)->None:
        """Write a complete buffered HTTP response with explicit length, type and caching."""
        self.send_response(status); self.send_header('Content-Type',content_type); self.send_header('Content-Length',str(len(payload))); self.send_header('Cache-Control',cache_control)
        for name,value in (extra_headers or {}).items(): self.send_header(name,value)
        self.end_headers(); self.wfile.write(payload)

def main()->int:
    """Read configuration, initialise the cache and run the threaded HTTP server."""
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--lms',default='http://mrlazy:9000',help='LMS base URL'); parser.add_argument('--bind',default='127.0.0.1',help='Address to listen on'); parser.add_argument('--port',type=int,default=8088,help='HTTP port')
    parser.add_argument('--batch-size',type=positive_int,default=40,help='Albums per LMS batch'); parser.add_argument('--idle-return-seconds',type=non_negative_int,default=30,help='Idle time before returning to the playing album; 0 disables')
    parser.add_argument('--reconnect-max-seconds',type=positive_int,default=30,help='Maximum reconnect backoff'); parser.add_argument('--random-scroll-max-seconds',type=positive_int,default=3,help='Maximum random and idle-return scroll duration'); parser.add_argument('--search-limit',type=positive_int,default=100,help='Maximum albums returned by a search'); parser.add_argument('--cache-dir',help='Persistent artwork cache directory (default: .cache/album-art)'); parser.add_argument('--cache-limit-mb',type=positive_int,default=MAX_ARTWORK_CACHE_BYTES//1_000_000,help='Default artwork cache limit in MB'); parser.add_argument('--cache-hard-limit-mb',type=positive_int,default=MAX_ARTWORK_CACHE_HARD_BYTES//1_000_000,help='Maximum artwork cache limit clients may select in MB'); parser.add_argument('--clear-cache',action='store_true',help='Clear the persistent artwork cache before starting'); args=parser.parse_args()
    if args.cache_limit_mb>args.cache_hard_limit_mb: parser.error('--cache-limit-mb must not exceed --cache-hard-limit-mb')
    static_dir=Path(__file__).resolve().parent; cache_dir=Path(args.cache_dir).expanduser().resolve() if args.cache_dir else static_dir/'.cache'/'album-art'
    if args.clear_cache and cache_dir.exists():
        removed=sum(1 for path in cache_dir.rglob('*') if path.is_file()); shutil.rmtree(cache_dir); print(f"Cleared artwork cache: {removed} file{'s' if removed!=1 else ''} removed from {cache_dir}")
    cache_dir.mkdir(parents=True,exist_ok=True)
    # Shared mutable defaults are exposed to the browser. UI durations use ms;
    # CLI durations use seconds. The handler factory reads the current LMS target.
    runtime_config={'batch_size':args.batch_size,'idle_return_ms':args.idle_return_seconds*1000,'library_check_ms':0,'reconnect_max_ms':args.reconnect_max_seconds*1000,'random_scroll_max_ms':args.random_scroll_max_seconds*1000,'search_limit':args.search_limit,'cache_limit_bytes':args.cache_limit_mb*1_000_000,'cache_hard_limit_bytes':args.cache_hard_limit_mb*1_000_000,'lms_url':args.lms.rstrip('/')}
    def handler(*handler_args,**handler_kwargs): return LyrionCarouselHandler(*handler_args,directory=str(static_dir),lms_url=runtime_config['lms_url'],cache_dir=cache_dir,runtime_config=runtime_config,**handler_kwargs)
    # Long-poll connections must not block ordinary artwork and control requests.
    server=ThreadingHTTPServer((args.bind,args.port),handler)
    if args.bind in {'0.0.0.0','::'}: print('Lyrion Carousel listening on all network interfaces.'); print(f'Open: http://{socket.gethostname()}:{args.port}/ or http://<server-ip>:{args.port}/')
    else: print(f'Lyrion Carousel: http://{args.bind}:{args.port}/')
    print(f'Lyrion server: {args.lms}'); print(f'Artwork cache: {cache_dir}'); print(f'Runtime config: batch={args.batch_size}, idle={args.idle_return_seconds}s, library-events=CometD, live-status=CometD, album-index=lightweight, random-scroll-max={args.random_scroll_max_seconds}s')
    try: server.serve_forever()
    except KeyboardInterrupt: print('\nStopping.')
    finally: server.server_close()
    return 0
if __name__=='__main__': sys.exit(main())
