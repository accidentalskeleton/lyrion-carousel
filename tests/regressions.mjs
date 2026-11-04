// Run with: node tests/regressions.mjs
// Small DOM doubles exercise the complete app module without LMS or playback writes.
export async function runTests(sources) {
  let checks = 0;
  const assert = (value, message) => { if (!value) throw Error(message); checks++; };
  const plain = source => source.replace(/^import .*;\n/gm, '').replace(/\bexport /g, '');
  const geometry = new Function(plain(sources.browser) + ';return {clamp,modulo,circularDelta,nearestPositionForIndex,fanLayout};')();
  assert(geometry.circularDelta(0, 99, 100) === 1, 'circular wrap');
  assert(geometry.nearestPositionForIndex(99, 0, 100) === -1, 'shortest route');
  const catalogue = new Function(plain(sources.catalogue) + ';return {buildAlbumPositionIndex,locateAlbum};')();
  const pages = [];
  const index = await catalogue.buildAlbumPositionIndex(async (_, cmd) => {
    pages.push(cmd.slice(1, 3));
    return {albums_loop:Array.from({length:cmd[2]}, (_, i) => ({id:cmd[1]+i}))};
  }, 95, 1, () => 1);
  assert(pages.length === 3 && pages[2][1] === 15 && index.get('94') === 94, 'default bounded index pages');
  const stale = await catalogue.buildAlbumPositionIndex(async () => ({albums_loop:[]}), 2, 1, () => 2);
  assert(stale === null, 'stale index discarded');
  let invalid = false;
  try { await catalogue.buildAlbumPositionIndex(() => {}, 1, 1, () => 1, 0); } catch (_) { invalid = true; }
  assert(invalid, 'invalid page size rejected');

  let libraryEvents = 0;
  const {CometDClient, rpc:realRpc, resetRpcSession} = new Function('fetch', plain(sources.lms) + ';return {CometDClient,rpc,resetRpcSession};')(
    async () => ({ok:true,json:async () => ({result:{}})})
  );
  const comet = new CometDClient(() => {}, () => {}, data => { assert(data.rescan === 0 || data.rescan === false, 'scan payload forwarded'); libraryEvents++; });
  comet.handleServerStatus({rescan:0}); comet.handleServerStatus({rescan:1}); comet.handleServerStatus({rescan:0}); comet.handleServerStatus({rescan:0});
  assert(libraryEvents === 1, 'one observation per completed scan');
  comet.handleServerStatus({rescan:true}); comet.handleServerStatus({rescan:false});
  assert(libraryEvents === 2, 'boolean scan-status changes are also observed once');
  const oldRpc = realRpc('0', ['players',0,1]); resetRpcSession();
  let rejected = false; try { await oldRpc; } catch (_) { rejected = true; }
  assert(rejected, 'old server RPC rejected');

  class Element {
    constructor(name='') {
      this.name=name;this.children=[];this.hidden=/overlay|menu|front-preview/.test(name);
      this.dataset={};this.attributes={};this.listeners={};this.value='';this.clientWidth=1000;this.clientHeight=400;
      this.style={setProperty(k,v){this[k]=v;},getPropertyValue(k){return this[k]||'';}};
      const classes=new Set();this.classList={add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x)),contains:x=>classes.has(x)};
    }
    get options(){return this.children;}
    append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
    replaceChildren(...nodes){this.children=[];this.append(...nodes);}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
    setAttribute(k,v){this.attributes[k]=v;}
    getAttribute(k){return this.attributes[k];}
    toggleAttribute(k,v){if(v)this.attributes[k]='';else delete this.attributes[k];}
    addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}
    dispatchEvent(event){for(const fn of this.listeners[event.type]||[])fn(event);return true;}
    contains(el){return el===this||this.children.some(n=>n.contains?.(el));}
    focus(){} select(){} setPointerCapture(){}
    getBoundingClientRect(){return {left:0,right:1000,top:0,bottom:400,width:this.name==='case'?(this.coverWidth||300):1000,height:400};}
    querySelectorAll(selector){return this.children.filter(el=>selector==='.'+el.className?.split(' ')[0]);}
    querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  }
  const elements=new Map(),root=new Element('root');
  const element=selector=>{if(!elements.has(selector))elements.set(selector,new Element(selector));return elements.get(selector);};
  root.querySelector=selector=>selector.includes(':not(')?null:element(selector);
  const stage=element('.bf-stage'),preview=element('.bf-front-preview'),frontCase=new Element('case');
  // Track hidden transitions as well as final state; a close/reopen flicker
  // can otherwise pass assertions that inspect only the final DOM.
  const previewHideWrites=[];
  let previewHiddenState=preview.hidden;
  Object.defineProperty(preview,'hidden',{get(){return previewHiddenState},set(value){
    previewHideWrites.push(Boolean(value));previewHiddenState=Boolean(value);
  }});
  preview.querySelector=()=>frontCase;
  const document=new Element('document');document.querySelectorAll=()=>[];document.getElementById=()=>root;document.createElement=tag=>new Element(tag);document.elementFromPoint=()=>null;
  const window=new Element('window');window.innerWidth=1000;window.innerHeight=600;
  const storage=new Map();const localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))};
  let time=0,nextId=0;const frames=new Map(),timers=new Map();
  const setTimeout=fn=>{timers.set(++nextId,fn);return nextId;},clearTimeout=id=>timers.delete(id);
  const requestAnimationFrame=fn=>{frames.set(++nextId,fn);return nextId;},cancelAnimationFrame=id=>frames.delete(id);
  const rpcCalls=[];
  const catalogueEvents=[];
  let catalogueReconcileChanged=true;
  let tracksFixture=null;
  let library=Array.from({length:95},(_,i)=>({id:i+1,album:'Album '+String(i+1).padStart(3,'0'),artist:'Artist',textkey:'A'}));
  const rpc=async (player,cmd)=>{rpcCalls.push(cmd);if(cmd[0]==='players')return {players_loop:[{playerid:'test-player',connected:1,isplaying:1}]};if(cmd[0]==='status')return {mode:'play',playlist_loop:[{album_id:20,album:'Album 020',artist:'Artist',title:'Track',duration:60}],time:1};if(cmd[0]==='tracks')return {titles_loop:tracksFixture||[],count:tracksFixture?.length||0};if(cmd[0]==='albums')return {count:library.length,albums_loop:library.slice(cmd[1],cmd[1]+cmd[2])};return {};};
  window.dispatchEvent=()=>{};
  const imageRequests=[];
  class PreloadImage{set src(url){this.url=url;imageRequests.push(this)}}
  let metadataFetch=async()=>({ok:false});
  const env={document,window,localStorage,performance:{now:()=>time},requestAnimationFrame,cancelAnimationFrame,setTimeout,clearTimeout,setInterval:setTimeout,clearInterval:clearTimeout,
    ResizeObserver:class{observe(){}},Event:class{},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},Image:PreloadImage,fetch:(url,...args)=>{
      if(url==='/api/catalogue/invalidate'){
        catalogueEvents.push({action:'invalidate',method:args[0]?.method});
        return Promise.resolve({ok:true,json:async()=>({invalidated:true})});
      }
      if(url==='/api/catalogue/reconcile'){
        catalogueEvents.push({action:'reconcile',method:args[0]?.method});
        return Promise.resolve({ok:true,json:async()=>({changed:catalogueReconcileChanged,count:library.length,new_albums:catalogueReconcileChanged?1:0})});
      }
      if(url.startsWith('/api/catalogue')){
        catalogueEvents.push({action:'read',url});
        return Promise.resolve({ok:true,json:async()=>({albums_loop:library.map(a=>({...a,artwork_track_id:a.id})),count:library.length})});
      }
      return metadataFetch(url,...args);
    },rpc,CometDClient:class{stop(){}start(){}},resetRpcSession:()=>{},fanLayout:geometry.fanLayout,clamp:geometry.clamp,modulo:geometry.modulo,circularDelta:geometry.circularDelta,nearestPosition:geometry.nearestPositionForIndex,
    buildAlbumPositionIndex:catalogue.buildAlbumPositionIndex,locateIndexedAlbum:catalogue.locateAlbum,
    createLmsProvider:()=>({play:async album=>{await rpc('test-player',['playlistcontrol','cmd:load','album_id:'+album[6]]);return {};}}),createSpotifyProvider:()=>({play:async()=>({})}),spotifyAlbumInformation:async()=>({tracks:[]})};
  const app=plain(sources.app).replace(/start\(\);\s*$/, '');
  const api=new Function(...Object.keys(env), app + `
    return {fetchSpineMeta,flushSpineMetaBatch,rememberSpineMeta,clearSpineMetadata,indexForAlbumId,rebuildAlbumIndex,
      metaState:()=>({cached:spineMetaCache.size,pending:spineMetaPending.size,queued:spineMetaBatchQueue.size,active:spineMetaBatchesActive}),
      cachedSpineMeta:url=>spineMetaCache.get(url),
      replaceAlbumsForTest:value=>{albums=value;totalAlbums=value.length;rebuildAlbumIndex();},
      prefetchCoverWindow,coverCache:()=>({active:warmingCovers.size,cached:warmCovers.size,queued:coverQueue.length}),browseWithArrow,connectLyrion,playRandomAlbum,centreAlbumIndex,loadInitialCatalogue,refreshCatalogue,handleLibraryEvent,setDisplayOrder,applySetting,applyStatus,selectStartupAlbum,returnToPlayingAlbum,stopFollowing,ensurePlayingCover,closeFrontPreview,openFrontPreview,showTrackList,closeTrackList,closeAlbumMenu,sortAlbumTracks,distinctTrackArtist,updateMeta,draw,
      set(values){if('playerId' in values)playerId=values.playerId;if('connecting' in values)connecting=values.connecting;if('playing' in values)playing=values.playing;if('playingAlbumId' in values)playingAlbumId=values.playingAlbumId;if('hover' in values)hoveredAlbumIndex=values.hover;if('position' in values)position=target=values.position;if('activity' in values)lastActivityAt=values.activity;},
      state:()=>({albums,position,target,PAGE_SIZE,DISPLAY_ALBUM_COUNT,orderMode,frontPreviewAlbum,frontTimer,followAnimation,followingNowPlaying,playing,KEEP_PLAYING_OPEN,randomAnimating}),
      geometry:()=>({nodes,frontPreviewIndex})};
  `)(...Object.values(env));
  async function settle(promise) {
    let done=false,error;promise.then(()=>done=true,e=>{done=true;error=e;});
    for(let i=0;i<500&&!done;i++){
      await Promise.resolve();time+=16;
      const pending=[...frames.values()];frames.clear();for(const fn of pending)fn(time);
    }
    if(error)throw error;if(!done)throw Error('Animation did not finish');
  }
  await api.loadInitialCatalogue();
  const firstSpine=stage.children.find(node=>node.className?.includes('bf-album'));
  const spineLabel=firstSpine?.children.find(node=>node.className==='bf-spine-label');
  const spineShell=firstSpine?.children.find(node=>node.className==='bf-spine-shell');
  const spineCover=firstSpine?.children.find(node=>node.className==='bf-spine-cover');
  assert(spineLabel?.textContent?.includes('Artist — Album'), 'one continuous artist and album spine label');
  assert(spineShell?.src==='/assets/jewel-case-spine-v1.svg', 'all spines use shared static shell image');
  assert(!spineCover, 'spines do not request or display cropped cover artwork');
  assert(firstSpine?.className?.includes('bf-album'), 'spines retain the normal cover-derived colour metadata path');
  assert(api.state().albums.length===95 && api.state().albums.every(Boolean), 'full catalogue loaded in bounded pages');
  assert(rpcCalls.filter(c=>c[0]==='albums').every(c=>c[2]<=40), 'catalogue page limit');

  // Phase 1: existing backend supports at most 64 local spine metadata IDs
  // per request. A large visible window should not issue one GET per spine.
  api.clearSpineMetadata();
  const metadataBatches=[];
  metadataFetch=async (url,options)=>{
    if(url==='/api/art-meta'){
      const ids=JSON.parse(options.body).artwork_ids;
      metadataBatches.push(ids);
      return {ok:true,json:async()=>({metadata:Object.fromEntries(ids.map(id=>[id,{
        spine_color:'#123456',text_color:'#ffffff',colour_index:5
      }]))})};
    }
    return {ok:false};
  };
  const sampleAlbums=Array.from({length:70},(_,i)=>{
    const album=[];album[11]='/api/art-meta/perf'+i+'?v=3&server=local';return album;
  });
  const pendingMetadata=sampleAlbums.map(album=>api.fetchSpineMeta(album));
  assert(api.fetchSpineMeta(sampleAlbums[0])===pendingMetadata[0],
    'duplicate spine metadata lookups share the same pending promise');
  assert(api.metaState().queued===70,'rapidly requested metadata is queued, not sent as 70 GETs');
  await api.flushSpineMetaBatch();
  await api.flushSpineMetaBatch();
  const metadataResult=await Promise.all(pendingMetadata);
  assert(metadataBatches.length===2&&metadataBatches[0].length===64&&metadataBatches[1].length===6,
    '70 spine metadata lookups use only two bounded batch requests');
  assert(metadataResult.every(meta=>meta?.spine_color==='#123456')&&api.metaState().pending===0,
    'metadata batches resolve all callers and clear pending requests');
  await api.fetchSpineMeta(sampleAlbums[0]);
  assert(metadataBatches.length===2,'cached metadata is reused without another request');

  let spotifyMetaCalls=0;
  metadataFetch=async url=>{
    if(url.startsWith('/api/spotty-art-meta'))spotifyMetaCalls++;
    return {ok:true,json:async()=>({spine_color:'#abcdef'})};
  };
  const spotifyMetadata=[];spotifyMetadata[11]='/api/spotty-art-meta?path=%2Fimageproxy%2Fabc';
  assert((await api.fetchSpineMeta(spotifyMetadata)).spine_color==='#abcdef'&&spotifyMetaCalls===1,
    'Spotty metadata retains its separate single-item endpoint');

  for(let i=0;i<1150;i++)api.rememberSpineMeta('/lru/'+i,{spine_color:'#123456'});
  assert(api.metaState().cached===1024&&api.cachedSpineMeta('/lru/1149')!==undefined&&
    api.cachedSpineMeta('/lru/0')===undefined,
    'spine metadata cache remains bounded as a large library is browsed');

  let finishStaleBatch;
  metadataFetch=()=>new Promise(resolve=>{finishStaleBatch=resolve});
  const staleAlbum=[];staleAlbum[11]='/api/art-meta/stale-generation?v=3';
  const staleMetadata=api.fetchSpineMeta(staleAlbum);
  const inFlightBatch=api.flushSpineMetaBatch();
  await Promise.resolve();
  api.clearSpineMetadata();
  finishStaleBatch({ok:true,json:async()=>({metadata:{'stale-generation':{spine_color:'#ff0000'}}})});
  await inFlightBatch;
  assert((await staleMetadata)===null&&api.metaState().cached===0&&api.metaState().active===0,
    'clearing metadata discards stale results and releases old-generation capacity');

  const overflowAlbums=Array.from({length:300},(_,i)=>{
    const album=[];album[11]='/api/art-meta/over'+i+'?v=3';return album;
  });
  const overflowPromises=overflowAlbums.map(album=>api.fetchSpineMeta(album));
  assert(api.metaState().queued===256&&api.metaState().pending===256,
    'fast browsing bounds the queued metadata window to 256 albums');
  api.clearSpineMetadata();
  assert((await Promise.all(overflowPromises)).every(meta=>meta===null)&&api.metaState().pending===0,
    'discarded metadata promises are resolved, never left hanging');

  metadataFetch=async()=>({ok:false});

  api.applySetting('displayCount',20);
  assert(api.state().PAGE_SIZE===40&&stage.children.length>20&&stage.children.length<40, 'display count independent of page size');
  await api.setDisplayOrder('random');
  const previous=api.state().albums.map(a=>a[6]);
  library.push({id:96,album:'New album',artist:'Artist'});
  const beforeRefreshEvents=catalogueEvents.length;
  await api.refreshCatalogue();
  const refreshEvents=catalogueEvents.slice(beforeRefreshEvents);
  assert(refreshEvents[0]?.action==='invalidate'&&refreshEvents[0]?.method==='POST'&&
    refreshEvents.some(event=>event.action==='read'),
    'LMS rescan invalidates server snapshot before requesting new album ordering');
  assert(api.state().orderMode==='random'&&api.state().albums.slice(0,95).every((a,i)=>a[6]===previous[i]), 'refresh retains random order');
  // Observing scan completion must not itself trigger a UI refresh. Carousel
  // first asks its own server to compare library state.
  const unchangedAlbums=api.state().albums;
  const beforeUnchanged=catalogueEvents.length;
  catalogueReconcileChanged=false;
  await api.handleLibraryEvent();
  assert(catalogueEvents.slice(beforeUnchanged).length===1&&
    catalogueEvents[beforeUnchanged]?.action==='reconcile'&&
    catalogueEvents[beforeUnchanged]?.method==='POST'&&
    api.state().albums===unchangedAlbums,
    'unchanged LMS scan observation does not refetch or rebuild the Carousel catalogue');
  catalogueReconcileChanged=true;
  library[0]={...library[0],album:'Recently Updated'};
  const beforeChanged=catalogueEvents.length;
  await api.handleLibraryEvent();
  const observed=catalogueEvents.slice(beforeChanged);
  assert(observed[0]?.action==='reconcile'&&
    observed.some(e=>e.action==='read')&&
    !observed.some(e=>e.action==='invalidate')&&
    api.state().albums.some(album=>album?.[0]==='Recently Updated'),
    'changed LMS scan is independently reconciled before Carousel loads its new snapshot');
  api.applySetting('random',1000);
  // Actual connectLyrion() keeps connecting=true until startup completes;
  // otherwise applyStatus() launches a competing follow animation.
  api.set({connecting:true});
  await settle(api.selectStartupAlbum({mode:'play',playlist_loop:[{album_id:20,album:'Album 020',artist:'Artist',title:'Track',duration:60}],time:1}));
  api.set({connecting:false});
  assert(api.state().frontPreviewAlbum[6]===20&&!preview.hidden&&api.state().frontTimer===0,'startup opens playing cover without timeout');
  // Reproduce the configured idle return: browse away from Now Playing,
  // then animate back. The playing cover must not be hidden even for a frame.
  const firstPlayingCover=api.state().frontPreviewAlbum;
  const firstPlayingIndex=api.state().albums.indexOf(firstPlayingCover);
  const firstPlayingPosition=api.state().position;
  api.set({position:firstPlayingPosition+7});
  api.draw();
  const offCentreTransform=frontCase.style.transform;
  const hideStart=previewHideWrites.length;
  const returning=api.returnToPlayingAlbum(true);
  await Promise.resolve();
  assert(api.state().frontPreviewAlbum===firstPlayingCover&&!preview.hidden,
    'playing cover remains mounted as automatic return begins');
  await settle(returning);
  assert(api.state().frontPreviewAlbum===firstPlayingCover&&!preview.hidden&&
    api.geometry().frontPreviewIndex===firstPlayingIndex,
    'idle return keeps the identical playing cover open');
  assert(!previewHideWrites.slice(hideStart).includes(true),
    'idle return never hides the playing cover, even temporarily');
  assert(frontCase.style.transform!==offCentreTransform,
    'playing cover slides back with the shelf instead of reopening');
  // The library can replace an album object during a scan or reorder without
  // changing the album identity; pinning must survive that replacement.
  const refreshedPlayingAlbum=[...firstPlayingCover];
  api.state().albums[firstPlayingIndex]=refreshedPlayingAlbum;
  const beforeRefreshHideWrites=previewHideWrites.length;
  api.stopFollowing();
  assert(!preview.hidden&&api.state().frontPreviewAlbum===firstPlayingCover,
    'stable playing album ID keeps the cover open after a catalogue refresh');
  assert(!previewHideWrites.slice(beforeRefreshHideWrites).includes(true),
    'catalogue object replacement causes no cover hide event');
  api.state().albums[firstPlayingIndex]=firstPlayingCover;


  // Short clicks are inert; dragging the enlarged cover scrolls the same
  // shelf with the same distance, momentum and snap as dragging the spines.
  // Album Information is only reached through the long-press album menu.
  const trackOverlay=element('.bf-track-overlay');
  const coverTarget={closest:selector=>selector==='.bf-front-case'?frontCase:null};
  const playbackBefore=rpcCalls.filter(command=>command[0]==='playlistcontrol').length;
  const originalCover=api.state().frontPreviewAlbum;
  const originalCoverIndex=api.geometry().frontPreviewIndex;
  const originalCoverPosition=api.state().position;
  assert(trackOverlay.hidden,'Album Information initially closed');
  frontCase.dispatchEvent({type:'click',target:{closest:()=>null}});
  assert(trackOverlay.hidden,'normal cover click never opens Album Information');

  let prevented=false;
  element('.bf-front-art').dispatchEvent({type:'keydown',key:'Enter',preventDefault(){prevented=true;}});
  element('.bf-front-art').dispatchEvent({type:'keydown',key:' ',preventDefault(){prevented=true;}});
  assert(!prevented&&trackOverlay.hidden,'Enter and Space on the artwork do not open Album Information');

  preview.dispatchEvent({type:'pointerdown',button:0,target:coverTarget,pointerId:31,clientX:300,clientY:90});
  preview.dispatchEvent({type:'pointerup',pointerId:31});
  assert(trackOverlay.hidden&&api.state().position===originalCoverPosition,
    'short cover tap neither opens Album Information nor moves the shelf');
  frontCase.dispatchEvent({type:'click',target:{closest:()=>null}});
  assert(trackOverlay.hidden,'synthetic click after tap remains inert');

  preview.dispatchEvent({type:'pointerdown',button:0,target:coverTarget,pointerId:32,clientX:300,clientY:90});
  time+=80;
  preview.dispatchEvent({type:'pointermove',pointerId:32,clientX:190,clientY:95});
  const draggingLeft=api.state().position;
  assert(draggingLeft>originalCoverPosition&&stage.classList.contains('is-dragging'),
    'dragging the cover left scrolls the shelf right like the spines');
  time+=80;
  preview.dispatchEvent({type:'pointermove',pointerId:32,clientX:120,clientY:95});
  preview.dispatchEvent({type:'pointerup',pointerId:32});
  assert(trackOverlay.hidden&&!stage.classList.contains('is-dragging')&&api.state().target>originalCoverPosition,
    'releasing the cover drag snaps toward a neighbouring album without showing info');
  assert(api.state().frontPreviewAlbum===originalCover&&!preview.hidden,
    'swiping a pinned playing cover never opens the destination album');
  api.set({position:originalCoverPosition});
  api.openFrontPreview(originalCover,originalCoverIndex);

  preview.dispatchEvent({type:'pointerdown',button:0,target:coverTarget,pointerId:35,clientX:130,clientY:90});
  time+=90;
  preview.dispatchEvent({type:'pointermove',pointerId:35,clientX:270,clientY:93});
  assert(api.state().position<originalCoverPosition,
    'dragging the cover right scrolls the shelf left');
  preview.dispatchEvent({type:'pointercancel',pointerId:35});
  assert(!stage.classList.contains('is-dragging'),
    'cancelled cover gesture resets the shelf drag state');
  api.set({position:originalCoverPosition});
  api.openFrontPreview(originalCover,originalCoverIndex);

  const playTarget={closest:selector=>selector==='button'?element('.bf-front-play'):frontCase};
  preview.dispatchEvent({type:'pointerdown',button:0,target:playTarget,pointerId:33,clientX:80,clientY:90});
  frontCase.dispatchEvent({type:'click',target:playTarget});
  assert(trackOverlay.hidden&&api.state().position===originalCoverPosition,
    'Play button pointer interactions do not move the carousel or show information');
  assert(rpcCalls.filter(command=>command[0]==='playlistcontrol').length===playbackBefore,
    'cover gestures and short clicks never change playback');

  // A long press must continue to expose the existing album action menu,
  // rather than turning into a cover click or an opening-case animation.
  const beforeLongPressTimers=new Set(timers.keys());
  preview.dispatchEvent({type:'pointerdown',button:0,target:coverTarget,pointerId:34,clientX:80,clientY:90});
  const longPressId=[...timers.keys()].find(id=>!beforeLongPressTimers.has(id));
  assert(longPressId!==undefined,'cover long-press timer is still registered');
  const longPressCallback=timers.get(longPressId);
  timers.delete(longPressId);
  longPressCallback();
  assert(!element('.bf-album-menu').hidden&&trackOverlay.hidden,
    'long press shows album action menu without opening Album Information');
  preview.dispatchEvent({type:'pointerup',pointerId:34});
  assert(trackOverlay.hidden,'releasing long press never activates the cover');
  element('.bf-track-list-open').onclick();
  assert(!trackOverlay.hidden&&element('.bf-album-menu').hidden,
    'Album Information remains available through the long-press menu item only');
  api.closeTrackList();

  let menuPrevented=false;
  frontCase.dispatchEvent({type:'contextmenu',target:coverTarget,clientX:90,clientY:85,
    preventDefault(){menuPrevented=true;}});
  assert(menuPrevented&&!element('.bf-album-menu').hidden&&trackOverlay.hidden,
    'right-click opens the same album actions menu without directly showing information');
  api.closeAlbumMenu();
  menuPrevented=false;
  frontCase.dispatchEvent({type:'keydown',key:'ContextMenu',
    preventDefault(){menuPrevented=true;}});
  assert(menuPrevented&&!element('.bf-album-menu').hidden&&trackOverlay.hidden,
    'keyboard ContextMenu key opens album actions menu');
  api.closeAlbumMenu();



  const compilationAlbum=api.state().albums.find(album=>album?.[6]===20);
  const originalAlbumArtist=compilationAlbum[1];
  compilationAlbum[1]='Various Artists';
  api.applyStatus({mode:'play',playlist_loop:[{
    album_id:20,album:'Album 020',albumartist:'Various Artists',
    artist:'Cast',title:'Walkaway',duration:215
  }],time:41});
  assert(element('.bf-meta').children[0]?.children[1]?.textContent===' — Various Artists',
    'Now Playing heading shows the album artist without a redundant Playing label');
  assert(element('.bf-meta').children[1]?.dataset.prefix==='Walkaway — Cast',
    'compilation now-playing line shows individual track artist');

  api.applyStatus({mode:'play',playlist_cur_index:0,playlist_loop:[{
    'playlist index':0,album_id:20,album:'Album 020',albumartist:'Various Artists',
    artist:'Various Artists',trackartist:'Cast',title:'Walkaway',duration:215
  }],time:41});
  assert(element('.bf-meta').children[1]?.dataset.prefix==='Walkaway — Cast',
    'LMS artist roles use per-track performer instead of generic compilation artist');

  compilationAlbum[1]=originalAlbumArtist;
  api.applyStatus({mode:'play',playlist_loop:[{
    album_id:20,album:'Album 020',albumartist:'Artist',
    artist:'Artist',title:'Track',duration:60
  }],time:1});
  assert(element('.bf-meta').children[0]?.children[1]?.textContent===' — Artist',
    'single-artist Now Playing heading never adds a Playing suffix');
  assert(element('.bf-meta').children[1]?.dataset.prefix==='Track',
    'single-artist album does not repeat the artist alongside track title');

  api.applyStatus({mode:'play',playlist_loop:[{
    album_id:20,album:'Album 020',albumartist:'Artist',
    artist:'  ARTIST  ',title:'Same Performer',duration:60
  }],time:1});
  assert(element('.bf-meta').children[1]?.dataset.prefix==='Same Performer',
    'artist comparison ignores surrounding whitespace and letter case');
  api.applyStatus({mode:'play',playlist_loop:[{
    album_id:20,album:'Album 020',albumartist:'Artist',
    artist:'Various Artists',title:'Different Performer',duration:60
  }],time:1});
  assert(element('.bf-meta').children[1]?.dataset.prefix==='Different Performer — Various Artists',
    'a distinct artist is shown without hard-coded performer exclusions');

  api.applyStatus({mode:'play',playlist_loop:[{
    album_id:20,album:'Album 020',albumartist:'Artist',
    title:'Instrumental',duration:60
  }],time:1});
  assert(element('.bf-meta').children[1]?.dataset.prefix==='Instrumental',
    'missing track artist does not invent a performer');
  api.applyStatus({mode:'play',playlist_loop:[{
    album_id:20,album:'Album 020',artist:'Artist',title:'Track',duration:60
  }],time:1});

  const albumForTrackList=api.state().albums.find(a=>a?.[6]===20);
  const previousTrackListArtist=albumForTrackList[1];
  albumForTrackList[1]='Various Artists';
  tracksFixture=[
    {id:4,disc:2,tracknum:2,title:'California Dreamin’',artist:'The Mamas & the Papas',duration:120},
    {id:2,disc:1,tracknum:2,title:'I’m Sticking With You',artist:'Various Artists',duration:120},
    {id:3,disc:2,tracknum:1,title:'A Thousand Miles',artist:'Vanessa Carlton',duration:120},
    {id:1,disc:1,tracknum:1,title:'Everything I Own',artist:'Bread',duration:120}
  ];
  const sortedTracks=api.sortAlbumTracks(tracksFixture);
  assert(sortedTracks.map(a=>a.id).join(',')==='1,2,3,4','multidisc tracks sort by disc then track number');
  assert(api.sortAlbumTracks([
    {disc:2,tracknum:'2/20',id:5},{disc:'1/2',tracknum:'3/20',id:4},
    {disc:'1/2',tracknum:'1/20',id:2}
  ]).map(a=>a.id).join(',')==='2,4,5','disc and track fraction tags sort numerically');
  assert(api.sortAlbumTracks([{id:3,disc:1},{id:1,disc:1}]).map(a=>a.id).join(',')==='3,1',
    'tracks without track numbers preserve upstream order');
  await api.showTrackList(albumForTrackList);
  const rows=element('.bf-track-list').children;
  assert(rows.filter(row=>row.className==='bf-disc-heading').map(row=>row.textContent).join(',')==='Disc 1,Disc 2',
    'multidisc album information inserts numbered disc headings');
  const titles=rows.filter(row=>row.className!=='bf-disc-heading').map(row=>row.children[1].textContent);
  assert(titles.join('|')==='Everything I Own — Bread|I’m Sticking With You|A Thousand Miles — Vanessa Carlton|California Dreamin’ — The Mamas & the Papas',
    'album information lists discs and tracks in order with only distinct artists');
  assert(rpcCalls.some(cmd=>cmd[0]==='tracks'&&cmd.includes('sort:tracknum')&&cmd.includes('tags:altngidA')),
    'LMS track request asks for disc numbers, artists and track order');
  api.closeTrackList();
  tracksFixture=null;
  albumForTrackList[1]=previousTrackListArtist;

  api.stopFollowing();assert(!preview.hidden,'pin survives scrolling');
  const otherIndex=api.state().albums.findIndex(album=>album[6]!==20);
  api.openFrontPreview(api.state().albums[otherIndex],otherIndex);
  assert(api.state().frontPreviewAlbum[6]!==20&&api.state().frontTimer!==0,'other album can preview while keep-open enabled');
  // Playing cover -> manual album #2 -> click album #3 must replace the
  // preview in one click. The overlay CSS must allow pointer hit-testing
  // to reach the neighbouring spine (checked by the Python CSS test).
  const thirdIndex=(otherIndex+1)%api.state().albums.length;
  api.set({position:otherIndex});api.draw();time+=250;
  const thirdSpine={dataset:{index:String(thirdIndex)}};
  const thirdTarget={closest:selector=>selector==='.bf-album'?thirdSpine:null};
  stage.dispatchEvent({type:'pointerdown',button:0,target:thirdTarget,pointerId:81,clientX:120,clientY:80});
  stage.dispatchEvent({type:'pointerup',target:thirdTarget,pointerId:81,clientX:120,clientY:80,stopImmediatePropagation(){}});
  assert(!preview.hidden&&api.state().frontPreviewAlbum===api.state().albums[thirdIndex],
    'clicking a third spine switches directly from the second preview');
  api.closeFrontPreview();await Promise.resolve();await Promise.resolve();
  assert(!preview.hidden&&api.state().frontPreviewAlbum[6]===20,'closing preview restores playing cover');

  const oldPosition=api.state().position;api.set({position:oldPosition+2});api.draw();
  assert(frontCase.style.transform!=='translate3d(0px,0,0)','open cover moves with shelf');
  for(const coverWidth of [300,1200]){
    frontCase.coverWidth=coverWidth;
    for(const offset of [-70,-20,-2,.49,2,20,70]){
      api.set({position:oldPosition+offset});api.draw();
      const x=style=>Number(/translate3d\(([-\d.]+)px/.exec(style.transform)[1]);
      const bounds=api.geometry().nodes.filter(n=>!('data-front-preview' in n.el.attributes)).map(n=>[x(n.el.style),x(n.el.style)+parseFloat(n.el.style.width)]);
      bounds.push([x(frontCase.style)-coverWidth/2,x(frontCase.style)+coverWidth/2]);
      assert(Array.from({length:41},(_,i)=>-500+i*25).every(point=>bounds.some(([left,right])=>point>=left-.01&&point<=right+.01)),'shelf coverage with '+coverWidth+'px cover at offset '+offset);
    }
  }
  frontCase.coverWidth=300;
  api.set({hover:api.state().albums.findIndex(a=>a[6]!==20)});api.updateMeta(true);
  assert(element('.bf-meta').children.length===1,'hover omits unrelated track');
  api.set({hover:-1});api.updateMeta(true);assert(element('.bf-meta').children.length===3,'outside hover shows playing track');
  api.applySetting('keepPlayingOpen',false);
  api.stopFollowing();
  assert(!preview.hidden&&api.state().KEEP_PLAYING_OPEN===true,
    'playing cover cannot be dismissed or disabled while playback is active');
  for(const mode of ['pause','stop']){
    api.set({playing:true,playingAlbumId:20});
    const index=api.state().albums.findIndex(a=>a[6]===20);
    api.openFrontPreview(api.state().albums[index],index);
    api.applyStatus({mode,playlist_loop:[{album_id:20,album:'Album 020'}]});
    assert(preview.hidden&&api.state().frontPreviewAlbum===null,'playing cover closes on '+mode);
  }
  api.set({playing:true,playingAlbumId:20});
  const browsingIndex=api.state().albums.findIndex(a=>a[6]!==20);
  api.openFrontPreview(api.state().albums[browsingIndex],browsingIndex);
  api.applyStatus({mode:'pause',playlist_loop:[{album_id:20}]});
  assert(!preview.hidden,'pausing preserves a different album preview');
  api.set({playing:false});api.updateMeta(true);assert(element('.bf-meta').children.length===0,'stopped details clear');
  await settle(api.selectStartupAlbum({mode:'stop',playlist_loop:[]}));
  assert(preview.hidden&&!rpcCalls.some(c=>c[0]==='playlistcontrol'),'stopped startup never opens or plays');
  assert(frames.size===0,'no idle animation frames remain');
  api.set({playerId:'player-one'});
  const random=api.playRandomAlbum();await Promise.resolve();await Promise.resolve();
  const randomTarget=api.state().target;api.centreAlbumIndex(2);
  assert(api.state().target===randomTarget,'search cannot redirect random animation');
  await settle(random);
  assert(rpcCalls.filter(c=>c[0]==='playlistcontrol').length===1&&!api.state().randomAnimating,'random plays once and unlocks');
  const cancelledRandom=api.playRandomAlbum();await Promise.resolve();api.set({playerId:'player-two'});
  await settle(cancelledRandom);
  assert(rpcCalls.filter(c=>c[0]==='playlistcontrol').length===1&&!api.state().randomAnimating,'player change cancels random playback');

  const tabs=['display','playback','connection','genres','cache','about'].map(name=>{
    const tab=new Element(name);tab.className='bf-settings-tab';tab.setAttribute('aria-controls','settings-panel-'+name);root.append(tab);return tab;
  });
  window.fetch=async()=>{};
  const settingsFetch=async url=>url==='/api/config'?{ok:true,json:async()=>({lms_url:'http://test:9000',idle_return_ms:45000,random_scroll_max_ms:2000})}:{ok:true,text:async()=> '0.10.0'};
  new Function('document','window','localStorage','fetch','setTimeout','Event','CustomEvent','rpc',plain(sources.settings))(document,window,localStorage,settingsFetch,setTimeout,class{},class{constructor(type,options){this.type=type;this.detail=options.detail;}},async()=>({genres_loop:[]}));
  await window.__lyrionLmsConfigReady;
  tabs[2].listeners.click[0]();
  assert(tabs[2].getAttribute('aria-selected')==='true'&&tabs[2].tabIndex===0,'settings tab selected accessibly');
  assert(!element('#settings-panel-connection').hidden&&element('#settings-panel-display').hidden,'settings shows only selected panel');
  const key=key=>({key,preventDefault(){},stopPropagation(){}});
  tabs[2].listeners.keydown[0](key('ArrowRight'));
  assert(!element('#settings-panel-genres').hidden,'arrow key selects genres settings tab');
  tabs[3].listeners.keydown[0](key('ArrowRight'));
  assert(!element('#settings-panel-cache').hidden,'arrow key selects cache settings tab');
  tabs[4].listeners.keydown[0](key('ArrowRight'));
  assert(!element('#settings-panel-about').hidden,'arrow key selects about settings tab');
  tabs[5].listeners.keydown[0](key('Home'));
  assert(!element('#settings-panel-display').hidden,'Home selects first settings tab');
  assert(api.state().KEEP_PLAYING_OPEN===true,
    'the playing cover is permanently pinned regardless of old preferences');
  assert(window.__lyrionCarouselSettings.idle===45000&&window.__lyrionCarouselSettings.random===2000,'unsaved settings respect runtime defaults');
  assert(!sources.index.includes('bf-keep-playing-open')&&
    !sources.settings.includes('keepPlayingOpen:'),
    'obsolete setting to close playing cover has been removed');
  await settle(api.connectLyrion());
  assert(root.dataset.ready==='true'&&stage.children.length>0,'complete connection reveals shelf');
  assert(!preview.hidden&&api.state().frontPreviewAlbum[6]===20,'complete connection opens playing album');
  api.set({playing:false});
  const selectedBeforeOrder=api.state().albums[Math.round(api.state().position)%api.state().albums.length][6];
  await api.setDisplayOrder('colour');
  assert(api.state().albums.every((a,i)=>a[6]===library[i].id),'browser preserves server prepared order');
  assert(api.state().albums[Math.round(api.state().position)][6]===selectedBeforeOrder,'server ordering preserves selected album');
  assert(storage.get('albumBrowserOrderMode')==='colour','colour order persists');
  api.set({playing:true,playingAlbumId:20,position:3});
  for(const mode of ['artistAlbum','album','colour','random']){
    await api.setDisplayOrder(mode);
    assert(api.state().albums[Math.round(api.state().position)][6]===20,'sort '+mode+' immediately centres playing album');
    assert(api.state().frontPreviewAlbum[6]===20&&!preview.hidden,'sort '+mode+' opens playing album');
    api.set({position:3});
  }
  api.applySetting('coverSize',256);
  assert(api.state().albums.every(a=>a[8].includes('size=256')),'cover size updates artwork URLs');
  const beforeStyle=api.state().albums[Math.round(api.state().position)][6];
  api.applySetting('displayStyle','fan');
  assert(api.state().albums[Math.round(api.state().position)][6]===beforeStyle,'display switch preserves position');
  assert(stage.classList.contains('bf-fan-active')&&!stage.classList.contains('bf-shelf-active'),'fan style activates exclusively');
  assert(stage.children.length<=27&&stage.children.every(el=>el.querySelector('.bf-jewel-front')),'fan renders bounded jewel cases');
  assert(stage.children.every(el=>el.style.transform.includes('rotateY(')),'fan applies main carousel transforms');
  api.set({position:api.state().position+35});api.draw();
  assert(api.geometry().nodes.some(n=>n.index===Math.round(api.state().position)%api.state().albums.length),'fan updates visible window after scrolling');
  api.applySetting('displayStyle','shelf');
  assert(stage.classList.contains('bf-shelf-active')&&!stage.classList.contains('bf-fan-active'),'switch back restores shelf');
  assert(stage.children.every(el=>!el.querySelector('.bf-jewel-front')),'switch back removes fan cover nodes');
  const styleSelect=element('.bf-display-style');styleSelect.value='fan';styleSelect.listeners.change[0]();
  assert(storage.get('albumBrowserDisplayStyle')==='fan','display style preference saved');
  assert(window.__lyrionCarouselSettings.displayStyle==='shelf','display style defaults to shelf');
  api.set({playing:false,position:5});
  api.openFrontPreview(api.state().albums[5],5);
  const playbackCalls=rpcCalls.filter(c=>c[0]==='playlistcontrol').length;
  const manualArrowCover=api.state().frontPreviewAlbum;
  api.browseWithArrow(1);
  assert(!preview.hidden&&api.state().frontPreviewAlbum===manualArrowCover&&Math.round(api.state().target)===6,
    'arrow navigation preserves a manual cover while moving spines');
  api.browseWithArrow(1);
  assert(!preview.hidden&&api.state().frontPreviewAlbum===manualArrowCover&&Math.round(api.state().target)===7,
    'repeated arrows keep the same manual cover open');
  api.browseWithArrow(-1);
  assert(!preview.hidden&&api.state().frontPreviewAlbum===manualArrowCover&&Math.round(api.state().target)===6,
    'reverse arrow scroll keeps the manual cover open');
  const lastAlbum=api.state().albums.length-1;
  api.set({position:lastAlbum});
  api.browseWithArrow(1);
  assert(!preview.hidden&&api.state().frontPreviewAlbum===manualArrowCover&&Math.round(api.state().target)===lastAlbum+1,
    'arrow wrapping preserves an open manual cover');
  assert(api.state().KEEP_PLAYING_OPEN===true,
    'playing-cover pinning remains enabled during navigation');
  api.set({playing:true,playingAlbumId:20,position:5});
  const pinnedIndex=api.state().albums.findIndex(a=>a[6]===20);
  api.openFrontPreview(api.state().albums[pinnedIndex],pinnedIndex);
  api.browseWithArrow(1);
  assert(api.state().frontPreviewAlbum===api.state().albums[pinnedIndex]&&!preview.hidden,
    'arrow navigation leaves the currently playing cover pinned');
  assert(rpcCalls.filter(c=>c[0]==='playlistcontrol').length===playbackCalls,
    'keyboard browsing never starts playback');

  // Wheel browsing must never promote a spine to a preview. Once it stops,
  // a deliberate tap on a spine is still allowed to open that album.
  api.set({playing:false,position:5});
  api.openFrontPreview(api.state().albums[5],5);
  const wheelPreviewTimer=api.state().frontTimer;
  stage.dispatchEvent({type:'wheel',deltaX:0,deltaY:180,preventDefault(){}});
  assert(!preview.hidden&&api.state().frontPreviewAlbum===api.state().albums[5],
    'wheel scrolling preserves the manually previewed album');
  assert(api.state().frontTimer===wheelPreviewTimer&&timers.has(wheelPreviewTimer),
    'wheel scrolling does not cancel or extend the manual preview timeout');
  const wheelPosition=api.state().position;
  const idleIndex=(Math.round(wheelPosition)+2)%api.state().albums.length;
  const idleSpine={dataset:{index:String(idleIndex)}};
  const idleTarget={closest:selector=>selector==='.bf-album'?idleSpine:null};
  stage.dispatchEvent({type:'pointerdown',button:0,target:idleTarget,pointerId:51,clientX:100,clientY:80});
  stage.dispatchEvent({type:'pointerup',target:idleTarget,pointerId:51,clientX:100,clientY:80,stopImmediatePropagation(){}});
  assert(!preview.hidden&&api.state().frontPreviewAlbum===api.state().albums[5],
    'spine press during wheel scrolling cannot replace the open cover');
  time+=250;
  api.set({position:Math.round(wheelPosition)});
  stage.dispatchEvent({type:'pointerdown',button:0,target:idleTarget,pointerId:52,clientX:100,clientY:80});
  stage.dispatchEvent({type:'pointerup',target:idleTarget,pointerId:52,clientX:100,clientY:80,stopImmediatePropagation(){}});
  assert(api.state().frontPreviewAlbum===api.state().albums[idleIndex]&&!preview.hidden,
    'deliberate spine click opens its cover once scrolling has stopped');
  // A subsequent spine drag must preserve the manually selected preview and
  // should never promote the spine under the pointer at release.
  api.set({playing:false,position:10});
  api.openFrontPreview(api.state().albums[10],10);
  const scrollSpine={dataset:{index:'12'}};
  const scrollTarget={closest:selector=>selector==='.bf-album'?scrollSpine:null};
  stage.dispatchEvent({type:'pointerdown',button:0,target:scrollTarget,pointerId:53,clientX:300,clientY:80});
  time+=40;
  stage.dispatchEvent({type:'pointermove',target:scrollTarget,pointerId:53,clientX:180,clientY:80});
  stage.dispatchEvent({type:'pointerup',target:scrollTarget,pointerId:53,clientX:180,clientY:80,
    stopImmediatePropagation(){}});
  assert(!preview.hidden&&api.state().frontPreviewAlbum===api.state().albums[10],
    'drag-scrolling the spines preserves a manual cover without opening a replacement');

  // The idle return must wait for a non-playing preview's timeout rather
  // than replacing it during scrolling or before its preview timer expires.
  api.set({playing:true,playingAlbumId:20,position:10});
  api.openFrontPreview(api.state().albums[10],10);
  const previewBeforeIdle=api.state().frontPreviewAlbum;
  await api.returnToPlayingAlbum(true);
  assert(!preview.hidden&&api.state().frontPreviewAlbum===previewBeforeIdle,
    'idle return does not preempt the manual cover before timeout');
  const timeoutId=api.state().frontTimer;
  assert(timeoutId&&timers.has(timeoutId),'non-playing preview has an active timeout');
  const expirePreview=timers.get(timeoutId);timers.delete(timeoutId);expirePreview();
  for(let i=0;i<15;i++)await Promise.resolve();
  assert(api.state().frontPreviewAlbum?.[6]===20&&!preview.hidden,
    'manual preview timeout restores the playing case');

  api.set({playing:true,playingAlbumId:20,position:5});
  api.openFrontPreview(api.state().albums[pinnedIndex],pinnedIndex);
  stage.dispatchEvent({type:'wheel',deltaX:0,deltaY:180,preventDefault(){}});
  assert(api.state().frontPreviewAlbum===api.state().albums[pinnedIndex]&&!preview.hidden,
    'wheel scrolling retains the currently playing cover without replacing it');
  assert(api.state().KEEP_PLAYING_OPEN===true,
    'wheel browsing cannot disable permanent playing-cover pinning');

  assert(api.coverCache().active===2,'cover preloader limits concurrent downloads');
  assert(imageRequests.every(image=>image.fetchPriority==='low'&&image.decoding==='async'),'cover warming uses low priority and async decoding');
  api.prefetchCoverWindow(10);api.prefetchCoverWindow(30);
  assert(api.coverCache().queued<=9,'preloader replaces stale queued windows');
  for(let round=0;round<20;round++)for(const image of imageRequests.slice())image.onload?.();
  assert(api.coverCache().active===0&&api.coverCache().cached<=24,'preloader drains and bounds retained images');
  const warmedCount=imageRequests.length;api.prefetchCoverWindow(30);
  assert(imageRequests.length===warmedCount,'unchanged window does not refetch covers');

  // 0.10.0 Spotify/Spotty regression coverage.
  if (sources.spotify) {
    const spottyCalls=[];
    const spottyRpc=async (player,cmd)=>{
      spottyCalls.push(cmd);
      if(cmd[0]==='spotty'&&cmd[1]==='playlist')return {ok:1};
      if(cmd.includes('item_id:9'))return {items_loop:[]};
      if(cmd.includes('item_id:album-1'))return {items_loop:[
        {id:'track-1',type:'audio',line1:'1 First track',duration:61,genre:'Rock',year:'2020'},
        {id:'9',name:'Add Album to Library'}
      ]};
      if(cmd.includes('item_id:3'))return {items_loop:[{id:'album-search',type:'playlist',name:'Search Album by Search Artist',image:'/imageproxy/search'}]};
      if(cmd.some(x=>String(x).startsWith('search:')))return {items_loop:[{id:'3',name:'Albums',passthrough:[{type:'album',query:'needle'}]}]};
      if(cmd.includes('item_id:7'))return {items_loop:[{id:'album-1',name:'Saved Album by Saved Artist',image:'/imageproxy/saved'}]};
      return {items_loop:[{id:'2',name:'Search',type:'search'},{id:'7',name:'Albums'}]};
    };
    const spotty=new Function('rpc',plain(sources.spotify)+';return {normalizeSpottyAlbum,savedSpotifyAlbums,searchSpotifyAlbums,playSpotifyAlbum,saveSpotifyAlbum,spotifyAlbumInformation};')(spottyRpc);
    const normalized=spotty.normalizeSpottyAlbum({id:'x',name:'Title by Artist',image:'/imageproxy/x'});
    assert(normalized.source==='spotify'&&normalized.title==='Title'&&normalized.artist==='Artist'&&normalized.spottyItemId==='x','Spotty album normalization');
    const saved=await spotty.savedSpotifyAlbums('player');
    assert(saved.length===1&&saved[0].title==='Saved Album'&&spottyCalls.some(c=>c.includes('item_id:7')),'saved Spotify albums use discovered Albums node');
    const searched=await spotty.searchSpotifyAlbums('player','needle');
    assert(searched.length===1&&searched[0].title==='Search Album','Spotify full-catalogue album search');
    await spotty.playSpotifyAlbum('player','album-1');
    assert(spottyCalls.some(c=>c[0]==='spotty'&&c[1]==='playlist'&&c.includes('item_id:album-1')),'Spotify playback stays in Spotty/LMS');
    await spotty.saveSpotifyAlbum('player','album-1');
    assert(spottyCalls.some(c=>c.includes('item_id:9')),'Spotify searched album save follows Spotty action');
    const info=await spotty.spotifyAlbumInformation('player','album-1');
    assert(info.tracks.length===1&&info.genre==='Rock'&&info.year==='2020','Spotify Album Information parses tracks and metadata');
  }
  if (sources.index) {
    assert(sources.index.includes('data-source="library"')&&sources.index.includes('data-source="spotify"'),'Library and Spotify source controls present');
    assert(sources.index.includes('class="bf-front-case" tabindex="0"')&&
      sources.index.includes('Swipe left or right to browse albums'),
      'closed cover is keyboard-focusable and advertises horizontal browsing');
    assert(!sources.index.includes('aria-label="Show album information"'),
      'the closed cover is no longer a direct Album Information button');
    assert(!sources.index.includes('gsap-jewel-poc')&&!sources.index.includes('cdn.jsdelivr.net/npm/gsap'),
      'production page has no GSAP or open-case experiment dependencies');
    assert(sources.index.includes('class="bf-front-play"'),
      'separate Play button remains on the closed photographic case');
    assert(sources.index.includes('settings-panel-coffee')&&sources.index.includes('https://buymeacoffee.com/stuliet'),'Coffee settings panel present');
  }
  if (sources.albumBrowserCss) {
    for(const selector of ['.bf-source-switch','.bf-previous','.bf-next','.bf-queue-open'])
      assert(sources.albumBrowserCss.includes('#book-fan-browser.is-starting '+selector),'startup hides '+selector);
  }
  if (sources.lmsProvider) {
    let disabled=new Set(['7','9']);
    const calls=[];
    const fakeRpc=async (_player,command)=>{
      calls.push(command);
      if(command.includes('genre_id:7,9'))return {albums_loop:[{id:2},{id:3}],count:2};
      return {albums_loop:[{id:1},{id:2},{id:3}],count:3};
    };
    const createLmsProvider=new Function('rpc',plain(sources.lmsProvider)+';return createLmsProvider;')(fakeRpc);
    const provider=createLmsProvider({
      mapAlbum:album=>album,getPlayerId:()=>null,getPageSize:()=>10,getSearchLimit:()=>100,
      getDisabledGenres:()=>disabled,getOrderMode:()=> 'artistAlbum',getLibraryCount:()=>0,
      setLibraryCount:()=>{},getPositionIndex:()=>new Map(),setPositionIndex:()=>{}
    });
    const filtered=await provider.search('pink');
    assert(filtered.albums.length===1&&filtered.albums[0].id===1,'local search excludes albums in disabled genres, including mixed-genre albums');
    assert(calls.length===2&&calls[1].includes('genre_id:7,9')&&!calls.flat().some(arg=>String(arg).startsWith('exclude_genre_id:')),'local search uses supported LMS genre_id filter');
    disabled=new Set();calls.length=0;
    const unfiltered=await provider.search('pink');
    assert(unfiltered.albums.length===3&&calls.length===1,'local search returns all matches when no genres are disabled');
    assert(sources.app.includes('lmsProvider.search(value)'),'app search uses genre-aware LMS provider');
  }
  assert(sources.app.includes("'tags:altngidA'")&&sources.app.includes('trackGenres'),'LMS Album Information requests disc, artist and genre metadata');

  if (sources.server) {
    assert(sources.server.includes('CATALOGUE_SNAPSHOT_TTL_SECONDS')&&
      sources.server.includes('_load_catalogue_snapshot')&&
      sources.server.includes('_catalogue_genre_ids')&&
      sources.server.includes('_invalidate_catalogue_data'),
      'server exposes persistent, expiring catalogue snapshots and indexed genre exclusions');
    assert(sources.server.includes('def _reconcile_catalogue')&&
      sources.server.includes('class CarouselColourIndexer')&&
      sources.app.includes("'/api/catalogue/reconcile'"),
      'Carousel owns scan reconciliation and background indexing without LMS hooks');
    assert(!sources.server.includes('from disc_artwork import')&&
      !sources.server.includes('/api/processed-disc/')&&
      !sources.server.includes('/api/local-artwork/'),
      'server no longer exposes the removed disc and booklet routes');
    assert(sources.server.includes('jewel-case-realistic-v1.png')&&
      sources.app.includes('case=realistic-v1'),
      'realistic closed jewel-case artwork composition is preserved');
  }
  if (sources.debianBuild) {
    assert(!sources.debianBuild.includes('disc_artwork.py')&&
      sources.debianBuild.includes('cp -a "$PROJECT_DIR/assets" "$PROJECT_DIR/css" "$PROJECT_DIR/js"'),
      'Debian package excludes removed disc module while retaining photographic assets');
  }

  assert(sources.app.includes("'tags:alJenKNRA'"),'initial LMS player status requests artist roles');
  assert(!sources.app.includes('carousel:toggle-jewel-case')&&!sources.app.includes('carousel:album-preview'),
    'closed-cover interaction no longer dispatches open-case events');
  assert(!sources.app.includes("isThisPlaying?' · Playing':'"),
    'Now Playing heading never renders a redundant Playing status suffix');
  assert(sources.app.includes('beginShelfDrag(')&&sources.app.includes('moveShelfDrag(event,false)')&&
    sources.app.includes('finishShelfDrag(false)'),
    'cover reuses the existing spine drag and snap physics');
  assert(!sources.app.includes('showTrackList(frontPreviewAlbum)')&&
    !sources.app.includes('showTrackList(press.album)'),
    'short cover presses do not open Album Information');
  assert(sources.app.includes('lastShelfScrollAt')&&
    sources.app.includes('if(shelfIsScrolling()||event.button!==0)return;'),
    'spine clicks are suppressed during active wheel or drag scrolling');
  assert(sources.app.includes('indexForAlbumId(playingAlbumId)')&&
    sources.app.includes('frontPreviewIndex=frontPreviewAlbum[6]!=null?'),
    'per-frame Now Playing and preview positions use indexed album lookup');
  assert(sources.app.includes('lastHoverProbeAt')&&
    sources.app.includes('updateHoveredAlbumFromPoint(true)'),
    'hover hit testing is throttled during animation but immediate on pointer movement');

  assert(!/function browseWithArrow\([\s\S]*?function stopFollowing\(/.exec(sources.app)?.[0].includes('openFrontPreview('),
    'arrow-key browsing cannot automatically open another cover');
  assert(sources.lms.includes("'tags:alJenA'"),'CometD subscription requests artist roles');

  // Large catalogues retain O(1) album lookup; stale positions after a
  // reorder are validated and repaired rather than returning wrong albums.
  const savedAlbums=api.state().albums;
  const largeAlbums=Array.from({length:20000},(_,i)=>{
    const album=[];album[6]='large-'+i;return album;
  });
  api.replaceAlbumsForTest(largeAlbums);
  assert(api.indexForAlbumId('large-19999')===19999,
    '20,000-album indexed lookup reaches last album');
  [largeAlbums[1],largeAlbums[19999]]=[largeAlbums[19999],largeAlbums[1]];
  assert(api.indexForAlbumId('large-19999')===1&&api.indexForAlbumId('large-1')===19999,
    'album index cache detects reordered positions and self-corrects');
  api.replaceAlbumsForTest(savedAlbums);


  return checks;
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('regressions.mjs')) {
  const {readFile}=await import('node:fs/promises');
  const sources={};for(const name of ['app','browser','catalogue','lms','settings','spotify'])sources[name]=await readFile(new URL('../js/'+name+'.js',import.meta.url),'utf8');
  sources.lmsProvider=await readFile(new URL('../js/providers/lms-provider.js',import.meta.url),'utf8');
  sources.index=await readFile(new URL('../index.html',import.meta.url),'utf8');
  sources.albumBrowserCss=await readFile(new URL('../css/album-browser.css',import.meta.url),'utf8');
  sources.server=await readFile(new URL('../server.py',import.meta.url),'utf8');
  sources.debianBuild=await readFile(new URL('../packaging/debian/build-deb.sh',import.meta.url),'utf8');
  console.log(`${await runTests(sources)} regression checks passed`);
}
