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
  const comet = new CometDClient(() => {}, () => {}, data => { assert(data.rescan === 0, 'scan payload forwarded'); libraryEvents++; });
  comet.handleServerStatus({rescan:0}); comet.handleServerStatus({rescan:1}); comet.handleServerStatus({rescan:0}); comet.handleServerStatus({rescan:0});
  assert(libraryEvents === 1, 'one refresh per completed scan');
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
  preview.querySelector=()=>frontCase;
  const document=new Element('document');document.querySelectorAll=()=>[];document.getElementById=()=>root;document.createElement=tag=>new Element(tag);document.elementFromPoint=()=>null;
  const window=new Element('window');window.innerWidth=1000;window.innerHeight=600;
  const storage=new Map();const localStorage={getItem:k=>storage.get(k)??null,setItem:(k,v)=>storage.set(k,String(v))};
  let time=0,nextId=0;const frames=new Map(),timers=new Map();
  const setTimeout=fn=>{timers.set(++nextId,fn);return nextId;},clearTimeout=id=>timers.delete(id);
  const requestAnimationFrame=fn=>{frames.set(++nextId,fn);return nextId;},cancelAnimationFrame=id=>frames.delete(id);
  const rpcCalls=[];
  let library=Array.from({length:95},(_,i)=>({id:i+1,album:'Album '+String(i+1).padStart(3,'0'),artist:'Artist',textkey:'A'}));
  const rpc=async (player,cmd)=>{rpcCalls.push(cmd);if(cmd[0]==='players')return {players_loop:[{playerid:'test-player',connected:1,isplaying:1}]};if(cmd[0]==='status')return {mode:'play',playlist_loop:[{album_id:20,album:'Album 020',artist:'Artist',title:'Track',duration:60}],time:1};if(cmd[0]==='albums')return {count:library.length,albums_loop:library.slice(cmd[1],cmd[1]+cmd[2])};return {};};
  window.dispatchEvent=()=>{};
  const imageRequests=[];
  class PreloadImage{set src(url){this.url=url;imageRequests.push(this)}}
  let metadataFetch=async()=>({ok:false});
  const env={document,window,localStorage,performance:{now:()=>time},requestAnimationFrame,cancelAnimationFrame,setTimeout,clearTimeout,setInterval:setTimeout,clearInterval:clearTimeout,
    ResizeObserver:class{observe(){}},Event:class{},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options?.detail;}},Image:PreloadImage,fetch:(url,...args)=>url.startsWith('/api/catalogue')?Promise.resolve({ok:true,json:async()=>({albums_loop:library.map(a=>({...a,artwork_track_id:a.id})),count:library.length})}):metadataFetch(url,...args),rpc,CometDClient:class{stop(){}start(){}},resetRpcSession:()=>{},fanLayout:geometry.fanLayout,clamp:geometry.clamp,modulo:geometry.modulo,circularDelta:geometry.circularDelta,nearestPosition:geometry.nearestPositionForIndex,
    buildAlbumPositionIndex:catalogue.buildAlbumPositionIndex,locateIndexedAlbum:catalogue.locateAlbum,
    createLmsProvider:()=>({play:async album=>{await rpc('test-player',['playlistcontrol','cmd:load','album_id:'+album[6]]);return {};}}),createSpotifyProvider:()=>({play:async()=>({})}),spotifyAlbumInformation:async()=>({tracks:[]})};
  const app=plain(sources.app).replace(/start\(\);\s*$/, '');
  const api=new Function(...Object.keys(env), app + `
    return {prefetchCoverWindow,coverCache:()=>({active:warmingCovers.size,cached:warmCovers.size,queued:coverQueue.length}),browseWithArrow,connectLyrion,playRandomAlbum,centreAlbumIndex,loadInitialCatalogue,refreshCatalogue,setDisplayOrder,applySetting,applyStatus,selectStartupAlbum,returnToPlayingAlbum,stopFollowing,ensurePlayingCover,closeFrontPreview,openFrontPreview,updateMeta,draw,
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
  assert(api.state().albums.length===95 && api.state().albums.every(Boolean), 'full catalogue loaded in bounded pages');
  assert(rpcCalls.filter(c=>c[0]==='albums').every(c=>c[2]<=40), 'catalogue page limit');
  api.applySetting('displayCount',20);
  assert(api.state().PAGE_SIZE===40&&stage.children.length>20&&stage.children.length<40, 'display count independent of page size');
  await api.setDisplayOrder('random');
  const previous=api.state().albums.map(a=>a[6]);
  library.push({id:96,album:'New album',artist:'Artist'});
  await api.refreshCatalogue();
  assert(api.state().orderMode==='random'&&api.state().albums.slice(0,95).every((a,i)=>a[6]===previous[i]), 'refresh retains random order');
  api.applySetting('random',1000);
  // Actual connectLyrion() keeps connecting=true until startup completes;
  // otherwise applyStatus() launches a competing follow animation.
  api.set({connecting:true});
  await settle(api.selectStartupAlbum({mode:'play',playlist_loop:[{album_id:20,album:'Album 020',artist:'Artist',title:'Track',duration:60}],time:1}));
  api.set({connecting:false});
  assert(api.state().frontPreviewAlbum[6]===20&&!preview.hidden&&api.state().frontTimer===0,'startup opens playing cover without timeout');

  const compilationAlbum=api.state().albums.find(album=>album?.[6]===20);
  const originalAlbumArtist=compilationAlbum[1];
  compilationAlbum[1]='Various Artists';
  api.applyStatus({mode:'play',playlist_loop:[{
    album_id:20,album:'Album 020',albumartist:'Various Artists',
    artist:'Cast',title:'Walkaway',duration:215
  }],time:41});
  assert(element('.bf-meta').children[0]?.children[1]?.textContent.includes('Various Artists'),
    'compilation heading retains album artist');
  assert(element('.bf-meta').children[1]?.dataset.prefix==='Walkaway — Cast',
    'compilation now-playing line shows individual track artist');
  compilationAlbum[1]=originalAlbumArtist;
  api.applyStatus({mode:'play',playlist_loop:[{
    album_id:20,album:'Album 020',albumartist:'Artist',
    artist:'Artist',title:'Track',duration:60
  }],time:1});
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

  api.stopFollowing();assert(!preview.hidden,'pin survives scrolling');
  const otherIndex=api.state().albums.findIndex(album=>album[6]!==20);
  api.openFrontPreview(api.state().albums[otherIndex],otherIndex);
  assert(api.state().frontPreviewAlbum[6]!==20&&api.state().frontTimer!==0,'other album can preview while keep-open enabled');
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
  api.applySetting('keepPlayingOpen',false);api.stopFollowing();assert(preview.hidden,'off restores dismissal');
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
  assert(window.__lyrionCarouselSettings.keepPlayingOpen===true,'keep-open defaults on');
  assert(window.__lyrionCarouselSettings.idle===45000&&window.__lyrionCarouselSettings.random===2000,'unsaved settings respect runtime defaults');
  const keep=element('.bf-keep-playing-open');keep.value='false';keep.listeners.change[0]();
  assert(storage.get('albumBrowserKeepPlayingOpen')==='false','keep-open choice persisted');
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
  api.browseWithArrow(1);
  assert(api.state().frontPreviewAlbum===api.state().albums[6],'right arrow advances open cover');
  api.browseWithArrow(1);
  assert(api.state().frontPreviewAlbum===api.state().albums[7],'repeated arrow advances before animation finishes');
  api.browseWithArrow(-1);
  assert(api.state().frontPreviewAlbum===api.state().albums[6],'left arrow reverses open preview');
  api.openFrontPreview(api.state().albums.at(-1),api.state().albums.length-1);
  api.browseWithArrow(1);
  assert(api.state().frontPreviewAlbum===api.state().albums[0],'keyboard preview wraps around catalogue');
  api.closeFrontPreview();api.browseWithArrow(1);
  assert(preview.hidden,'closed covers stay closed on arrow navigation');
  api.set({playing:true,playingAlbumId:20});
  const pinnedIndex=api.state().albums.findIndex(a=>a[6]===20);
  api.openFrontPreview(api.state().albums[pinnedIndex],pinnedIndex);api.browseWithArrow(1);
  assert(api.state().frontPreviewAlbum===api.state().albums[(pinnedIndex+1)%api.state().albums.length],'arrow browses away from pinned playing cover');
  assert(rpcCalls.filter(c=>c[0]==='playlistcontrol').length===playbackCalls,'keyboard previews do not start playback');
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
  assert(sources.app.includes("'tags:altng'")&&sources.app.includes('trackGenres'),'LMS Album Information requests and aggregates track genre metadata');
  return checks;
}

if (typeof process !== 'undefined' && process.argv?.[1]?.endsWith('regressions.mjs')) {
  const {readFile}=await import('node:fs/promises');
  const sources={};for(const name of ['app','browser','catalogue','lms','settings','spotify'])sources[name]=await readFile(new URL('../js/'+name+'.js',import.meta.url),'utf8');
  sources.lmsProvider=await readFile(new URL('../js/providers/lms-provider.js',import.meta.url),'utf8');
  sources.index=await readFile(new URL('../index.html',import.meta.url),'utf8');
  sources.albumBrowserCss=await readFile(new URL('../css/album-browser.css',import.meta.url),'utf8');
  console.log(`${await runTests(sources)} regression checks passed`);
}
