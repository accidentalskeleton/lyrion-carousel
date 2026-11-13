#!/usr/bin/env python3
"""Serve Lyrion Carousel and proxy its requests to Lyrion Music Server."""
from __future__ import annotations
import time, io, random, argparse, colorsys, hashlib, ipaddress, json, os, re, shutil, socket, sqlite3, sys, threading
from indexed_order import indexed_album_order
import metadata_db
from collections import deque
from concurrent.futures import ThreadPoolExecutor
from collections import OrderedDict
from contextlib import closing
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from demo_sessions import DEMO_SESSIONS
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlsplit, parse_qs
from urllib.request import Request, urlopen
from PIL import Image, ImageStat, ImageOps

# Architecture: HTTP threads serve static files and a small set of LMS proxy APIs.
# Image processing and catalogue ordering happen here, leaving the browser to
# render and interact. Disk caches survive restarts; job progress does not.
# The pool below is shared across metadata requests; the optional artwork warmer
# has its own single daemon thread so it does not occupy this foreground pool.
METADATA_WORKERS=ThreadPoolExecutor(max_workers=6,thread_name_prefix="album-metadata")
_CATALOGUE_CODES=OrderedDict()
_CATALOGUE_CODES_LOCK=threading.Lock()

# Incremental image-cache accounting avoids scanning thousands of cache files
# after every newly generated cover. The first write after restart establishes
# a disk baseline; explicit pruning/clearing reconciles the counter.
_IMAGE_CACHE_LOCK=threading.RLock()
_IMAGE_CACHE_BYTES={}
# One snapshot for each LMS target and cache directory. Locks protect concurrent
# catalogue HTTP requests; the on-disk snapshots survive application restarts.
_CATALOGUE_LOCK=threading.RLock()
_CATALOGUE_MEMORY={}
CATALOGUE_SNAPSHOT_VERSION=3
CATALOGUE_SNAPSHOT_TTL_SECONDS=900
CATALOGUE_MAX_SNAPSHOT_BYTES=64_000_000
CATALOGUE_SORT_CACHE_ENTRIES=4
CATALOGUE_SORT_CACHE_MAX_BYTES=32*1024*1024
# LMS never calls Carousel. The browser observes ordinary LMS scan status and
# asks Carousel to reconcile its own snapshot before deciding to refresh the UI.
MAX_BACKGROUND_COLOUR_QUEUE=20_000
# Store indexed cover colours in small SQLite transactions instead of rewriting
# a full 10,000+ album snapshot whenever a user scrolls to new albums.
COLOUR_INDEX_VERSION=1
# The selected LMS belongs to the appliance, not solely to the web browser.
# Keep it outside /artwork so Settings -> Clear Cache cannot reset it.
LMS_SETTINGS_FILENAME='lyrion-carousel-lms.json'
MAX_LMS_SETTINGS_BYTES=4096
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
SPINE_TEXT_STYLE_VERSION=3
def spine_relative_luminance(colour:str)->float:
    components=[int(colour[i:i+2],16)/255 for i in (1,3,5)]
    linear=[v/12.92 if v<=.04045 else ((v+.055)/1.055)**2.4 for v in components]
    return .2126*linear[0]+.7152*linear[1]+.0722*linear[2]

def spine_contrast_ratio(a:str,b:str)->float:
    bright,dark=sorted((spine_relative_luminance(a),spine_relative_luminance(b)),reverse=True)
    return (bright+.05)/(dark+.05)

def select_spine_text_colour(spine_colour:str,artwork_key:str)->str:
    """Compute a cover-related coloured ink with >=4.5:1 luminance contrast.

    Rotate the cover hue and adapt ink lightness to its actual background.
    Near-grey covers get a reproducible hue instead of arbitrary black/white.
    A tiny album-specific hue offset prevents otherwise identical rows.
    """
    red,green,blue=(int(spine_colour[i:i+2],16)/255 for i in (1,3,5))
    hue,lightness,saturation=colorsys.rgb_to_hls(red,green,blue)
    digest=hashlib.sha256(artwork_key.encode()).digest()
    if saturation<.12:
        hue=int.from_bytes(digest[:2],'big')/65536
    hue=(hue+.5+(digest[2]/255-.5)*.13)%1
    ink_saturation=.68 if saturation>.12 else .58

    def colour_at(ink_lightness):
        channels=colorsys.hls_to_rgb(hue,ink_lightness,ink_saturation)
        return '#'+''.join(f'{round(c*255):02x}' for c in channels)

    # Find the most saturated-looking readable shade near an ideal ink tone,
    # avoiding unnecessarily pale or dark text. Search either contrast side.
    luminance=spine_relative_luminance(spine_colour)
    prefer_light=luminance<.179  # midpoint in luminance where 4.5:1 flips
    candidates=[]
    for i in range(3,98):
        l=i/100
        colour=colour_at(l)
        if spine_contrast_ratio(colour,spine_colour)>=4.5:
            ideal=.74 if prefer_light else .28
            candidates.append((abs(l-ideal),abs(l-.5),colour))
    if candidates:
        return min(candidates)[2]
    # Last resort guarantees minimum contrast even after RGB rounding.
    white='#ffffff'
    black='#000000'
    return white if spine_contrast_ratio(white,spine_colour)>=spine_contrast_ratio(black,spine_colour) else black

# Accept LMS identifiers, but never path separators supplied in an artwork URL.
ARTWORK_ID=re.compile(r"^[A-Za-z0-9._:@%-]+$")
def colour_sort_index(colour:str)->int:
    """Hue runs red through violet; near-neutral colours follow dark to light."""
    red,green,blue=(int(colour[offset:offset+2],16)/255 for offset in (1,3,5))
    hue,saturation,value=colorsys.rgb_to_hsv(red,green,blue)
    hue_band=360 if saturation<.12 else min(359,int(hue*360))
    return hue_band*1_000_000+round(value*1000)*1000+round(saturation*1000)

