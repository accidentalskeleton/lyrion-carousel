#!/usr/bin/env python3
"""Serve Lyrion Carousel and proxy its requests to Lyrion Music Server."""
from __future__ import annotations
import argparse, hashlib, json, os, re, shutil, socket, sys, threading
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, unquote, urlsplit
from urllib.request import Request, urlopen

MAX_RPC_BYTES=1_000_000
MAX_UPSTREAM_BYTES=8_000_000
MAX_ARTWORK_BYTES=10_000_000
MAX_ARTWORK_CACHE_BYTES=512_000_000
ARTWORK_ID=re.compile(r"^[A-Za-z0-9._:@%-]+$")
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
    def __init__(self,*args,directory:str,lms_url:str,cache_dir:Path,runtime_config:dict[str,int],**kwargs):
        self.lms_url=lms_url.rstrip('/'); self.cache_dir=cache_dir; self.runtime_config=runtime_config
        super().__init__(*args,directory=directory,**kwargs)
    def do_POST(self)->None:
        path=urlsplit(self.path).path
        if path=='/api/cache/clear': self._clear_cache(); return
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
    def _log_lms_rpc(self,payload:object)->None:
        try:
            params=payload.get('params') if isinstance(payload,dict) else None
            if not isinstance(params,list) or len(params)<2 or not isinstance(params[1],list) or not params[1]: raise ValueError
            print(f"LMS RPC [{params[0] or 'server'}] -> {' '.join(str(p) for p in params[1])}",flush=True)
        except (TypeError,ValueError): print('LMS RPC -> <unrecognised request>',flush=True)
    def _log_cometd(self,payload:object)->None:
        messages=payload if isinstance(payload,list) else [payload]; channels=[str(m.get('channel','?')) for m in messages if isinstance(m,dict)]
        print(f"LMS CometD -> {', '.join(channels) or '<unrecognised request>'}",flush=True)
    def do_GET(self)->None:
        path=urlsplit(self.path).path
        if path=='/api/config': self._send_payload(200,json.dumps(self.runtime_config).encode(),'application/json; charset=utf-8',cache_control='no-store'); return
        if path.startswith('/api/art/'):
            artwork_id=unquote(path.removeprefix('/api/art/'))
            if not ARTWORK_ID.fullmatch(artwork_id): self.send_error(400,'Invalid artwork ID'); return
            self._serve_artwork(artwork_id); return
        super().do_GET()
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
                path.unlink(); path.with_suffix('.type').unlink(missing_ok=True); total-=size
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
    parser.add_argument('--reconnect-max-seconds',type=positive_int,default=30,help='Maximum reconnect backoff'); parser.add_argument('--random-scroll-max-seconds',type=positive_int,default=3,help='Maximum shamrock scroll duration'); parser.add_argument('--search-limit',type=positive_int,default=100,help='Maximum albums returned by a search'); parser.add_argument('--cache-dir',help='Persistent artwork cache directory (default: .cache/album-art)'); parser.add_argument('--clear-cache',action='store_true',help='Clear the persistent artwork cache before starting'); args=parser.parse_args()
    static_dir=Path(__file__).resolve().parent; cache_dir=Path(args.cache_dir).expanduser().resolve() if args.cache_dir else static_dir/'.cache'/'album-art'
    if args.clear_cache and cache_dir.exists():
        removed=sum(1 for path in cache_dir.rglob('*') if path.is_file()); shutil.rmtree(cache_dir); print(f"Cleared artwork cache: {removed} file{'s' if removed!=1 else ''} removed from {cache_dir}")
    cache_dir.mkdir(parents=True,exist_ok=True)
    runtime_config={'batch_size':args.batch_size,'idle_return_ms':args.idle_return_seconds*1000,'library_check_ms':0,'reconnect_max_ms':args.reconnect_max_seconds*1000,'random_scroll_max_ms':args.random_scroll_max_seconds*1000,'search_limit':args.search_limit}
    def handler(*handler_args,**handler_kwargs): return LyrionCarouselHandler(*handler_args,directory=str(static_dir),lms_url=args.lms,cache_dir=cache_dir,runtime_config=runtime_config,**handler_kwargs)
    server=ThreadingHTTPServer((args.bind,args.port),handler)
    if args.bind in {'0.0.0.0','::'}: print('Lyrion Carousel listening on all network interfaces.'); print(f'Open: http://{socket.gethostname()}:{args.port}/ or http://<server-ip>:{args.port}/')
    else: print(f'Lyrion Carousel: http://{args.bind}:{args.port}/')
    print(f'Lyrion server: {args.lms}'); print(f'Artwork cache: {cache_dir}'); print(f'Runtime config: batch={args.batch_size}, idle={args.idle_return_seconds}s, library-events=CometD, live-status=CometD, album-index=lightweight, random-scroll-max={args.random_scroll_max_seconds}s')
    try: server.serve_forever()
    except KeyboardInterrupt: print('\nStopping.')
    finally: server.server_close()
    return 0
if __name__=='__main__': sys.exit(main())
