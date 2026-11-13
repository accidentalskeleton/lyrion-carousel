// Run with: node tests/regressions.mjs
// Small DOM doubles exercise the complete app module without LMS or playback writes.
export async function runTests(sources) {
  let checks = 0;
  const assert = (value, message) => { if (!value) throw Error(message); checks++; };
  const plain = source => source.replace(/^import .*;\r?\n/gm, '').replace(/\bexport /g, '');
  const geometry = new Function(plain(sources.browser) + ';return {clamp,modulo,circularDelta,nearestPositionForIndex};')();
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
  let serverStatusFixture = {rescan:0,lastscan:'100','info total albums':95,'info total songs':900};
  const lmsPollCommands=[];
  const {CometDClient, rpc:realRpc, resetRpcSession} = new Function('fetch', plain(sources.lms) + ';return {CometDClient,rpc,resetRpcSession};')(
    async (_,request) => {
      lmsPollCommands.push(JSON.parse(request?.body||'{}')?.params?.[1]);
      return {ok:true,json:async () => ({result:serverStatusFixture})};
    }
  );
  const statusEvents=[];
  const comet = new CometDClient(() => {}, () => {}, data => {
    statusEvents.push(data);
    libraryEvents++;
  }, () => 95);
  comet.handleServerStatus(serverStatusFixture);
  assert(libraryEvents===0,'first serverstatus observation establishes a baseline');
  comet.handleServerStatus({...serverStatusFixture,rescan:1});
  comet.handleServerStatus({...serverStatusFixture,rescan:0,lastscan:'101'});
  comet.handleServerStatus({...serverStatusFixture,rescan:0,lastscan:'101'});
  assert(libraryEvents===1,'scan completion and lastscan change trigger one refresh');
  comet.handleServerStatus({...serverStatusFixture,rescan:0,lastscan:'102'});
  assert(libraryEvents===2,'lastscan change triggers refresh even when rescan remains 0');
  comet.handleServerStatus({...serverStatusFixture,rescan:0,lastscan:'102'});
  assert(libraryEvents===2,'replayed serverstatus is idempotent');
  comet.handleServerStatus({...serverStatusFixture,rescan:0,lastscan:'102','info total albums':96});
  assert(libraryEvents===3,'album total detects additions without a rescan transition');
  comet.handleServerStatus({...serverStatusFixture,rescan:0,lastscan:'102','info total albums':96,'info total songs':902});
  assert(libraryEvents===4,'song total detects new tracks on an existing album');
  comet.handleServerStatus({...serverStatusFixture,rescan:true,lastscan:'103'});
  assert(libraryEvents===4,'never refresh while LMS is still scanning');
  comet.handleServerStatus({...serverStatusFixture,rescan:false,lastscan:'103'});
  assert(libraryEvents===5,'scan completion refreshes after deferred revision change');
  comet.stop();
  comet.handleServerStatus({...serverStatusFixture,lastscan:'104'});
  assert(libraryEvents===6,'same-LMS reconnect retains previous lastscan baseline');
  comet.resetLibraryState();
  comet.handleServerStatus({...serverStatusFixture,lastscan:'3','info total albums':22});
  assert(libraryEvents===7,'new-LMS initial mismatch with displayed album count triggers reconciliation');
  comet.resetLibraryState();
  comet.handleServerStatus({...serverStatusFixture,lastscan:'3','info total albums':95});
  assert(libraryEvents===7,'new-LMS initial matching baseline does not trigger false scan');
  // A status request still works without CometD messages, but stale in-flight
  // replies from a previous LMS generation must not cause a refresh.
  comet.generation=21;
  serverStatusFixture={rescan:0,lastscan:'4','info total albums':95,'info total songs':900};
  await comet.pollServerStatus(21);
  assert(libraryEvents===8,'lightweight serverstatus polling catches a missed scan');
  await comet.pollServerStatus(20);
  assert(libraryEvents===8,'stale serverstatus polls are ignored');
  let playerStatusDelivered=0;
  comet.onStatus=()=>{playerStatusDelivered++;};
  comet.playerId='test-player';
  await comet.pollPlayerStatus(21,'test-player');
  assert(playerStatusDelivered===1 &&
    lmsPollCommands.some(cmd=>cmd?.[0]==='status'&&cmd.includes('tags:aluJenKNRAxE')),
    'fallback player-status read includes Spotify URL/extid tags and reaches the viewer');
  await comet.pollPlayerStatus(20,'test-player');
  assert(playerStatusDelivered===1,'stale player-status poll does not update another session');
  // A browser can already have the NEW live LMS count, yet have an OLD
  // 15-minute prepared SQLite catalogue. The old comparison with the live
  // count failed to detect this; compare against the prepared count instead.
  let preparedSnapshot={albums:95,created:100};
  let staleDetected=0;
  const staleComet=new CometDClient(()=>{},()=>{},()=>{staleDetected++;},()=>preparedSnapshot);
  staleComet.handleServerStatus({rescan:0,lastscan:'95','info total albums':96,'info total songs':901});
  assert(staleDetected===1,'new LMS album detects stale prepared catalogue at initial status');
  staleComet.handleServerStatus({rescan:0,lastscan:'95','info total albums':96,'info total songs':901});
  assert(staleDetected===2,'stale prepared count remains retryable while catalogue is unchanged');
  preparedSnapshot={albums:96,created:97};
  staleComet.handleServerStatus({rescan:0,lastscan:'95','info total albums':96,'info total songs':901});
  assert(staleDetected===2,'reconciliation updates prepared baseline and stops repeated refreshes');
  const replacedComet=new CometDClient(()=>{},()=>{},()=>{staleDetected++;},
    ()=>({albums:96,created:90}));
  replacedComet.handleServerStatus({rescan:0,lastscan:'95','info total albums':96,'info total songs':901});
  assert(staleDetected===3,'same-count library replacements detected after snapshot creation');
  const freshComet=new CometDClient(()=>{},()=>{},()=>{staleDetected++;},
    ()=>({albums:96,created:110}));
  freshComet.handleServerStatus({rescan:0,lastscan:'95','info total albums':96,'info total songs':901});
  assert(staleDetected===3,'fresh snapshot does not cause unnecessary reconciliation');
  const playerless=new CometDClient(()=>{},()=>{},()=>{},()=>({albums:95,created:100}));
  // Status polling is allowed to start without an LMS playback player;
  // avoid real timers/network here by checking the code's contract.
  assert(sources.lms.includes('if (!playerId) return;') &&
    sources.lms.indexOf('this.statusTimer = setInterval(') < sources.lms.indexOf('if (!playerId) return;'),
    'library status polling is independent of playback player selection');
  const oldRpc = realRpc('0', ['players',0,1]); resetRpcSession();
  let rejected = false; try { await oldRpc; } catch (_) { rejected = true; }
  assert(rejected, 'old server RPC rejected');

  class Element {
    constructor(name='') {
      this.name=name;this.children=[];this.hidden=/overlay|menu|front-preview/.test(name);
      this.dataset={};this.attributes={};this.listeners={};this.value='';this.clientWidth=1000;this.clientHeight=400;
      this.style={writes:{},setProperty(k,v){this[k]=v;this.writes[k]=(this.writes[k]||0)+1;},getPropertyValue(k){return this[k]||'';}};
      const classes=new Set();this.classList={add:(...v)=>v.forEach(x=>classes.add(x)),remove:(...v)=>v.forEach(x=>classes.delete(x)),contains:x=>classes.has(x),toggle:(x,on)=>{if(on)classes.add(x);else classes.delete(x);return on;}};
    }
    get options(){return this.children;}
    get textContent(){return (this._text||'')+this.children.map(child=>child.textContent||'').join('');}
    set textContent(value){this._text=String(value);this.children=[];}
    append(...nodes){for(const n of nodes){n.parent=this;this.children.push(n);}}
    replaceChildren(...nodes){this._text='';this.children=[];this.append(...nodes);}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(n=>n!==this);}
    setAttribute(k,v){this.attributes[k]=v;}
    removeAttribute(k){delete this.attributes[k];}
    getAttribute(k){return this.attributes[k];}
    toggleAttribute(k,v){if(v)this.attributes[k]='';else delete this.attributes[k];}
    addEventListener(k,fn){(this.listeners[k]??=[]).push(fn);}
    dispatchEvent(event){for(const fn of this.listeners[event.type]||[])fn(event);return true;}
    contains(el){return el===this||this.children.some(n=>n.contains?.(el));}
    focus(){} select(){} setPointerCapture(){}
    get offsetWidth(){this.widthReads=(this.widthReads||0)+1;return this.name==='case'?(this.coverWidth||300):this.clientWidth;}
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
  const sourceButtonsForTest=['library','spotify'].map(source=>{const button=new Element('source');button.dataset.source=source;return button;});
  const document=new Element('document');document.querySelectorAll=selector=>selector==='.bf-source-button'?sourceButtonsForTest:[];document.getElementById=()=>root;document.createElement=tag=>new Element(tag);document.elementFromPoint=()=>null;
  const window=new Element('window');window.innerWidth=1000;window.innerHeight=600;
  const storage=new Map();const localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))};
  let time=0,nextId=0;const frames=new Map(),timers=new Map();
  const setTimeout=fn=>{timers.set(++nextId,fn);return nextId;},clearTimeout=id=>timers.delete(id);
  const requestAnimationFrame=fn=>{frames.set(++nextId,fn);return nextId;},cancelAnimationFrame=id=>frames.delete(id);
  const rpcCalls=[];
  const catalogueEvents=[];
  let catalogueReconcileChanged=true,recentNewAlbumIdsFixture=[];
  let preparedLibraryOverride=null,preparedCreatedAt=200;
  const revisionOf=rows=>JSON.stringify(rows.map(x=>[x.id,x.album,x.artist]));
  let tracksFixture=null,statusFixture=null,tracksHandler=null,spottyCapability=1,spotifyFollowAlbums=[],spotifyFollowSearch=null;
  let library=Array.from({length:95},(_,i)=>({id:i+1,album:'Album '+String(i+1).padStart(3,'0'),artist:'Artist',textkey:'A'}));
  const rpc=async (player,cmd)=>{rpcCalls.push(cmd);if(cmd[0]==='can')return {_can:spottyCapability};if(cmd[0]==='players')return {players_loop:[{playerid:'test-player',connected:1,isplaying:1}]};if(cmd[0]==='status')return statusFixture||{mode:'play',playlist_loop:[{album_id:20,album:'Album 020',artist:'Artist',title:'Track',duration:60}],time:1};if(cmd[0]==='tracks')return tracksHandler?tracksHandler(cmd):{titles_loop:(tracksFixture||[]).slice(cmd[1],cmd[1]+cmd[2]),count:tracksFixture?.length||0};if(cmd[0]==='albums'){
    const sort=cmd.find(arg=>typeof arg==='string'&&arg.startsWith('sort:'));
    const ordered=sort==='sort:recentlyplayed'?library.slice().reverse():library;
    return {count:ordered.length,albums_loop:ordered.slice(cmd[1],cmd[1]+cmd[2])};
  }return {};};
  window.dispatchEvent=()=>{};
  const imageRequests=[];
  class PreloadImage{set src(url){this.url=url;imageRequests.push(this)}}
  let metadataFetch=async()=>({ok:false});
  // Discovery must choose a different album when the test requires scrolling.
  // A real random draw can select the centred album and legitimately skip it.
  const appMath=Object.create(Math);appMath.random=()=>.37;
  const env={Math:appMath,document,window,localStorage,performance:{now:()=>time},requestAnimationFrame,cancelAnimationFrame,setTimeout,clearTimeout,setInterval:setTimeout,clearInterval:clearTimeout,
    ResizeObserver:class{observe(){}},Event:class{},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},Image:PreloadImage,fetch:(url,...args)=>{
      if(url==='/api/catalogue/invalidate'){
        catalogueEvents.push({action:'invalidate',method:args[0]?.method});
        return Promise.resolve({ok:true,json:async()=>({invalidated:true})});
      }
      if(url==='/api/catalogue/reconcile'){
        catalogueEvents.push({action:'reconcile',method:args[0]?.method});
        return Promise.resolve({ok:true,json:async()=>({changed:catalogueReconcileChanged,count:library.length,revision:revisionOf(library),new_albums:catalogueReconcileChanged?recentNewAlbumIdsFixture.length:0,recent_new_album_ids:recentNewAlbumIdsFixture})});
      }
      if(url.startsWith('/api/catalogue')){
        catalogueEvents.push({action:'read',url});
        const prepared=preparedLibraryOverride||library;
        return Promise.resolve({ok:true,json:async()=>({
          albums_loop:prepared.map(a=>({...a,artwork_track_id:a.id})),
          count:prepared.length,library_count:prepared.length,snapshot_created:preparedCreatedAt,catalogue_revision:revisionOf(prepared)
        })});
      }
      return metadataFetch(url,...args);
    },rpc,CometDClient:class{stop(){}start(){}resetLibraryState(){}},resetRpcSession:()=>{},clamp:geometry.clamp,modulo:geometry.modulo,circularDelta:geometry.circularDelta,nearestPosition:geometry.nearestPositionForIndex,
    buildAlbumPositionIndex:catalogue.buildAlbumPositionIndex,locateIndexedAlbum:catalogue.locateAlbum,
    createLmsProvider:()=>({play:async album=>{await rpc('test-player',['playlistcontrol','cmd:load','album_id:'+album[6]]);return {};}}),createSpotifyProvider:()=>({load:async()=>({albums:spotifyFollowAlbums,total:spotifyFollowAlbums.length,libraryCount:spotifyFollowAlbums.length,live:false}),search:async()=>spotifyFollowSearch?spotifyFollowSearch():({albums:spotifyFollowAlbums}),play:async album=>{await rpc('test-player',['spotty','playlist','play','item_id:'+album[14]]);return {};}}),spotifyAlbumInformation:async()=>({tracks:[]}),
    spotifyAlbumUrl:new Function(plain(sources.spotify)+';return spotifyAlbumUrl;')(),
    spotifyAlbumSearchUrl:new Function(plain(sources.spotify)+';return spotifyAlbumSearchUrl;')()};
  const app=plain(sources.app).replace(/start\(\);\s*$/, '');
  const api=new Function(...Object.keys(env), app + `
    return {setOrderForTest:value=>{orderMode=value;},setSourceForTest:value=>{catalogueSource=value;},sourceForTest:()=>catalogueSource,sourceOrdersForTest:()=>({...sourceOrderModes}),checkSpottyAvailability,spottyState:()=>spottyAvailable,setCatalogueSource,shelfSpace,shelfIndexAt,spineWeight,mapLyrionAlbum,catalogueCodeLines,loadSpineMeta,fetchSpineMeta,flushSpineMetaBatch,rememberSpineMeta,clearSpineMetadata,indexForAlbumId,rebuildAlbumIndex,jumpToLetter,letterIndex:()=>new Map(alphabetIndex),
      preparedStateForTest:()=>({albums:preparedCatalogueCount,created:preparedCatalogueCreated,revision:preparedCatalogueRevision,live:libraryAlbumCount}),
      arrivalStateForTest:()=>({mode:newAlbumAction,revision:observedLibraryRevision}),
      manualSourceStateForTest:()=>({timeout:MANUAL_SOURCE_IDLE_MS,until:sourceBrowseDeadline,timer:sourceBrowseTimer,held:sourceBrowseHeld()}),
      metaState:()=>({cached:spineMetaCache.size,pending:spineMetaPending.size,queued:spineMetaBatchQueue.size,active:spineMetaBatchesActive}),
      cachedSpineMeta:url=>spineMetaCache.get(url),
      replaceAlbumsForTest:value=>{albums=value;totalAlbums=value.length;rebuildAlbumIndex();},
      finiteShelfBounds,snapShelfPosition,
      prefetchCoverWindow,invalidateFrontCaseWidth,frontCaseWidth,coverCache:()=>({active:warmingCovers.size,cached:warmCovers.size,queued:coverQueue.length}),browseWithArrow,connectLyrion,playRandomAlbum,discoverAlbum,centreAlbumIndex,loadInitialCatalogue,refreshCatalogue,handleLibraryEvent,setDisplayOrder,applySetting,applyStatus,selectStartupAlbum,returnToPlayingAlbum,stopFollowing,ensurePlayingCover,closeFrontPreview,openFrontPreview,showTrackList,closeTrackList,closeAlbumMenu,syncFrontTimeoutPause,openQueue,closeQueue,storeBatch,restoreSourceOrders,resolveSpotifyPlayingAlbum,followPlayingSource,playbackSourceForTrack,openSearch,closeSearch,runSearch,noteUserActivity,selectSearchAlbum,openAlbumMenu,selectedAlbumFilter,queueAlbum,playAlbumNow,clearPlaylistAndPlay,sortAlbumTracks,distinctTrackArtist,updateHoveredAlbumFromPoint,updateMeta,draw,
      set(values){if('playerId' in values)playerId=values.playerId;if('connecting' in values)connecting=values.connecting;if('playing' in values){playing=values.playing;paused=false;}if('paused' in values)paused=values.paused;if('playingAlbumId' in values)playingAlbumId=values.playingAlbumId;if('hover' in values)hoveredAlbumIndex=values.hover;if('position' in values)position=target=values.position;if('activity' in values)lastActivityAt=values.activity;},
      state:()=>({albums,position,target,PAGE_SIZE,DISPLAY_ALBUM_COUNT,orderMode,frontPreviewAlbum,frontTimer,frontTimeoutRemaining,frontTimeoutDeadline,followAnimation,followingNowPlaying,playing,paused,KEEP_PLAYING_OPEN,randomAnimating,discoveryBusy,discoveryHoldTimer,discoveryHoverSuspended,hoveredAlbumIndex,wheelTimer,coverOpening,raf,sourceFollowPending}),
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
  // Simulate the reported failure: LMS sees the latest album, but the saved
  // SQLite catalogue was prepared before that album was indexed.
  const previousPrepared=library.slice();
  library.push({id:96,album:'Unobserved album',artist:'Artist'});
  preparedLibraryOverride=previousPrepared;
  await api.loadInitialCatalogue();
  assert(api.state().albums.length===95 &&
    api.preparedStateForTest().albums===95 &&
    api.preparedStateForTest().live===95 &&
    library.length===96,
    'browser still has stale prepared snapshot while LMS reports a newer album');
  let staleSnapshotObserved=0;
  const actualStartupComet=new CometDClient(()=>{},()=>{},()=>{staleSnapshotObserved++;},
    api.preparedStateForTest);
  actualStartupComet.handleServerStatus({rescan:0,lastscan:'199','info total albums':96});
  assert(staleSnapshotObserved===1,'initial LMS status notices the stale 95-album snapshot');
  preparedLibraryOverride=null;
  library.pop();
  await api.loadInitialCatalogue();
  assert(api.preparedStateForTest().albums===95,'restored catalogue snapshot baseline');

  assert(api.catalogueCodeLines('BEADYCD2')==='BEADYCD\n2','catalogue letter prefix stays intact');
  for(const code of ['9362-49870-2','1234567890123','509999 65111 2 1']){
    assert(api.catalogueCodeLines(code).split('\n').length===3,
      'long catalogue numbers use three lines instead of shrinking into two');
  }
  for(const code of ['9362-49870-2','088 112 379-2','1234567890123','7243 8 53711 2 7 / CDDEEPP 2']){
    const lines=api.catalogueCodeLines(code).split('\n');
    assert(lines.length>=2&&lines.length<=3&&lines.join('').replace(/\s/g,'')===code.replace(/\s/g,''),
      'catalogue wrapping preserves code characters in two or three lines');
  }
  const firstSpine=stage.children.find(node=>node.className?.includes('bf-album'));
  const spineLabel=firstSpine?.children.find(node=>node.className==='bf-spine-label');
  const spineShell=firstSpine?.children.find(node=>node.className==='bf-spine-shell');
  const catalogueFooter=firstSpine?.children.find(node=>node.className==='bf-spine-catalogue');
  assert(catalogueFooter.hidden&&catalogueFooter.textContent==='',
    'albums without real catalogue metadata have no fabricated code');
  const spineCover=firstSpine?.children.find(node=>node.className==='bf-spine-cover');
  assert(spineLabel?.textContent?.includes('Artist — Album'), 'one continuous artist and album spine label');
  assert(spineLabel.children.some(child=>child.className==='bf-spine-artist')&&
    spineLabel.children.some(child=>child.className==='bf-spine-title'),
    'artist and title retain separate styling without changing their text');
  assert(new Set(api.geometry().nodes.map(node=>node.el.dataset.labelAlign)).size===2,
    'album identities produce both top-aligned and centred spine labels');
  assert(new Set(api.geometry().nodes.map(node=>node.el.dataset.printStyle)).size===3,
    'varied spines offer regular, bold and condensed print treatments');
  assert(firstSpine.children.some(child=>child.className==='bf-spine-wear'&&child.getAttribute('aria-hidden')==='true'),
    'wear is a reusable decorative layer hidden from assistive technology');
  assert(new Set(api.geometry().nodes.map(node=>node.el.dataset.catalogueStyle)).size===3,
    'catalogue lettering varies independently across sans serif and monospace treatments');
  assert(spineShell?.src==='/assets/jewel-case-spine-v1.svg', 'all spines use shared static shell image');
  assert(!spineCover, 'spines do not request or display cropped cover artwork');
  assert(firstSpine?.className?.includes('bf-album'), 'spines retain the normal cover-derived colour metadata path');
  assert(api.state().albums.length===95 && api.state().albums.every(Boolean), 'full catalogue loaded in bounded pages');
  assert(rpcCalls.filter(c=>c[0]==='albums').every(c=>c[2]<=40), 'catalogue page limit');

  api.setSourceForTest('spotify');spottyCapability=0;await api.checkSpottyAvailability();
  assert(api.sourceForTest()==='library'&&storage.get('albumBrowserSource')==='library',
    'missing Spotty restores the saved Spotify source to Library');
  assert(api.spottyState()===false,'LMS capability check detects an absent Spotty plugin');
  assert(sourceButtonsForTest[1].disabled&&!sourceButtonsForTest[0].disabled,
    'Spotify is disabled while the LMS library remains selectable without Spotty');
  const callsBeforeDisabledSpotify=rpcCalls.length;
  await api.setCatalogueSource('spotify');
  assert(rpcCalls.length===callsBeforeDisabledSpotify,'disabled Spotify never tries to load Spotty albums');
  spottyCapability=1;await api.checkSpottyAvailability();
  assert(api.spottyState()===true,'LMS capability check detects an installed Spotty plugin');
  assert(!sourceButtonsForTest[1].disabled,'Spotify becomes selectable when Spotty is installed');
  assert(api.mapLyrionAlbum({id:999,disccount:2})[17]===2,'LMS disc count is retained');
  assert(api.spineWeight(api.mapLyrionAlbum({id:999,disccount:2}))===1.5,'multi-disc spines are 1.5 times normal width');
  const normalAlbums=api.state().albums;
  const mixedAlbums=normalAlbums.map((album,index)=>{const copy=album.slice();copy[17]=index%3===0?2:1;return copy;});
  api.replaceAlbumsForTest(mixedAlbums);api.set({position:40});api.draw();
  for(const position of [-200,-1,0,1.5,40,94,95,201.25]){
    assert(Math.abs(api.shelfIndexAt(api.shelfSpace(position))-position)<1e-9,
      'weighted shelf positions round-trip across both wrap boundaries');
  }
  const mixedNodes=api.geometry().nodes;
  for(const node of mixedNodes){
    const normalWidth=stage.clientWidth/api.state().DISPLAY_ALBUM_COUNT;
    assert(node.el.dataset.caseType===(Number(node.album[17])>1?'multi':'single'),
      'only multi-disc albums receive the extra case seam');
    assert(Math.abs(parseFloat(node.el.style.width)-normalWidth*api.spineWeight(node.album))<1e-8,
      'rendered widths use real disc counts');
  }
  const leftFor=node=>Number(/translate3d\(([-.\d]+)px/.exec(node.el.style.transform)[1]);
  const orderedNodes=mixedNodes.slice().sort((a,b)=>a.index-b.index);
  for(let i=1;i<orderedNodes.length;i++){
    const before=orderedNodes[i-1],after=orderedNodes[i];
    assert(Math.abs(leftFor(before)+parseFloat(before.el.style.width)-leftFor(after))<1e-8,
      'mixed single/multi-disc spines touch without overlaps or gaps');
  }
  api.applySetting('shelfVariety','false');
  assert(api.geometry().nodes.every(node=>Math.abs(parseFloat(node.el.style.width)-stage.clientWidth/api.state().DISPLAY_ALBUM_COUNT)<1e-8),
    'disabling wider multi-disc spines immediately restores uniform widths');
  api.applySetting('shelfVariety','true');
  assert(api.geometry().nodes.some(node=>api.spineWeight(node.album)===1.5),
    'reenabling wider spines restores multi-disc widths');
  api.setOrderForTest('recent');
  for(const end of [0,1]){
    api.set({position:api.finiteShelfBounds()[end]});
    api.applySetting('shelfVariety','false');
    assert(Math.abs(api.state().position-api.finiteShelfBounds()[end])<1e-8,
      'turning multi-disc widths off preserves the current finite shelf endpoint');
    api.applySetting('shelfVariety','true');
    assert(Math.abs(api.state().position-api.finiteShelfBounds()[end])<1e-8,
      'turning multi-disc widths on preserves the current finite shelf endpoint');
  }
  api.setOrderForTest('artistAlbum');
  api.replaceAlbumsForTest(normalAlbums);api.set({position:4});api.draw();

  // Phase 4: advancing the shelf should recycle the same physical elements
  // rather than destroying and constructing a row of new image/text nodes.
  const originalPosition=api.state().position;
  const initialPool=api.geometry().nodes.map(node=>node.el);
  const cachedCoverWidth=api.frontCaseWidth();
  assert(api.frontCaseWidth()===cachedCoverWidth,'case width is cached across redraws');
  const initialPoolSize=initialPool.length;
  api.set({position:originalPosition+1});api.draw();
  const movedPool=api.geometry().nodes;
  assert(movedPool.length===initialPoolSize,'phase 4 keeps a bounded visible spine pool');
  assert(movedPool.every(node=>initialPool.includes(node.el)),
    'scrolling by one album recycles existing shelf nodes');
  assert(new Set(movedPool.map(node=>node.el)).size===movedPool.length,
    'each pooled shelf node is used exactly once');
  assert(stage.children.length===movedPool.length,
    'recycled spines are not appended twice to the shelf');
  assert(movedPool.every(node=>Number(node.el.dataset.index)===node.index),
    'recycled nodes keep their current album index for interactions');
  const stableNode=movedPool[Math.floor(movedPool.length/2)];
  const pitchWrites=stableNode.el.style.writes['--spine-width'];
  api.draw();api.draw();
  assert(stableNode.el.style.writes['--spine-width']===pitchWrites,
    'unchanged spine width is not written on every animation frame');
  api.set({position:originalPosition+20});api.draw();
  assert(stage.children.length===api.geometry().nodes.length,
    'long jumps preserve bounded DOM without leaking stale spines');
  assert(api.geometry().nodes.every(node=>node.el._boundAlbum===api.state().albums[node.index]),
    'pooled nodes are rebound to the correct album after a long jump');
  api.set({position:originalPosition});api.draw();

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
  const cachedSpine=new Element('cached-spine');
  cachedSpine._boundAlbum=sampleAlbums[0];cachedSpine.dataset.index='0';
  api.loadSpineMeta(sampleAlbums[0],cachedSpine);
  assert(cachedSpine.style['--spine-color']==='#123456',
    'cached spine colour is applied synchronously before the next paint');
  const uncachedAlbum=[];
  cachedSpine._boundAlbum=uncachedAlbum;
  api.loadSpineMeta(uncachedAlbum,cachedSpine);
  assert(cachedSpine.style['--spine-color']==='#202628'&&
    cachedSpine.style['--spine-text']==='#f5f2ea'&&
    cachedSpine.style['--spine-font-family']==='Arial,Helvetica,sans-serif',
    'reusing a node without metadata clears the previous album styling');

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
  // Another browser can reconcile the shared server before this browser
  // receives a scan notification. Server then says changed:false, despite
  // our still-visible shelf having an older content revision.
  catalogueReconcileChanged=false;
  library.push({id:97,album:'Another browser added this',artist:'Artist'});
  const beforeAlreadyReconciled=catalogueEvents.length;
  await api.handleLibraryEvent();
  const otherBrowserEvents=catalogueEvents.slice(beforeAlreadyReconciled);
  assert(otherBrowserEvents[0]?.action==='reconcile'&&
    otherBrowserEvents.some(e=>e.action==='read')&&
    api.state().albums.some(a=>a?.[0]==='Another browser added this'),
    'already-reconciled server revision still refreshes stale browser shelf');
  // Same count, changed album row: the content revision, not count, must win.
  library[0]={...library[0],album:'Replaced without changing total'};
  const beforeSameCount=catalogueEvents.length;
  await api.handleLibraryEvent();
  assert(catalogueEvents.slice(beforeSameCount).some(e=>e.action==='read')&&
    api.state().albums.some(a=>a?.[0]==='Replaced without changing total'),
    'same-count edits refresh when server revision differs from browser');
  const afterSync=catalogueEvents.length;
  await api.handleLibraryEvent();
  assert(catalogueEvents.length===afterSync+1 &&
    catalogueEvents[afterSync]?.action==='reconcile',
    'matching server and browser revisions avoid unnecessary reloads');
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


  // Short clicks close; dragging the enlarged cover scrolls the same
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
  assert(!preview.hidden&&preview.dataset.opening!=='true',
    'short cover tap leaves the pinned playing cover open');
  await api.ensurePlayingCover();
  assert(!preview.hidden,'playback status keeps the playing cover open');
  api.set({playing:false});
  preview.dispatchEvent({type:'pointerdown',button:0,target:coverTarget,pointerId:31,clientX:300,clientY:90});
  preview.dispatchEvent({type:'pointerup',pointerId:31});
  assert(preview.dataset.opening==='true','short tap still closes a non-playing preview');
  await settle(api.closeFrontPreview(true,true));
  assert(preview.hidden,'non-playing preview finishes closing');
  api.set({playing:true});
  api.openFrontPreview(originalCover,originalCoverIndex);
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
  assert(element('.bf-track-spotify-link').hidden,
    'local LMS album information never shows Spotify links');
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
    api.invalidateFrontCaseWidth();
    for(const offset of [-70,-20,-2,.49,2,20,70]){
      api.set({position:oldPosition+offset});api.draw();
      const x=style=>Number(/translate3d\(([-\d.]+)px/.exec(style.transform)[1]);
      const bounds=api.geometry().nodes.filter(n=>!('data-front-preview' in n.el.attributes)).map(n=>[x(n.el.style),x(n.el.style)+parseFloat(n.el.style.width)]);
      bounds.push([x(frontCase.style)-coverWidth/2,x(frontCase.style)+coverWidth/2]);
      assert(Array.from({length:41},(_,i)=>-500+i*25).every(point=>bounds.some(([left,right])=>point>=left-.01&&point<=right+.01)),'shelf coverage with '+coverWidth+'px cover at offset '+offset);
    }
  }
  frontCase.coverWidth=300;
  api.invalidateFrontCaseWidth();
  api.set({hover:api.state().albums.findIndex(a=>a[6]!==20)});api.updateMeta(true);
  assert(element('.bf-meta').children.length===1,'hover omits unrelated track');
  api.set({hover:-1});api.updateMeta(true);assert(element('.bf-meta').children.length===3,'outside hover shows playing track');
  api.applySetting('keepPlayingOpen',false);
  api.stopFollowing();
  assert(!preview.hidden&&api.state().KEEP_PLAYING_OPEN===true,
    'playing cover cannot be dismissed or disabled while playback is active');
  // Pausing is not a stop: the current playing cover must stay enlarged,
  // pinned and timeout-free, including after repeated status notifications.
  api.set({playing:true,playingAlbumId:20});
  const pausedIndex=api.state().albums.findIndex(a=>a[6]===20);
  api.openFrontPreview(api.state().albums[pausedIndex],pausedIndex);
  for(const mode of ['pause','pause','play','pause']){
    api.applyStatus({mode,playlist_loop:[{album_id:20,album:'Album 020',title:'Track',duration:60}],time:20});
    assert(!preview.hidden&&api.state().frontPreviewAlbum?.[6]===20,
      'current album cover stays open across '+mode+' status');
    assert(preview.dataset.pinned==='true'&&api.state().frontTimer===0,
      'current album cover remains pinned without a timeout across '+mode);
    assert(api.state().paused===(mode==='pause')&&api.state().playing===(mode==='play'),
      'paused and playing modes remain independently tracked');
  }
  // LMS live updates can omit the playlist and even omit mode. Neither
  // should unpin a paused album or discard its now-playing metadata.
  api.applyStatus({mode:'pause',time:20});
  assert(!preview.hidden&&preview.dataset.pinned==='true'&&api.state().frontPreviewAlbum?.[6]===20,
    'paused status without playlist metadata retains the pinned album');
  assert(element('.bf-meta').children[1]?.dataset.prefix==='Track',
    'paused status without playlist metadata retains the track');
  api.applyStatus({time:20});
  assert(api.state().paused&&!api.state().playing&&!preview.hidden,
    'live status missing mode cannot turn pause into stop');
  api.applyStatus({mode:'pause',playlist_loop:[{album:'Album 020',title:'Track'}]});
  assert(api.state().frontPreviewAlbum?.[6]===20&&preview.dataset.pinned==='true',
    'partial playlist metadata without album ID preserves the current album');
  api.applyStatus({mode:'stop',playlist_loop:[{album_id:20,album:'Album 020'}]});
  assert(preview.hidden&&api.state().frontPreviewAlbum===null,
    'stopping playback closes the previously pinned cover');
  // A manual preview of another album should not be forcibly replaced by pause.
  api.set({playing:true,playingAlbumId:20});
  const browsingIndex=api.state().albums.findIndex(a=>a[6]!==20);
  api.openFrontPreview(api.state().albums[browsingIndex],browsingIndex);
  api.applyStatus({mode:'pause',playlist_loop:[{album_id:20}]});
  assert(!preview.hidden&&api.state().frontPreviewAlbum?.[6]!==20,
    'pausing preserves a different album preview');
  api.set({playing:false});api.updateMeta(true);assert(element('.bf-meta').children.length===1,'stopped playback retains the open album heading without track details');
  await settle(api.selectStartupAlbum({mode:'pause',playlist_loop:[{album_id:20,album:'Album 020'}]}));
  assert(!preview.hidden&&preview.dataset.pinned==='true'&&!api.state().playing,'paused startup opens the current album without starting playback');
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

  // Cloverleaf long-press opens album discovery without invoking playback.
  api.set({playing:false,playingAlbumId:null});
  const shamrock=element('.bf-random'),discovery=element('.bf-discovery-menu');
  const controlsBeforeDiscovery=rpcCalls.filter(c=>c[0]==='playlistcontrol').length;
  shamrock.dispatchEvent({type:'pointerdown',button:0,pointerId:12,clientX:100,clientY:100});
  const hold=api.state().discoveryHoldTimer;
  assert(hold>0&&timers.has(hold),'cloverleaf press arms a hold timer');
  timers.get(hold)();
  assert(!discovery.hidden,'cloverleaf long press opens discovery menu');
  shamrock.dispatchEvent({type:'pointerup',pointerId:12});
  shamrock.onclick();
  assert(rpcCalls.filter(c=>c[0]==='playlistcontrol').length===controlsBeforeDiscovery,
    'long press suppresses synthetic short-press playback');
  // The mouse may still be positioned over a different spine when the
  // user finishes clicking a discovery menu item.
  api.set({hover:4,position:0});api.updateMeta(true);
  const firstDiscovery=api.discoverAlbum('forgotten');
  await Promise.resolve();await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert(api.state().discoveryBusy&&api.state().followAnimation,
    'first discovery starts a shelf animation before opening its cover');
  // Moving the mouse onto the shelf after clicking the menu must not cancel
  // the first discovery animation before its selected jewel case opens.
  document.dispatchEvent({type:'pointermove',target:stage,clientX:45,clientY:50});
  assert(api.state().followAnimation,
    'mouse movement during discovery does not cancel its animation');
  await settle(firstDiscovery);
  assert(api.state().hoveredAlbumIndex===-1&&api.state().discoveryHoverSuspended,
    'rediscovery discards stale mouse hover and suspends passive hit testing');
  const hoverSpine=stage.children.find(node=>node.dataset?.index!==undefined);
  document.elementFromPoint=()=>({closest:selector=>selector==='.bf-album'?hoverSpine:null});
  api.updateHoveredAlbumFromPoint(true);
  assert(api.state().hoveredAlbumIndex===-1,
    'stationary mouse does not reselect a different album after discovery');
  document.dispatchEvent({type:'pointermove',target:stage,clientX:33,clientY:44});
  assert(!api.state().discoveryHoverSuspended,
    'a real shelf pointer movement restores normal hover behaviour');
  document.elementFromPoint=()=>null;
  assert(api.state().frontPreviewAlbum!==null&&!api.state().discoveryBusy,
    'long forgotten opens an album cover and unlocks discovery');
  assert(rpcCalls.some(c=>c.includes('sort:recentlyplayed')),
    'long forgotten queries LMS album playback ranking');
  await settle(api.discoverAlbum('rarely'));
  assert(rpcCalls.some(c=>c.includes('sort:playcount')),
    'rarely played queries LMS album playcount ranking');
  await settle(api.discoverAlbum('surprise'));
  assert(rpcCalls.filter(c=>c[0]==='playlistcontrol').length===controlsBeforeDiscovery,
    'all rediscovery modes select an album without starting playback');
  const idleCover=api.state().frontPreviewAlbum;
  assert(element('.bf-meta').children.length===1,
    'idle rediscovery displays album and artist details without a playing track');
  assert(element('.bf-meta').children[0].children[0].textContent===idleCover[0]&&
    element('.bf-meta').children[0].children[1].textContent.includes(idleCover[1]),
    'idle rediscovery detail heading identifies the opened album');
  api.closeFrontPreview();
  assert(element('.bf-meta').children.length===0,
    'closing an idle album preview clears its detail heading');


  const tabs=['display','browsing','connection','genres','cache','about'].map(name=>{
    const tab=new Element(name);tab.className='bf-settings-tab';tab.setAttribute('aria-controls','settings-panel-'+name);root.append(tab);return tab;
  });
  window.fetch=async()=>{};
  const releaseCalls=[],releaseDelays=new Map();let releaseTime=1800000000000;
  let releaseInstalled='0.10.0';
  let releaseReply=async()=>({ok:true,json:async()=>({tag_name:'v0.11.0',draft:false,prerelease:false})});
  const settingsFetch=async(url,options)=>{
    if(url.startsWith('https://api.github.com/')){releaseCalls.push({url,options});return releaseReply(options);}
    return url==='/api/config'?{ok:true,json:async()=>({lms_url:'http://test:9000',idle_return_ms:45000,random_scroll_max_ms:2000})}:{ok:true,text:async()=>releaseInstalled};
  };
  const settingsTimeout=(callback,delay)=>{const id=setTimeout(callback);releaseDelays.set(id,delay);return id;};
  const settingsClear=id=>{clearTimeout(id);releaseDelays.delete(id);};
  const settingsApi=new Function('document','window','localStorage','fetch','setTimeout','clearTimeout','Date','Event','CustomEvent','rpc',plain(sources.settings)+`;return {
    releaseVersion,releaseIsNewer,checkForReleases,configureReleaseChecks,loadVersion,
    state:()=>({timer:releaseTimer,pending:!!releaseController,installed:installedReleaseVersion})
  };`)(document,window,localStorage,settingsFetch,settingsTimeout,settingsClear,class extends Date{static now(){return releaseTime}},class{},class{constructor(type,options){this.type=type;this.detail=options.detail;}},async()=>({genres_loop:[]}));
  await window.__lyrionLmsConfigReady;
  for(let turn=0;turn<5;turn++)await Promise.resolve();
  const autoRelease=element('.bf-release-auto'),checkRelease=element('.bf-release-check'),releaseLabel=element('.bf-release-status'),releaseLink=element('.bf-release-link');
  const releaseNotice=element('.bf-update-notice');
  assert(releaseNotice.hidden,'main carousel stays quiet before a newer release is confirmed');
  assert(settingsApi.state().installed==='0.10.0','release checks compare against the installed VERSION file');
  const toastCss=sources.settingsCss.match(/\.bf-new-album-toast:not\(\[hidden\]\)\s*\{([^}]+)\}/)?.[1]||'';
  assert(/z-index:\s*900\s*;/.test(toastCss)&&/top:\s*8px\s*;/.test(toastCss),
    'new album notice appears above open cases and menus at the top of the viewer');
  const newAlbumActionControl=element('.bf-new-album-action');
  assert(newAlbumActionControl.value==='none','new album preview is opt-in');
  newAlbumActionControl.value='preview';
  newAlbumActionControl.listeners.change[0]();
  assert(storage.get('albumBrowserNewAlbumAction')==='preview',
    'new album action is saved for this browser');
  newAlbumActionControl.value='none';
  newAlbumActionControl.listeners.change[0]();
  const manualTimeoutControl=element('.bf-source-browse-timeout');
  assert(manualTimeoutControl.value==='300000','manual source browse timeout defaults to five minutes');
  manualTimeoutControl.value='600000';
  manualTimeoutControl.listeners.change[0]();
  assert(storage.get('albumBrowserSourceBrowseTimeoutMs')==='600000',
    'source browsing timeout choice is persisted per browser');
  manualTimeoutControl.value='300000';
  manualTimeoutControl.listeners.change[0]();
  assert(autoRelease.checked&&releaseDelays.get(settingsApi.state().timer)===0,'automatic release checks default on and schedule the first check');
  assert(settingsApi.releaseIsNewer('v0.11.0','0.10.0'),'new minor release is detected');
  assert(settingsApi.releaseIsNewer('v0.11.10','0.11.9'),'release versions are compared numerically, not lexically');
  assert(settingsApi.releaseIsNewer('v1.0.0','0.99.99'),'new major release is detected');
  assert(!settingsApi.releaseIsNewer('v0.11.3','0.11.3')&&!settingsApi.releaseIsNewer('v0.11.2','0.11.3'),'equal or older releases are not updates');
  assert(!settingsApi.releaseVersion('v0.12.0-beta.1')&&!settingsApi.releaseVersion('javascript:alert(1)'),'prerelease and invalid version tags are rejected');
  const automaticCallback=timers.get(settingsApi.state().timer);
  await automaticCallback();
  assert(releaseCalls.length===1&&releaseCalls[0].url.endsWith('/accidentalskeleton/lyrion-carousel/releases/latest'),'automatic check uses only this project stable-release endpoint');
  assert(releaseCalls[0].options.credentials==='omit'&&releaseCalls[0].options.referrerPolicy==='no-referrer','release requests omit credentials and referrer data');
  assert(releaseLabel.textContent.includes('v0.11.0')&&!releaseLink.hidden,'new stable release is shown without installing it');
  assert(releaseLink.href==='https://github.com/accidentalskeleton/lyrion-carousel/releases/tag/v0.11.0','release link is constructed from a validated tag, not upstream HTML');
  assert(!releaseNotice.hidden&&releaseNotice.textContent==='v0.11.0 available'&&releaseNotice.href===releaseLink.href,
    'automatic checks show a discreet main-screen notice linking to the same validated release');
  const day=86400000;
  assert(releaseDelays.get(settingsApi.state().timer)===day,'successful automatic checks schedule the next daily check');
  settingsApi.configureReleaseChecks();
  assert(releaseCalls.length===1&&releaseDelays.get(settingsApi.state().timer)===day,'reloading settings reuses the saved check time instead of checking again');
  assert(!releaseNotice.hidden,'cached release results restore the main-screen notice without another request');
  releaseInstalled='0.11.0';await settingsApi.loadVersion();settingsApi.configureReleaseChecks();
  assert(releaseNotice.hidden,'installing the announced version removes the cached update notice');
  releaseInstalled='0.10.0';await settingsApi.loadVersion();settingsApi.configureReleaseChecks();
  releaseTime+=day;
  await timers.get(settingsApi.state().timer)();
  assert(releaseCalls.length===2,'periodic timer checks again after 24 hours');
  localStorage.setItem('albumBrowserReleaseAttempt',String(releaseTime));
  await settingsApi.checkForReleases();
  assert(releaseCalls.length===2,'another tab check within the daily interval is not duplicated');
  autoRelease.checked=false;autoRelease.listeners.change[0]();
  assert(storage.get('albumBrowserReleaseChecks')==='false'&&!settingsApi.state().timer,'automatic checking can be disabled persistently');
  assert(!releaseNotice.hidden,'disabling background checking preserves an already confirmed update notice');
  await settingsApi.checkForReleases();
  assert(releaseCalls.length===2,'disabled automatic checking never requests GitHub');
  releaseReply=async()=>({ok:true,json:async()=>({tag_name:'v0.10.0'})});
  await checkRelease.listeners.click[0]();
  assert(releaseCalls.length===3&&releaseLabel.textContent.includes('up to date')&&releaseLink.hidden&&!settingsApi.state().timer,'manual checks still work when automatic checking is off');
  assert(releaseNotice.hidden,'an up-to-date manual result clears the main-screen notice');
  settingsApi.configureReleaseChecks();
  assert(!autoRelease.checked&&!settingsApi.state().timer,'off preference survives Settings reinitialisation');
  const beforeNoticeSync=releaseCalls.length;
  localStorage.setItem('albumBrowserReleaseResult',JSON.stringify({tag:'v0.12.0',checkedAt:releaseTime}));
  Element.prototype.dispatchEvent.call(window,{type:'storage',key:'albumBrowserReleaseResult'});
  assert(!releaseNotice.hidden&&releaseNotice.textContent==='v0.12.0 available'&&releaseCalls.length===beforeNoticeSync,
    'another tab can update the main-screen notice without triggering an additional check');
  for(const payload of [{tag_name:'v0.12.0',prerelease:true},{tag_name:'v0.12.0',draft:true},{tag_name:'javascript:alert(1)'}]){
    releaseReply=async()=>({ok:true,json:async()=>payload});
    await settingsApi.checkForReleases(true);
    assert(releaseLabel.textContent.includes('Could not check')&&releaseLink.hidden,'invalid or non-stable release never becomes an update link');
  }
  releaseReply=async()=>({ok:false,status:403});
  await settingsApi.checkForReleases(true);
  assert(releaseLabel.textContent.includes('Could not check')&&!checkRelease.disabled,'rate limits fail quietly and leave manual checking usable');
  assert(!releaseNotice.hidden&&releaseNotice.textContent==='v0.12.0 available','a failed check preserves the last confirmed update notice');
  autoRelease.checked=true;autoRelease.listeners.change[0]();
  releaseReply=async()=>{throw Error('offline')};
  await settingsApi.checkForReleases(true);
  assert(releaseDelays.get(settingsApi.state().timer)===day,'network failures back off for a day instead of hammering GitHub');
  let abortSignal,finishReply;
  releaseReply=options=>{abortSignal=options.signal;return new Promise(resolve=>{finishReply=resolve});};
  const pendingRelease=settingsApi.checkForReleases(true),beforeDuplicate=releaseCalls.length;
  await settingsApi.checkForReleases(true);
  assert(releaseCalls.length===beforeDuplicate&&checkRelease.disabled,'concurrent release checks share one in-flight request');
  Element.prototype.dispatchEvent.call(window,{type:'pageshow'});
  assert(settingsApi.state().pending&&!abortSignal.aborted,'initial pageshow never aborts a pending release check');
  autoRelease.checked=false;autoRelease.listeners.change[0]();
  assert(abortSignal.aborted&&!settingsApi.state().timer&&!checkRelease.disabled,'turning off checks aborts the pending request and clears its timer');
  const disabledReleaseLabel=releaseLabel.textContent;
  finishReply({ok:true,json:async()=>({tag_name:'v9.0.0'})});await pendingRelease;
  assert(releaseLabel.textContent===disabledReleaseLabel&&releaseNotice.textContent==='v0.12.0 available',
    'a late cancelled release response never overwrites the last confirmed update');
  releaseReply=options=>new Promise((_,reject)=>{options.signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true});});
  const timedRelease=settingsApi.checkForReleases(true);
  const timeoutEntry=[...releaseDelays].find(([id,delay])=>delay===10000&&timers.has(id));
  timers.get(timeoutEntry[0])();await timedRelease;
  assert(releaseLabel.textContent.includes('Could not check')&&!settingsApi.state().pending&&!checkRelease.disabled,'stalled release requests time out and unlock the button');
  autoRelease.checked=true;autoRelease.listeners.change[0]();
  Element.prototype.dispatchEvent.call(window,{type:'pagehide'});
  assert(!settingsApi.state().timer,'leaving the page removes the release scheduler');
  Element.prototype.dispatchEvent.call(window,{type:'pageshow'});
  assert(!!settingsApi.state().timer,'restoring a suspended page resumes daily checks');
  autoRelease.checked=false;autoRelease.listeners.change[0]();
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
  assert(sources.index.includes('class="bf-project-link" href="https://github.com/accidentalskeleton/lyrion-carousel" target="_blank" rel="noopener noreferrer"'),
    'About links to the GitHub project in a protected new tab');
  assert(sources.index.includes('aria-label="GitHub project (opens in a new tab)"'),
    'the project link announces its new-tab behavior');
  assert(sources.index.includes('css/settings.css?v=new-album-toast-top-1'),
    'project-link styles invalidate the settings stylesheet cache');
  tabs[5].listeners.keydown[0](key('Home'));
  assert(!element('#settings-panel-display').hidden,'Home selects first settings tab');
  assert(api.state().KEEP_PLAYING_OPEN===true,
    'the playing cover is permanently pinned regardless of old preferences');
  assert(window.__lyrionCarouselSettings.idle===45000&&window.__lyrionCarouselSettings.random===2000,'unsaved settings respect runtime defaults');
  assert(!sources.index.includes('bf-keep-playing-open')&&
    !sources.settings.includes('keepPlayingOpen:'),
    'obsolete setting to close playing cover has been removed');
  await settle(api.connectLyrion());
  // Touch gestures on spines and open cases should not select browser text.
  // Search fields and other panels must retain their native behaviour.
  const selectEvent=()=>({type:'selectstart',prevented:false,preventDefault(){this.prevented=true;}});
  const spineSelect=selectEvent(),openCaseSelect=selectEvent(),searchSelect=selectEvent();
  stage.dispatchEvent(spineSelect);
  frontCase.dispatchEvent(openCaseSelect);
  assert(spineSelect.prevented&&openCaseSelect.prevented,
    'spines and open jewel cases prevent native browser text selection');
  element('.bf-search-input').dispatchEvent(searchSelect);
  assert(!searchSelect.prevented&&!document.listeners.selectstart,
    'touch selection protection remains scoped to CD surfaces');


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
  // Both chronological shelves are finite: no wrapping by arrows, wheel,
  // drag or geometry; other modes remain circular.
  await api.setDisplayOrder('indexed');
  assert(api.state().orderMode==='indexed'&&storage.get('albumBrowserOrderMode')==='indexed',
    'Recently Indexed order is selectable and persisted independently');
  api.closeFrontPreview();
  const [indexedFirst]=api.finiteShelfBounds();
  api.set({playing:false,position:0});api.draw();api.browseWithArrow(-1);
  assert(api.state().target===indexedFirst,
    'Recently Indexed uses the same bounded shelf as Recently Added');
  api.set({playing:false,position:0});
  await api.setDisplayOrder('recent');
  assert(api.state().orderMode==='recent'&&storage.get('albumBrowserOrderMode')==='recent',
    'Recently Added order is active and persisted');
  api.closeFrontPreview();
  const recentLast=api.state().albums.length-1;
  const [firstStop,lastStop]=api.finiteShelfBounds();
  const visible=Math.min(api.state().DISPLAY_ALBUM_COUNT||30,api.state().albums.length);
  assert(firstStop===(visible-1)/2&&lastStop===recentLast-firstStop,
    'finite shelf stops at viewport edges, not at centred first/last albums');
  api.set({position:0});api.draw();api.browseWithArrow(-1);
  assert(api.state().target===firstStop,'Recently Added cannot arrow past newest shelf edge');
  api.set({position:recentLast});api.draw();api.browseWithArrow(1);
  assert(api.state().target===lastStop,'Recently Added cannot arrow past oldest shelf edge');
  api.set({position:firstStop});api.browseWithArrow(1);
  assert(api.state().target>firstStop,'Recently Added can browse forward inside the range');
  api.set({position:firstStop});
  stage.dispatchEvent({type:'wheel',deltaX:0,deltaY:-900000,preventDefault(){}});
  assert(api.state().position===firstStop&&api.state().target===firstStop,'wheel stops at beginning');
  api.set({position:lastStop});
  stage.dispatchEvent({type:'wheel',deltaX:0,deltaY:900000,preventDefault(){}});
  assert(api.state().position===lastStop&&api.state().target===lastStop,'wheel stops at end');
  api.set({position:firstStop});
  stage.dispatchEvent({type:'pointerdown',button:0,pointerId:122,clientX:100,clientY:30,target:{closest:()=>null}});
  stage.dispatchEvent({type:'pointermove',pointerId:122,clientX:6000,clientY:30});
  stage.dispatchEvent({type:'pointerup',pointerId:122});
  assert(api.state().position===firstStop&&api.state().target===firstStop,'drag clamps at beginning');
  api.set({position:firstStop});api.draw();
  assert(api.geometry().nodes.some(node=>node.index===0),
    'first CD remains rendered at the left shelf edge');
  assert(api.geometry().nodes.every(node=>node.index>=0&&node.index<=recentLast),
    'bounded mode renders no spines from the opposite end');
  api.set({position:lastStop});api.draw();
  assert(api.geometry().nodes.some(node=>node.index===recentLast),
    'last CD remains rendered at the right shelf edge');
  assert(api.geometry().nodes.every(node=>node.index>=0&&node.index<=recentLast),
    'bounded mode does not wrap spines at last album');
  // A bounded shelf never extends its scroll range for an open case.
  // The case is left off-centre, but fully visible inside the viewport.
  const coverX=()=>Number(frontCase.style.transform.split('translate3d(')[1]?.split('px')[0]);
  const caseWidth=api.frontCaseWidth();
  const shelfWidth=stage.clientWidth;
  api.set({playing:false,position:firstStop});
  api.closeFrontPreview();api.draw();
  api.openFrontPreview(api.state().albums[0],0);
  api.draw();
  const spineX=node=>Number(node.el.style.transform.split('translate3d(')[1]?.split('px')[0]);
  const nextSpine=api.geometry().nodes.find(node=>node.index===1);
  assert(Math.abs(spineX(nextSpine)-(coverX()+caseWidth/2))<.01,
    'the next spine touches the open case without being covered');

  assert(api.state().target===firstStop&&!preview.hidden,
    'opening the newest album does not extend the finite scroll limit');
  api.draw();
  assert(coverX()<0&&coverX()>=-(shelfWidth-caseWidth)/2-.01,
    'newest jewel case remains off-centre but fully visible');
  api.browseWithArrow(-1);
  assert(api.state().target===firstStop,
    'open case cannot scroll past the first finite endpoint');
  const beforeWheel=api.state().position;
  stage.dispatchEvent({type:'wheel',deltaX:0,deltaY:1200,preventDefault(){}});
  assert(api.state().position>beforeWheel&&api.state().target===api.state().position,
    'wheel genuinely scrolls a bounded shelf while a cover is open');
  const afterWheel=api.state().position;
  preview.dispatchEvent({type:'wheel',deltaX:0,deltaY:700,preventDefault(){}});
  assert(api.state().position>afterWheel&&!preview.hidden,
    'wheel events on an open jewel case also scroll the bounded shelf');
  stage.dispatchEvent({type:'wheel',deltaX:0,deltaY:-2000,preventDefault(){}});
  assert(api.state().position===firstStop,
    'wheel can reverse back to the left bounded endpoint');
  assert(api.state().wheelTimer===0,'finite wheel release never snaps small input back');
  api.draw();
  assert(api.state().target===firstStop&&api.state().position===firstStop,
    'wheel snap does not shift a half-album endpoint inward');
  api.browseWithArrow(1);
  assert(api.state().target===firstStop+1,
    'arrow from half-album endpoint advances exactly one album');
  api.set({position:firstStop});
  preview.dispatchEvent({type:'pointerdown',button:0,target:coverTarget,pointerId:231,clientX:400,clientY:90});
  preview.dispatchEvent({type:'pointermove',target:coverTarget,pointerId:231,clientX:180,clientY:90});
  preview.dispatchEvent({type:'pointerup',target:coverTarget,pointerId:231});
  assert(api.state().target>firstStop,
    'dragging an open edge case scrolls within the finite shelf');
  api.set({position:firstStop});

  // A playing cover is pinned to its album, not to the viewport or a
  // perpetual recentering request. Browser navigation must remain usable.
  api.set({playing:true,playingAlbumId:api.state().albums[0][6]});
  api.browseWithArrow(1);
  const browsingTarget=api.state().target;
  assert(browsingTarget>firstStop,'arrow can browse away from an open edge cover');
  await api.ensurePlayingCover();
  assert(api.state().target===browsingTarget,
    'reopening an already playing case never resets active shelf scrolling');
  api.set({position:firstStop+4});api.draw();
  const leftmostSpine=api.geometry().nodes.filter(n=>n.index>0)
    .map(n=>Number(n.el.style.transform.split('translate3d(')[1]?.split('px')[0]))
    .filter(Number.isFinite);
  assert(leftmostSpine.length>0&&Math.min(...leftmostSpine)<stage.clientWidth/2,
    'scrolling away from an edge does not leave all neighbouring spines offscreen');
  api.set({playing:false,playingAlbumId:null,position:firstStop});
  api.closeFrontPreview();
  assert(api.state().target===firstStop,
    'closing newest cover preserves the same finite endpoint');
  api.set({position:lastStop});
  api.openFrontPreview(api.state().albums[recentLast],recentLast);
  assert(api.state().target===lastStop&&!preview.hidden,
    'opening the oldest album does not extend the finite scroll limit');
  api.draw();
  assert(coverX()>0&&coverX()<=(shelfWidth-caseWidth)/2+.01,
    'oldest jewel case remains off-centre but fully visible');
  api.browseWithArrow(1);
  assert(api.state().target===lastStop,
    'open case cannot scroll past the last finite endpoint');
  stage.dispatchEvent({type:'wheel',deltaX:0,deltaY:-1200,preventDefault(){}});
  assert(api.state().position<lastStop,
    'mouse wheel scrolls inward from the right endpoint with cover open');
  api.set({position:lastStop});
  stage.dispatchEvent({type:'wheel',deltaX:0,deltaY:1200,preventDefault(){}});
  api.draw();
  assert(api.state().target===lastStop,
    'wheel snapping preserves the exact right endpoint');
  api.closeFrontPreview();
  assert(api.state().target===lastStop,
    'closing oldest cover preserves the finite endpoint');
  const seenPositions=[firstStop,firstStop+4,(firstStop+lastStop)/2,lastStop-4,lastStop];
  for(const place of seenPositions){
    api.set({playing:false,playingAlbumId:null,position:place});
    api.closeFrontPreview();api.draw();
    for(const coverIndex of [0,1,Math.floor(recentLast/2),recentLast-1,recentLast]){
      api.openFrontPreview(api.state().albums[coverIndex],coverIndex);api.draw();
      const openNodes=api.geometry().nodes;
      const intervals=[[coverX()-caseWidth/2,coverX()+caseWidth/2]];
      for(const node of openNodes){
        if(node.index===coverIndex)continue;
        const left=spineX(node),right=left+parseFloat(node.el.style.width);
        assert(right<=coverX()-caseWidth/2+.01||left>=coverX()+caseWidth/2-.01,
          'open finite case never covers another spine');
        intervals.push([left,right]);
      }
      assert(Array.from({length:101},(_,index)=>-shelfWidth/2+index*shelfWidth/100)
        .every(point=>intervals.some(([left,right])=>point>=left-.01&&point<=right+.01)),
        'reserved open-case slot leaves no gaps across the finite shelf');
      api.closeFrontPreview();api.draw();
    }
  }
  for(const mode of ['recent','artistAlbum']){
    await api.setDisplayOrder(mode);
    const index=Math.floor(recentLast/2);
    api.set({playing:false,playingAlbumId:null,position:index});api.closeFrontPreview();
    api.openFrontPreview(api.state().albums[index],index,true);
    const opening=api.state().coverOpening;
    const scale=()=>{
      const angle=Number(/rotateY\(([^d]+)/.exec(frontCase.style.transform)?.[1]||0)*Math.PI/180;
      const perspective=Number(/perspective\(([^p]+)/.exec(frontCase.style.transform)?.[1]||1200);
      const depth=frontCase.offsetWidth/(2*perspective);
      return Math.cos(angle)/(1-depth*depth*Math.sin(angle)*Math.sin(angle));
    };
    const initialScale=scale(),pool=api.geometry().nodes.map(node=>node.el),widthReads=frontCase.widthReads;
    assert(!!opening&&initialScale>0&&initialScale<1,'explicit spine opening begins at spine width in '+mode);
    time+=100;api.draw();
    assert(frontCase.widthReads===widthReads,'opening frames reuse cached layout measurements');
    assert(scale()>initialScale&&scale()<1,'case grows progressively rather than appearing at full width');
    assert(api.geometry().nodes.every(node=>pool.includes(node.el)),'opening frames reuse the existing DOM pool');
    api.set({playing:true,playingAlbumId:api.state().albums[index][6]});
    await api.ensurePlayingCover();
    assert(api.state().coverOpening===opening,'passive playback pinning never restarts the opening');
    time+=400;api.draw();
    assert(!api.state().coverOpening&&!api.state().raf&&scale()===1,'opening stops scheduling frames when settled');
    await api.ensurePlayingCover();
    assert(!api.state().coverOpening&&!api.state().raf,'settled playback cover stays idle');
    api.set({playing:false});api.closeFrontPreview();
    window.matchMedia=()=>({matches:true});
    api.openFrontPreview(api.state().albums[index],index,true);
    assert(!api.state().coverOpening&&scale()===1,'reduced motion skips the expanding case');
    delete window.matchMedia;
    api.closeFrontPreview();api.openFrontPreview(api.state().albums[index],index,true);
    stage.dispatchEvent({type:'wheel',deltaX:0,deltaY:120,preventDefault(){}});
    assert(!api.state().coverOpening,'wheel input immediately interrupts the opening');
    api.closeFrontPreview();api.openFrontPreview(api.state().albums[index],index,true);
    api.browseWithArrow(1);
    assert(!api.state().coverOpening,'keyboard navigation immediately interrupts the opening');
    api.closeFrontPreview();api.openFrontPreview(api.state().albums[index],index,true);
    stage.dispatchEvent({type:'pointerdown',button:0,pointerId:321,clientX:100,clientY:30,target:{closest:()=>null}});
    assert(!api.state().coverOpening,'pointer dragging immediately interrupts the opening');
    stage.dispatchEvent({type:'pointercancel',pointerId:321});
    api.closeFrontPreview();
    api.set({playing:false,playingAlbumId:null,position:index});
    api.openFrontPreview(api.state().albums[index],index);
    const closingAlbum=api.state().frontPreviewAlbum,closingPosition=api.state().position;
    const closeReads=frontCase.widthReads,closingPool=api.geometry().nodes.map(node=>node.el);
    const closing=api.closeFrontPreview(false,true);
    assert(api.state().coverOpening?.closing&&!preview.hidden,'animated close keeps the case mounted in '+mode);
    time+=100;api.draw();
    assert(frontCase.widthReads===closeReads,'closing frames reuse cached layout measurements');
    const closingScale=scale();
    assert(closingScale>0&&closingScale<1&&api.state().frontPreviewAlbum===closingAlbum,'case turns progressively back toward spine width');
    assert(api.geometry().nodes.every(node=>closingPool.includes(node.el)),'closing reuses the same spine pool');
    time+=400;api.draw();
    assert(await closing,'closing completes successfully');
    assert(preview.hidden&&!api.state().coverOpening&&!api.state().raf,'completed close hides the case and stops rendering');
    assert(api.state().position===closingPosition&&api.state().target===closingPosition,'closing never resets shelf navigation');
    const restored=api.geometry().nodes.find(node=>node.index===index);
    assert(restored&&!('data-front-preview' in restored.el.attributes),'the original spine is restored after closing');
    api.openFrontPreview(api.state().albums[index],index,true);
    time+=80;api.draw();
    const partialScale=scale(),reversing=api.closeFrontPreview(false,true);
    assert(Math.abs(scale()-partialScale)<.0001,'closing during opening reverses from the current pose');
    time+=400;api.draw();await reversing;
    api.openFrontPreview(api.state().albums[index],index);
    const cancelledClose=api.closeFrontPreview(false,true);
    time+=100;api.draw();
    api.openFrontPreview(api.state().albums[index+1],index+1,true);
    assert(!await cancelledClose,'selecting another album cancels the stale close completion');
    time+=400;api.draw();
    assert(!preview.hidden&&api.state().frontPreviewAlbum===api.state().albums[index+1],'a stale close never hides the replacement cover');
    api.closeFrontPreview();api.openFrontPreview(api.state().albums[index],index);
    const interruptedClose=api.closeFrontPreview(false,true);
    stage.dispatchEvent({type:'wheel',deltaX:0,deltaY:120,preventDefault(){}});
    assert(!await interruptedClose&&!preview.hidden&&!api.state().coverOpening,'wheel browsing cancels closing and keeps the case usable');
    window.matchMedia=()=>({matches:true});
    await api.closeFrontPreview(false,true);
    assert(preview.hidden&&!api.state().coverOpening,'reduced motion closes without an expanding or turning animation');
    delete window.matchMedia;
    api.set({playing:false,playingAlbumId:null});
    api.openFrontPreview(api.state().albums[index],index);
    const lateTimeout=timers.get(api.state().frontTimer);
    api.set({playing:true,playingAlbumId:api.state().albums[index][6]});
    await lateTimeout();
    assert(!preview.hidden&&!api.state().coverOpening,'a late timeout never closes a newly pinned playing cover');
    api.set({playing:false});api.closeFrontPreview();
  }
  api.set({position:recentLast});api.browseWithArrow(1);
  assert(api.state().target===recentLast+1,'circular shelf still wraps in other modes');

  api.applySetting('coverSize',256);
  assert(api.state().albums.every(a=>a[8].includes('size=256')),'cover size updates artwork URLs');
  assert(stage.classList.contains('bf-shelf-active'),
    'the shelf remains the only available display style');
  assert(!stage.children.some(el=>el.querySelector('.bf-jewel-front')),
    'shelf-only mode creates no fan cover nodes');
  assert(!sources.index.includes('bf-display-style'),
    'Settings no longer offers the experimental fan view');
  assert(!sources.app.includes('syncFanDom')&&!sources.app.includes('fanLayout'),
    'obsolete fan renderer is removed');
  assert(window.__lyrionCarouselSettings.displayStyle===undefined,
    'legacy fan preference is ignored on startup');
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
  const expirePreview=timers.get(timeoutId);timers.delete(timeoutId);
  const expired=expirePreview();
  assert(api.state().coverOpening?.closing&&!preview.hidden&&api.state().frontPreviewAlbum===previewBeforeIdle,
    'manual preview timeout turns the existing case closed before replacing it');
  await settle(expired);
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
    const spotty=new Function('rpc',plain(sources.spotify)+';return {normalizeSpottyAlbum,spotifyAlbumUrl,spotifyAlbumSearchUrl,savedSpotifyAlbums,searchSpotifyAlbums,playSpotifyAlbum,saveSpotifyAlbum,spotifyAlbumInformation};')(spottyRpc);
    const normalized=spotty.normalizeSpottyAlbum({id:'x',name:'Title by Artist',image:'/imageproxy/x'});
    assert(normalized.source==='spotify'&&normalized.title==='Title'&&normalized.artist==='Artist'&&normalized.spottyItemId==='x','Spotty album normalization');
    const spotifyId='4aawyAB9vmqN3uQ7FjRGTy';
    const spotifyUrl='https://open.spotify.com/album/'+spotifyId;
    assert(spotty.spotifyAlbumUrl('spotify:album:'+spotifyId)===spotifyUrl,
      'real Spotify album URIs produce a canonical Spotify album link');
    assert(spotty.spotifyAlbumUrl(spotifyUrl+'?si=test')===spotifyUrl,
      'Spotty album URLs are stripped of tracking parameters');
    assert(!spotty.spotifyAlbumUrl('item_id:album-1')&&!spotty.spotifyAlbumUrl('https://open.spotify.com.evil.example/album/'+spotifyId)&&!spotty.spotifyAlbumUrl('spotify:track:'+spotifyId),
      'navigation tokens, lookalike hosts and track links are never promoted to album links');
    assert(spotty.normalizeSpottyAlbum({id:'album-1',favorites_url:'spotify:album:'+spotifyId}).spotifyUrl===spotifyUrl,
      'saved Spotify entries retain a verified album link');
    assert(spotty.spotifyAlbumSearchUrl('The 2nd Law','Muse')==='https://open.spotify.com/search/The%202nd%20Law%20Muse/albums',
      'Spotify album search fallback uses album and artist instead of guessing a direct album ID');
    const saved=await spotty.savedSpotifyAlbums('player');
    assert(saved.length===1&&saved[0].title==='Saved Album'&&spottyCalls.some(c=>c.includes('item_id:7')),'saved Spotify albums use discovered Albums node');
    const searched=await spotty.searchSpotifyAlbums('player','needle');
    assert(searched.length===1&&searched[0].title==='Search Album','Spotify full-catalogue album search');
    const menuAlbum=spotty.normalizeSpottyAlbum({type:'playlist',text:'Correct Album\nCorrect Artist',params:{item_id:'temporary-position'},presetParams:{favorites_title:'Correct Album by Correct Artist',favorites_url:'spotify:album:'+spotifyId}});
    assert(menuAlbum.title==='Correct Album'&&menuAlbum.artist==='Correct Artist'&&menuAlbum.spottyItemId==='temporary-position'&&menuAlbum.id==='spotify:album:'+spotifyId,'Spotty rich menu preserves stable album identity separately from navigation position');
    assert(spottyCalls.some(cmd=>cmd.includes('type:album')&&cmd.includes('menu:1'))&&spottyCalls.some(cmd=>cmd.includes('item_id:7')&&cmd.includes('menu:1')),'search and saved albums request stable URI metadata from rich menus');
    await spotty.playSpotifyAlbum('player',{spottyItemId:'wrong-position',spotifyUrl});
    assert(spottyCalls.some(cmd=>cmd.join('|')==='playlist|play|spotify:album:'+spotifyId),'Spotify playback uses stable album URI and ignores stale navigation positions');
    await spotty.playSpotifyAlbum('player','album-1');
    assert(spottyCalls.some(c=>c[0]==='spotty'&&c[1]==='playlist'&&c.includes('item_id:album-1')),'Spotify playback stays in Spotty/LMS');
    const stableDetailCalls=[];
    const stableDetail=new Function('rpc',plain(sources.spotify)+';return {saveSpotifyAlbum,spotifyAlbumInformation};')(async(_,cmd)=>{
      stableDetailCalls.push(cmd);
      if(cmd.includes('search:spotify:album:'+spotifyId))return {items_loop:[{id:'stable-save',name:'Add Album to Library'},{type:'audio',name:'1 Exact album track'}]};
      if(cmd.includes('item_id:stable-save'))return {};
      return {items_loop:[{id:'search-root',name:'Search',type:'search'}]};
    });
    await stableDetail.saveSpotifyAlbum('player',{spottyItemId:'wrong-position',spotifyUrl});
    const stableInfo=await stableDetail.spotifyAlbumInformation('player',{spottyItemId:'wrong-position',spotifyUrl});
    assert(stableDetailCalls.some(cmd=>cmd.includes('search:spotify:album:'+spotifyId))&&!stableDetailCalls.some(cmd=>cmd.includes('item_id:wrong-position')),'album information and saving resolve the stable URI rather than a reordered menu item');
    assert(stableInfo.tracks[0]?.title==='Exact album track'&&stableDetailCalls.some(cmd=>cmd.includes('item_id:stable-save')),'stable album lookup retains track details and native library-save action');
    await spotty.saveSpotifyAlbum('player','album-1');
    assert(spottyCalls.some(c=>c.includes('item_id:9')),'Spotify searched album save follows Spotty action');
    const info=await spotty.spotifyAlbumInformation('player','album-1');
    assert(info.tracks.length===1&&info.genre==='Rock'&&info.year==='2020','Spotify Album Information parses tracks and metadata');
    assert(sources.index.includes('class="bf-track-spotify-link"')&&sources.index.includes('rel="noopener noreferrer"'),
      'Album Information contains a safe external Spotify album link');
    const candidate=['Spotify Album','Spotify Artist','', '', '0','0deg','spotify:album-1',true,'','',2020,'',undefined,'spotify','album-1',undefined,spotifyUrl];
    await api.showTrackList(candidate);
    assert(!element('.bf-track-spotify-link').hidden&&element('.bf-track-spotify-link').href===spotifyUrl&&element('.bf-track-spotify-link').textContent.startsWith('Open album'),
      'verified Spotify album link is visible in Album Information');
    api.closeTrackList();
    assert(element('.bf-track-spotify-link').hidden&&!element('.bf-track-spotify-link').getAttribute('href'),
      'closing Album Information clears the external destination');
    candidate[16]='javascript:alert(1)';
    await api.showTrackList(candidate);
    assert(!element('.bf-track-spotify-link').hidden&&element('.bf-track-spotify-link').href.startsWith('https://open.spotify.com/search/')&&element('.bf-track-spotify-link').textContent.startsWith('Find album'),
      'untrusted direct URL is rejected and replaced with explicitly labelled Spotify search');
    api.closeTrackList();
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
  if(sources.shelfCss) {
    assert(sources.shelfCss.includes('#book-fan-browser .bf-stage *')&&
      sources.shelfCss.includes('#book-fan-browser .bf-front-case *'),
      'spine descendants and open covers explicitly suppress native selection');
    assert(sources.shelfCss.includes('-webkit-user-select:none')&&
      sources.shelfCss.includes('-webkit-touch-callout:none')&&
      sources.shelfCss.includes('-webkit-tap-highlight-color:transparent'),
      'Safari and Chromium touchscreen highlight suppression is configured');
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

  assert(sources.app.includes("'tags:aluJenKNRAxE'"),'initial LMS player status requests artist roles');
  assert(!sources.app.includes('carousel:toggle-jewel-case')&&!sources.app.includes('carousel:album-preview'),
    'closed-cover interaction no longer dispatches open-case events');
  assert(!sources.app.includes("isThisPlaying?' · Playing':'"),
    'Now Playing heading never renders a redundant Playing status suffix');
  assert(sources.app.includes('beginShelfDrag(')&&sources.app.includes('moveShelfDrag(event,false)')&&
    sources.app.includes('finishShelfDrag(false)'),
    'cover reuses the existing spine drag and snap physics');
  assert(sources.app.includes('async function followPlayingSource()')&&
    sources.app.includes('armIdleReturn(0);void followPlayingSource()}')&&
    sources.app.includes('await followPlayingSource();if(connection!==connectionGeneration)return;resetReconnect();'),
    'Playback source changes follow across browser sessions and on initial connection');
  assert(sources.app.includes("await setCatalogueSource(playingSource)")&&
    sources.app.includes("if(sourceFollowAttempt===key&&now-sourceFollowAttemptAt<5000)return;"),
    'Source following reuses catalogue switching without repeatedly retrying unavailable albums');

  // All original sort IDs remain stable, keeping saved preferences intact.
  const labelStart=sources.app.indexOf('const orderLabels=');
  const orderLabels=sources.app.slice(labelStart,sources.app.indexOf(';',labelStart));
  assert(orderLabels.includes("recent:'New Music (LMS)'")&&orderLabels.includes("indexed:'Recently Added'"),
    'LMS-native and Carousel album date orders have distinct visible names');
  assert(orderLabels.includes("artistAlbum:'Artist → Album'")&&
    orderLabels.includes("album:'Album → Artist'")&&orderLabels.includes("colour:'Spine Colour'"),
    'alphabetical and spine colour labels are descriptive');
  const menuStart=sources.index.indexOf('<div class="bf-order-menu"');
  const menu=sources.index.slice(menuStart,sources.index.indexOf('<div class="bf-transport"',menuStart));
  const modeOrder=[...menu.matchAll(/data-order="([^"]+)"/g)].map(match=>match[1]);
  assert(modeOrder.join(',')==='artistAlbum,album,indexed,recent,colour,random',
    'order menu groups alphabetical, chronological and visual sorting');
  assert(menu.includes('role="separator"')&&menu.includes('Sort albums by'),
    'sort menu contains a heading and group dividers');
  const buttonContent=id=>{
    const from=menu.indexOf('data-order="'+id+'"');
    return from<0?'':menu.slice(from,menu.indexOf('</button>',from));
  };
  const clockButton=buttonContent('recent');
  const calendarButton=buttonContent('indexed');
  assert(clockButton.includes('M3.5 4.5v4.5H8')&&
    calendarButton.includes('M5 5h14v14H5z')&&
    sources.index.includes('class="bf-order-icon lms-history"')&&
    sources.albumBrowserCss.includes('[data-mode="recent"] .bf-order-icon.lms-history'),
    'LMS New Music uses a distinct history clock while Recently Added keeps the calendar');

  assert(sources.index.includes('css/album-browser.css?v=sort-labels-1'),
    'sort menu icon CSS cache version is updated');
  assert(sources.index.includes('js/app.js?v=new-album-notify-race-1')&&sources.index.includes('css/shelf.css?v=touch-selection-1'),
    'Cross-browser source following invalidates the app module cache');
  assert(sources.app.includes("trackAlbum=album;trackPlayNow.hidden=false;trackPlayNow.disabled=!playerId;"),
    'Spotify Album Information displays the same play control as local albums');
  assert(sources.app.includes("if(album[13]==='spotify')await loadAlbum(album);else await playAlbumNow(album);"),
    'Album Information plays Spotify via its provider and keeps local play-now behaviour');
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
  assert(sources.lms.includes("'tags:aluJenAxE'"),'CometD subscription requests artist roles');

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
  // Letter jumps should not fetch or scan 20,000 entries on each click.
  // The index tracks the first position in the *current* ordered catalogue.
  largeAlbums[0][9]='A';
  largeAlbums[15000][9]='M';
  largeAlbums[19999][9]='Z';
  api.replaceAlbumsForTest(largeAlbums);
  assert(api.letterIndex().get('A')===0&&api.letterIndex().get('M')===15000&&
    api.letterIndex().get('Z')===19999,'20k-album alphabet index stores first positions');
  const batchRequestsBefore=rpcCalls.filter(command=>command[0]==='albums').length;
  api.set({position:0});
  await api.jumpToLetter('Z');
  assert(api.state().target===-1,'letter navigation reaches final album by shortest circular route');
  assert(rpcCalls.filter(command=>command[0]==='albums').length===batchRequestsBefore,
    'indexed letter jump does not request LMS album pages');
  [largeAlbums[0],largeAlbums[19999]]=[largeAlbums[19999],largeAlbums[0]];
  api.replaceAlbumsForTest(largeAlbums);
  assert(api.letterIndex().get('Z')===0&&api.letterIndex().get('A')===19999,
    'alphabet index follows album reordering');
  largeAlbums[0][9]='';
  api.replaceAlbumsForTest(largeAlbums);
  assert(!api.letterIndex().has('Z'),'alphabet index drops letters removed by a filter');
  // Put the array back before the separate DOM-pool stress test.
  [largeAlbums[0],largeAlbums[19999]]=[largeAlbums[19999],largeAlbums[0]];
  api.replaceAlbumsForTest(largeAlbums);
  // The 20k-album browse simulation must keep the allocated spine set
  // bounded even after repeated long jumps across the library.
  api.set({playing:false});
  api.closeFrontPreview(true);
  api.replaceAlbumsForTest(largeAlbums);
  api.set({position:0});
  api.draw();
  const hugePool=new Set(stage.children);
  for(let i=1;i<=120;i++){
    api.set({position:(i*151)%largeAlbums.length});
    api.draw();
    assert(stage.children.length===hugePool.size,
      '20k-album browse keeps constant visible DOM size at jump '+i);
    assert(stage.children.every(el=>hugePool.has(el)),
      '20k-album browse reuses existing elements at jump '+i);
  }
  api.replaceAlbumsForTest(savedAlbums);
  api.set({position:0});api.draw();


  // Phase 4: optional browser measurements must stay completely dormant
  // until requested, then generate a portable deterministic report.
  if(sources.performance){
    let clock=0,frameId=0,frameCallback=null,scheduled=0,cancelled=0;
    const observed=[],handlers=new Map();
    const eventTarget=prefix=>({
      addEventListener(name,fn){handlers.set(prefix+':'+name,fn)},
      removeEventListener(name,fn){if(handlers.get(prefix+':'+name)===fn)handlers.delete(prefix+':'+name)}
    });
    const stageElement=Object.assign(eventTarget('stage'),{
      querySelectorAll:()=>Array.from({length:36},()=>({}))
    });
    const perfDocument=Object.assign(eventTarget('document'),{
      visibilityState:'visible',querySelector:()=>stageElement
    });
    class FakeObserver {
      constructor(callback){this.callback=callback;observed.push(this);}
      observe(){} disconnect(){} takeRecords(){return [];}
    }
    const perfWindow={};
    const perfConsole={info(){},warn(){},table(){}};
    const perfCode=sources.performance.replace('window.lyrionPerf=','window.lyrionPerf=');
    const browser=new Function('window','document','console','performance',
      'MutationObserver','PerformanceObserver','requestAnimationFrame',
      'cancelAnimationFrame','location','URL','setTimeout',
      perfCode+';return window.lyrionPerf;')(
        perfWindow,perfDocument,perfConsole,
        {now:()=>clock},
        class{observe(){} disconnect(){} takeRecords(){return []}},
        FakeObserver,callback=>{scheduled++;frameCallback=callback;return ++frameId},
        ()=>{cancelled++},{href:'http://streamer:8088'},class FakeURL {constructor(name){this.pathname=name.split('?')[0].replace(/^https?:\/\/[^/]+/,'')}},()=>0
      );
    assert(scheduled===0,'Phase 4 measurement has zero idle animation frames');
    assert(browser.active===false,'browser profiler is opt-in');
    browser.start({label:'phase4-test'});
    assert(browser.active&&scheduled===1,'profiler starts one animation chain only on request');
    for(let i=0;i<60;i++){clock+=16.667;const tick=frameCallback;tick(clock);}
    const report=browser.stop();
    assert(!browser.active&&cancelled===1,'profiler cancels its animation chain on stop');
    assert(report.sampledFrames===59&&report.dom.initialSpines===36,
      'profiler returns sampled frames and visible DOM count');
    assert(report.frameMs.p95>=16&&report.frameMs.p95<18,
      'profiler calculates frame-time percentiles in milliseconds');
    assert(report.estimatedDroppedFrames===0,'smooth frames produce no dropped-frame estimate');
    assert(report.detectedFps>=59&&report.detectedFps<=61,
      'profiler detects 60Hz from observed rAF samples');
    assert(report.activeScrolling.sampledFrames===0,
      'idle frames do not count as active scrolling frames');
    assert(report.suspensions.count===0,'normal rAF intervals are not suspensions');
    assert(handlers.size===0,'profiler cleans up every temporary input listener');

    // A 144Hz sample with a multi-second browser suspension should report
    // normal active FPS without inventing hundreds of dropped frames.
    browser.start({label:'144Hz-test'});
    for(let i=0;i<40;i++){
      clock+=1000/144;const tick=frameCallback;tick(clock);
    }
    handlers.get('stage:wheel')();
    for(let i=0;i<90;i++){
      clock+=1000/144;const tick=frameCallback;tick(clock);
    }
    clock+=4534.8;frameCallback(clock);
    for(let i=0;i<35;i++){
      clock+=1000/144;const tick=frameCallback;tick(clock);
    }
    const fastReport=browser.stop();
    assert(fastReport.detectedFps>=143&&fastReport.detectedFps<=145,
      'profiler detects a high-refresh display rather than assuming 60Hz');
    assert(fastReport.effectiveFps===fastReport.detectedFps,
      'automatic refresh detection selects the frame budget');
    assert(fastReport.suspensions.count===1&&fastReport.suspensions.longestMs>4500,
      'multi-second rAF gaps are reported separately as suspensions');
    assert(fastReport.estimatedDroppedFrames===0&&fastReport.frameMs.max<8,
      'suspensions do not inflate the missed-frame estimate or frame-time maximum');
    assert(fastReport.activeScrolling.sampledFrames>0&&
      fastReport.activeScrolling.estimatedFps>=140,
      'active browsing FPS excludes idle time and suspended intervals');
    assert(handlers.size===0,'second capture also removes its event listeners');
    assert(browser.lastReport===fastReport,'profiler exposes its most recent report');
    assert(browser.compare(report,report)['Frame p95 (ms)'].improvementPercent===0,
      'profiler comparison works for equal baseline and candidate');
    let invalidFps=false;
    try{browser.start({targetFps:0})}catch(_){invalidFps=true}
    assert(invalidFps&&!browser.active,'profiler rejects invalid refresh targets');
  }

  api.set({playerId:"test-player"});
  tracksFixture=[{id:4,disc:2,tracknum:2},{id:2,disc:1,tracknum:2},{id:3,disc:2,tracknum:1},{id:1,disc:1,tracknum:1}];
  const multiAlbum=albumForTrackList.slice();multiAlbum[17]=2;
  tracksFixture.find(track=>track.id===3).discsubtitle='Bonus tracks';
  await api.openAlbumMenu(multiAlbum,{clientX:980,clientY:590});
  const discSelect=element('.bf-album-disc');
  assert(!element('.bf-album-disc-label').hidden&&!discSelect.disabled,'multi-disc menu offers a disc selector');
  assert(discSelect.children.map(option=>option.textContent).join('|')==='Full album|Disc 1|Disc 2 — Bonus tracks','disc choices use actual LMS discs and subtitles in order');
  assert(api.selectedAlbumFilter()===null,'full album remains the default');
  discSelect.value='2';discSelect.onchange();
  const discFilter=api.selectedAlbumFilter();
  assert(discFilter==='track_id:3,4','selected disc contains only its tracks in track order');
  assert(element('.bf-play-next').textContent==='Play disc 2 after current album','action labels identify selected disc and queue position');
  statusFixture={mode:'play',playlist_cur_index:1,playlist_loop:[{album_id:20},{album_id:20},{album_id:21}]};
  let actionStart=rpcCalls.length;
  await api.queueAlbum(multiAlbum,false,discFilter);
  assert(rpcCalls.slice(actionStart).some(cmd=>cmd.join('|')==='playlistcontrol|cmd:add|track_id:3,4'),'disc append sends only selected track IDs');
  statusFixture={...statusFixture,playlist_loop:[{album_id:20},{album_id:21}]};
  actionStart=rpcCalls.length;
  await api.queueAlbum(multiAlbum,true,discFilter);
  assert(rpcCalls.slice(actionStart).some(cmd=>cmd.join('|')==='playlistcontrol|cmd:insert|index:2|track_id:3,4'),'disc play-next inserts after current album');
  statusFixture={mode:'play',playlist_cur_index:1,playlist_loop:[{album_id:20},{album_id:20},{album_id:21}]};
  actionStart=rpcCalls.length;
  await api.playAlbumNow(multiAlbum,discFilter);
  const replaceCalls=rpcCalls.slice(actionStart).filter(cmd=>cmd[0]==='playlistcontrol');
  assert(replaceCalls.map(cmd=>cmd.join('|')).join(';')==='playlistcontrol|cmd:delete|index:1;playlistcontrol|cmd:delete|index:0;playlistcontrol|cmd:insert|index:0|track_id:3,4','replace-current preserves remaining albums and inserts selected disc');
  actionStart=rpcCalls.length;
  await api.clearPlaylistAndPlay(multiAlbum,discFilter);
  assert(rpcCalls.slice(actionStart).some(cmd=>cmd.join('|')==='playlistcontrol|cmd:load|track_id:3,4'),'clear-and-play loads selected disc');
  statusFixture={playlist_loop:[]};actionStart=rpcCalls.length;
  await api.playAlbumNow(multiAlbum,discFilter);
  assert(rpcCalls.slice(actionStart).some(cmd=>cmd.join('|')==='playlistcontrol|cmd:load|track_id:3,4'),'replace-current starts selected disc when queue is empty');
  statusFixture=null;
  await api.openAlbumMenu(albumForTrackList,{clientX:0,clientY:0});
  assert(element('.bf-album-disc-label').hidden&&api.selectedAlbumFilter()===null,'single-disc menu resets selection and hides disc controls');
  tracksFixture=Array.from({length:501},(_,i)=>({id:i+1,disc:i<500?1:3,tracknum:i+1}));
  await api.openAlbumMenu(multiAlbum,{clientX:0,clientY:0});
  assert(discSelect.children.map(option=>option.textContent).join('|')==='Full album|Disc 1|Disc 3','disc discovery pages tracks and preserves nonconsecutive disc numbers');
  tracksHandler=async()=>{throw Error('Offline')};
  await api.openAlbumMenu(multiAlbum,{clientX:0,clientY:0});
  assert(discSelect.disabled&&api.selectedAlbumFilter()===null&&discSelect.children[0].textContent.includes('unavailable'),'failed disc lookup preserves full-album playback');
  let resolveTracks;tracksHandler=()=>new Promise(resolve=>{resolveTracks=resolve});
  const staleMenu=api.openAlbumMenu(multiAlbum,{clientX:0,clientY:0});
  await api.openAlbumMenu(albumForTrackList,{clientX:0,clientY:0});
  resolveTracks({count:1,titles_loop:[{id:1,disc:2}]});await staleMenu;
  assert(element('.bf-album-disc-label').hidden&&discSelect.children.length===0,'stale disc response cannot alter a replacement menu');
  tracksHandler=null;
  const spotifyMenuAlbum=multiAlbum.slice();spotifyMenuAlbum[13]='spotify';actionStart=rpcCalls.length;
  await api.openAlbumMenu(spotifyMenuAlbum,{clientX:0,clientY:0});
  assert(element('.bf-album-disc-label').hidden&&rpcCalls.length===actionStart,'Spotify does not issue local disc queries');
  api.closeAlbumMenu();




  api.set({playerId:'test-player'});
  const currentCoverAlbum=api.state().albums.find(a=>String(a?.[6])==='20');
  const currentCoverIndex=api.state().albums.indexOf(currentCoverAlbum);
  statusFixture={mode:'play',playlist_loop:[{album_id:20,album:'Album 020'}]};
  api.applyStatus(statusFixture);api.openFrontPreview(currentCoverAlbum,currentCoverIndex);
  const coverButton=element('.bf-front-play');
  assert(coverButton.innerHTML===element('.bf-play').innerHTML&&coverButton.getAttribute('aria-label')==='Pause player','playing cover icon and accessible label match main control');
  statusFixture={...statusFixture,mode:'pause'};actionStart=rpcCalls.length;
  await coverButton.onclick({stopPropagation(){}});
  assert(rpcCalls.slice(actionStart).some(cmd=>cmd[0]==='pause')&&!rpcCalls.slice(actionStart).some(cmd=>cmd[0]==='playlistcontrol'),'current cover pauses without reloading or clearing queue');
  assert(coverButton.innerHTML===element('.bf-play').innerHTML&&coverButton.getAttribute('aria-label')==='Resume player'&&!preview.hidden,'paused cover shows matching play icon and remains open');
  statusFixture={...statusFixture,mode:'play'};actionStart=rpcCalls.length;
  await coverButton.onclick({stopPropagation(){}});
  assert(rpcCalls.slice(actionStart).some(cmd=>cmd[0]==='pause')&&!rpcCalls.slice(actionStart).some(cmd=>cmd[0]==='playlistcontrol'),'paused cover resumes without restarting album');
  assert(coverButton.getAttribute('aria-label')==='Pause player','resuming updates cover button back to pause');
  const otherCoverIndex=api.state().albums.findIndex(a=>String(a?.[6])!=='20');
  api.openFrontPreview(api.state().albums[otherCoverIndex],otherCoverIndex);
  assert(coverButton.getAttribute('aria-label')==='Play album'&&coverButton.innerHTML.includes('▶'),'other album previews always offer album playback');
  actionStart=rpcCalls.length;await coverButton.onclick({stopPropagation(){}});
  assert(rpcCalls.slice(actionStart).some(cmd=>cmd[0]==='playlistcontrol'&&cmd.includes('cmd:load')),'other album cover still loads chosen album');

  api.setSourceForTest('library');api.set({playerId:'test-player',playing:false,playingAlbumId:null});
  api.closeFrontPreview(true);api.applySetting('frontTimeout',100);
  const searchAlbum=api.state().albums[1];
  actionStart=rpcCalls.length;
  await settle(api.selectSearchAlbum(searchAlbum));
  assert(!preview.hidden&&api.state().frontPreviewAlbum===searchAlbum,'LMS search selection opens the found album after scrolling');
  assert(api.state().frontTimer!==0&&preview.dataset.pinned==='false','found non-playing album uses normal preview timeout');
  const timeout=timers.get(api.state().frontTimer);await settle(timeout());
  assert(preview.hidden,'found album closes after normal preview timeout without playback');
  assert(!rpcCalls.slice(actionStart).some(cmd=>cmd[0]==='playlistcontrol'||cmd[0]==='pause'),'selecting search results never changes playback');
  api.set({playing:true,playingAlbumId:20});
  api.openFrontPreview(currentCoverAlbum,currentCoverIndex);
  await settle(api.selectSearchAlbum(searchAlbum));
  assert(api.state().frontPreviewAlbum===searchAlbum&&api.state().frontTimer!==0,'search result replaces playing cover with a timed preview');
  const returnTimeout=timers.get(api.state().frontTimer);await settle(returnTimeout());
  await Promise.resolve();
  assert(!preview.hidden&&String(api.state().frontPreviewAlbum?.[6])==='20','search preview timeout restores current playing cover');
  await settle(api.selectSearchAlbum(currentCoverAlbum));
  assert(api.state().frontTimer===0&&preview.dataset.pinned==='true','searching for current album keeps it pinned without timeout');
  api.applyStatus({mode:'stop',playlist_loop:[]});api.set({position:0});
  const pointerSearch=api.selectSearchAlbum(searchAlbum);
  await Promise.resolve();
  api.noteUserActivity({type:'pointermove'});
  assert(!!api.state().followAnimation,'pointer motion does not cancel search scrolling');
  api.applyStatus({mode:'stop',playlist_loop:[]});
  assert(!!api.state().followAnimation,'repeated stopped status does not cancel search scrolling');
  await settle(pointerSearch);
  assert(api.state().frontPreviewAlbum===searchAlbum&&!preview.hidden,'search still opens its album after pointer motion and stopped status');
  api.set({position:0});api.closeFrontPreview(true);
  const interruptedSearch=api.selectSearchAlbum(searchAlbum);await Promise.resolve();
  api.browseWithArrow(1);await settle(interruptedSearch);
  assert(preview.hidden,'explicit keyboard navigation can still interrupt search without opening a stale preview');
  element('.bf-search-input').value='previous query';
  element('.bf-search-results').append(new Element('old result'));
  element('.bf-search-status').textContent='Previous results';
  api.closeSearch();api.openSearch();
  assert(element('.bf-search-input').value===''&&element('.bf-search-results').children.length===0,'new search clears previous query and results');
  assert(element('.bf-search-status').textContent==='Type at least two characters.'&&!element('.bf-search-overlay').hidden,'new search resets its status and opens normally');
  api.setSourceForTest('spotify');api.set({playerId:'test-player',playing:false,playingAlbumId:null});api.closeFrontPreview(true);
  statusFixture={mode:'play',remote:1,playlist_loop:[{album:'The Colour And The Shape',artist:'Foo Fighters',title:'Doll',url:'spotify:track:fixture'}]};
  const spotifySearchAlbum=['The Colour And The Shape','Foo Fighters','','','','','spotty-item:search-fixture',true,'','','','',undefined,'spotify','search-fixture','search-preview'];
  actionStart=rpcCalls.length;
  await settle(api.selectSearchAlbum(spotifySearchAlbum));
  assert(!preview.hidden&&api.state().frontPreviewAlbum===spotifySearchAlbum,'Spotify search selection opens the found cover');
  assert(api.state().frontTimer!==0&&element('.bf-front-play').getAttribute('aria-label')==='Play album','Spotify search preview has normal timeout and explicit Play button');
  assert(!rpcCalls.slice(actionStart).some(cmd=>cmd[0]==='playlistcontrol'||(cmd[0]==='spotty'&&cmd[1]==='playlist')),'Spotify search selection never changes playback');
  const spotifyPreviewTimeout=timers.get(api.state().frontTimer);await settle(spotifyPreviewTimeout());
  assert(preview.hidden,'Spotify search preview closes after normal timeout');
  await settle(api.selectSearchAlbum(spotifySearchAlbum));actionStart=rpcCalls.length;
  await element('.bf-front-play').onclick({stopPropagation(){}});
  assert(rpcCalls.slice(actionStart).some(cmd=>cmd.join('|')==='spotty|playlist|play|item_id:search-fixture'),'Spotify album plays only when its cover Play button is clicked');
  api.setSourceForTest('spotify');api.set({playerId:'test-player',playing:false,playingAlbumId:null});api.closeFrontPreview(true);
  const externalSpotifyAlbum=['External Spotify Album','External Artist','','','','','spotify:album:external',true,'','','','',undefined,'spotify','external-node',undefined,'https://open.spotify.com/album/4aawyAB9vmqN3uQ7FjRGTy'];
  spotifyFollowAlbums=[externalSpotifyAlbum];actionStart=rpcCalls.length;
  api.applyStatus({mode:'play',remote:1,playlist_loop:[{album:'External Spotify Album',artist:'External Artist',title:'External track',url:'spotify:track:external'}]});
  await settle(api.resolveSpotifyPlayingAlbum());
  for(let step=0;step<100;step++){await Promise.resolve();if(api.state().frontPreviewAlbum===externalSpotifyAlbum)break;}
  assert(api.state().albums.some(album=>album[6]===externalSpotifyAlbum[6]),'external Spotify playback resolves an album absent from this browser shelf');
  assert(!preview.hidden&&api.state().frontPreviewAlbum===externalSpotifyAlbum,'resolved external Spotify album opens its playing cover');
  assert(!rpcCalls.slice(actionStart).some(cmd=>cmd[0]==='playlistcontrol'||cmd[0]==='playlist'||(cmd[0]==='spotty'&&cmd[1]==='playlist')),'following external Spotify playback never sends a playback command');
  const pausedRemote=externalSpotifyAlbum.slice();pausedRemote[0]='Paused external album';pausedRemote[6]='spotify:album:paused-external';spotifyFollowAlbums=[pausedRemote];
  api.applyStatus({mode:'pause',remote:1,playlist_loop:[{album:pausedRemote[0],artist:'External Artist',title:'Paused remote track',url:'spotify:track:paused-remote'}]});
  await settle(api.resolveSpotifyPlayingAlbum());for(let step=0;step<100;step++)await Promise.resolve();
  assert(!preview.hidden&&api.state().frontPreviewAlbum===pausedRemote&&preview.dataset.pinned==='true'&&!api.state().playing,'external paused Spotify album is also resolved and pinned without resuming');
  let finishStaleLookup;spotifyFollowSearch=()=>new Promise(resolve=>{finishStaleLookup=resolve});
  api.applyStatus({mode:'play',remote:1,playlist_loop:[{album:'Stale external album',artist:'External Artist',title:'Stale track',url:'spotify:track:stale'}]});
  await Promise.resolve();api.applyStatus({mode:'stop',playlist_loop:[]});
  const staleRemote=externalSpotifyAlbum.slice();staleRemote[0]='Stale external album';staleRemote[6]='spotify:album:stale-external';
  finishStaleLookup({albums:[staleRemote]});for(let step=0;step<100;step++)await Promise.resolve();
  assert(!api.state().albums.some(album=>album[6]===staleRemote[6]),'late Spotify lookup cannot add or reopen an album after playback stops');
  spotifyFollowSearch=null;
  api.applyStatus({mode:'stop',playlist_loop:[]});api.set({playing:false,playingAlbumId:null});api.setSourceForTest('library');
  await api.setDisplayOrder('recent');
  spotifyFollowAlbums=[['Z album','A artist','','','','','spotify:order-z',true,'','','','',undefined,'spotify','order-z'],['A album','Z artist','','','','','spotify:order-a',true,'','','','',undefined,'spotify','order-a']];
  await settle(api.setCatalogueSource('spotify'));await api.setDisplayOrder('album');
  assert(api.state().albums[0][0]==='A album','Spotify album order is applied to its catalogue');
  assert(storage.get('albumBrowserOrderMode:spotify')==='album'&&storage.get('albumBrowserOrderMode:library')==='recent','source order preferences are saved independently');
  await settle(api.setCatalogueSource('library'));
  assert(api.state().orderMode==='recent','returning to Library restores its saved Recently Added order');
  await settle(api.setCatalogueSource('spotify'));
  assert(api.state().orderMode==='album'&&api.state().albums[0][0]==='A album','returning to Spotify restores its saved album order and sorting');
  storage.set('albumBrowserOrderMode:library','random');storage.set('albumBrowserOrderMode:spotify','artistAlbum');api.restoreSourceOrders();
  assert(api.sourceOrdersForTest().library==='random'&&api.sourceOrdersForTest().spotify==='artistAlbum','saved per-source preferences restore after reload');
  storage.delete('albumBrowserOrderMode:library');storage.delete('albumBrowserOrderMode:spotify');storage.set('albumBrowserOrderMode','colour');api.restoreSourceOrders();
  assert(api.sourceOrdersForTest().library==='colour'&&api.sourceOrdersForTest().spotify==='artistAlbum','legacy shared ordering migrates to Library without overwriting Spotify default');
  storage.set('albumBrowserOrderMode:spotify','recent');api.restoreSourceOrders();
  assert(api.sourceOrdersForTest().spotify==='artistAlbum','unsupported Spotify Recently Added preference falls back safely');
  storage.set('albumBrowserOrderMode:spotify','indexed');api.restoreSourceOrders();
  assert(api.sourceOrdersForTest().spotify==='artistAlbum','Spotify cannot restore Library-only Recently Indexed');
  api.set({playerId:'test-player',playing:false,playingAlbumId:null});api.setSourceForTest('library');
  statusFixture={mode:'play',playlist_tracks:24,playlist_cur_index:0,playlist_loop:[{album_id:20,title:'First track'},{album_id:20,title:'Second track'}]};
  await api.openQueue();
  assert(element('.bf-queue-position').textContent==='1 / 24'&&element('.bf-queue-progress').textContent==='Track 1 of 24','queue indicators use the total queue rather than the fetched track count');
  const queueRows=element('.bf-queue-list').children.slice(),queueButton=queueRows[1].children[0];
  const queueMutations=[];const replaceQueueRows=element('.bf-queue-list').replaceChildren.bind(element('.bf-queue-list'));
  element('.bf-queue-list').replaceChildren=(...rows)=>{queueMutations.push(rows);replaceQueueRows(...rows)};
  element('.bf-queue-list').scrollTop=75;
  statusFixture={...statusFixture,playlist_cur_index:1};actionStart=rpcCalls.length;
  await queueButton.onclick();
  assert(element('.bf-queue-drawer').classList.contains('is-open'),'selecting a queue track keeps the popup displayed');
  assert(queueMutations.length===0&&element('.bf-queue-list').children[1]===queueRows[1],'track selection preserves existing queue rows without clearing or rebuilding');
  assert(queueRows[1].classList.contains('is-current')&&!queueRows[0].classList.contains('is-current')&&queueButton.getAttribute('aria-current')==='true','queue highlight moves to selected track in place');
  assert(element('.bf-queue-list').scrollTop===75,'track selection preserves queue scroll position');
  assert(rpcCalls.slice(actionStart).filter(cmd=>cmd[0]==='status'&&cmd[2]===1000).length===0,'track selection does not reopen and reload the full queue');
  api.applyStatus({...statusFixture,playlist_cur_index:0});
  assert(queueRows[0].classList.contains('is-current')&&queueButton.getAttribute('aria-current')===undefined,'external track changes update queue highlight without replacing rows');
  assert(element('.bf-queue-position').textContent==='1 / 24','external status updates queue position');
  api.applyStatus({mode:'pause',playlist_cur_index:13});
  assert(element('.bf-queue-position').textContent==='14 / 24'&&element('.bf-queue-progress').textContent==='Track 14 of 24','paused partial status retains the queue total and uses queue position');
  api.applyStatus({mode:'pause'});
  assert(element('.bf-queue-position').textContent==='14 / 24','status without queue fields preserves the indicator');
  api.applyStatus({mode:'stop',playlist_tracks:0,playlist_loop:[]});
  assert(element('.bf-queue-position').hidden&&element('.bf-queue-progress').hidden,'empty queue hides both indicators');
  api.applyStatus({mode:'play',playlist_tracks:2,playlist_cur_index:9});
  assert(element('.bf-queue-position').hidden,'inconsistent queue position is not displayed');
  api.closeQueue();statusFixture=null;
  api.closeQueue();api.closeAlbumMenu();api.closeTrackList();api.closeSearch();
  api.set({playing:false,playingAlbumId:null});api.applySetting('frontTimeout',100);
  const timedAlbum=api.state().albums[0];api.openFrontPreview(timedAlbum,0);
  time+=30;await api.openAlbumMenu(timedAlbum,{clientX:100,clientY:100});api.syncFrontTimeoutPause();
  assert(api.state().frontTimer===0&&api.state().frontTimeoutRemaining===70,'opening an album menu pauses the remaining cover countdown');
  time+=500;element('.bf-settings-overlay').hidden=false;api.closeAlbumMenu();api.syncFrontTimeoutPause();
  assert(api.state().frontTimer===0&&api.state().frontTimeoutRemaining===70&&!preview.hidden,'a second popup keeps countdown paused without spending or resetting its remaining time');
  element('.bf-settings-overlay').hidden=true;api.syncFrontTimeoutPause();
  assert(api.state().frontTimer!==0&&api.state().frontTimeoutDeadline-time===70,'closing the last popup resumes exactly the remaining countdown');
  await settle(timers.get(api.state().frontTimer)());
  assert(preview.hidden,'resumed preview countdown still closes normally');
  for(const selector of ['.bf-settings-overlay','.bf-search-overlay','.bf-track-overlay','.bf-order-menu','.bf-discovery-menu']){
    api.openFrontPreview(timedAlbum,0);element(selector).hidden=false;api.syncFrontTimeoutPause();
    assert(api.state().frontTimer===0&&!preview.hidden,selector+' pauses preview timeout');
    element(selector).hidden=true;api.syncFrontTimeoutPause();assert(api.state().frontTimer!==0,selector+' resumes preview timeout');
  }
  api.set({playerId:''});
  const sourceBeforeRadio=api.sourceOrdersForTest(),shelfBeforeRadio=api.sourceForTest();
  api.applyStatus({mode:'play',remote:1,playlist_cur_index:0,playlist_tracks:1,playlist_loop:[{title:'Radio programme',album:'Radio station',url:'https://radio.example/live'}]});
  assert(root.dataset.externalPlayback==='true','radio playback dims the shelf');
  await settle(api.followPlayingSource());
  assert(api.sourceForTest()===shelfBeforeRadio&&api.sourceOrdersForTest().library===sourceBeforeRadio.library&&api.sourceOrdersForTest().spotify===sourceBeforeRadio.spotify,'radio does not change saved shelf ordering');
  api.applyStatus({mode:'pause',playlist_loop:[{title:'Radio programme'}]});
  assert(root.dataset.externalPlayback==='true','paused external playback keeps the shelf dimmed');
  api.applyStatus({mode:'play',playlist_loop:[{album_id:20,album:'Library album',title:'Local track',url:'file:///music/track.flac'}]});
  assert(root.dataset.externalPlayback==='false','library playback restores normal shelf brightness');
  api.applyStatus({mode:'play',remote:1,playlist_loop:[{title:'Spotify track',album:'Spotify album',url:'spotify:track:fixture'}]});
  assert(root.dataset.externalPlayback==='false','Spotify playback is not dimmed despite remote flag');
  api.applyStatus({mode:'stop',playlist_loop:[]});
  const beforeRadioCount=api.state().albums.length;
  const radioStatus={mode:'play',remote:1,playlist_loop:[{title:'Radio song',artist:'Radio artist',remote_title:'Station',artwork_url:'/imageproxy/song/image.jpg',icon:'/imageproxy/station/image.jpg'}]};
  api.applyStatus(radioStatus);
  const radioAlbum=api.state().albums.find(a=>a?.[13]==='external'),radioArt=element('.bf-external-art');
  assert(api.state().albums.length===beforeRadioCount+1&&radioAlbum,'radio adds one temporary shelf CD');
  assert(api.state().albums.indexOf(radioAlbum)===Math.floor(beforeRadioCount/2),'temporary radio CD is inserted in the middle of the shelf');
  const realRadioNeighbours=api.state().albums.filter(a=>a?.[13]!=='external').slice(0,api.state().PAGE_SIZE);
  api.storeBatch(0,{albums_loop:realRadioNeighbours.map(a=>({id:a[6],album:a[0],artist:a[1]}))},false);
  assert(api.state().albums.includes(radioAlbum)&&realRadioNeighbours.every((a,i)=>api.state().albums.filter(b=>b?.[13]!=='external')[i][6]===a[6]),'catalogue page loading preserves the middle radio slot and real album positions');

  await settle(api.ensurePlayingCover());
  assert(api.state().frontPreviewAlbum===radioAlbum&&!preview.hidden&&preview.dataset.pinned==='true','radio uses the normal pinned shelf cover');
  api.applyStatus(radioStatus);
  assert(api.state().albums.filter(a=>a?.[13]==='external').length===1,'repeated radio status does not duplicate its CD');
  radioArt.onerror();
  assert(radioAlbum[8].includes(encodeURIComponent('/imageproxy/station/image.jpg')),'radio shelf CD falls back to station artwork');
  api.applyStatus({mode:'play',remote:1,playlist_loop:[{title:'Next radio song',remote_title:'Station',artwork_url:''}]});
  assert(api.state().albums.includes(radioAlbum)&&radioAlbum[8].includes(encodeURIComponent('/imageproxy/station/image.jpg')),'missing song artwork retains the same CD with remembered station artwork');
  api.applyStatus({mode:'play',remote:1,playlist_loop:[{title:'Next radio song',remote_title:'Station',artwork_url:'/imageproxy/delayed/image.jpg'}]});
  assert(radioAlbum[8].includes(encodeURIComponent('/imageproxy/station/image.jpg')),'station artwork remains visible while delayed song artwork loads');
  radioArt.onload();
  assert(radioAlbum[8].includes(encodeURIComponent('/imageproxy/delayed/image.jpg')),'loaded song artwork replaces station artwork in place');
  const previousRadioArt=radioAlbum[8];
  api.applyStatus({mode:'play',remote:1,playlist_loop:[{title:'New radio song',remote_title:'Station',artwork_url:'/imageproxy/delayed/image.jpg',modificationTime:'new artwork revision'}]});
  assert(radioAlbum[8]===previousRadioArt&&radioArt.src!==previousRadioArt,'updated artwork is preloaded while current artwork stays visible');
  radioArt.onload();
  assert(radioAlbum[8]!==previousRadioArt&&radioAlbum[8].includes('revision='),'same artwork URL with new metadata refreshes the existing radio CD');

  radioArt.onerror();radioArt.onerror();
  assert(api.state().albums.includes(radioAlbum),'artwork failures never remove the temporary radio CD');

  api.applyStatus({mode:'pause',playlist_loop:[{title:'Radio song'}]});
  assert(api.state().albums.includes(radioAlbum)&&element('.bf-front-play').getAttribute('aria-label')==='Resume player','paused radio retains its shelf CD and matching button');
  api.applyStatus({mode:'play',playlist_loop:[{album_id:20,album:'Library album',title:'Local track'}]});
  assert(!api.state().albums.some(a=>a?.[13]==='external')&&api.state().albums.length===beforeRadioCount,'library playback removes the temporary radio CD');

  // Spotify is also remote in LMS. A status payload without the u/URL tag
  // must not be treated as a radio station just because it says remote:1.
  assert(api.playbackSourceForTrack({title:'Spotty song'}, {remote:1})==='unknown',
    'metadata-light Spotify status never becomes a fake radio CD');
  assert(api.playbackSourceForTrack({extid:'spotify:track:abc'}, {remote:1})==='spotify',
    'Spotify external ID identifies the music source');
  assert(api.playbackSourceForTrack({url:'spotify://track:abc'}, {remote:1})==='spotify',
    'Spotify track URI identifies the music source');
  assert(api.playbackSourceForTrack({url:'https://radio.example/live'}, {remote:1})==='external',
    'real HTTP radio streams remain external');
  assert(api.playbackSourceForTrack({remote_title:'Radio station'}, {remote:1})==='external',
    'radio station metadata keeps the fake CD when the stream URL is missing');
  // Protocol-independent remote classification: the server's remote flag is
  // authoritative, but a concrete non-Spotify URI is required to avoid
  // converting metadata-light Spotify updates into fake radio CDs.
  const planetRockStatus={
    mode:'play',remote:1,current_title:' ',
    playlist_cur_index:'0',
    playlist_loop:[{
      title:'The Planet Rock Years',
      album:'Legendary rock tracks, tv and memories from one classic year',
      remote:1,
      url:'https://stream-mz.hellorayo.co.uk/planetrock.aac?direct=true',
      artwork_url:'/imageproxy/planetrock/image.jpg','playlist index':0
    }],
    remoteMeta:{remote:1,url:'https://stream-mz.hellorayo.co.uk/planetrock.aac?direct=true'}
  };
  assert(api.playbackSourceForTrack(planetRockStatus.playlist_loop[0],planetRockStatus)==='external',
    'actual Planet Rock HTTP stream remains external via remote flag');
  for(const uri of ['sounds://_LIVE_bbc_radio_two','radiofuture://station/live','rtsp://station/live']){
    assert(api.playbackSourceForTrack({remote:1,url:uri},{remote:1})==='external',
      'remote player streams are independent of URL scheme: '+uri);
  }
  assert(api.playbackSourceForTrack({remote:1,url:'file:///music/track.flac',album_id:20},{remote:1})==='unknown',
    'remote:1 with only a local-looking URI is ambiguous, not a false radio CD');
  assert(api.playbackSourceForTrack({remote:0,url:'file:///music/track.flac',album_id:20},{remote:0})==='library',
    'remote:0 local album remains a library record');
  assert(api.playbackSourceForTrack({remote:1,title:'Metadata-light remote',artist:'Artist'},{remote:1})==='unknown',
    'remote:1 without a non-Spotify URI does not invent a radio CD');
  assert(api.playbackSourceForTrack({title:'Metadata-light Spotify track',album:'Album',remote:1},
      {remoteMeta:{remote:1}})==='unknown',
    'partial CometD remote status never misclassifies Spotify as radio');
  assert(api.playbackSourceForTrack({url:'spotify:track:abc',remote:1},
      {remote:1,remoteMeta:{url:'sounds://_LIVE_bbc_radio_two'}})==='spotify',
    'positive Spotify identity takes priority over other remote URLs');
  assert(api.playbackSourceForTrack({url:'spotify://track:abc',remote:1},{remote:1})==='spotify',
    'Spotify double-slash URI remains Spotify despite remote:1');
  assert(api.playbackSourceForTrack({url:'radiofuture://station/live'},
      {remoteMeta:{remote:1}})==='external',
    'remoteMeta flag can identify a new radio protocol even when track.remote is missing');

  // Real LMS BBC Sounds Radio 2 payload: the live stream has a sounds:// URI
  // and artwork, but neither a remote_title nor a station icon.
  const soundsStatus={
    mode:'play',remote:1,current_title:"Don't Stop Believin'",
    playlist_cur_index:'0',playlist_loop:[{
      artist:'Journey',album:"Vernon Kay - Owain's 4 Nations Cycle Challenge, Day 5 Part 2",
      title:"Don't Stop Believin'",url:'sounds://_LIVE_bbc_radio_two',
      remote:1,id:'-93827187894416',
      artwork_url:'/imageproxy/https%3A%2F%2Fichef.bbci.co.uk%2Fimages%2Fic%2F320x320%2Fp01bty7k.jpg/image.jpg',
      'playlist index':0
    }],
    remoteMeta:{url:'sounds://_LIVE_bbc_radio_two',remote:1}
  };
  assert(api.playbackSourceForTrack(soundsStatus.playlist_loop[0],soundsStatus)==='external',
    'BBC Sounds URI is recognised as radio, not unknown or Spotify');
  api.setSourceForTest('library');
  api.applyStatus({mode:'stop',playlist_loop:[]});
  const soundsBefore=api.state().albums.length;
  api.applyStatus(soundsStatus);
  assert(root.dataset.externalPlayback==='true'&&
    api.state().albums.filter(album=>album?.[13]==='external').length===1&&
    api.state().albums.length===soundsBefore+1,
    'real BBC Sounds metadata inserts exactly one virtual radio CD and dims Library');
  await settle(api.ensurePlayingCover());
  assert(api.state().frontPreviewAlbum?.[13]==='external'&&!preview.hidden,
    'BBC Sounds virtual jewel case is displayed as the active cover');
  api.applyStatus({mode:'stop',playlist_loop:[]});
  assert(!api.state().albums.some(album=>album?.[13]==='external'),
    'stopping BBC Sounds removes the temporary radio CD');
  const rockBefore=api.state().albums.length;
  api.applyStatus(planetRockStatus);
  assert(root.dataset.externalPlayback==='true'&&
    api.state().albums.filter(album=>album?.[13]==='external').length===1&&
    api.state().albums.length===rockBefore+1,
    'actual Planet Rock metadata also inserts exactly one temporary radio CD');
  await settle(api.ensurePlayingCover());
  assert(api.state().frontPreviewAlbum?.[13]==='external'&&!preview.hidden,
    'Planet Rock continues to open its radio jewel case');
  // Partial metadata must preserve the established radio source without
  // replacing its CD, just as it preserves confirmed Spotify playback.
  api.applyStatus({mode:'pause',remote:1,playlist_loop:[{title:'Partial radio update',remote:1}]});
  assert(root.dataset.externalPlayback==='true'&&
    api.state().albums.filter(album=>album?.[13]==='external').length===1,
    'partial remote event keeps the existing confirmed radio CD');
  api.applyStatus({mode:'stop',playlist_loop:[]});


  async function settleSource(expected) {
    for(let i=0;i<500;i++){
      await Promise.resolve();
      time+=16;
      const pending=[...frames.values()];frames.clear();
      for(const fn of pending)fn(time);
      if(api.sourceForTest()===expected&&!api.state().sourceFollowPending)return;
    }
    throw Error('Source switch did not settle: '+expected);
  }
  // Each independently open viewer observes the player's status. Simulate a
  // second browser, still browsing Library, learning that Spotify started
  // elsewhere without sending any playback command itself.
  const beforePassiveSwitch=rpcCalls.filter(cmd=>cmd[0]==='playlistcontrol'||(cmd[0]==='spotty'&&cmd[1]==='playlist')).length;
  api.set({playerId:'test-player',playing:true});
  api.setSourceForTest('library');
  spotifyFollowAlbums=[externalSpotifyAlbum];
  api.applyStatus({mode:'play',remote:1,playlist_loop:[{
    album:'External Spotify Album',artist:'External Artist',title:'Remote song',
    url:'spotify://track:external'
  }]});
  await settleSource('spotify');
  assert(root.dataset.externalPlayback==='false'&&!api.state().albums.some(a=>a?.[13]==='external'),
    'another viewer follows Spotify rather than adding a dimmed fake radio CD');
  api.applyStatus({mode:'pause',remote:1,playlist_loop:[{
    album:'External Spotify Album',artist:'External Artist',title:'Remote song',
    extid:'spotify:track:external'
  }]});
  assert(api.sourceForTest()==='spotify'&&!api.state().playing&&root.dataset.externalPlayback==='false',
    'paused Spotify remains the selected source and is not treated as radio');
  api.applyStatus({mode:'play',remote:1,playlist_loop:[{
    album:'Radio station',remote_title:'Radio station',title:'Live radio',
    url:'https://radio.example/live'
  }]});
  assert(api.sourceForTest()==='spotify'&&root.dataset.externalPlayback==='true'&&
    api.state().albums.some(a=>a?.[13]==='external'),
    'switching to radio dims the current shelf and adds exactly one temporary CD');
  // Source switching rebuilds the catalogue. It must not silently discard
  // the radio CD and wait for another (possibly absent) playerstatus update.
  await settle(api.setCatalogueSource('library'));
  assert(api.sourceForTest()==='library'&&
    api.state().albums.filter(a=>a?.[13]==='external').length===1&&
    api.state().frontPreviewAlbum?.[13]==='external'&&!preview.hidden,
    'switch to Library preserves and opens the current radio CD');
  await settle(api.setDisplayOrder('album'));
  assert(api.state().albums.filter(a=>a?.[13]==='external').length===1&&
    api.state().frontPreviewAlbum?.[13]==='external',
    'reordering the Library preserves the virtual radio CD');
  await settle(api.setCatalogueSource('spotify'));
  assert(api.sourceForTest()==='spotify'&&
    api.state().albums.filter(a=>a?.[13]==='external').length===1&&
    api.state().frontPreviewAlbum?.[13]==='external',
    'switch back to Spotify preserves and opens the radio CD');
  await settle(api.setDisplayOrder('album'));
  assert(api.state().albums.filter(a=>a?.[13]==='external').length===1,
    'reordering Spotify never loses or duplicates the radio CD');

  api.applyStatus({mode:'play',playlist_loop:[{
    album_id:20,album:'Album 020',title:'Local song',url:'file:///music/local.flac'
  }]});
  await settleSource('library');
  assert(root.dataset.externalPlayback==='false'&&
    !api.state().albums.some(a=>a?.[13]==='external'),
    'radio-to-Library playback restores the Library shelf and removes the fake CD');
  assert(rpcCalls.filter(cmd=>cmd[0]==='playlistcontrol'||(cmd[0]==='spotty'&&cmd[1]==='playlist')).length===beforePassiveSwitch,
    'passive source-following on another viewer never issues playback commands');

  // A deliberate selection is a LOCAL browsing decision, not a playback
  // command. The user may browse Spotify while another viewer plays Library.
  const playbackWritesBeforeBrowse=rpcCalls.filter(cmd=>cmd[0]==='playlistcontrol'||(cmd[0]==='spotty'&&cmd[1]==='playlist')).length;
  assert(api.manualSourceStateForTest().timeout===300000,
    'default manual source browsing hold is five minutes');
  await settle(sourceButtonsForTest[1].onclick());
  assert(api.sourceForTest()==='spotify'&&api.manualSourceStateForTest().held,
    'selecting Spotify manually holds this viewer on Spotify');
  const firstBrowseTimer=api.manualSourceStateForTest().timer;
  const originalDeadline=api.manualSourceStateForTest().until;
  api.applyStatus({mode:'play',playlist_loop:[{album_id:20,album:'Album 020',
    title:'Other viewer playing local track',url:'file:///music/local.flac'}]});
  await api.followPlayingSource();
  assert(api.sourceForTest()==='spotify',
    'local playback updates cannot override a manual Spotify browsing session');
  time+=60000;api.noteUserActivity({type:'wheel'});
  const renewed=api.manualSourceStateForTest();
  assert(renewed.held&&renewed.until>originalDeadline&&renewed.timer!==firstBrowseTimer&&
    !timers.has(firstBrowseTimer),'touch/wheel/keyboard activity extends the local browse timer');
  time=originalDeadline+1;
  await api.followPlayingSource();
  assert(api.sourceForTest()==='spotify','original timeout no longer interrupts an active browser');
  time=renewed.until+1;
  const expire=timers.get(renewed.timer);
  assert(typeof expire==='function','idle expiry has a scheduled callback');
  expire();
  await settleSource('library');
  assert(!api.manualSourceStateForTest().held&&api.sourceForTest()==='library',
    'after configured inactivity, manual browsing returns to player source');
  // Changing the setting is immediate, including the Follow immediately
  // option; automatic switches must never arm their own grace period.
  api.applySetting('sourceBrowseTimeout',60000);
  await settle(sourceButtonsForTest[1].onclick());
  assert(api.manualSourceStateForTest().timeout===60000&&
    api.manualSourceStateForTest().held,'new timeout applies to a newly selected source');
  api.applySetting('sourceBrowseTimeout',0);
  await settleSource('library');
  assert(!api.manualSourceStateForTest().held&&api.sourceForTest()==='library',
    'Follow immediately cancels an active browsing hold and resumes syncing');
  assert(rpcCalls.filter(cmd=>cmd[0]==='playlistcontrol'||(cmd[0]==='spotty'&&cmd[1]==='playlist')).length===playbackWritesBeforeBrowse,
    'manual browsing and automatic return never issue player commands');
  // New albums are a notification/preview, NEVER another playback action.
  // First synchronise the viewer's revision without announcing any old scan.
  recentNewAlbumIdsFixture=[];
  api.applySetting('newAlbumAction','none');
  api.setSourceForTest('library');
  api.applyStatus({mode:'stop',playlist_loop:[]});
  api.closeFrontPreview(true);
  await settle(api.handleLibraryEvent());
  assert(api.arrivalStateForTest().revision===revisionOf(library),
    'existing library establishes a baseline without previewing old albums');
  const newAlbumToast=element('.bf-new-album-toast');
  const arrivalPlaybackBefore=rpcCalls.filter(cmd=>cmd[0]==='playlistcontrol'||
    (cmd[0]==='spotty'&&cmd[1]==='playlist')).length;
  api.applySetting('newAlbumAction','notify');
  const firstArrival={id:99101,album:'Freshly ripped album',artist:'Ripping artist'};
  library.push(firstArrival);
  recentNewAlbumIdsFixture=[String(firstArrival.id)];
  // Another viewer already reconciled: changed=false, but the browser's
  // revision is older and the arrival is still persisted in server metadata.
  catalogueReconcileChanged=false;
  await settle(api.handleLibraryEvent());
  assert(!newAlbumToast.hidden&&newAlbumToast.textContent.includes('Freshly ripped album'),
    'notify mode announces an arrival even if another viewer reconciled first');
  assert(api.state().frontPreviewAlbum?.[6]!==firstArrival.id,
    'notification alone never opens the new album');
  newAlbumToast.hidden=true;
  await settle(api.handleLibraryEvent());
  assert(newAlbumToast.hidden,'unchanged catalogue revision does not repeat the announcement');

  // A different path can update this viewer's shelf BEFORE it receives the
  // scan event. It must still announce that revision exactly once.
  const alreadyRefreshedArrival={id:99107,album:'Already on the shelf',artist:'New arrival'};
  library.push(alreadyRefreshedArrival);
  recentNewAlbumIdsFixture=[String(alreadyRefreshedArrival.id)];
  catalogueReconcileChanged=false;
  await settle(api.loadInitialCatalogue());
  assert(api.preparedStateForTest().revision===revisionOf(library)&&
    api.arrivalStateForTest().revision!==revisionOf(library),
    'shelf can be current before arrival revision is observed');
  newAlbumToast.hidden=true;
  await settle(api.handleLibraryEvent());
  assert(!newAlbumToast.hidden&&newAlbumToast.textContent.includes('Already on the shelf'),
    'show notification works even when the shelf was refreshed before the event');
  newAlbumToast.hidden=true;
  await settle(api.handleLibraryEvent());
  assert(newAlbumToast.hidden,'already-refreshed arrival is never announced twice');

  // In preview mode the virtual viewer is idle and may scroll/open, but never
  // play. Opening an album also reuses the standard temporary case timeout.
  api.applySetting('newAlbumAction','preview');
  api.closeFrontPreview(true);
  api.set({activity:Date.now()-30000});
  const secondArrival={id:99102,album:'Second fresh CD',artist:'Ripping artist'};
  library.push(secondArrival);
  recentNewAlbumIdsFixture=[String(secondArrival.id)];
  catalogueReconcileChanged=true;
  await settle(api.handleLibraryEvent());
  assert(api.state().frontPreviewAlbum?.[6]===secondArrival.id&&!preview.hidden,
    'idle viewer scrolls to freshly added album and opens its jewel case');
  assert(api.state().frontTimer!==0,
    'new album cover uses the usual temporary front-preview timeout');

  // Active browsing must not be hijacked; a text notification is safe.
  api.closeFrontPreview(true);
  api.set({activity:Date.now()});
  const activeArrival={id:99103,album:'Added during browsing',artist:'Ripping artist'};
  library.push(activeArrival);
  recentNewAlbumIdsFixture=[String(activeArrival.id)];
  await settle(api.handleLibraryEvent());
  assert(!newAlbumToast.hidden&&api.state().frontPreviewAlbum?.[6]!==activeArrival.id,
    'active browsing prevents automatic shelf motion even in preview mode');

  // One scan with several album IDs never creates a cascade of animations.
  api.closeFrontPreview(true);
  api.set({activity:Date.now()-30000});
  library.push({id:99104,album:'Multi disc one',artist:'Artist'});
  library.push({id:99105,album:'Multi disc two',artist:'Artist'});
  recentNewAlbumIdsFixture=['99104','99105'];
  await settle(api.handleLibraryEvent());
  assert(newAlbumToast.textContent.includes('2 new albums added')&&
    ['99104','99105'].includes(String(api.state().frontPreviewAlbum?.[6])),
    'multiple new albums result in one notification and one preview only');

  // Spotify browsing must stay Spotify. An arrival can notify, but must not
  // switch catalogues or open a local-library cover there.
  api.setSourceForTest('spotify');
  library.push({id:99106,album:'Added while in Spotify',artist:'Artist'});
  recentNewAlbumIdsFixture=['99106'];
  newAlbumToast.hidden=true;
  await settle(api.handleLibraryEvent());
  assert(api.sourceForTest()==='spotify'&&
    newAlbumToast.textContent.includes('New Library album added')&&
    !newAlbumToast.hidden,'arrival never forces a Spotify viewer into Library');
  assert(rpcCalls.filter(cmd=>cmd[0]==='playlistcontrol'||
    (cmd[0]==='spotty'&&cmd[1]==='playlist')).length===arrivalPlaybackBefore,
    'new album notifications and previews never issue playback commands');
  recentNewAlbumIdsFixture=[];
  api.setSourceForTest('library');
  await settle(api.loadInitialCatalogue());
  api.closeFrontPreview(true);
  api.applySetting('newAlbumAction','none');
  api.set({playing:false,hover:0});const headingAlbum=api.state().albums[0],oldHeading=headingAlbum.slice(0,2);
  headingAlbum[0]=' ';headingAlbum[1]='The Dead Daisies';api.updateMeta(true);
  assert(element('.bf-meta').children[0].children[1].textContent==='The Dead Daisies','missing album title omits the artist separator');
  [headingAlbum[0],headingAlbum[1]]=oldHeading;
  return checks;
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('regressions.mjs')) {
  const {readFile}=await import('node:fs/promises');
  const sources={};for(const name of ['app','browser','catalogue','lms','settings','spotify'])sources[name]=await readFile(new URL('../js/'+name+'.js',import.meta.url),'utf8');
  sources.lmsProvider=await readFile(new URL('../js/providers/lms-provider.js',import.meta.url),'utf8');
  sources.index=await readFile(new URL('../index.html',import.meta.url),'utf8');
  sources.albumBrowserCss=await readFile(new URL('../css/album-browser.css',import.meta.url),'utf8');
  sources.shelfCss=await readFile(new URL('../css/shelf.css',import.meta.url),'utf8');
  sources.settingsCss=await readFile(new URL('../css/settings.css',import.meta.url),'utf8');
  sources.server=await readFile(new URL('../server.py',import.meta.url),'utf8');
  sources.debianBuild=await readFile(new URL('../packaging/debian/build-deb.sh',import.meta.url),'utf8');
  sources.performance=await readFile(new URL('../js/performance.js',import.meta.url),'utf8');
  console.log(`${await runTests(sources)} regression checks passed`);
}