def valid_colour_metadata(details)->bool:
    if not isinstance(details,dict):return False
    colour=details.get('spine_color')
    if not isinstance(colour,str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',colour):
        return False
    return (details.get('colour_index')==colour_sort_index(colour)
            and isinstance(details.get('text_color'),str)
            and isinstance(details.get('spine_font'),str))

def validate_lms_url(value)->str:
    """Normalise the same safe, unauthenticated LMS URL format used by Settings."""
    if not isinstance(value,str):raise ValueError('LMS URL must be a string')
    lms_url=value.strip().rstrip('/')
    parsed=urlsplit(lms_url)
    if (parsed.scheme not in ('http','https') or not parsed.hostname or
            parsed.username or parsed.password or parsed.query or parsed.fragment):
        raise ValueError('Invalid LMS URL')
    # Trigger urllib validation for malformed numeric ports.
    _=parsed.port
    return lms_url

# Host and cross-site request checks reduce DNS-rebinding and CSRF exposure.
# They are not authentication: keep the service reachable only on a trusted LAN.
_RFC1918_NETWORKS=tuple(ipaddress.ip_network(network) for network in
                        ('10.0.0.0/8','172.16.0.0/12','192.168.0.0/16'))
_IPV6_LOCAL_NETWORKS=tuple(ipaddress.ip_network(network) for network in
                           ('fc00::/7','fe80::/10'))

def local_allowed_hosts(extra:str='')->frozenset[str]:
    """Only explicitly configured names are trusted; never trust all .local names."""
    hostname=socket.gethostname().strip().lower().rstrip('.')
    names={'localhost','localhost.localdomain'}
    for name in (hostname,hostname+'.local',*extra.split(',')):
        name=name.strip().lower()
        if (name and name==name.rstrip('.') and len(name)<=253
                and all(re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?',part)
                        for part in name.split('.'))):
            names.add(name)
    return frozenset(names)

def is_local_request_host(value:str|None,allowed_hosts:frozenset[str]|set[str]=frozenset())->bool:
    """Validate one exact Host authority; reject public names and non-LAN IPs."""
    if not isinstance(value,str) or not value or value!=value.strip() or ',' in value:
        return False
    if any(ord(ch)<33 or ord(ch)==127 for ch in value):
        return False
    try:
        parsed=urlsplit('//'+value)
        if (not parsed.hostname or parsed.username is not None or parsed.password is not None
                or parsed.path or parsed.query or parsed.fragment or parsed.netloc!=value):
            return False
        port=parsed.port  # Trigger strict port parsing.
        if port is not None and port<1:return False
    except ValueError:
        return False
    host=parsed.hostname.lower()
    if host.endswith('.') or '%' in host:return False
    try:
        address=ipaddress.ip_address(host)
    except ValueError:
        # Reject numeric-looking IPv4 forms rather than treating them as DNS names.
        if re.fullmatch(r'[0-9.]+',host):return False
        if (len(host)>253 or not all(
                re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?',label)
                for label in host.split('.'))):
            return False
        return host in allowed_hosts
    if address.is_unspecified or address.is_multicast or address.is_reserved:
        # IPv6 ULA may be considered reserved by some Python versions; allow
        # only the explicitly enumerated private ranges below.
        if address.version==4:return False
    if address.version==4:
        return address.is_loopback or any(address in network for network in _RFC1918_NETWORKS)
    return (address.is_loopback or any(address in network for network in _IPV6_LOCAL_NETWORKS))

def same_origin_header(origin:str|None,host:str)->bool:
    """An absent Origin is permitted only with the custom non-simple POST header."""
    if origin is None:return True
    if not isinstance(origin,str) or origin=='null' or origin!=origin.strip():
        return False
    try:
        parsed=urlsplit(origin)
        authority=urlsplit('//'+host)
        return (parsed.scheme in ('http','https') and parsed.hostname is not None
                and not parsed.username and not parsed.password and not parsed.path
                and not parsed.query and not parsed.fragment
                and parsed.hostname.lower()==authority.hostname.lower()
                and parsed.port==authority.port)
    except (ValueError,AttributeError):
        return False

def load_saved_lms_url(path:Path,fallback:str)->str:
    """Use the persisted server choice, falling back to systemd/CLI on first run."""
    try:
        if path.stat().st_size>MAX_LMS_SETTINGS_BYTES:raise ValueError('Oversized LMS settings')
        payload=json.loads(path.read_bytes())
        if not isinstance(payload,dict) or payload.get('version')!=1:
            raise ValueError('Unsupported LMS settings')
        return validate_lms_url(payload.get('lms_url'))
    except (OSError,ValueError,UnicodeError,TypeError,AttributeError):
        return fallback

def save_lms_url(path:Path,lms_url:str)->None:
    """Atomically persist the LMS choice outside the artwork-cache tree."""
    payload=json.dumps({'version':1,'lms_url':validate_lms_url(lms_url)}).encode('utf-8')
    path.parent.mkdir(parents=True,exist_ok=True)
    temporary=path.with_name(path.name+f'.{os.getpid()}.{threading.get_ident()}.tmp')
    try:
        temporary.write_bytes(payload)
        temporary.replace(path)
    finally:
        temporary.unlink(missing_ok=True)

def remember_catalogue_order(orders:OrderedDict,key:tuple,payload:bytes)->bool:
    """Cache serialized orders within both entry and byte limits (oldest first).

    Oversized payloads are returned to callers but not retained. The count
    is tiny (four), so summing current payload lengths avoids mutable
    accounting that could become stale after snapshot or colour invalidation.
    """
    orders.pop(key,None)
    if len(payload)>CATALOGUE_SORT_CACHE_MAX_BYTES:return False
    orders[key]=payload
    while (len(orders)>CATALOGUE_SORT_CACHE_ENTRIES or
           sum(len(value) for value in orders.values())>CATALOGUE_SORT_CACHE_MAX_BYTES):
        orders.popitem(last=False)
    return True

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

class CarouselColourIndexer:
    """Low-priority, single-worker queue driven only by Carousel's own checks."""
    def __init__(self):
        self.lock=threading.RLock()
        self.queue=deque()
        self.queued=set()
        self.thread=None
        self.stop_event=threading.Event()
        self.target=None
        self.last_foreground=0.0
        self.completed=0
        self.failed=0
        self.status='idle'

    def stop(self):
        with self.lock:
            self.stop_event.set()
            self.queue.clear()
            self.queued.clear()
            self.target=None
            # The old worker may be completing a network request; its stop
            # event stays set while a future queue starts with a fresh worker.
            self.thread=None
            self.status='stopped'

    def snapshot(self):
        with self.lock:
            return {'status':self.status,'queued':len(self.queue),
                    'completed':self.completed,'failed':self.failed}

    def enqueue(self,handler,artwork_ids):
        """Queue only new artwork, without holding a request or network socket."""
        target=(str(handler.cache_dir.resolve()),handler.lms_url)
        with self.lock:
            if self.target!=target:
                self.stop_event.set()
                self.stop_event=threading.Event()
                self.target=target
                self.thread=None
                self.queue.clear()
                self.queued.clear()
                self.completed=0
                self.failed=0
            for artwork_id in artwork_ids:
                artwork_id=str(artwork_id)
                if not ARTWORK_ID.fullmatch(artwork_id) or artwork_id in self.queued:
                    continue
                if len(self.queue)>=MAX_BACKGROUND_COLOUR_QUEUE:break
                self.queued.add(artwork_id)
                self.queue.append(artwork_id)
            if not self.queue:return
            self.status='running'
            if self.thread is None or not self.thread.is_alive() or getattr(self.thread,'colour_target',None)!=target:
                worker=object.__new__(LyrionCarouselHandler)
                worker.cache_dir=handler.cache_dir
                worker.lms_url=handler.lms_url
                worker.runtime_config=getattr(handler,'runtime_config',{})
                worker.background_warming=True
                event=self.stop_event
                self.thread=threading.Thread(target=self.run,args=(worker,event,target),
                                             daemon=True,name='carousel-colour-index')
                self.thread.colour_target=target
                self.thread.start()

    def run(self,worker,event,target):
        """Yield to foreground browsing and the artwork warmer, one cover at a time."""
        while not event.is_set():
            with self.lock:
                if self.target!=target or event is not self.stop_event:break
                if not self.queue:
                    self.status='complete'
                    if self.thread is threading.current_thread():self.thread=None
                    return
                artwork_id=self.queue.popleft()
                self.queued.discard(artwork_id)
            while not event.is_set() and time.monotonic()-self.last_foreground<1.5:
                event.wait(.25)
            if event.is_set():break
            try:
                # Coordinate with cache clear and existing artwork warming.
                with ARTWORK_WARMER.io_lock:
                    if event.is_set():break
                    details=worker._artwork_metadata(artwork_id)
                    if details:
                        worker._remember_catalogue_colours({artwork_id:details})
                    else:
                        raise ValueError('Artwork metadata unavailable')
            except (OSError,ValueError,URLError,UpstreamPayloadTooLarge,CacheFull) as error:
                print(f'Colour indexing failed for artwork {artwork_id}: {type(error).__name__}: {error}',file=sys.stderr,flush=True)
                with self.lock:
                    if self.target==target and event is self.stop_event:self.failed+=1
            else:
                with self.lock:
                    if self.target==target and event is self.stop_event:self.completed+=1
            event.wait(.4)
        with self.lock:
            if self.thread is threading.current_thread():self.thread=None
            if self.target==target and event is self.stop_event:
                self.status='cancelled' if event.is_set() else 'complete'

COLOUR_INDEXER=CarouselColourIndexer()

class LyrionCarouselHandler(SimpleHTTPRequestHandler):
    server_version="LyrionCarousel/1.0"
    def __init__(self,*args,directory:str,lms_url:str,cache_dir:Path,runtime_config:dict[str,object],**kwargs):
        self.lms_url=lms_url.rstrip('/'); self.cache_dir=cache_dir; self.runtime_config=runtime_config
        self.lms_settings_path=cache_dir.parent/LMS_SETTINGS_FILENAME
        self.allowed_hosts=runtime_config.get('_allowed_hosts',local_allowed_hosts())
        super().__init__(*args,directory=directory,**kwargs)
    def parse_request(self)->bool:
        """Validate Host on every request and protect all POST endpoints."""
        if not super().parse_request():return False
        hosts=self.headers.get_all('Host',[])
        allowed=getattr(self,'allowed_hosts',local_allowed_hosts())
        if len(hosts)!=1 or not is_local_request_host(hosts[0],allowed):
            self.send_error(403,'Unrecognised Host header')
            return False
        if self.command=='POST':
            # The header makes cross-site HTML forms/simple requests unusable;
            # no CORS policy permits a foreign site to set it by fetch().
            app_headers=self.headers.get_all('X-Lyrion-Request',[])
            if app_headers!=['1']:
                self.send_error(403,'Missing application request header')
                return False
            fetch_sites=self.headers.get_all('Sec-Fetch-Site',[])
            if len(fetch_sites)>1 or (fetch_sites and fetch_sites[0] not in ('same-origin','none')):
                self.send_error(403,'Cross-site request denied')
                return False
            origins=self.headers.get_all('Origin',[])
            if len(origins)>1 or (origins and not same_origin_header(origins[0],hosts[0])):
                self.send_error(403,'Cross-origin request denied')
                return False
        return True
    def end_headers(self)->None:
        """Revalidate application assets; image endpoints supply their own cache policy."""
        if urlsplit(self.path).path not in {'/api/config','/api/lms','/api/cometd','/api/config/lms','/api/config/cache','/api/build','/api/cache/clear','/api/catalogue','/api/catalogue/status','/api/catalogue/invalidate','/api/catalogue/reconcile'} and not urlsplit(self.path).path.startswith(('/api/art/','/api/art-meta/')):
            self.send_header('Cache-Control','no-cache')
        super().end_headers()
    def do_POST(self)->None:
        """Dispatch state-changing/cache APIs or forward bounded JSON to LMS."""
        path=urlsplit(self.path).path
        if path=='/api/demo': self._demo_post(); return
        if path=='/api/catalogue-codes': self._serve_catalogue_codes(); return
        if path=='/api/cache/warm': self._warm_cache(); return
        if path=='/api/art-meta':
            COLOUR_INDEXER.last_foreground=time.monotonic()
            self._serve_metadata_batch(); return
        if path=='/api/catalogue/reconcile': self._reconcile_catalogue(); return
        if path=='/api/catalogue/invalidate': self._invalidate_catalogue(); return
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
        COLOUR_INDEXER.stop()
        with ARTWORK_WARMER.io_lock: self._clear_cache_files()

    def _clear_cache_files(self)->None:
        """Delete cache files and report the number removed to the Settings UI."""
        removed=0
        try:
            # Catalogue sorting may generate artwork and take the IMAGE lock.
            # Take locks in that same order to avoid deadlocks during clearing.
            with _CATALOGUE_LOCK:
                with _IMAGE_CACHE_LOCK:
                    for path in self.cache_dir.rglob('*'):
                        if path.is_file() or path.is_symlink(): path.unlink(); removed+=1
                    _IMAGE_CACHE_BYTES.pop(str(self.cache_dir.resolve()),None)
                # Keep the SQLite deletion under the same catalogue lock so
                # another request cannot repopulate a snapshot during clearing.
                metadata_db.clear_generated(self._metadata_db_path())
                _CATALOGUE_MEMORY.clear()
            self._send_payload(200,json.dumps({'removed':removed}).encode(),'application/json; charset=utf-8',cache_control='no-store')
        except (OSError,sqlite3.Error,ValueError) as error: self._send_upstream_error(error)
    def _update_lms_url(self)->None:
        """Update the shared proxy target; subsequent HTTP handlers use the new URL."""
        try:
            length=int(self.headers.get('Content-Length','0'))
            if length<1 or length>MAX_RPC_BYTES: self.send_error(413,'Invalid request size'); return
            payload=json.loads(self.rfile.read(length))
            value=payload.get('lms_url') if isinstance(payload,dict) else None
            lms_url=validate_lms_url(value)
            # Keep the server and browser in agreement after restarts. Persist
            # before returning 200; if the disk write fails, keep the old URL.
            save_lms_url(getattr(self,'lms_settings_path',
                              self.cache_dir.parent/LMS_SETTINGS_FILENAME),lms_url)
            ARTWORK_WARMER.stop()
            COLOUR_INDEXER.stop()
            # An earlier snapshot of this server can be stale after switching.
            self._invalidate_catalogue_data(lms_url=lms_url)
            self.runtime_config['lms_url']=lms_url
            self.lms_url=lms_url
            self._send_payload(200,json.dumps({'lms_url':lms_url}).encode(),'application/json; charset=utf-8',cache_control='no-store')
        except (ValueError,TypeError,UnicodeDecodeError,json.JSONDecodeError): self.send_error(400,'Invalid LMS URL')
        except OSError as error:self._send_upstream_error(error)
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
            if path.suffix not in ('.img','.type'): continue
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
        if path.startswith(('/api/art/','/api/art-meta/')):
            ARTWORK_WARMER.last_foreground=time.monotonic()
            COLOUR_INDEXER.last_foreground=time.monotonic()
        if path=='/api/catalogue': self._serve_catalogue(); return
        if path=='/api/catalogue/status': self._serve_catalogue_status(); return
        if path=='/api/diagnostics/spotty': self._serve_spotty_diagnostic(); return
        if path=='/api/diagnostics/now-playing': self._serve_now_playing_diagnostic(); return
        if path=='/api/spotty-art': self._serve_spotty_art(); return
        if path=='/api/spotty-art-meta': self._serve_spotty_art_meta(); return
        if path=='/api/build': self._serve_build_info(); return
        if path=='/api/config': self._send_payload(200,json.dumps({k:v for k,v in self.runtime_config.items() if not k.startswith('_')}).encode(),'application/json; charset=utf-8',cache_control='no-store'); return
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

    def _serve_build_info(self)->None:
        """Report the installed server build, independent of browser asset caches."""
        directory=Path(self.directory)
        info={}
        try:
            saved=json.loads((directory/'BUILD_INFO.json').read_text(encoding='utf-8'))
            if isinstance(saved,dict):info=saved
        except (OSError,ValueError,UnicodeError):
            pass
        try:
            version=(directory/'VERSION').read_text(encoding='utf-8').strip()
        except (OSError,UnicodeError):
            version=''
        if not re.fullmatch(r'[0-9A-Za-z.+:~-]{1,100}',version):version='unknown'
        commit=info.get('commit')
        if not isinstance(commit,str) or not re.fullmatch(r'[0-9a-f]{40}',commit):commit=None
        self._send_payload(200,json.dumps({'version':version,'commit':commit}).encode(),
                           'application/json; charset=utf-8',cache_control='no-store')

    def _demo_post(self)->None:
        """Explicitly opt into a visual-only session, or publish a bounded step."""
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=1024: raise ValueError
            data=json.loads(self.rfile.read(length))
            if not isinstance(data,dict): raise ValueError
            action=data.get('action')
            if action=='create':
                payload=DEMO_SESSIONS.create()
            elif action=='join':
                code=data.get('code','')
                if not isinstance(code,str) or len(code)!=8 or not all(c in '0123456789ABCDEF' for c in code): raise ValueError
                payload=DEMO_SESSIONS.join(code)
            elif action=='state':
                code=data.get('code','')
                token=data.get('viewer','')
                if not isinstance(code,str) or not isinstance(token,str) or len(token)>100: raise ValueError
                payload=DEMO_SESSIONS.state(code,token)
            elif action in ('step','stop'):
                code=data.get('code','')
                token=data.get('controller','')
                if not isinstance(code,str) or not isinstance(token,str) or len(token)>100: raise ValueError
                payload=DEMO_SESSIONS.update(code,token,action,data.get('step'),data.get('source'),data.get('album_id'))
            else: raise ValueError
        except (ValueError,TypeError,UnicodeDecodeError,json.JSONDecodeError):
            self.send_error(400,'Invalid demo request'); return
        if payload is None:
            self.send_error(403,'Demo session unavailable or unauthorised'); return
        self._send_payload(200,json.dumps(payload).encode(),'application/json; charset=utf-8',cache_control='no-store')

    def _lms_rpc(self,player_id:str,command:list[object])->dict:
        body=json.dumps({'id':1,'method':'slim.request','params':[player_id,command]}).encode()
        with urlopen(Request(f'{self.lms_url}/jsonrpc.js',data=body,headers={'Content-Type':'application/json'}),timeout=15) as response:
            payload=json.loads(self._read_limited(response,MAX_UPSTREAM_BYTES))
        return payload.get('result',{}) if isinstance(payload,dict) else {}

    def _serve_spotty_art(self)->None:
        """Proxy/cache Spotty artwork and optionally render the same jewel-case variant as local albums."""
        try:
            query=parse_qs(urlsplit(self.path).query)
            raw=query.get('path',[''])[0]
            size_raw=query.get('size',[''])[0]
            case=query.get('case',[''])[0]=='realistic-v1'
            revision=query.get('revision',[''])[0]
            if len(revision)>256: raise ValueError('Invalid artwork revision')
            key,payload,content_type=self._spotty_artwork(raw,revision)
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
                    self._store_artwork(variant,type_path,payload,content_type); self._prune_artwork_cache(force=False)
            self._send_payload(200,payload,content_type,cache_control='public, max-age=86400')
        except ValueError as error: self.send_error(400,str(error))
        except HTTPError as error: self._send_http_error(error)
        except (URLError,TimeoutError,OSError,UpstreamPayloadTooLarge) as error: self._send_upstream_error(error)

    def _spotty_artwork(self,raw:str,revision:str=""):
        """Return cached Spotty artwork bytes and content type, fetching through LMS if needed."""
        if not raw.startswith('/imageproxy/') or len(raw)>4096: raise ValueError('Invalid Spotty artwork path')
        key=hashlib.sha256(f'{self.lms_url}\\0spotty\\0{raw}'.encode()).hexdigest()
        if revision: key=hashlib.sha256(f'{key}|{revision}'.encode()).hexdigest()
        cache_path=self.cache_dir/f'{key}.img'; type_path=self.cache_dir/f'{key}.type'
        try: return key,cache_path.read_bytes(),type_path.read_text(encoding='ascii').strip() or 'image/png'
        except (FileNotFoundError,OSError,UnicodeError): pass
        with urlopen(Request(self.lms_url+raw,method='GET'),timeout=15) as response:
            payload=self._read_limited(response,MAX_ARTWORK_BYTES); content_type=response.headers.get_content_type() or 'image/png'
        self._store_artwork(cache_path,type_path,payload,content_type); self._prune_artwork_cache(force=False)
        return key,payload,content_type

    def _serve_spotty_art_meta(self)->None:
        """Persist Spotify spine metadata in the same SQLite database as Library spines."""
        try:
            raw=parse_qs(urlsplit(self.path).query).get('path',[''])[0]
            key,payload,_=self._spotty_artwork(raw)
            db_path=self._metadata_db_path()
            metadata=metadata_db.artwork_get(db_path,self.lms_url,key,source='spotify')
            font=SPINE_FONTS[int(hashlib.sha256(raw.encode()).hexdigest()[:8],16)%len(SPINE_FONTS)]
            if (not valid_colour_metadata(metadata) or
                    metadata.get('text_style_version')!=SPINE_TEXT_STYLE_VERSION or
                    metadata.get('spine_font')!=font):
                # Preserve the known cover colour when upgrading a cached style.
                # Only decode the original artwork when no valid colour exists.
                colour=metadata.get('spine_color') if isinstance(metadata,dict) else None
                if not isinstance(colour,str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',colour):
                    with Image.open(io.BytesIO(payload)) as image:
                        rgb=image.convert('RGB').resize((1,1),getattr(Image,'Resampling',Image).BILINEAR)
                        red,green,blue=ImageStat.Stat(rgb).mean
                    colour=f'#{round(red):02x}{round(green):02x}{round(blue):02x}'
                metadata={'spine_color':colour,
                          'text_color':select_spine_text_colour(colour,raw),
                          'text_style_version':SPINE_TEXT_STYLE_VERSION,
                          'spine_font':font,'colour_index':colour_sort_index(colour)}
                metadata_db.artwork_put_many(db_path,self.lms_url,{key:metadata},source='spotify')
            self._send_payload(200,json.dumps(metadata).encode(),'application/json; charset=utf-8',cache_control='public, max-age=86400')
        except ValueError as error: self.send_error(400,str(error))
        except HTTPError as error: self._send_http_error(error)
        except (URLError,TimeoutError,OSError,sqlite3.Error,UpstreamPayloadTooLarge) as error: self._send_upstream_error(error)

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

    def _catalogue_pages(self,genre_id:int|None=None,sort:str='artistalbum'):
        """Yield bounded LMS album pages; callers decide how to process the full library."""
        start=0
        while True:
            command=['albums',start,200,f'sort:{sort}','tags:ajlysiq']
            if genre_id is not None: command.append(f'genre_id:{genre_id}')
            body=json.dumps({'id':1,'method':'slim.request','params':['0',command]}).encode()
            with urlopen(Request(f'{self.lms_url}/jsonrpc.js',data=body,headers={'Content-Type':'application/json'}),timeout=10) as response:
                result=json.loads(self._read_limited(response,MAX_UPSTREAM_BYTES))['result']
            page=result.get('albums_loop',[])
            yield page
            start+=len(page)
            if start>=int(result.get('count',start)): return
            if not page: raise ValueError('Incomplete catalogue')

    def _metadata_db_path(self)->Path:
        return metadata_db.database_path(self.cache_dir)

    def _catalogue_snapshot_key(self,lms_url:str|None=None):
        return (str(self.cache_dir.resolve()),lms_url or self.lms_url)

    def _catalogue_revision(self,snapshot)->str:
        """Stable album-content revision; unlike snapshot age it only changes
        when the library's album rows actually change."""
        revision=snapshot.get('revision')
        if not isinstance(revision,str) or not revision:
            revision=self._catalogue_fingerprint(snapshot['albums'])
            snapshot['revision']=revision
        return revision

    def _save_catalogue_snapshot(self,snapshot)->None:
        """Persist the full snapshot in the shared SQLite database."""
        data = {
            'version': CATALOGUE_SNAPSHOT_VERSION,
            'lms_url': self.lms_url,
            'created': snapshot['created'],
            'revision': self._catalogue_revision(snapshot),
            'recent_new_album_ids': snapshot.get('recent_new_album_ids',[]),
            'albums': snapshot['albums'],
            'genres': snapshot['genres'],
            'lms_orders': snapshot.get('lms_orders',{})
        }
        if len(json.dumps(data,ensure_ascii=False).encode('utf-8'))>CATALOGUE_MAX_SNAPSHOT_BYTES:
            return
        metadata_db.snapshot_put(self._metadata_db_path(),self.lms_url,data)

    def _load_catalogue_snapshot(self):
        """Read a valid snapshot, otherwise fetch the complete library exactly once."""
        key=self._catalogue_snapshot_key()
        now=time.time()
        snapshot=_CATALOGUE_MEMORY.get(key)
        if snapshot and 0<=now-snapshot['created']<CATALOGUE_SNAPSHOT_TTL_SECONDS:
            return snapshot
        previous=snapshot if snapshot and isinstance(snapshot.get('albums'),list) else None
        try:
            data=metadata_db.snapshot_get(self._metadata_db_path(),self.lms_url)
            if data is None: raise ValueError('No snapshot')
            if len(json.dumps(data,ensure_ascii=False).encode('utf-8'))>CATALOGUE_MAX_SNAPSHOT_BYTES:raise ValueError('Snapshot too large')
            if (data.get('version')!=CATALOGUE_SNAPSHOT_VERSION or
                    data.get('lms_url')!=self.lms_url or
                    not isinstance(data.get('albums'),list) or
                    not all(isinstance(album,dict) for album in data['albums']) or
                    not isinstance(data.get('genres'),dict) or
                    not all(isinstance(ids,list) and all(isinstance(i,str) for i in ids)
                            for ids in data['genres'].values()) or
                    not isinstance(data.get('created'),(int,float)) or
                    not 0<=now-data['created']<CATALOGUE_SNAPSHOT_TTL_SECONDS):
                raise ValueError('Snapshot outdated')
            expected={str(a['id']) for a in data['albums'] if a.get('id') is not None}
            ranks=data.get('lms_orders')
            ranks=ranks if isinstance(ranks,dict) else {}
            album_rank=ranks.get('album')
            if not (isinstance(album_rank,dict) and
                    isinstance(album_rank.get('ids'),list) and
                    isinstance(album_rank.get('textkeys'),list) and
                    len(album_rank['ids'])==len(album_rank['textkeys'])==len(expected) and
                    all(isinstance(i,str) for i in album_rank['ids']) and
                    all(isinstance(k,str) for k in album_rank['textkeys']) and
                    len(set(album_rank['ids']))==len(expected) and
                    set(album_rank['ids'])==expected):
                ranks={}
            else:ranks={'album':album_rank}
            snapshot={'created':data['created'],'albums':data['albums'],
                      'genres':data['genres'],'colours':self._load_colour_index(),
                      'revision':data.get('revision'),
                      'recent_new_album_ids':data.get('recent_new_album_ids',[]),
                      'lms_orders':ranks,'orders':OrderedDict()}
        except (OSError,ValueError,TypeError,AttributeError,UnicodeError,sqlite3.Error):
            # Cache expiry is not evidence of a new baseline. Retain the
            # previous album identities from SQLite even when too old to
            # serve, because another viewer might refresh the shelf before
            # the scan-completion callback reaches /reconcile.
            if previous is None:
                try:
                    old=metadata_db.snapshot_get(self._metadata_db_path(),self.lms_url)
                    if (isinstance(old,dict) and old.get('version') in (2,CATALOGUE_SNAPSHOT_VERSION)
                            and old.get('lms_url')==self.lms_url and
                            isinstance(old.get('albums'),list) and
                            all(isinstance(a,dict) for a in old['albums'])):
                        previous=old
                except (OSError,sqlite3.Error,ValueError,TypeError):
                    pass
            albums=[album for page in self._catalogue_pages() for album in page]
            recent=[]
            if previous is not None:
                prior={str(a.get('id')) for a in previous['albums'] if a.get('id') is not None}
                recent=[str(a['id']) for a in albums
                        if a.get('id') is not None and str(a['id']) not in prior][:25]
                if not recent and self._catalogue_fingerprint(albums)==self._catalogue_revision(previous):
                    recent=previous.get('recent_new_album_ids',[])
            snapshot={'created':time.time(),'albums':albums,'genres':{},
                      'colours':self._load_colour_index(),
                      'recent_new_album_ids':recent,'lms_orders':{},'orders':OrderedDict()}
            try:self._save_catalogue_snapshot(snapshot)
            except (OSError,sqlite3.Error,ValueError):pass  # Serving the live catalogue takes priority.
        _CATALOGUE_MEMORY[key]=snapshot
        return snapshot

    def _load_colour_index(self)->dict:
        """Load validated local artwork metadata from the shared database."""
        try:
            data=metadata_db.artwork_all(self._metadata_db_path(),self.lms_url)
            return {key:value for key,value in data.items()
                    if valid_colour_metadata(value)}
        except (sqlite3.Error,OSError,ValueError):
            return {}

    def _save_colour_index(self,metadata:dict)->None:
        """Upsert changed spine metadata only, not the whole catalogue."""
        valid={str(key):value for key,value in metadata.items()
               if valid_colour_metadata(value)}
        if valid:metadata_db.artwork_put_many(self._metadata_db_path(),self.lms_url,valid)

    def _colour_index_count(self)->int:
        try:return metadata_db.artwork_count(self._metadata_db_path(),self.lms_url)
        except (sqlite3.Error,OSError,ValueError):return 0

    def _remember_catalogue_colours(self,metadata:dict)->int:
        """Index successful spine batches and invalidate prepared colour orders."""
        with _CATALOGUE_LOCK:
            # Save metadata even when the full album catalogue is not loaded yet.
            # These colours will be available on the first catalogue request.
            snapshot=_CATALOGUE_MEMORY.get(self._catalogue_snapshot_key())
            changed={}
            for artwork_id,details in metadata.items():
                if not valid_colour_metadata(details):continue
                if snapshot and snapshot['colours'].get(artwork_id)==details:continue
                changed[artwork_id]=details
            if not changed:return 0
            try:self._save_colour_index(changed)
            except (sqlite3.Error,OSError):pass
            if snapshot:
                snapshot['colours'].update(changed)
                for key in tuple(snapshot['orders']):
                    if key[0]=='colour':snapshot['orders'].pop(key,None)
            return len(changed)

    def _catalogue_genre_ids(self,snapshot,genres:set[int])->set[str]:
        """Index each excluded genre once; reuse across orders and restarts."""
        excluded=set()
        changed=False
        for genre_id in sorted(genres):
            key=str(genre_id)
            if key not in snapshot['genres']:
                ids={str(album['id']) for page in self._catalogue_pages(genre_id)
                     for album in page if album.get('id') is not None}
                snapshot['genres'][key]=sorted(ids)
                changed=True
            excluded.update(snapshot['genres'][key])
        if changed:
            try:self._save_catalogue_snapshot(snapshot)
            except (OSError,sqlite3.Error):pass
        return excluded

    def _invalidate_catalogue_data(self,lms_url:str|None=None)->None:
        """Forget memory and disk snapshots after an LMS rescan or source change."""
        with _CATALOGUE_CODES_LOCK:
            for key in list(_CATALOGUE_CODES):
                if key[0]==(lms_url or self.lms_url):_CATALOGUE_CODES.pop(key,None)
        with _CATALOGUE_LOCK:
            _CATALOGUE_MEMORY.pop(self._catalogue_snapshot_key(lms_url),None)
            metadata_db.snapshot_delete(self._metadata_db_path(),lms_url or self.lms_url)

    def _invalidate_catalogue(self)->None:
        try:
            self._invalidate_catalogue_data()
            self._send_payload(200,b'{"invalidated":true}','application/json; charset=utf-8',cache_control='no-store')
        except (OSError,sqlite3.Error,ValueError) as error:self._send_upstream_error(error)

    @staticmethod
    def _catalogue_fingerprint(albums)->str:
        """Stable LMS album-row comparison, independent of upstream page ordering."""
        ordered=sorted(albums,key=lambda item:(str(item.get('id','')),json.dumps(item,sort_keys=True)))
        payload=json.dumps(ordered,sort_keys=True,ensure_ascii=False,separators=(',',':'))
        return hashlib.sha256(payload.encode('utf-8')).hexdigest()

    def _previous_catalogue_for_reconcile(self):
        """Compare with memory or the saved snapshot without forcing a new scan."""
        snapshot=_CATALOGUE_MEMORY.get(self._catalogue_snapshot_key())
        if snapshot is not None:return snapshot
        try:
            saved=metadata_db.snapshot_get(self._metadata_db_path(),self.lms_url)
            if saved is None:return None
            if len(json.dumps(saved,ensure_ascii=False).encode('utf-8'))>CATALOGUE_MAX_SNAPSHOT_BYTES:
                return None
            if (saved.get('version') not in (2,CATALOGUE_SNAPSHOT_VERSION) or
                    saved.get('lms_url')!=self.lms_url or
                    not isinstance(saved.get('albums'),list) or
                    not all(isinstance(a,dict) for a in saved['albums'])):
                return None
            return {'albums':saved['albums'],'genres':saved.get('genres',{}),
                    'orders':OrderedDict(),'colours':self._load_colour_index(),
                    'lms_orders':saved.get('lms_orders',{}),
                    'legacy_sort':saved.get('version')!=CATALOGUE_SNAPSHOT_VERSION,
                    'created':saved.get('created',0),'revision':saved.get('revision'),
                    'recent_new_album_ids':saved.get('recent_new_album_ids',[])}
        except (OSError,ValueError,TypeError,UnicodeError,AttributeError,sqlite3.Error):
            return None

    def _reconcile_catalogue(self)->None:
        """Carousel-owned action: check LMS after observing a completed scan.

        LMS does not know this endpoint. The browser requests it after an LMS
        status observation; no LMS hook, ripper action, or cross-service trigger.
        """
        try:
            with _CATALOGUE_LOCK:
                previous=self._previous_catalogue_for_reconcile()
                current=[album for page in self._catalogue_pages() for album in page]
                current_revision=self._catalogue_fingerprint(current)
                changed=(previous is None or
                         self._catalogue_revision(previous)!=current_revision)
                old_by_id={str(a.get('id')):a for a in previous['albums']} if previous else {}
                # Preserve the latest real additions in the snapshot so every
                # browser receives the SAME event even if an earlier browser
                # already reconciled the server. Never announce a cold baseline.
                newly_added=[str(a['id']) for a in current
                             if previous is not None and a.get('id') is not None
                             and str(a['id']) not in old_by_id]
                new_artwork_ids=[]
                already_indexed=self._load_colour_index()
                for album in current:
                    before=old_by_id.get(str(album.get('id')))
                    artwork=album.get('artwork_track_id')
                    if (previous is not None and artwork and
                            (before is None or str(before.get('artwork_track_id'))!=str(artwork)) and
                            str(artwork) not in already_indexed):
                        new_artwork_ids.append(str(artwork))
                # Each scan can change genre assignments without changing album
                # rows. Drop stale genre indexes; browsers with genre filters
                # refresh independently after observing a scan completion.
                snapshot={
                    'created':time.time(),'albums':current,'genres':{},
                    'revision':current_revision,'colours':already_indexed,
                    'recent_new_album_ids':newly_added[:25] if newly_added else (
                        previous.get('recent_new_album_ids',[]) if previous and not changed else []),
                    'lms_orders':{},'orders':OrderedDict()
                } if changed or previous is None or previous.get('legacy_sort') else previous
                snapshot['created']=time.time()
                snapshot['genres']={}
                snapshot.setdefault('lms_orders',{})
                # If album rows are unchanged, keep prepared unfiltered orders
                # and discard only filtered orders (genre membership can move).
                if changed:snapshot['orders'].clear()
                else:
                    for order_key in tuple(snapshot['orders']):
                        if order_key[1]:snapshot['orders'].pop(order_key,None)
                _CATALOGUE_MEMORY[self._catalogue_snapshot_key()]=snapshot
                try:self._save_catalogue_snapshot(snapshot)
                except (OSError,sqlite3.Error):pass
                valid_new_ids=snapshot.get('recent_new_album_ids',[])
                result={'changed':changed,'count':len(current),
                        'revision':self._catalogue_revision(snapshot),
                        'recent_new_album_ids':valid_new_ids if isinstance(valid_new_ids,list) else [],
                        'new_albums':len(newly_added)}
            # Do not hold the catalogue lock while starting background work.
            if new_artwork_ids and self.lms_url==self.runtime_config.get('lms_url',self.lms_url):
                COLOUR_INDEXER.enqueue(self,dict.fromkeys(new_artwork_ids))
            self._send_payload(200,json.dumps(result).encode(),
                               'application/json; charset=utf-8',cache_control='no-store')
        except (OSError,ValueError,KeyError,sqlite3.Error,URLError,UpstreamPayloadTooLarge) as error:
            self._send_upstream_error(error)

    def _serve_catalogue_status(self)->None:
        """Lightweight diagnostics without triggering any LMS requests."""
        key=self._catalogue_snapshot_key()
        with _CATALOGUE_LOCK:
            snapshot=_CATALOGUE_MEMORY.get(key)
            if snapshot:
                age=max(0,time.time()-snapshot['created'])
                state={'cached':age<CATALOGUE_SNAPSHOT_TTL_SECONDS,
                       'source':'memory','age_seconds':round(age,1),
                       'revision':self._catalogue_revision(snapshot),
                       'albums':len(snapshot['albums']),
                       'genre_indexes':len(snapshot['genres']),
                       'colour_indexes':len(snapshot['colours'])}
            else:
                try:
                    data=metadata_db.snapshot_get(self._metadata_db_path(),self.lms_url)
                    if data is None:
                        state={'cached':False,'source':'none'}
                    else:
                        age=max(0,time.time()-float(data['created']))
                        valid=(data.get('version')==CATALOGUE_SNAPSHOT_VERSION and
                               data.get('lms_url')==self.lms_url and
                               age<CATALOGUE_SNAPSHOT_TTL_SECONDS)
                        state={'cached':valid,'source':'database',
                               'age_seconds':round(age,1),
                               'revision':data.get('revision'),
                               'albums':len(data.get('albums',[])),
                               'genre_indexes':len(data.get('genres',{})),
                               'colour_indexes':self._colour_index_count()}
                except (OSError,ValueError,KeyError,TypeError,AttributeError,sqlite3.Error):
                    state={'cached':False,'source':'invalid'}
        # One inexpensive read-only endpoint lets every open browser observe
        # the shared LMS selection and catalogue revision. No LMS scan or
        # album enumeration is triggered by this status request.
        state['colour_indexing']=COLOUR_INDEXER.snapshot()
        self._send_payload(200,json.dumps(state).encode(),'application/json; charset=utf-8',cache_control='no-store')

    def _serve_catalogue(self)->None:
        """Prepare an ordering from a shared, persistent LMS catalogue snapshot."""
        query=parse_qs(urlsplit(self.path).query)
        mode=query.get('order',['artistAlbum'])[0]
        excluded_genre_ids={int(genre_id) for genre_id in query.get('exclude_genre_id',[])
                            if genre_id.isdecimal() and int(genre_id)>0}
        if mode not in ('artistAlbum','album','colour','random','recent','indexed'):
            self.send_error(400,'Invalid album order');return
        try:
            with _CATALOGUE_LOCK:
                snapshot=self._load_catalogue_snapshot()
                order_key=(mode,tuple(sorted(excluded_genre_ids)))
                cached=snapshot['orders'].get(order_key) if mode!='random' else None
                if cached is not None:
                    snapshot['orders'].move_to_end(order_key)
                    payload=cached
                else:
                    excluded_ids=self._catalogue_genre_ids(snapshot,excluded_genre_ids)
                    albums=[album for album in snapshot['albums']
                            if str(album.get('id')) not in excluded_ids]
                    library_count=len(snapshot['albums'])
                    if mode=='album':
                        # Retrieve ALBUMSORT order once per snapshot, store only
                        # IDs and LMS's one-letter sort keys; reuse cover metadata.
                        ranks=snapshot.setdefault('lms_orders',{})
                        rank=ranks.get('album')
                        if not isinstance(rank,dict):
                            rows=[a for page in self._catalogue_pages(sort='album') for a in page]
                            ids=[str(a['id']) for a in rows if a.get('id') is not None]
                            baseline={str(a['id']) for a in snapshot['albums']
                                      if a.get('id') is not None}
                            if (len(ids)!=len(baseline) or len(set(ids))!=len(baseline)
                                    or set(ids)!=baseline):
                                raise ValueError('LMS album order changed during catalogue preparation')
                            rank={'ids':ids,'textkeys':[str(a.get('textkey') or '') for a in rows]}
                            ranks['album']=rank
                            try:self._save_catalogue_snapshot(snapshot)
                            except (OSError,sqlite3.Error,ValueError):pass
                        indexed={str(a['id']):a for a in albums}
                        albums=[dict(indexed[id],textkey=key)
                                for id,key in zip(rank['ids'],rank['textkeys']) if id in indexed]
                    if mode=='recent':
                        # Use LMS's native first-added ranking, NOT modification
                        # dates or unreliable album-ID order. The base snapshot
                        # retains album metadata and genre exclusion indexes.
                        ranked_ids=[str(item['id']) for page in self._catalogue_pages(sort='new')
                                    for item in page if item.get('id') is not None]
                        rank={album_id:i for i,album_id in enumerate(ranked_ids)}
                        albums.sort(key=lambda item:(rank.get(str(item.get('id')),len(rank)),str(item.get('id',''))))
                    if mode=='indexed':
                        # Use current LMS library indexing, not persistent
                        # recording history shared by other releases.
                        ranked_ids=indexed_album_order(snapshot['albums'],self._lms_rpc,
                                                      self._metadata_db_path(),self.lms_url)
                        rank={album_id:i for i,album_id in enumerate(ranked_ids)}
                        albums.sort(key=lambda item:(rank.get(str(item.get('id')),len(rank)),
                                                     str(item.get('id',''))))
                    if mode=='colour':
                        ids=list(dict.fromkeys(str(a['artwork_track_id']) for a in albums
                                               if a.get('artwork_track_id')))
                        # Already indexed artwork is never reopened just to sort.
                        # Fetch only missing colours. Metadata cached in SQLite is
                        # reused by _artwork_metadata before artwork is fetched.
                        missing=[artwork_id for artwork_id in ids
                                 if artwork_id not in snapshot['colours']]
                        if missing:
                            fresh=dict(zip(missing,METADATA_WORKERS.map(self._artwork_metadata,missing)))
                            for artwork_id,details in fresh.items():
                                if isinstance(details,dict):
                                    snapshot['colours'][artwork_id]=details
                            try:self._save_colour_index(fresh)
                            except (sqlite3.Error,OSError):pass
                        metadata=snapshot['colours']
                        albums=[dict(album,spine_metadata=metadata.get(str(album.get('artwork_track_id'))))
                                for album in albums]
                    def key(album):
                        artist=str(album.get('artist','')).casefold()
                        title=str(album.get('album',album.get('title',''))).casefold()
                        tie=(artist,title,str(album.get('id','')))
                        if mode=='colour':
                            return ((album.get('spine_metadata') or {}).get('colour_index',float('inf')),*tie)
                        return tie
                    if mode=='random':random.shuffle(albums)
                    elif mode=='colour':albums.sort(key=key)
                    # Both alphabetical orders preserve LMS native sorting.
                    payload=json.dumps({'count':len(albums),'library_count':library_count,
                                        'snapshot_created':snapshot['created'],
                                        'catalogue_revision':self._catalogue_revision(snapshot),
                                        'albums_loop':albums},ensure_ascii=False).encode('utf-8')
                    if mode!='random':
                        remember_catalogue_order(snapshot['orders'],order_key,payload)
            self._send_payload(200,payload,'application/json; charset=utf-8',cache_control='no-store')
        except (OSError,ValueError,KeyError,sqlite3.Error,URLError,UpstreamPayloadTooLarge) as error:
            self._send_upstream_error(error)

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
            self._prune_artwork_cache(force=False)
        return variant,content_type

    def _serve_artwork_meta(self,artwork_id:str)->None:
        """Return cached/generated spine metadata, or a non-cacheable 404 when unavailable."""
        metadata=self._artwork_metadata(artwork_id)
        self._send_payload(200 if metadata else 404,json.dumps(metadata or {'error':'Artwork metadata unavailable'}).encode(),'application/json; charset=utf-8',cache_control='public, max-age=86400' if metadata else 'no-store')

    def _album_catalogue_code(self,album_id:str)->str:
        key=(self.lms_url,album_id)
        with _CATALOGUE_CODES_LOCK:
            cached=_CATALOGUE_CODES.get(key)
            if cached and time.monotonic()-cached[0]<900:
                _CATALOGUE_CODES.move_to_end(key)
                return cached[1]
        code=''
        try:
            # Carousel never reads the music library, FLAC paths or ripper
            # metadata. LMS owns those files and exposes their raw tags.
            result=self._lms_rpc('0',['titles',0,1,'album_id:'+album_id])
            tracks=result.get('titles_loop',[]) if isinstance(result,dict) else []
            track_id=str(tracks[0].get('id','')) if tracks and isinstance(tracks[0],dict) else ''
            if re.fullmatch(r'[0-9]{1,12}',track_id):
                raw_tags=self._lms_rpc('0',['tags','track_id:'+track_id])
                if isinstance(raw_tags,dict):
                    for name,value in raw_tags.items():
                        if isinstance(name,str) and name.upper() in ('CATALOGNUMBER','CATALOG_NUMBER'):
                            if isinstance(value,str) and value.strip().casefold() not in ('','[none]','none','n/a'):
                                code=value.strip()[:160]
                            break
        except (OSError,ValueError,KeyError,TypeError):return ''
        with _CATALOGUE_CODES_LOCK:
            _CATALOGUE_CODES[key]=(time.monotonic(),code)
            while len(_CATALOGUE_CODES)>2048:_CATALOGUE_CODES.popitem(last=False)
        return code

    def _serve_catalogue_codes(self)->None:
        try:
            length=int(self.headers.get('Content-Length','0'))
            if not 0<length<=MAX_RPC_BYTES:raise ValueError
            payload=json.loads(self.rfile.read(length))
            ids=payload.get('album_ids') if isinstance(payload,dict) else None
            if not isinstance(ids,list) or len(ids)>64 or any(not isinstance(i,str) or not re.fullmatch(r'[0-9]{1,12}',i) for i in ids):raise ValueError
        except (ValueError,UnicodeError):
            self.send_error(400,'Expected up to 64 album IDs');return
        ids=list(dict.fromkeys(ids))
        codes=dict(zip(ids,METADATA_WORKERS.map(self._album_catalogue_code,ids)))
        self._send_payload(200,json.dumps({'codes':codes}).encode(),'application/json; charset=utf-8',cache_control='no-store')

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
        # Album shelf metadata builds the index incrementally; it is flushed
        # periodically rather than rewriting the catalogue on every request.
        self._remember_catalogue_colours(metadata)
        self._send_payload(200,json.dumps({'metadata':metadata}).encode(),'application/json; charset=utf-8',cache_control='no-store')

    def _artwork_metadata(self,artwork_id:str):
        """Load or calculate Library spine metadata from the unified database."""
        key=hashlib.sha256(f'{self.lms_url}\0{artwork_id}'.encode()).hexdigest()
        font=SPINE_FONTS[int(hashlib.sha256(artwork_id.encode()).hexdigest()[:8],16)%len(SPINE_FONTS)]
        try:
            metadata=metadata_db.artwork_get(self._metadata_db_path(),self.lms_url,artwork_id)
            if (valid_colour_metadata(metadata) and
                    metadata.get('text_style_version')==SPINE_TEXT_STYLE_VERSION and
                    metadata.get('spine_font')==font):
                return metadata
            if not isinstance(metadata,dict):
                metadata={}
            colour=metadata.get('spine_color')
            if not isinstance(colour,str) or not re.fullmatch(r'#[0-9a-fA-F]{6}',colour):
                self._ensure_artwork(artwork_id)
                with Image.open(self.cache_dir/f'{key}.img') as image:
                    sample=image.convert('RGB').resize((1,1),getattr(Image,'Resampling',Image).BILINEAR)
                    red,green,blue=ImageStat.Stat(sample).mean
                colour=f'#{round(red):02x}{round(green):02x}{round(blue):02x}'
            metadata={'spine_color':colour,
                      'text_color':select_spine_text_colour(colour,artwork_id),
                      'text_style_version':SPINE_TEXT_STYLE_VERSION,
                      'spine_font':font,'colour_index':colour_sort_index(colour)}
            metadata_db.artwork_put_many(self._metadata_db_path(),self.lms_url,{artwork_id:metadata})
            return metadata
        except (OSError,ValueError,sqlite3.Error,URLError,UpstreamPayloadTooLarge): return None

    def _ensure_artwork(self,artwork_id:str)->None:
        """Populate the disk cache without sending full artwork to a metadata client."""
        key=hashlib.sha256(f'{self.lms_url}\0{artwork_id}'.encode()).hexdigest()
        cache_path=self.cache_dir/f'{key}.img'
        if cache_path.is_file(): return
        with urlopen(Request(f"{self.lms_url}/music/{quote(artwork_id,safe='')}/cover.jpg",method='GET'),timeout=10) as response:
            payload=self._read_limited(response,MAX_ARTWORK_BYTES)
            content_type=response.headers.get_content_type() or 'image/jpeg'
        self._store_artwork(cache_path,cache_path.with_suffix('.type'),payload,content_type)
        self._prune_artwork_cache(force=False)

    def _serve_artwork(self,artwork_id:str)->None:
        """Serve original LMS artwork from disk, fetching it only on a cache miss."""
        key=hashlib.sha256(f'{self.lms_url}\0{artwork_id}'.encode()).hexdigest(); cache_path=self.cache_dir/f'{key}.img'; type_path=self.cache_dir/f'{key}.type'
        try: payload=cache_path.read_bytes(); content_type=type_path.read_text(encoding='ascii').strip() or 'image/jpeg'
        except (FileNotFoundError,OSError,UnicodeError): payload=None
        if payload is not None: self._send_payload(200,payload,content_type,cache_control='public, max-age=86400',extra_headers={'X-Album-Art-Cache':'HIT'}); return
        try:
            with urlopen(Request(f"{self.lms_url}/music/{quote(artwork_id,safe='')}/cover.jpg",method='GET'),timeout=10) as response:
                payload=self._read_limited(response,MAX_ARTWORK_BYTES); content_type=response.headers.get_content_type() or 'image/jpeg'; self._store_artwork(cache_path,type_path,payload,content_type); self._prune_artwork_cache(force=False); self._send_payload(response.status,payload,content_type,cache_control='public, max-age=86400',extra_headers={'X-Album-Art-Cache':'MISS'})
        except HTTPError as error: self._send_http_error(error)
        except UpstreamPayloadTooLarge as error: self._send_upstream_error(error)
        except (URLError,TimeoutError,OSError) as error: self._send_upstream_error(error)
    def _cache_image_bytes(self)->int:
        """Lazy, process-local image byte counter, partitioned by cache directory."""
        key=str(self.cache_dir.resolve())
        with _IMAGE_CACHE_LOCK:
            if key not in _IMAGE_CACHE_BYTES:
                total=0
                for path in self.cache_dir.glob('*.img'):
                    try: total+=path.stat().st_size
                    except OSError: continue
                _IMAGE_CACHE_BYTES[key]=total
            return _IMAGE_CACHE_BYTES[key]

    def _store_artwork(self,cache_path:Path,type_path:Path,payload:bytes,content_type:str)->None:
        """Atomically publish images while accounting for their byte delta."""
        # Serialise cache writes and eviction, not image decoding/network I/O.
        with _IMAGE_CACHE_LOCK:
            key=str(self.cache_dir.resolve())
            used=self._cache_image_bytes()
            try: previous=cache_path.stat().st_size
            except OSError: previous=0
            proposed=used+len(payload)-previous
            if getattr(self,'background_warming',False) and proposed>self._cache_limit_bytes(): raise CacheFull()
            suffix=f'.{os.getpid()}.{threading.get_ident()}.tmp'
            image_temp=cache_path.with_name(cache_path.name+suffix)
            type_temp=type_path.with_name(type_path.name+suffix)
            try:
                image_temp.write_bytes(payload)
                type_temp.write_text(content_type,encoding='ascii')
                image_temp.replace(cache_path)
                _IMAGE_CACHE_BYTES[key]=proposed
                type_temp.replace(type_path)
            finally:
                image_temp.unlink(missing_ok=True)
                type_temp.unlink(missing_ok=True)

    def _prune_artwork_cache(self,force:bool=True)->None:
        """Evict oldest images only when over budget; rescan on forced prune."""
        if getattr(self,'background_warming',False): return
        with _IMAGE_CACHE_LOCK:
            if not force and self._cache_image_bytes()<=self._cache_limit_bytes(): return
            entries=[];total=0
            for path in self.cache_dir.glob('*.img'):
                try:
                    info=path.stat()
                    entries.append((info.st_mtime,path,info.st_size))
                    total+=info.st_size
                except OSError: continue
            for _,path,size in sorted(entries):
                if total<=self._cache_limit_bytes(): break
                try:
                    path.unlink()
                    path.with_suffix('.type').unlink(missing_ok=True)
                    total-=size
                except OSError: continue
            _IMAGE_CACHE_BYTES[str(self.cache_dir.resolve())]=total

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
    parser.add_argument('--lms',default='http://streamer:9000',help='LMS base URL'); parser.add_argument('--bind',default='127.0.0.1',help='Address to listen on'); parser.add_argument('--port',type=int,default=8088,help='HTTP port')
    parser.add_argument('--batch-size',type=positive_int,default=40,help='Albums per LMS batch'); parser.add_argument('--idle-return-seconds',type=non_negative_int,default=30,help='Idle time before returning to the playing album; 0 disables')
    parser.add_argument('--reconnect-max-seconds',type=positive_int,default=30,help='Maximum reconnect backoff'); parser.add_argument('--random-scroll-max-seconds',type=positive_int,default=3,help='Maximum random and idle-return scroll duration'); parser.add_argument('--search-limit',type=positive_int,default=100,help='Maximum albums returned by a search'); parser.add_argument('--cache-dir',help='Persistent artwork cache directory (default: .cache/album-art)'); parser.add_argument('--cache-limit-mb',type=positive_int,default=MAX_ARTWORK_CACHE_BYTES//1_000_000,help='Default artwork cache limit in MB'); parser.add_argument('--cache-hard-limit-mb',type=positive_int,default=MAX_ARTWORK_CACHE_HARD_BYTES//1_000_000,help='Maximum artwork cache limit clients may select in MB'); parser.add_argument('--clear-cache',action='store_true',help='Clear the persistent artwork cache before starting'); parser.add_argument('--allowed-hosts',default=os.environ.get('ALLOWED_HOSTS',''),help='Additional comma-separated permitted local browser hostnames'); args=parser.parse_args()
    if args.cache_limit_mb>args.cache_hard_limit_mb: parser.error('--cache-limit-mb must not exceed --cache-hard-limit-mb')
    static_dir=Path(__file__).resolve().parent; cache_dir=Path(args.cache_dir).expanduser().resolve() if args.cache_dir else static_dir/'.cache'/'album-art'
    if args.clear_cache and cache_dir.exists():
        removed=sum(1 for path in cache_dir.rglob('*') if path.is_file()); shutil.rmtree(cache_dir); print(f"Cleared artwork cache: {removed} file{'s' if removed!=1 else ''} removed from {cache_dir}")
    cache_dir.mkdir(parents=True,exist_ok=True)
    if args.clear_cache:metadata_db.clear_generated(metadata_db.database_path(cache_dir))
    saved_lms_url=load_saved_lms_url(cache_dir.parent/LMS_SETTINGS_FILENAME,args.lms.rstrip('/'))
    # Shared mutable defaults are exposed to the browser. UI durations use ms;
    # CLI durations use seconds. The handler factory reads the current LMS target.
    allowed_hosts=local_allowed_hosts(args.allowed_hosts)
    runtime_config={'batch_size':args.batch_size,'idle_return_ms':args.idle_return_seconds*1000,'library_check_ms':0,'reconnect_max_ms':args.reconnect_max_seconds*1000,'random_scroll_max_ms':args.random_scroll_max_seconds*1000,'search_limit':args.search_limit,'cache_limit_bytes':args.cache_limit_mb*1_000_000,'cache_hard_limit_bytes':args.cache_hard_limit_mb*1_000_000, 'lms_url':saved_lms_url,'_allowed_hosts':allowed_hosts}
    def handler(*handler_args,**handler_kwargs): return LyrionCarouselHandler(*handler_args,directory=str(static_dir),lms_url=runtime_config['lms_url'],cache_dir=cache_dir,runtime_config=runtime_config,**handler_kwargs)
    # Long-poll connections must not block ordinary artwork and control requests.
    server=ThreadingHTTPServer((args.bind,args.port),handler)
    if args.bind in {'0.0.0.0','::'}: print('Lyrion Carousel listening on all network interfaces.'); print(f'Open: http://{socket.gethostname()}:{args.port}/ or http://<server-ip>:{args.port}/')
    else: print(f'Lyrion Carousel: http://{args.bind}:{args.port}/')
    print(f'Lyrion server: {runtime_config["lms_url"]}'); print(f'Artwork cache: {cache_dir}'); print(f'Runtime config: batch={args.batch_size}, idle={args.idle_return_seconds}s, library-events=CometD, live-status=CometD, album-index=lightweight, random-scroll-max={args.random_scroll_max_seconds}s')
    try: server.serve_forever()
    except KeyboardInterrupt: print('\nStopping.')
    finally: server.server_close()
    return 0
if __name__=='__main__': sys.exit(main())
