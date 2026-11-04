import { rpc, CometDClient, resetRpcSession } from './lms.js?v=track-artist-roles-1';
import { buildAlbumPositionIndex, locateAlbum as locateIndexedAlbum } from './catalogue.js?v=display-choice-1';
import { clamp, modulo, circularDelta, nearestPositionForIndex as nearestPosition } from './browser.js?v=display-choice-1';
import { createLmsProvider } from './providers/lms-provider.js?v=providers-1';
import { createSpotifyProvider } from './providers/spotify-provider.js?v=providers-1';
import { spotifyAlbumInformation } from './spotify.js?v=album-details-1';

const root=document.getElementById('book-fan-browser'),sourceButtons=[...document.querySelectorAll('.bf-source-button')],stage=root.querySelector('.bf-stage'),meta=root.querySelector('.bf-meta'),play=root.querySelector('.bf-play'),previousTrack=root.querySelector('.bf-previous'),nextTrack=root.querySelector('.bf-next'),queueOpen=root.querySelector('.bf-queue-open'),randomPlay=root.querySelector('.bf-random'),orderToggle=root.querySelector('.bf-order-toggle'),orderMenu=root.querySelector('.bf-order-menu'),frontPreview=root.querySelector('.bf-front-preview'),frontArt=root.querySelector('.bf-front-art'),frontPlay=root.querySelector('.bf-front-play'),connectionLabel=root.querySelector('.bf-connection-label'),playerSelect=root.querySelector('.bf-player-select'),powerButton=root.querySelector('.bf-player-power'),searchOpen=root.querySelector('.bf-search-open'),searchOverlay=root.querySelector('.bf-search-overlay'),searchClose=root.querySelector('.bf-search-close'),searchInput=root.querySelector('.bf-search-input'),searchStatus=root.querySelector('.bf-search-status'),searchResults=root.querySelector('.bf-search-results'),alphabet=root.querySelector('.bf-alphabet');
stage.classList.add('bf-shelf-active');
let connectionGeneration=0,appStarted=false,artworkNamespace='',catalogueSource='library',libraryRefreshPending=false,libraryRefreshing=false,genreRefreshPending=false,disabledGenres=new Set();
let COVER_SIZE=512;
let PAGE_SIZE=40,DISPLAY_ALBUM_COUNT=30,IDLE_RETURN_MS=30000,MENU_TIMEOUT_MS=10000,FRONT_TIMEOUT_MS=10000,RECONNECT_MAX_MS=30000,RANDOM_SCROLL_MAX_MS=3000,SEARCH_LIMIT=100;
const demoAlbums=[['Night Geometry','The Meridian','linear-gradient(145deg,#0f3155,#d14e45)','rgba(244,190,76,.9)','8%','18deg'],['Blue Hours','Harbour Lights','linear-gradient(145deg,#0e223a,#458ca5)','linear-gradient(90deg,#d5eef0 48%,#193a61 48%)','2px','-12deg'],['Still Moving','Northbound','linear-gradient(145deg,#4b1f2c,#de8a55)','rgba(30,16,24,.72)','50%','0deg'],['Parallel Lines','Signal Path','linear-gradient(145deg,#e8dfca,#9c2828)','repeating-linear-gradient(90deg,#181818 0 9px,transparent 9px 18px)','0','24deg'],['After Image','Low Season','linear-gradient(145deg,#192019,#557557)','radial-gradient(circle at 35% 35%,#e0c895 0 12%,transparent 13%),radial-gradient(circle,#182219 0 48%,transparent 49%)','50%','0deg']];
let playerPower=null,powerPending=false;let playingSource='unknown',albums=demoAlbums.slice(),orderMode='artistAlbum',desiredOrderMode='artistAlbum',orderBusy=false,nodes=[],renderedWindowAnchor=-1,renderedWindowCount=0,prefetchedWindowPage=-1,playerId='',playingAlbumId=null,progressTimer=0,reconnectTimer=0,reconnectDelay=1000,connecting=false,totalAlbums=albums.length,libraryAlbumCount=albums.length,liveCatalogue=false,loadedBatches=new Set(),loadingBatches=new Map(),catalogueGeneration=0,albumPositionById=new Map(),positionIndexPromise=null,nowAlbumTitle='',nowAlbumArtist='',nowTrackTitle='',nowTrackArtist='',nowTrackNumber='',playbackSeconds=0,trackDuration=0,statusUpdatedAt=performance.now(),searchTimer=0,searchToken=0,idleTimer=0,idleReturnAlbumId=null,lastActivityAt=Date.now();
const SPINE_META_CACHE_LIMIT=1024,SPINE_META_QUEUE_LIMIT=256;
const spineMetaCache=new Map(),spineMetaPending=new Map(),spineMetaBatchQueue=new Map();
let spineMetaBatchTimer=0,spineMetaBatchesActive=0,spineMetaGeneration=0;
const albumIndexCache=new Map();
function rememberSpineMeta(url,meta){
    if(!url||!meta)return;
    spineMetaCache.delete(url);spineMetaCache.set(url,meta);
    while(spineMetaCache.size>SPINE_META_CACHE_LIMIT)spineMetaCache.delete(spineMetaCache.keys().next().value);
}
function clearSpineMetadata(){
    spineMetaGeneration++;clearTimeout(spineMetaBatchTimer);spineMetaBatchTimer=0;
    // In-flight old-generation requests may still finish, but must not
    // throttle metadata for a newly selected LMS or cleared artwork cache.
    spineMetaBatchesActive=0;
    for(const job of spineMetaBatchQueue.values())job.resolve(null);
    spineMetaBatchQueue.clear();spineMetaCache.clear();spineMetaPending.clear();
}
function indexForAlbumId(id){
    if(id===null||id===undefined)return -1;
    const key=String(id),cached=albumIndexCache.get(key);
    if(cached!==undefined&&albums[cached]&&String(albums[cached][6])===key)return cached;
    const found=albums.findIndex(album=>album&&String(album[6])===key);
    if(found<0)albumIndexCache.delete(key);else albumIndexCache.set(key,found);
    return found;
}
// Letter navigation is an O(1) lookup once the ordered catalogue is loaded.
// The minimum index is retained because batches can arrive out of order.
const alphabetIndex=new Map();
function indexAlbumLetter(album,index){
    const letter=String(album?.[9]||'').trim().charAt(0).toUpperCase();
    if(!/^[A-Z]$/.test(letter))return;
    const previous=alphabetIndex.get(letter);
    if(previous===undefined||index<previous)alphabetIndex.set(letter,index);
}
function rebuildAlbumIndex(){
    albumIndexCache.clear();
    alphabetIndex.clear();
    albums.forEach((album,index)=>{
        if(album?.[6]!=null)albumIndexCache.set(String(album[6]),index);
        if(album)indexAlbumLetter(album,index);
    });
}
let position=4,target=4,dragging=false,moved=false,startX=0,startPosition=0,pressedAlbumIndex=null,hoveredAlbumIndex=-1,frontPreviewIndex=-1,frontPreviewAlbum=null,lastPointerClientX=-1,lastPointerClientY=-1,lastX=0,lastTime=0,pointerVelocity=0,playing=false,randomAnimating=false,randomAnimationStart=0,randomAnimationFrom=0,randomAnimationTo=0,randomAnimationDuration=0,raf=0,wheelTimer=0,lastSelected=-1;
const selectedIndex=()=>modulo(Math.round(position),totalAlbums),nearestPositionForIndex=index=>nearestPosition(index,position,totalAlbums);
function emitStatus(){window.dispatchEvent(new Event('lyrion-carousel-status'))}function setConnection(label,connected){connectionLabel.textContent=label;root.dataset.connected=connected?'true':'false';emitStatus()}function albumCountLabel(){return totalAlbums<libraryAlbumCount?totalAlbums+' / '+libraryAlbumCount+' albums':totalAlbums+' albums'}function updateBusyState(){const unavailable=!playerId;powerButton.disabled=unavailable||powerPending||playerPower===null;randomPlay.disabled=randomAnimating||orderBusy||libraryRefreshing||unavailable||!totalAlbums;orderToggle.disabled=orderBusy||randomAnimating||libraryRefreshing;play.disabled=previousTrack.disabled=nextTrack.disabled=queueOpen.disabled=unavailable}function batchCount(){return Math.max(1,Math.ceil(totalAlbums/PAGE_SIZE))}
function mapLyrionAlbum(album){const artworkId=album.artwork_track_id,artworkUrl=artworkId?'/api/art/'+encodeURIComponent(artworkId)+'?size='+COVER_SIZE+'&case=realistic-v1&server='+artworkNamespace:'',artworkMetaUrl=artworkId?'/api/art-meta/'+encodeURIComponent(artworkId)+'?v=5&server='+artworkNamespace:'';if(album.spine_metadata?.text_style_version===3)rememberSpineMeta(artworkMetaUrl,album.spine_metadata);return[album.album||album.title||'Untitled',album.artist||'Unknown artist',artworkUrl?`url("${artworkUrl}") center / contain no-repeat`:'linear-gradient(145deg,#303030,#111)','transparent','0','0deg',album.id,true,artworkUrl,album.textkey||'',album.year||'',artworkMetaUrl,album.spine_metadata?.colour_index]}
function mapSpotifyAlbum(album){const artworkUrl=album.artwork?'/api/spotty-art?path='+encodeURIComponent(album.artwork)+'&size='+COVER_SIZE+'&case=realistic-v1':'',artworkMetaUrl=album.artwork?'/api/spotty-art-meta?version=3&path='+encodeURIComponent(album.artwork):'';return[album.title||'Untitled',album.artist||'Unknown artist',artworkUrl?`url("${artworkUrl}") center / contain no-repeat`:'linear-gradient(145deg,#303030,#111)','transparent','0','0deg','spotify:'+album.spottyItemId,true,artworkUrl,'',album.year||'',artworkMetaUrl,undefined,'spotify',album.spottyItemId]}
const lmsProvider=createLmsProvider({
    mapAlbum:mapLyrionAlbum,getPlayerId:()=>playerId,getPageSize:()=>PAGE_SIZE,getSearchLimit:()=>SEARCH_LIMIT,
    getDisabledGenres:()=>disabledGenres,getOrderMode:()=>orderMode,getLibraryCount:()=>libraryAlbumCount,
    setLibraryCount:value=>{libraryAlbumCount=value},getPositionIndex:()=>albumPositionById,setPositionIndex:value=>{albumPositionById=value}
});
const spotifyProvider=createSpotifyProvider({mapAlbum:mapSpotifyAlbum,getPlayerId:()=>playerId});
const catalogueProviders={library:lmsProvider,spotify:spotifyProvider};
const currentProvider=()=>catalogueProviders[catalogueSource];

async function loadSpotifyCatalogue(){
    setConnection('Loading Spotify albums…',true);
    const result=await spotifyProvider.load();
    albums=result.albums;totalAlbums=result.total;libraryAlbumCount=result.libraryCount;catalogueGeneration++;liveCatalogue=result.live;rebuildAlbumIndex();
    loadedBatches=new Set();loadingBatches=new Map();albumPositionById=new Map();positionIndexPromise=null;prefetchedWindowPage=-1;
    orderMode=desiredOrderMode='artistAlbum';
    position=target=0;hoveredAlbumIndex=-1;lastSelected=-1;closeFrontPreview();renderAlbums();draw();setConnection(albumCountLabel()+' · Spotify',true);
}

function updateSourceButtons(){sourceButtons.forEach(button=>{const active=button.dataset.source===catalogueSource;button.classList.toggle('is-active',active);button.setAttribute('aria-pressed',String(active))})}

async function setCatalogueSource(source){
    if(source===catalogueSource||orderBusy||libraryRefreshing)return;
    const previous=catalogueSource;catalogueSource=source==='spotify'?'spotify':'library';updateSourceButtons();sourceButtons.forEach(b=>b.disabled=true);
    try{
        if(catalogueSource==='spotify')await loadSpotifyCatalogue();else await loadInitialCatalogue();
        try{localStorage.setItem('albumBrowserSource',catalogueSource)}catch(_){}
        // A source switch replaces the catalogue, so resolve Now Playing again
        // against the newly loaded source. If that album exists here, move
        // straight to it and open/pin its jewel case.
        if(playing){
            let i=playingCarouselIndex();
            if(i<0&&catalogueSource==='library'&&playingAlbumId)i=await locateAlbum(playingAlbumId,false);
            if(i>=0){
                followingNowPlaying=false;cancelFollowAnimation();pinnedRequest++;
                closeFrontPreview(true);
                const arrived=await scrollToAlbumIndex(i);
                if(arrived){
                    position=target=nearestPositionForIndex(i);
                    renderAlbums();draw();openFrontPreview(albums[i],i);
                }
            }else{
                // Now Playing does not belong to the newly selected catalogue:
                // don't leave the previous library's pinned cover on screen.
                followingNowPlaying=false;cancelFollowAnimation();pinnedRequest++;
                closeFrontPreview(true);updateMeta(true);
            }
        }
    }
    catch(error){catalogueSource=previous;updateSourceButtons();setConnection(error.message||'Could not change music source',false)}
    finally{sourceButtons.forEach(b=>b.disabled=false);updateBusyState()}
}

const orderLabels={artistAlbum:'Artist / Album',album:'Album',random:'Random',colour:'Colour'};
function updateOrderToggle(){const label=orderLabels[orderMode];orderToggle.dataset.mode=orderMode;orderToggle.title='Album order: '+label;orderToggle.setAttribute('aria-label','Album order: '+label+'. Open order options');orderToggle.setAttribute('aria-expanded',String(!orderMenu.hidden));orderToggle.setAttribute('aria-pressed',String(orderMode==='random'));orderMenu.querySelectorAll('[data-order]').forEach(button=>button.setAttribute('aria-checked',String(button.dataset.order===orderMode)))}
function closeOrderMenu(){orderMenu.hidden=true;updateOrderToggle()}
function openOrderMenu(){closeAlbumMenu();const rect=orderToggle.getBoundingClientRect();orderMenu.hidden=false;orderMenu.style.left=Math.max(12,Math.min(rect.left,window.innerWidth-190))+'px';orderMenu.style.bottom=Math.max(12,window.innerHeight-rect.top+8)+'px';updateOrderToggle();orderMenu.querySelector(`[data-order="${orderMode}"]`)?.focus()}
async function setDisplayOrder(mode){
    if(catalogueSource==='spotify'){
        if(!Object.prototype.hasOwnProperty.call(orderLabels,mode))return;
        const selected=albums[selectedIndex()]?.[6]; orderMode=desiredOrderMode=mode;
        if(mode==='random')albums.sort(()=>Math.random()-.5);
        else if(mode==='colour')mode='artistAlbum';
        if(mode!=='random')albums.sort((a,b)=>(mode==='album'?(a[0]+'\0'+a[1]):(a[1]+'\0'+a[0])).localeCompare(mode==='album'?(b[0]+'\0'+b[1]):(b[1]+'\0'+b[0])));
        rebuildAlbumIndex();const i=indexForAlbumId(selected);position=target=i>=0?i:0;updateOrderToggle();renderAlbums();draw();return;
    }
    if(orderBusy||randomAnimating||!Object.prototype.hasOwnProperty.call(orderLabels,mode))return;
    const generation=catalogueGeneration,selected=albums[selectedIndex()]?.[6];
    orderBusy=true;cancelFollowAnimation();updateBusyState();
    try{
        connectionLabel.textContent='Preparing album order…';
        const query=new URLSearchParams({order:mode});
        for(const genreId of disabledGenres)query.append('exclude_genre_id',genreId);
        const response=await fetch('/api/catalogue?'+query,{cache:'no-store'});
        if(!response.ok)throw Error('Could not prepare catalogue; restart the updated server');
        const result=await response.json();
        if(generation!==catalogueGeneration)return;
        albums=(result.albums_loop||[]).map(mapLyrionAlbum);totalAlbums=albums.length;libraryAlbumCount=Number(result.library_count)||Math.max(libraryAlbumCount,totalAlbums);rebuildAlbumIndex();
        loadedBatches=new Set(Array.from({length:batchCount()},(_,i)=>i));
        orderMode=desiredOrderMode=mode;
        try{localStorage.setItem('albumBrowserOrderMode',mode)}catch(_){}
        updateOrderToggle();
        const playingIndex=playing?playingCarouselIndex():-1;
        const nextIndex=playingIndex>=0?playingIndex:selected!=null?indexForAlbumId(selected):selectedIndex();
        if(nextIndex>=0)position=target=nextIndex;
        hoveredAlbumIndex=-1;lastSelected=-1;renderAlbums();draw();
        if(playingIndex>=0)openFrontPreview(albums[playingIndex],playingIndex);
        if(mode==='colour')setConnection(albumCountLabel()+' · colour order',true);
    }finally{
        if(generation===catalogueGeneration){
            orderBusy=false;updateBusyState();
            if(genreRefreshPending){genreRefreshPending=false;setDisplayOrder(orderMode).catch(error=>setConnection(error.message||'Could not filter genres',false))}
            else if(libraryRefreshPending&&!libraryRefreshing&&!randomAnimating){
                handleLibraryEvent();
            }
        }
    }
}
// Keep nearby decoded covers warm without downloading the entire library.
const warmCovers=new Map(),warmingCovers=new Map();
let coverQueue=[],coverWindowKey='';
function prefetchCoverWindow(index){
    if(!totalAlbums)return;
    const urls=[0,1,-1,2,-2,3,-3,4,-4].map(offset=>albums[modulo(index+offset,totalAlbums)]?.[8]).filter(Boolean);
    const key=urls.join('|');if(key===coverWindowKey)return;
    coverWindowKey=key;
    for(const url of urls){if(warmCovers.has(url)){const image=warmCovers.get(url);warmCovers.delete(url);warmCovers.set(url,image)}}
    coverQueue=[...new Set(urls)].filter(url=>!warmCovers.has(url)&&!warmingCovers.has(url));
    pumpCoverQueue();
}
function pumpCoverQueue(){
    while(warmingCovers.size<2&&coverQueue.length){
        const url=coverQueue.shift(),image=new Image();
        warmingCovers.set(url,image);
        image.decoding='async';image.fetchPriority='low';
        const finish=success=>{
            image.onload=image.onerror=null;warmingCovers.delete(url);
            if(success){warmCovers.set(url,image);while(warmCovers.size>24)warmCovers.delete(warmCovers.keys().next().value)}
            pumpCoverQueue();
        };
        image.onload=()=>finish(true);image.onerror=()=>finish(false);image.src=url;
    }
}
function scheduleSpineMetaBatch(){
    if(spineMetaBatchTimer||!spineMetaBatchQueue.size||spineMetaBatchesActive>=2)return;
    spineMetaBatchTimer=setTimeout(()=>{spineMetaBatchTimer=0;flushSpineMetaBatch()},0);
}
async function flushSpineMetaBatch(){
    if(!spineMetaBatchQueue.size||spineMetaBatchesActive>=2)return;
    const jobs=[...spineMetaBatchQueue.values()].slice(0,64);
    for(const job of jobs)spineMetaBatchQueue.delete(job.url);
    spineMetaBatchesActive++;
    const generation=spineMetaGeneration;
    scheduleSpineMetaBatch(); // Up to two batches in flight.
    let result=null;
    try{
        const response=await fetch('/api/art-meta',{
            method:'POST',headers:{'Content-Type':'application/json','X-Lyrion-Request':'1'},
            body:JSON.stringify({artwork_ids:jobs.map(job=>job.id)})
        });
        if(response.ok)result=(await response.json()).metadata||null;
    }catch(_){/* Missing spine metadata must never prevent browsing. */}
    for(const job of jobs){
        const meta=job.generation===spineMetaGeneration?result?.[job.id]||null:null;
        if(meta)rememberSpineMeta(job.url,meta);
        if(spineMetaPending.get(job.url)===job.promise)spineMetaPending.delete(job.url);
        job.resolve(meta);
    }
    if(generation===spineMetaGeneration)spineMetaBatchesActive--;
    scheduleSpineMetaBatch();
}
function fetchSpineMeta(album){
    const url=album?.[11];if(!url)return Promise.resolve(null);
    if(spineMetaCache.has(url)){
        const meta=spineMetaCache.get(url);
        rememberSpineMeta(url,meta);return Promise.resolve(meta);
    }
    if(spineMetaPending.has(url))return spineMetaPending.get(url);
    const match=/^\/api\/art-meta\/([^?]+)/.exec(url);
    let id=null;
    if(match){try{id=decodeURIComponent(match[1])}catch(_){}}
    if(id&&/^[A-Za-z0-9._:@%-]+$/.test(id)){
        let resolve;const promise=new Promise(done=>{resolve=done});
        spineMetaPending.set(url,promise);
        spineMetaBatchQueue.set(url,{url,id,promise,resolve,generation:spineMetaGeneration});
        // Browsing can outrun metadata processing. Drop old, no-longer-visible
        // queued requests instead of retaining one for every library album.
        while(spineMetaBatchQueue.size>SPINE_META_QUEUE_LIMIT){
            const [expiredUrl,expired]=spineMetaBatchQueue.entries().next().value;
            spineMetaBatchQueue.delete(expiredUrl);
            if(spineMetaPending.get(expiredUrl)===expired.promise)spineMetaPending.delete(expiredUrl);
            expired.resolve(null);
        }
        scheduleSpineMetaBatch();
        return promise;
    }
    // Spotify's existing metadata endpoint is not part of the LMS batch API.
    const generation=spineMetaGeneration;
    const pending=fetch(url,{cache:'force-cache'})
        .then(response=>response.ok?response.json():null)
        .then(meta=>{
            if(generation!==spineMetaGeneration)return null;
            if(meta)rememberSpineMeta(url,meta);
            return meta;
        }).catch(()=>null).finally(()=>{
            if(spineMetaPending.get(url)===pending)spineMetaPending.delete(url);
        });
    spineMetaPending.set(url,pending);return pending;
}
function loadSpineMeta(album,element){
    const url=album?.[11],index=element.dataset.index;
    fetchSpineMeta(album).then(meta=>{
        // A pooled element may already represent another album by the time an
        // asynchronous metadata batch finishes. Never recolour the new spine.
        if(element.dataset.index!==index||element._boundAlbum!==album||album[11]!==url)return;
        if(meta?.spine_color)element.style.setProperty('--spine-color',meta.spine_color);
        if(meta?.text_color)element.style.setProperty('--spine-text',meta.text_color);
        if(meta?.spine_font)element.style.setProperty('--spine-font-family',meta.spine_font);
        if(Number.isFinite(meta?.colour_index))album[12]=meta.colour_index;
    });
}
const measuredFrontCase=frontPreview.querySelector('.bf-front-case');
let cachedFrontCaseWidth=null;
function invalidateFrontCaseWidth(){cachedFrontCaseWidth=null}
function frontCaseWidth(){
    if(cachedFrontCaseWidth===null)
        cachedFrontCaseWidth=measuredFrontCase?.getBoundingClientRect().width||0;
    return cachedFrontCaseWidth;
}
function shelfPitch(){return stage.clientWidth/Math.max(1,Math.min(DISPLAY_ALBUM_COUNT,totalAlbums))}
function shelfWindowCount(){
    // An open cover displaces neighbouring spines by up to half its width.
    // Keep enough extra albums beyond both edges to fill that displacement.
    const pitch=shelfPitch();
    const coverWidth=!frontPreview.hidden?frontCaseWidth():0;
    const buffer=Math.ceil(Math.max(0,coverWidth-pitch)/(2*Math.max(1,pitch)))+2;
    return Math.min(albums.length,DISPLAY_ALBUM_COUNT+2*buffer);
}
// Reuse the same bounded DOM pool as the visible window advances. Album
// changes or style switches rebind content; ordinary scrolling moves nodes.
function bindAlbumNode(node,album,index){
    const el=node.el;
    node.index=index;node.album=album;node.order=orderMode;
    node.cachedPitch=null;
    el._boundAlbum=album;
    el.className='bf-album cursor-interaction'+(album[7]?' is-live':'');
    el.role='option';
    el.dataset.index=String(index);
    el.setAttribute('aria-label',album[0]+' by '+(album[1]||'Unknown artist'));
    el.dataset.spineLabel=orderMode==='artistAlbum'?(album[1]||'Unknown artist')+' — '+album[0]:album[0]+' — '+(album[1]||'Unknown artist');
    el.title=el.getAttribute('aria-label');
    el.style.setProperty('--art',album[2]);
    // Reset colours from a previously pooled spine while the new batch loads.
    el.style.setProperty('--spine-color','#202628');
    el.style.setProperty('--spine-text','#f5f2ea');
    el.style.setProperty('--spine-font-family','Arial,Helvetica,sans-serif');
    if(!node.label){
        const label=document.createElement('span');label.className='bf-spine-label';
        el.append(label);node.label=label;
        const shell=document.createElement('img');shell.className='bf-spine-shell';
        shell.src='/assets/jewel-case-spine-v1.svg';shell.alt='';
        shell.setAttribute('aria-hidden','true');shell.draggable=false;
        el.append(shell);
    }
        node.label.textContent=orderMode==='artistAlbum'
            ?(album[1]||'Unknown artist')+' — '+(album[0]||'Untitled')
            :(album[0]||'Untitled')+' — '+(album[1]||'Unknown artist');
        node.label.title=node.label.textContent;
        loadSpineMeta(album,el);
}
function renderAlbums(){
    const count=shelfWindowCount(),anchor=selectedIndex();
    const desired=[];
    for(let offset=0;offset<count;offset++){
        const index=modulo(anchor+offset-Math.floor(count/2),totalAlbums);
        if(albums[index])desired.push(index);
    }
    const desiredSet=new Set(desired);
    const retained=new Map(nodes.filter(node=>desiredSet.has(node.index)).map(node=>[node.index,node]));
    const spare=nodes.filter(node=>!desiredSet.has(node.index));
    const next=[];
    for(const index of desired){
        const album=albums[index];
        let node=retained.get(index);
        if(!node)node=spare.pop()||{el:document.createElement('div'),index:-1,album:null,order:null,cachedPitch:null};
        if(node.album!==album||node.order!==orderMode||node.index!==index){
            bindAlbumNode(node,album,index);
        }
        if(node.el.parentElement!==stage&&node.el.parent!==stage)stage.append(node.el);
        next.push(node);
    }
    spare.forEach(node=>node.el.remove());
    nodes=next;
    renderedWindowAnchor=anchor;renderedWindowCount=count;
}
let shelfDomFrame=0;
function syncShelfDom(){
    shelfDomFrame=0;
    if(!frontPreview.hidden&&frontPreviewAlbum){
        const atIndex=albums[frontPreviewIndex];
        if(atIndex!==frontPreviewAlbum&&
           !(atIndex&&frontPreviewAlbum[6]!=null&&String(atIndex[6])===String(frontPreviewAlbum[6]))){
            frontPreviewIndex=frontPreviewAlbum[6]!=null?
                indexForAlbumId(frontPreviewAlbum[6]):albums.indexOf(frontPreviewAlbum);
        }
    }
    updateShelfWindow();
    if(!nodes.length)return;
    const pitch=shelfPitch(),frontCase=frontPreview.querySelector('.bf-front-case');
    const open=!frontPreview.hidden&&frontPreviewIndex>=0;
    const frontDelta=open?circularDelta(frontPreviewIndex,position,totalAlbums):0;
    const frontWidth=frontCaseWidth();
    // The cover and its gap share the album's shelf coordinate, not the viewport centre.
    if(frontCase)frontCase.style.transform=`translate3d(${frontDelta*pitch}px,0,0)`;
    const gapShift=open?Math.max(0,(frontWidth-pitch)/2):0;
    nodes.forEach(node=>{
        const d=circularDelta(node.index,position,totalAlbums);
        const sideShift=d<frontDelta?-gapShift:d>frontDelta?gapShift:0;
        const hiddenSpine=open&&node.index===frontPreviewIndex;
        node.el.toggleAttribute('data-front-preview',hiddenSpine);
        if(node.cachedPitch!==pitch){
            node.el.style.setProperty('width',pitch+'px','important');
            node.el.style.setProperty('--spine-width',pitch+'px');
            node.el.style.setProperty('--spine-font-size',Math.min(17,Math.max(10,(pitch-8)*.56))+'px');
            node.cachedPitch=pitch;
        }
        node.el.style.setProperty('transform',`translate3d(${d*pitch-pitch/2+sideShift}px,0,0)`,'important');
        node.el.style.zIndex=String(100-Math.round(Math.abs(d)));
        node.el.style.opacity=hiddenSpine?'0':String(clamp(1-Math.max(0,Math.abs(d)-nodes.length*.36)*.12,.18,1));
        node.el.style.pointerEvents=hiddenSpine?'none':Math.abs(d)<nodes.length/2?'auto':'none';
    });
    updateHoveredAlbumFromPoint();
}
const KEEP_PLAYING_OPEN=true;
let pinnedRequest=0;
let frontTimer=0,followingNowPlaying=false,followRequest=0,followAnimation=null;
function playingCarouselIndex(){
    if(!playing)return -1;
    if(playingAlbumId){const i=indexForAlbumId(playingAlbumId);if(i>=0)return i}
    if(catalogueSource==='spotify'&&nowAlbumTitle){
        const norm=v=>String(v||'').trim().toLocaleLowerCase();
        return albums.findIndex(album=>album?.[13]==='spotify'&&norm(album[0])===norm(nowAlbumTitle)&&(!nowAlbumArtist||norm(album[1])===norm(nowAlbumArtist)));
    }
    return -1;
}
function isPlayingCoverPinned(){
    if(!playing||frontPreview.hidden||!frontPreviewAlbum)return false;
    const i=playingCarouselIndex(),current=i>=0?albums[i]:null;
    // Catalogue refreshes and reordering replace album-array objects.
    // Matching the stable album ID prevents a temporary disappearance of
    // the currently playing cover just because its object was rebuilt.
    return !!current&&(frontPreviewAlbum===current||
        (frontPreviewAlbum[6]!=null&&current[6]!=null&&
        String(frontPreviewAlbum[6])===String(current[6])));
}
async function ensurePlayingCover(){
    const request=++pinnedRequest,id=playingAlbumId,generation=catalogueGeneration;
    frontPreview.dataset.pinned=String(isPlayingCoverPinned());
    if(!KEEP_PLAYING_OPEN||!playing)return;
    try{
        let index=playingCarouselIndex();
        if(index<0&&id)index=await locateAlbum(id,false);
        if(request===pinnedRequest&&generation===catalogueGeneration&&KEEP_PLAYING_OPEN&&playing&&index>=0)openFrontPreview(albums[index],index);
    }catch(_){/* A later playback update can retry when the catalogue is available. */}
}
function closeFrontPreview(suppressReopen=false){if(isPlayingCoverPinned()&&!suppressReopen)return;invalidateFrontCaseWidth();cancelFrontPress();clearTimeout(frontTimer);frontTimer=0;frontPreviewIndex=-1;frontPreviewAlbum=null;frontPreview.hidden=true;frontPreview.dataset.visible='false';frontPreview.setAttribute('aria-hidden','true');syncShelfDom();if(!suppressReopen&&KEEP_PLAYING_OPEN&&playing&&playingCarouselIndex()>=0)ensurePlayingCover()}
function openFrontPreview(album,index){if(!album)return;invalidateFrontCaseWidth();clearTimeout(frontTimer);frontPreviewIndex=index;frontPreviewAlbum=album;prefetchCoverWindow(index);frontArt.style.background=album[2];frontPreview.hidden=false;frontPreview.dataset.visible='true';frontPreview.setAttribute('aria-hidden','false');frontPreview.dataset.pinned=String(isPlayingCoverPinned());syncShelfDom();resumeFrontTimeout()}
frontPlay.onclick=async event=>{event.stopPropagation();const album=frontPreviewAlbum;if(!album)return;try{await loadAlbum(album);closeFrontPreview()}catch(_){setConnection('Could not play album',false);scheduleReconnect()}};
// Dismiss from the exposed shelf without opening or playing the spine underneath.
root.addEventListener('pointerdown',event=>{
    if(frontPreview.hidden||isPlayingCoverPinned()||event.button!==0)return;
    // Do not consume a spine's pointerdown: that prevented an explicit spine
    // click from opening its cover when a different preview was visible.
    // Scrolling leaves any open case visible; only its timeout or a new
    // explicit spine selection replaces a manual preview.
    if(event.target!==frontPreview)return;
    event.preventDefault();event.stopPropagation();
    cancelLongPress();followingNowPlaying=false;closeFrontPreview();
},true);
// The enlarged cover is another drag surface for the same shelf, not an
// action button. Hold it for the existing album menu (and Album Information).
const frontCaseElement=frontPreview.querySelector('.bf-front-case');
let frontPress=null,frontPressTimer=0;
function cancelFrontPress(){clearTimeout(frontPressTimer);frontPressTimer=0;frontPress=null}
function resumeFrontTimeout(){clearTimeout(frontTimer);frontTimer=!frontPreview.hidden&&!(playing&&String(frontPreviewAlbum?.[6])===String(playingAlbumId))&&FRONT_TIMEOUT_MS>0?setTimeout(()=>{frontTimer=0;const wasNonPlayingPreview=playing&&playingCarouselIndex()>=0&&!isPlayingCoverPinned();closeFrontPreview(true);if(wasNonPlayingPreview)returnToPlayingAlbum(true)},FRONT_TIMEOUT_MS):0}
frontPreview.addEventListener('pointerdown',event=>{
    if(randomAnimating||frontPress||event.button!==0||!event.target.closest('.bf-front-case')||event.target.closest('button')||!frontPreviewAlbum)return;
    cancelFrontPress();clearTimeout(frontTimer);frontTimer=0;
    const press={id:event.pointerId,x:event.clientX,y:event.clientY,album:frontPreviewAlbum,cancelled:false,long:false,scrolling:false};
    frontPress=press;
    event.target.closest('.bf-front-case').setPointerCapture(event.pointerId);
    frontPressTimer=setTimeout(()=>{
        frontPressTimer=0;
        if(frontPress!==press||press.cancelled||frontPreview.hidden)return;
        press.long=true;openAlbumMenu(press.album,{clientX:press.x,clientY:press.y});
    },550);
});
frontPreview.addEventListener('pointermove',event=>{
    const press=frontPress;
    if(!press||event.pointerId!==press.id||press.long||(press.cancelled&&!press.scrolling))return;
    const dx=event.clientX-press.x,dy=event.clientY-press.y;
    if(Math.hypot(dx,dy)>10){
        press.cancelled=true;
        clearTimeout(frontPressTimer);frontPressTimer=0;
    }
    // Horizontal movement is the same shelf drag as the spines. Do not close
    // the preview mid-gesture: doing so would drop pointer capture.
    if(!press.scrolling&&Math.abs(dx)>10&&Math.abs(dx)>=Math.abs(dy)){
        press.scrolling=true;
        beginShelfDrag({clientX:press.x,pointerId:press.id},null,null);
    }
    if(press.scrolling)moveShelfDrag(event,false);
});
frontPreview.addEventListener('pointerup',event=>{
    const press=frontPress;
    if(!press||event.pointerId!==press.id)return;
    cancelFrontPress();
    if(press.scrolling){
        finishShelfDrag(false);
        // Swiping the enlarged cover only moves the shelf. Both playing and
        // manually selected cases remain open until their normal transition.
    }
    // A short click intentionally performs no action.
    resumeFrontTimeout();
});
function cancelFrontGesture(event){
    if(!frontPress||event.pointerId!==frontPress.id)return;
    const wasScrolling=frontPress.scrolling;
    cancelFrontPress();
    if(wasScrolling)finishShelfDrag(true);
    resumeFrontTimeout();
}
frontPreview.addEventListener('pointercancel',cancelFrontGesture);
frontPreview.addEventListener('lostpointercapture',cancelFrontGesture);
// The album menu is the keyboard/context-menu equivalent of long-press.
// Enter/Space are deliberately inert on the cover itself.
frontCaseElement.addEventListener('contextmenu',event=>{
    if(frontPreview.hidden||!frontPreviewAlbum||event.target.closest('button'))return;
    event.preventDefault();
    openAlbumMenu(frontPreviewAlbum,{clientX:event.clientX,clientY:event.clientY});
});
frontCaseElement.addEventListener('keydown',event=>{
    if(event.key!=='ContextMenu'&&!(event.key==='F10'&&event.shiftKey))return;
    if(frontPreview.hidden||!frontPreviewAlbum)return;
    event.preventDefault();
    openAlbumMenu(frontPreviewAlbum,{clientX:window.innerWidth/2,clientY:window.innerHeight/2});
});
let lastHoverProbeAt=-Infinity;
function updateHoveredAlbumFromPoint(force=false){
    // Hit testing can force layout. During animation, sample hover at ~30 Hz
    // rather than on every frame; pointer movement always updates immediately.
    const now=performance.now();
    if(!force&&now-lastHoverProbeAt<32)return;
    lastHoverProbeAt=now;
    if(lastPointerClientX<0&&hoveredAlbumIndex===-1)return;
    let index=-1;
    if(lastPointerClientX>=0){
        const hit=document.elementFromPoint(lastPointerClientX,lastPointerClientY);
        const element=hit?.closest?.('.bf-album');
        if(element&&stage.contains(element))index=Number(element.dataset.index);
        else if(hit?.closest?.('.bf-front-case')&&!frontPreview.hidden)index=frontPreviewIndex;
        else if(hit===frontPreview){
            const node=nodes.find(({el})=>{
                const rect=el.getBoundingClientRect();
                return lastPointerClientX>=rect.left&&lastPointerClientX<rect.right&&lastPointerClientY>=rect.top&&lastPointerClientY<rect.bottom;
            });
            if(node)index=node.index;
        }
    }
    if(!Number.isInteger(index))index=-1;
    if(index!==hoveredAlbumIndex){hoveredAlbumIndex=index;updateMeta(true)}
}
function updateShelfWindow(){if(selectedIndex()!==renderedWindowAnchor||shelfWindowCount()!==renderedWindowCount)renderAlbums()}
function scheduleShelfDom(){if(!shelfDomFrame)shelfDomFrame=requestAnimationFrame(syncShelfDom)}
window.addEventListener('resize',()=>{invalidateFrontCaseWidth();scheduleShelfDom()});new ResizeObserver(()=>{invalidateFrontCaseWidth();scheduleShelfDom()}).observe(measuredFrontCase);root.addEventListener('pointermove',scheduleShelfDom,{capture:true,passive:true});root.addEventListener('pointerup',scheduleShelfDom,{capture:true});root.addEventListener('wheel',scheduleShelfDom,{capture:true,passive:true});document.addEventListener('keydown',scheduleShelfDom,{capture:true});setTimeout(scheduleShelfDom,0);
async function ensurePositionIndex(){if(albumPositionById.size)return albumPositionById;if(positionIndexPromise)return positionIndexPromise;const generation=catalogueGeneration;positionIndexPromise=buildAlbumPositionIndex(rpc,totalAlbums,generation,()=>catalogueGeneration,PAGE_SIZE).then(index=>{if(index&&generation===catalogueGeneration)albumPositionById=index;return index}).finally(()=>{if(generation===catalogueGeneration)positionIndexPromise=null});return positionIndexPromise}
async function loadRuntimeConfig(){try{const r=await fetch('/api/config',{cache:'no-store'});if(!r.ok)throw 0;const c=await r.json(),pos=(v,f)=>Number(v)>0?Number(v):f,non=(v,f)=>Number(v)>=0?Number(v):f;artworkNamespace=encodeURIComponent(c.lms_url||'');PAGE_SIZE=pos(c.batch_size,PAGE_SIZE);IDLE_RETURN_MS=non(c.idle_return_ms,IDLE_RETURN_MS);RECONNECT_MAX_MS=pos(c.reconnect_max_ms,RECONNECT_MAX_MS);RANDOM_SCROLL_MAX_MS=pos(c.random_scroll_max_ms,RANDOM_SCROLL_MAX_MS);SEARCH_LIMIT=pos(c.search_limit,SEARCH_LIMIT)}catch(_){}const s=window.__lyrionCarouselSettings||{};stage.classList.add('bf-shelf-active');COVER_SIZE=[128,256,384,512,768,1024].includes(Number(s.coverSize))?Number(s.coverSize):512;DISPLAY_ALBUM_COUNT=Math.max(10,Math.min(60,Number(s.displayCount)||30));try{const saved=localStorage.getItem('albumBrowserOrderMode');desiredOrderMode=['artistAlbum','album','random','colour'].includes(saved)?saved:localStorage.getItem('albumBrowserRandomOrder')==='true'?'random':'artistAlbum'}catch(_){}if(Number.isFinite(Number(s.idle)))IDLE_RETURN_MS=Number(s.idle);if(Number.isFinite(Number(s.frontTimeout)))FRONT_TIMEOUT_MS=Math.max(0,Number(s.frontTimeout)||0);if(Number(s.random)>0)RANDOM_SCROLL_MAX_MS=Number(s.random);if(Number.isFinite(Number(s.menuTimeout)))MENU_TIMEOUT_MS=Math.max(0,Number(s.menuTimeout))}
function applySetting(name,value){if(name==='coverSize'){COVER_SIZE=[128,256,384,512,768,1024].includes(Number(value))?Number(value):512;for(const album of albums){if(!album?.[8])continue;album[8]=album[8].replace(/size=\d+/, 'size='+COVER_SIZE);album[2]=`url("${album[8]}") center / contain no-repeat`;}if(frontPreviewAlbum)frontArt.style.background=frontPreviewAlbum[2];renderAlbums();draw()}else if(name==='displayCount'){DISPLAY_ALBUM_COUNT=Math.max(10,Math.min(60,Number(value)||30));renderAlbums();draw()}else if(name==='frontTimeout'){FRONT_TIMEOUT_MS=Math.max(0,Number(value)||0);if(!frontPreview.hidden){resumeFrontTimeout()}}else if(name==='idle'){IDLE_RETURN_MS=Math.max(0,Number(value)||0);armIdleReturn()}else if(name==='menuTimeout'){MENU_TIMEOUT_MS=Math.max(0,Number(value)||0);if(typeof albumMenu!=='undefined'&&!albumMenu.hidden){clearTimeout(menuIdleTimer);menuIdleTimer=MENU_TIMEOUT_MS>0?setTimeout(closeAlbumMenu,MENU_TIMEOUT_MS):0}}else if(name==='random'){const n=Number(value);if(n>0)RANDOM_SCROLL_MAX_MS=n}}
window.addEventListener('lyrion-carousel-setting',e=>applySetting(e.detail?.name,e.detail?.value));
window.addEventListener('lyrion-carousel-genres-change',event=>{
    disabledGenres=new Set(Array.isArray(event.detail?.disabled)?event.detail.disabled:[]);
    if(appStarted&&liveCatalogue){
        genreRefreshPending=true;
        if(!orderBusy){genreRefreshPending=false;setDisplayOrder(orderMode).catch(error=>setConnection(error.message||'Could not filter genres',false))}
    }
});
window.addEventListener('lyrion-carousel-lms-change',event=>{
    resetRpcSession();connectionGeneration++;catalogueGeneration++;pinnedRequest++;
    artworkNamespace=encodeURIComponent(event.detail?.lmsUrl||'');
    cometd.stop();resetReconnect();clearInterval(progressTimer);clearTimeout(idleTimer);
    cancelFollowAnimation();playing=false;playingAlbumId=null;closeFrontPreview();
    closeSearch();closeAlbumMenu();closeTrackList();
    connecting=false;playerId='';liveCatalogue=false;orderBusy=false;randomAnimating=false;randomAnimationDuration=0;randomPlay.classList.remove('is-busy');
    albumPositionById=new Map();positionIndexPromise=null;prefetchedWindowPage=-1;
    clearSpineMetadata();
    if(appStarted){setConnection('Connecting to Lyrion Music Server…',false);connectLyrion()}
});
window.addEventListener('lyrion-carousel-cache-cleared',()=>{
    artworkNamespace=artworkNamespace.split('&cache=')[0]+'&cache='+Date.now();
    clearSpineMetadata();handleLibraryEvent();
});
function scheduleReconnect(){if(reconnectTimer)return;const delay=reconnectDelay;setConnection('Reconnecting to Lyrion Music Server in '+Math.ceil(delay/1000)+'s…',false);reconnectTimer=setTimeout(()=>{reconnectTimer=0;connectLyrion()},delay);reconnectDelay=Math.min(reconnectDelay*2,RECONNECT_MAX_MS)}function resetReconnect(){clearTimeout(reconnectTimer);reconnectTimer=0;reconnectDelay=1000}
function storeBatch(batchNumber,result,render=true){const normal=modulo(batchNumber,batchCount()),start=normal*PAGE_SIZE,batch=(result.albums_loop||[]).map(mapLyrionAlbum);batch.forEach((a,o)=>{if(start+o<albums.length){albums[start+o]=a;if(a?.[6]!=null)albumIndexCache.set(String(a[6]),start+o);indexAlbumLetter(a,start+o)}});loadedBatches.add(normal);if(render){renderAlbums();draw()}return batch}
async function fetchBatch(batchNumber,render=true){if(!liveCatalogue||!totalAlbums)return[];const normal=modulo(batchNumber,batchCount());if(loadedBatches.has(normal)){const start=normal*PAGE_SIZE;return albums.slice(start,Math.min(start+PAGE_SIZE,totalAlbums))}if(loadingBatches.has(normal))return loadingBatches.get(normal);const generation=catalogueGeneration,promise=(async()=>{const start=normal*PAGE_SIZE,result=await rpc('0',['albums',start,PAGE_SIZE,'sort:artflow','tags:ajlysg']);if(generation!==catalogueGeneration)return[];return storeBatch(normal,result,render)})().finally(()=>{if(loadingBatches.get(normal)===promise)loadingBatches.delete(normal)});loadingBatches.set(normal,promise);return promise}
function prefetchAround(index){if(!liveCatalogue||!totalAlbums)return;const b=Math.floor(modulo(index,totalAlbums)/PAGE_SIZE);if(b===prefetchedWindowPage)return;prefetchedWindowPage=b;[-1,0,1].forEach(o=>fetchBatch(b+o).catch(()=>{if(prefetchedWindowPage===b)prefetchedWindowPage=-1}))}async function locateAlbum(id,render=true){const found=indexForAlbumId(id);if(found>=0)return found;await ensurePositionIndex();return locateIndexedAlbum(id,albums,albumPositionById,PAGE_SIZE,b=>fetchBatch(b,render))}
async function loadInitialCatalogue(){
    const connection=connectionGeneration;
    const result=await rpc('0',['albums',0,PAGE_SIZE,'sort:artflow','tags:ajlysg']);
    if(connection!==connectionGeneration)return;
    const first=(result.albums_loop||[]).map(mapLyrionAlbum);
    libraryAlbumCount=Number(result.count)||first.length;
    totalAlbums=libraryAlbumCount;
    if(!totalAlbums)throw Error('No albums');
    albums=new Array(totalAlbums);first.forEach((a,i)=>albums[i]=a);rebuildAlbumIndex();
    loadedBatches=new Set([0]);loadingBatches=new Map();catalogueGeneration++;
    orderBusy=false;albumPositionById=new Map();positionIndexPromise=null;prefetchedWindowPage=-1;
    liveCatalogue=true;root.dataset.catalogueSource=result.__lyrionCache?'cache':'live';
    await setDisplayOrder(desiredOrderMode);
    lastSelected=-1;
}
async function refreshCatalogue({invalidate=true}={}){
    // Explicit/manual refreshes can invalidate the snapshot. An observed LMS
    // scan has already been reconciled by Carousel's own server and must use
    // that freshly prepared snapshot instead of scanning LMS twice.
    if(invalidate){
        const response=await fetch('/api/catalogue/invalidate',{method:'POST',headers:{'X-Lyrion-Request':'1'}});
        if(!response.ok)throw Error('Could not invalidate the catalogue snapshot');
    }
    const connection=connectionGeneration,anchor=albums[selectedIndex()]?.[6];
    const previousOrder=albums.filter(Boolean).map(album=>String(album[6]));
    cancelFollowAnimation();
    await loadInitialCatalogue();
    if(connection!==connectionGeneration)return;
    if(orderMode==='random'){
        const ranks=new Map(previousOrder.map((id,index)=>[id,index]));
        albums.sort((a,b)=>(ranks.get(String(a[6]))??Infinity)-(ranks.get(String(b[6]))??Infinity));rebuildAlbumIndex();
    }
    const index=indexForAlbumId(anchor);
    position=target=index>=0?index:modulo(Math.round(position),totalAlbums);
    hoveredAlbumIndex=-1;lastSelected=-1;renderAlbums();draw();ensurePlayingCover();
    setConnection(albumCountLabel()+' · library updated',true);
}
function spotifyPlayingIndex(track,result){
    if(catalogueSource!=='spotify')return -1;
    const remote=result?.remoteMeta||{},artwork=track?.artwork_url||remote.artwork_url||'',albumName=track?.album||remote.album||'',artist=track?.albumartist||track?.artist||remote.artist||'';
    if(artwork){const i=albums.findIndex(a=>a?.[13]==='spotify'&&a?.[8]&&decodeURIComponent(a[8]).includes(artwork));if(i>=0)return i}
    const norm=v=>String(v||'').trim().toLocaleLowerCase();
    return albums.findIndex(a=>a?.[13]==='spotify'&&norm(a[0])===norm(albumName)&&(!artist||norm(a[1])===norm(artist)));
}
function setPlayerPower(value){playerPower=value===1||value==='1'||value===true?true:value===0||value==='0'||value===false?false:null;powerButton.dataset.power=playerPower===null?'unknown':playerPower?'on':'off';powerButton.setAttribute('aria-pressed',String(playerPower===true));const label=playerPower===null?'Player power unavailable':playerPower?'Turn selected player off':'Turn selected player on';powerButton.setAttribute('aria-label',label);powerButton.title=label;updateBusyState()}
async function togglePlayerPower(){if(!playerId||powerPending||playerPower===null)return;const selected=playerId,target=playerPower?0:1;powerPending=true;updateBusyState();try{await rpc(selected,['power',target]);if(selected===playerId){setPlayerPower(target);await refreshStatus()}}catch(_){if(selected===playerId){setConnection('Could not change player power',false);await refreshStatus()}}finally{powerPending=false;updateBusyState()}}
function applyStatus(result){if(!result)return;if(Object.prototype.hasOwnProperty.call(result,'power'))setPlayerPower(result.power);const previousAlbum=playingAlbumId,wasPlaying=playing;playing=result.mode==='play';const currentIndex=Math.max(0,Number(result.playlist_cur_index)||0),track=result.playlist_loop?.find(item=>Number(item['playlist index']??item.playlist_index)===currentIndex)||result.playlist_loop?.[currentIndex]||result.playlist_loop?.[0];if(track){const remote=result.remoteMeta||{};playingSource=(result.remote||remote.id||(/^spotify:/i.test(String(track.url||track.uri||''))))?'spotify':(track.album_id||remote.album_id?'library':'unknown');const spotifyIndex=spotifyPlayingIndex(track,result);playingAlbumId=track.album_id||remote.album_id||(spotifyIndex>=0?albums[spotifyIndex][6]:null);nowAlbumTitle=track.album||remote.album||track.remote_title||result.current_title||track.title||'';nowAlbumArtist=track.albumartist||track.artist||remote.artist||track.remote_artist||'';nowTrackTitle=track.title||remote.title||track.remote_title||result.current_title||'';nowTrackArtist=track.trackartist||track.artist||remote.trackartist||remote.artist||track.remote_artist||'';nowTrackNumber=track.tracknum||'';playbackSeconds=Number(result.time)||0;trackDuration=Number(track.duration||result.duration)||0;statusUpdatedAt=performance.now()}else{playingSource='unknown';playingAlbumId=null;nowAlbumTitle=nowAlbumArtist='';nowTrackTitle=nowTrackArtist=nowTrackNumber='';playbackSeconds=trackDuration=0}setConnection(albumCountLabel(),true);updateMeta(true);if(wasPlaying&&!playing&&frontPreviewAlbum&&String(frontPreviewAlbum[6])===String(previousAlbum)){pinnedRequest++;closeFrontPreview()}if(connecting)return;if(KEEP_PLAYING_OPEN&&(wasPlaying!==playing||String(previousAlbum)!==String(playingAlbumId)||frontPreview.hidden))ensurePlayingCover();else frontPreview.dataset.pinned=String(isPlayingCoverPinned());if(!playing){cancelFollowAnimation();followingNowPlaying=false}if(wasPlaying!==playing||String(previousAlbum)!==String(playingAlbumId))resumeFrontTimeout();const carouselPlayingIndex=playingCarouselIndex(),carouselPlayingId=carouselPlayingIndex>=0?String(albums[carouselPlayingIndex]?.[6]||''):'';if(playing&&carouselPlayingIndex>=0&&String(previousAlbum)!==String(playingAlbumId)&&(followingNowPlaying||KEEP_PLAYING_OPEN)){returnToPlayingAlbum(true);return}if(carouselPlayingIndex>=0&&String(idleReturnAlbumId||'')!==carouselPlayingId&&Date.now()-lastActivityAt>=IDLE_RETURN_MS)armIdleReturn(0)}
async function getStatus(trackCount=1){if(!playerId)return null;return rpc(playerId,['status','-',trackCount,'tags:alJenKNRA'])}
async function refreshStatus(){
    if(!playerId)return;
    const expectedPlayer=playerId,connection=connectionGeneration;
    try{const status=await getStatus();if(expectedPlayer===playerId&&connection===connectionGeneration)applyStatus(status)}
    catch(_){if(expectedPlayer===playerId&&connection===connectionGeneration){setConnection('Lyrion Music Server connection lost',false);scheduleReconnect()}}
}
async function selectStartupAlbum(status){
    stopFollowing();applyStatus(status);
    clearTimeout(idleTimer);idleTimer=0;
    if(playing&&playingAlbumId){
        position=target=modulo(Math.round(position),totalAlbums);
        hoveredAlbumIndex=-1;lastSelected=-1;renderAlbums();draw();
        root.classList.remove('is-starting');root.dataset.ready='true';
        await returnToPlayingAlbum(true);
        prefetchAround(selectedIndex());
        return;
    }
    const index=Math.floor(Math.random()*totalAlbums);
    await fetchBatch(Math.floor(index/PAGE_SIZE),false);
    position=target=modulo(Math.round(position),totalAlbums);
    hoveredAlbumIndex=-1;lastSelected=-1;renderAlbums();draw();
    root.classList.remove('is-starting');root.dataset.ready='true';
    await scrollToAlbumIndex(index);
    prefetchAround(selectedIndex());
}
async function handleLibraryEvent(){
    // This is a passive LMS status observation, not a command from LMS.
    // Carousel independently checks whether its library has changed.
    libraryRefreshPending=true;
    if(libraryRefreshing||randomAnimating||orderBusy)return;
    libraryRefreshing=true;updateBusyState();
    try{
        while(libraryRefreshPending){
            libraryRefreshPending=false;
            const connection=connectionGeneration;
            const response=await fetch('/api/catalogue/reconcile',{method:'POST',headers:{'X-Lyrion-Request':'1'}});
            if(!response.ok)throw Error('Could not check the LMS catalogue');
            const result=await response.json();
            if(connection!==connectionGeneration)return;
            // Genre membership can change after a scan even when the album
            // records remain identical, so active filters warrant a refresh.
            if(!result.changed&&!disabledGenres.size)continue;
            if(!liveCatalogue||catalogueSource==='spotify')continue;
            await refreshCatalogue({invalidate:false});
        }
    }catch(_){scheduleReconnect()}
    finally{libraryRefreshing=false;updateBusyState()}
}
const cometd=new CometDClient(applyStatus,state=>{root.dataset.liveUpdates=state==='live'?'true':state==='connecting'?'connecting':'false';emitStatus();if(state==='connecting')setConnection('Connecting to live updates…',false);else if(state==='live')setConnection(albumCountLabel()+' · live',true);else setConnection('Live updates lost · reconnecting',false)},handleLibraryEvent);
function openSearch(){searchOverlay.hidden=false;searchInput.focus();searchInput.select()}function closeSearch(){searchOverlay.hidden=true;searchToken++;clearTimeout(searchTimer)}function centreAlbumIndex(index,animate=true){if(randomAnimating||!Number.isFinite(index)||index<0)return;stopFollowing();const destination=nearestPositionForIndex(index);if(animate){target=destination;schedule()}else{position=target=destination;draw()}}
async function navigateToAlbum(id){searchStatus.textContent='Locating album…';try{let i=albums.findIndex(album=>album&&String(album[6])===String(id));if(i<0&&catalogueSource!=='spotify')i=await locateAlbum(id);if(i<0)throw 0;closeSearch();followingNowPlaying=false;cancelFollowAnimation();pinnedRequest++;if(!isPlayingCoverPinned())closeFrontPreview(true);const arrived=await scrollToAlbumIndex(i);if(arrived){position=target=nearestPositionForIndex(i);renderAlbums();draw()}}catch(_){searchStatus.textContent='That album could not be located.'}}
function renderSearchResults(results){searchResults.replaceChildren();for(const album of results){const b=document.createElement('button');b.className='bf-search-result';b.type='button';const img=document.createElement('img');img.alt='';if(album[8])img.src=album[8];const c=document.createElement('span'),t=document.createElement('strong'),a=document.createElement('span');t.textContent=album[0];a.textContent=album[1];c.append(t,a);b.append(img,c);b.onclick=()=>selectSearchAlbum(album);searchResults.append(b)}}
async function selectSearchAlbum(album){let existing=albums.find(a=>a&&String(a[6])===String(album[6]));if(!existing&&catalogueSource==='spotify'){album[15]='search-preview';albums.push(album);totalAlbums=albums.length;existing=album;catalogueGeneration++;rebuildAlbumIndex();renderAlbums();draw()}const i=albums.indexOf(existing);if(i<0)return;closeSearch();followingNowPlaying=false;cancelFollowAnimation();pinnedRequest++;if(!isPlayingCoverPinned())closeFrontPreview(true);const destination=nearestPositionForIndex(i);const arrived=await scrollToAlbumIndex(i);if(!arrived)return;position=target=destination;hoveredAlbumIndex=-1;lastSelected=-1;renderAlbums();draw()}
async function runSearch(query){const value=query.trim(),token=++searchToken;if(value.length<2){searchResults.replaceChildren();searchStatus.textContent='Type at least two characters.';return}searchStatus.textContent=catalogueSource==='spotify'?'Searching Spotify albums…':'Searching LMS…';try{if(catalogueSource==='spotify'){const result=await spotifyProvider.search(value);if(token!==searchToken)return;const matches=result.albums;renderSearchResults(matches);searchStatus.textContent=matches.length?matches.length+' Spotify album'+(matches.length===1?'':'s'):'No matching Spotify albums.';return}const result=await lmsProvider.search(value);if(token!==searchToken)return;const matches=result.albums;renderSearchResults(matches);searchStatus.textContent=matches.length?matches.length+' matches':'No matching albums.'}catch(error){if(token!==searchToken)return;console.error('Carousel album search failed:',error);const message=String(error?.message||error||'Unknown error');searchStatus.textContent=/LMS server changed during request/.test(message)?'LMS settings changed. Please retry search.':/HTTP 50[234]|Failed to fetch|NetworkError|Load failed/i.test(message)?'Cannot reach LMS search. Check the server connection.':'Album search failed: '+message.slice(0,140);}}
async function jumpToLetter(letter){
    searchStatus.textContent='Finding '+letter+'…';
    const generation=catalogueGeneration;
    const go=()=>{
        const index=alphabetIndex.get(letter);
        if(index===undefined)return false;
        closeSearch();centreAlbumIndex(index);return true;
    };
    if(go())return;
    // The server-prepared ordering is normally complete. Retain the bounded
    // fallback for partially loaded LMS catalogues, but never scan the array
    // after each page: storeBatch updates alphabetIndex incrementally.
    if(catalogueSource==='library'&&liveCatalogue&&loadedBatches.size<batchCount()){
        try{
            for(let b=0;b<batchCount();b++){
                if(generation!==catalogueGeneration)return;
                await fetchBatch(b,false);
                if(generation!==catalogueGeneration)return;
                if(go())return;
            }
        }catch(_){scheduleReconnect();return}
    }
    searchStatus.textContent='No albums under '+letter+'.';
}for(const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'){const b=document.createElement('button');b.className='bf-letter';b.type='button';b.textContent=letter;b.onclick=()=>jumpToLetter(letter);alphabet.append(b)}
function cancelFollowAnimation(){followRequest++;if(followAnimation){const animation=followAnimation;followAnimation=null;target=position;animation.resolve(false)}}
function browseWithArrow(direction){
    if(!totalAlbums||orderBusy||libraryRefreshing)return;
    followingNowPlaying=false;cancelFollowAnimation();pinnedRequest++;
    // Arrow scrolling never closes or replaces an open jewel case.
    target=Math.round(target)+direction;
    schedule();
}
function stopFollowing(){followingNowPlaying=false;cancelFollowAnimation();closeFrontPreview()}
function scrollToAlbumIndex(index){
    const destination=nearestPositionForIndex(index),distance=Math.abs(destination-position);
    if(distance<.015){position=target=destination;draw();return Promise.resolve(true)}
    return new Promise(resolve=>{
        followAnimation={from:position,to:destination,start:performance.now(),duration:Math.min(RANDOM_SCROLL_MAX_MS,Math.max(450,250+distance*45)),resolve};
        target=destination;schedule();
    });
}
function armIdleReturn(delayOverride=null){clearTimeout(idleTimer);if(IDLE_RETURN_MS<=0)return;const elapsed=Date.now()-lastActivityAt,delay=delayOverride===null?Math.max(0,IDLE_RETURN_MS-elapsed):delayOverride;idleTimer=setTimeout(()=>returnToPlayingAlbum(),delay)}
function noteUserActivity(){cancelFollowAnimation();lastActivityAt=Date.now();idleReturnAlbumId=null;armIdleReturn()}
async function returnToPlayingAlbum(immediate=false){
    clearTimeout(idleTimer);idleTimer=0;
    if(!immediate&&Date.now()-lastActivityAt<IDLE_RETURN_MS){armIdleReturn();return}
    if(randomAnimating||dragging||orderBusy||libraryRefreshing||root.querySelector('.bf-settings-overlay:not([hidden])')||!searchOverlay.hidden||!trackOverlay.hidden||!albumMenu.hidden||!orderMenu.hidden){clearTimeout(idleTimer);idleTimer=setTimeout(()=>returnToPlayingAlbum(immediate),1000);return}
    if(!playing)return;
    // A manual preview owns the visible case until its own timeout or the
    // user selects another spine. The idle return must not preempt it.
    if(!frontPreview.hidden&&!isPlayingCoverPinned())return;
    cancelFollowAnimation();
    const request=followRequest,expected=playingAlbumId==null?'':String(playingAlbumId),snapshot=lastActivityAt;
    followingNowPlaying=true;
    try{
        let i=playingCarouselIndex();
        if(i<0&&expected)i=await locateAlbum(expected);
        if(i<0)return;
        const carouselId=String(albums[i]?.[6]||'');idleReturnAlbumId=carouselId;
        if(request!==followRequest||lastActivityAt!==snapshot||!playing||(expected&&playingAlbumId!=null&&String(playingAlbumId)!==expected))return;
        closeSearch();
        // Preserve the SAME enlarged playing cover throughout the idle-return
        // animation. Reposition it via syncShelfDom(), never hide then reopen.
        const playingCover=albums[i];
        if(frontPreview.hidden||frontPreviewAlbum!==playingCover)openFrontPreview(playingCover,i);
        const arrived=await scrollToAlbumIndex(i);
        if(arrived&&request===followRequest&&playing&&(!expected||playingAlbumId==null||String(playingAlbumId)===expected)){
            updateMeta(true);
            if(frontPreview.hidden||frontPreviewAlbum!==albums[i])openFrontPreview(albums[i],i);
        }
    }catch(_){if(request===followRequest){idleReturnAlbumId=null;scheduleReconnect()}}
}
async function loadAlbum(album){if(!playerId||!album?.[6])return;const provider=album[13]==='spotify'?spotifyProvider:lmsProvider;const result=await provider.play(album);if(result?.saved){const selectedId=album[6],catalogue=await spotifyProvider.load();albums=catalogue.albums;totalAlbums=libraryAlbumCount=albums.length;catalogueGeneration++;rebuildAlbumIndex();const i=indexForAlbumId(selectedId);position=target=i>=0?i:0;renderAlbums();draw()}else if(result?.error)setConnection('Playing · could not save album to Spotify library',false);await refreshStatus();setTimeout(refreshStatus,350)}async function togglePlayback(){if(!playerId)return;try{await rpc(playerId,['pause']);await refreshStatus();setTimeout(refreshStatus,250)}catch(_){setConnection('Playback command failed',false);scheduleReconnect()}}
async function skipTrack(direction){if(!playerId)return;try{await rpc(playerId,['playlist','index',direction>0?'+1':'-1']);await refreshStatus();setTimeout(refreshStatus,250)}catch(_){setConnection(direction>0?'Could not play the next track':'Could not play the previous track',false);scheduleReconnect()}}
const albumMenu=root.querySelector('.bf-album-menu'),albumMenuTitle=root.querySelector('.bf-album-menu-title'),clearPlayButton=root.querySelector('.bf-clear-play'),playNowButton=root.querySelector('.bf-play-now'),playNextButton=root.querySelector('.bf-play-next'),addQueueButton=root.querySelector('.bf-add-queue'),trackListOpen=root.querySelector('.bf-track-list-open'),trackOverlay=root.querySelector('.bf-track-overlay'),trackClose=root.querySelector('.bf-track-close'),trackPlayNow=root.querySelector('.bf-track-play-now'),trackTitle=root.querySelector('#bf-track-title'),trackDetails=root.querySelector('.bf-track-details'),trackStatus=root.querySelector('.bf-track-status'),trackList=root.querySelector('.bf-track-list');let menuAlbum=null,menuIdleTimer=0,longPressTimer=0,longPressAlbum=null,longPressX=0,longPressY=0;
root.addEventListener('contextmenu',event=>event.preventDefault());
root.addEventListener('pointerdown',event=>{if(event.button!==0)event.stopPropagation()},true);
document.addEventListener('pointermove',event=>{
    if((event.clientX!==lastPointerClientX||event.clientY!==lastPointerClientY)&&(stage.contains(event.target)||frontPreview.contains(event.target)))noteUserActivity();
    lastPointerClientX=event.clientX;lastPointerClientY=event.clientY;updateHoveredAlbumFromPoint(true);
},{passive:true});
document.addEventListener('pointerout',event=>{
    if(!event.relatedTarget){lastPointerClientX=lastPointerClientY=-1;updateHoveredAlbumFromPoint(true)}
});
function closeAlbumMenu(){clearTimeout(menuIdleTimer);menuIdleTimer=0;albumMenu.hidden=true;menuAlbum=null}
function openAlbumMenu(album,event){closeAlbumMenu();closeOrderMenu();menuAlbum=album;const spotify=album?.[13]==='spotify';playNowButton.hidden=spotify;playNextButton.hidden=spotify;addQueueButton.hidden=spotify;trackListOpen.hidden=false;albumMenuTitle.textContent=album[0]+' — '+album[1];albumMenu.hidden=false;const width=220,left=Math.min(event.clientX,window.innerWidth-width-12),top=Math.min(event.clientY,window.innerHeight-130);albumMenu.style.left=Math.max(12,left)+'px';albumMenu.style.top=Math.max(12,top)+'px';if(MENU_TIMEOUT_MS>0)menuIdleTimer=setTimeout(closeAlbumMenu,MENU_TIMEOUT_MS);playNextButton.focus()}
async function queueAlbum(album,playNext){closeAlbumMenu();if(!playerId||!album?.[6])return;try{let command=['playlistcontrol','cmd:add','album_id:'+album[6]];if(playNext){const status=await getStatus(1000),tracks=status?.playlist_loop||[],currentIndex=Number(status?.playlist_cur_index),currentAlbumId=String(tracks[0]?.album_id||'');let albumTrackCount=0;while(albumTrackCount<tracks.length&&String(tracks[albumTrackCount]?.album_id||'')===currentAlbumId)albumTrackCount++;if(Number.isFinite(currentIndex)&&albumTrackCount>0)command=['playlistcontrol','cmd:insert','index:'+(currentIndex+albumTrackCount),'album_id:'+album[6]]}await rpc(playerId,command);setConnection(playNext?'Album added after the current album':'Album added to queue',true);setTimeout(refreshStatus,350)}catch(_){setConnection('Could not update the playlist',false);scheduleReconnect()}}
async function playAlbumNow(album){closeAlbumMenu();if(!playerId||!album?.[6])return;try{const status=await rpc(playerId,['status',0,1000,'tags:alJen']),tracks=status?.playlist_loop||[],currentIndex=Number(status?.playlist_cur_index),currentTrack=tracks[currentIndex];if(!Number.isFinite(currentIndex)||!currentTrack?.album_id)throw Error('Current album unavailable');const currentAlbumId=String(currentTrack.album_id);let start=currentIndex,end=currentIndex;while(start>0&&String(tracks[start-1]?.album_id||'')===currentAlbumId)start--;while(end+1<tracks.length&&String(tracks[end+1]?.album_id||'')===currentAlbumId)end++;for(let index=end;index>=start;index--)await rpc(playerId,['playlistcontrol','cmd:delete','index:'+index]);await rpc(playerId,['playlistcontrol','cmd:insert','index:0','album_id:'+album[6]]);await rpc(playerId,['playlist','index',0]);await refreshStatus();setTimeout(refreshStatus,350)}catch(_){setConnection('Could not play album now',false);scheduleReconnect()}}
async function clearPlaylistAndPlay(album){closeAlbumMenu();if(!playerId||!album?.[6])return;try{await loadAlbum(album);setConnection('Playlist cleared; playing '+album[0]+' from track 1',true)}catch(_){setConnection('Could not clear playlist and play album',false);scheduleReconnect()}}
let trackRequest=0,trackAlbum=null;
function closeTrackList(){trackRequest++;trackAlbum=null;trackOverlay.hidden=true;trackList.replaceChildren()}
// The LMS track query defaults to title order. Keep disc order, then track
// number, and retain upstream order for missing/ambiguous track numbers.
function albumTrackNumber(value){
    const match=String(value??'').trim().match(/^(\d+)(?:\s*\/\s*\d+)?$/);
    return match&&Number(match[1])>0?Number(match[1]):null;
}
function sortAlbumTracks(tracks){
    return tracks.map((track,index)=>({track,index})).sort((a,b)=>{
        const ad=albumTrackNumber(a.track.disc)??1,bd=albumTrackNumber(b.track.disc)??1;
        if(ad!==bd)return ad-bd;
        const at=albumTrackNumber(a.track.tracknum),bt=albumTrackNumber(b.track.tracknum);
        if(at!==null&&bt!==null&&at!==bt)return at-bt;
        return a.index-b.index;
    }).map(item=>item.track);
}
function distinctTrackArtist(track,albumArtist){
    const artist=String(track?.trackartist||track?.artist||'').trim();
    return artist&&artist.toLocaleLowerCase()!==String(albumArtist||'').trim().toLocaleLowerCase()?artist:'';
}
async function showTrackList(album){
    closeAlbumMenu();if(!album?.[6])return;
    const request=++trackRequest,spotify=album?.[13]==='spotify';trackAlbum=album;trackPlayNow.hidden=spotify;trackPlayNow.disabled=!playerId;
    trackTitle.textContent=album[0];trackDetails.textContent=album[1]+(album[10]?' · '+album[10]:'');
    trackStatus.textContent='Loading album information…';trackList.replaceChildren();trackOverlay.hidden=false;trackClose.focus();
    try{
        let tracks=[],genre='',year=album[10]||'';
        if(spotify){
            const info=await spotifyAlbumInformation(playerId,{spottyItemId:album[14]});
            tracks=info.tracks||[];genre=info.genre||'';year=info.year||year;
        }else{
            const [trackResult,albumResult]=await Promise.all([
                rpc('0',['tracks',0,1000,'album_id:'+album[6],'sort:tracknum','tags:altngidA']),
                rpc('0',['albums',0,1,'album_id:'+album[6],'tags:ajlyg'])
            ]);
            tracks=sortAlbumTracks(trackResult.titles_loop||[]);
            const detail=(albumResult.albums_loop||[])[0]||{};
            const trackGenres=[...new Set(tracks.flatMap(track=>[track.genre,track.genres]).flat().filter(Boolean).flatMap(value=>String(value).split(/\s*,\s*/)).filter(Boolean))];
            genre=detail.genre||detail.genres||trackGenres.join(', ');
            year=detail.year||year;
        }
        tracks=sortAlbumTracks(tracks);
        if(request!==trackRequest||trackOverlay.hidden)return;
        const details=[album[1],year,genre].filter(Boolean);trackDetails.textContent=details.join(' · ');
        if(!tracks.length){trackStatus.textContent=spotify?'No track list returned by Spotty.':'No tracks found.';return}
        trackStatus.textContent='';
        const multiDisc=new Set(tracks.map(track=>albumTrackNumber(track.disc)??1)).size>1;
        let displayedDisc=null;
        tracks.forEach((track,index)=>{
            const disc=albumTrackNumber(track.disc)??1;
            if(multiDisc&&disc!==displayedDisc){
                const separator=document.createElement('li');
                separator.className='bf-disc-heading';
                separator.textContent='Disc '+disc;
                trackList.append(separator);
                displayedDisc=disc;
            }
            const item=document.createElement('li'),number=document.createElement('span');
            number.textContent=track.tracknum||index+1;
            const title=document.createElement('span'),artist=distinctTrackArtist(track,album[1]);
            title.textContent=(track.title||'Untitled')+(artist?' — '+artist:'');
            const duration=document.createElement('span');
            duration.textContent=track.duration?formatTime(track.duration):'';
            item.append(number,title,duration);trackList.append(item);
        })
    }catch(_){if(request!==trackRequest)return;trackStatus.textContent=spotify?'Spotify album information is unavailable from Spotty.':'Track list unavailable while LMS reconnects.'}
}
const queueScrim=root.querySelector('.bf-queue-scrim'),queueDrawer=root.querySelector('.bf-queue-drawer'),queueGrip=root.querySelector('.bf-queue-grip'),queueClose=root.querySelector('.bf-queue-close'),queueStatus=root.querySelector('.bf-queue-status'),queueList=root.querySelector('.bf-queue-list');let queueRequest=0,queueGesture=null;
function closeQueue(){queueRequest++;queueDrawer.classList.remove('is-open');queueScrim.classList.remove('is-open');queueDrawer.setAttribute('aria-hidden','true');queueScrim.setAttribute('aria-hidden','true');queueOpen.setAttribute('aria-expanded','false')}
function queueItem(track,index,currentIndex){const item=document.createElement('li'),button=document.createElement('button'),number=document.createElement('span'),copy=document.createElement('span'),title=document.createElement('strong'),detail=document.createElement('span'),duration=document.createElement('span');button.type='button';button.className='bf-queue-item';button.setAttribute('aria-label','Play '+(track.title||'Untitled'));number.className='bf-queue-number';number.textContent=String(index+1);title.textContent=track.title||'Untitled';detail.textContent=[track.artist,track.album].filter(Boolean).join(' · ');duration.textContent=track.duration?formatTime(track.duration):'';copy.append(title,detail);button.append(number,copy,duration);item.append(button);if(index===currentIndex){item.className='is-current';button.setAttribute('aria-current','true')}button.onclick=async()=>{if(!playerId)return;try{await rpc(playerId,['playlist','index',index]);await refreshStatus();await openQueue()}catch(_){queueStatus.textContent='Could not select that track.'}};return item}
async function openQueue(){if(!playerId)return;const request=++queueRequest;queueDrawer.classList.add('is-open');queueScrim.classList.add('is-open');queueDrawer.setAttribute('aria-hidden','false');queueScrim.setAttribute('aria-hidden','false');queueOpen.setAttribute('aria-expanded','true');queueStatus.textContent='Loading queue…';queueList.replaceChildren();try{const result=await rpc(playerId,['status',0,1000,'tags:alJen']);if(request!==queueRequest)return;const tracks=result.playlist_loop||[],currentIndex=Number(result.playlist_cur_index);queueStatus.textContent=tracks.length?tracks.length+' track'+(tracks.length===1?'':'s'):'The queue is empty.';queueList.replaceChildren(...tracks.map((track,index)=>queueItem(track,index,currentIndex)));queueList.querySelector('.is-current')?.scrollIntoView?.({block:'center'});queueClose.focus()}catch(_){if(request===queueRequest)queueStatus.textContent='Queue unavailable while LMS reconnects.'}}
function beginQueueGesture(event){if(event.button!==0)return;queueGesture={id:event.pointerId,y:event.clientY};event.currentTarget.setPointerCapture?.(event.pointerId)}
function finishQueueGesture(event,opening){if(!queueGesture||event.pointerId!==queueGesture.id)return;const distance=queueGesture.y-event.clientY;queueGesture=null;if((opening&&distance>35)||(!opening&&distance<-35))opening?openQueue():closeQueue()}
queueOpen.addEventListener('pointerdown',beginQueueGesture);queueOpen.addEventListener('pointerup',event=>finishQueueGesture(event,true));queueOpen.onclick=openQueue;queueGrip.addEventListener('pointerdown',beginQueueGesture);queueGrip.addEventListener('pointerup',event=>finishQueueGesture(event,false));queueGrip.onclick=closeQueue;queueClose.onclick=closeQueue;queueScrim.onclick=closeQueue;playerSelect.addEventListener('change',closeQueue);document.addEventListener('keydown',event=>{if(event.key==='Escape'&&queueDrawer.classList.contains('is-open')){event.stopImmediatePropagation();closeQueue();queueOpen.focus()}},true);
clearPlayButton.onclick=()=>clearPlaylistAndPlay(menuAlbum);playNowButton.onclick=()=>playAlbumNow(menuAlbum);playNextButton.onclick=()=>queueAlbum(menuAlbum,true);addQueueButton.onclick=()=>queueAlbum(menuAlbum,false);trackListOpen.onclick=()=>showTrackList(menuAlbum);trackPlayNow.onclick=async()=>{const album=trackAlbum;if(!album||!playerId)return;trackPlayNow.disabled=true;await playAlbumNow(album);if(trackAlbum===album)closeTrackList()};trackClose.onclick=closeTrackList;trackOverlay.onclick=event=>{if(event.target===trackOverlay)closeTrackList()};
function cancelLongPress(){clearTimeout(longPressTimer);longPressTimer=0;longPressAlbum=null}
document.addEventListener('pointerdown',event=>{if(randomAnimating)return;const element=event.target.closest('.bf-album');if(!element)return;const index=Number(element.dataset.index);longPressAlbum=albums[index];longPressX=event.clientX;longPressY=event.clientY;longPressTimer=setTimeout(()=>{if(!longPressAlbum)return;dragging=false;moved=true;stage.classList.remove('is-dragging');openAlbumMenu(longPressAlbum,event);cancelLongPress()},550)},true);
document.addEventListener('pointermove',event=>{if(longPressTimer&&Math.hypot(event.clientX-longPressX,event.clientY-longPressY)>10)cancelLongPress()},true);
document.addEventListener('pointerdown',event=>{if(event.button!==0)cancelLongPress()},true);
document.addEventListener('pointerup',cancelLongPress,true);document.addEventListener('pointercancel',cancelLongPress,true);
document.addEventListener('wheel',event=>{if(!stage.contains(event.target)&&!frontPreview.contains(event.target))return;followingNowPlaying=false;cancelFollowAnimation();if(!albumMenu.hidden)closeAlbumMenu();if(!orderMenu.hidden)closeOrderMenu()},true);
document.addEventListener('contextmenu',event=>{const element=event.target.closest('.bf-album');if(!element)return;event.preventDefault();const album=albums[Number(element.dataset.index)];if(album)openAlbumMenu(album,event)},true);
document.addEventListener('pointerdown',event=>{if(!albumMenu.hidden&&!albumMenu.contains(event.target))closeAlbumMenu();if(!orderMenu.hidden&&!orderMenu.contains(event.target)&&event.target!==orderToggle)closeOrderMenu()},true);document.addEventListener('keydown',event=>{if(event.key==='Escape'&&!trackOverlay.hidden)closeTrackList();else if(event.key==='Escape'&&!albumMenu.hidden)closeAlbumMenu();else if(event.key==='Escape'&&!orderMenu.hidden)closeOrderMenu();else if(event.key==='Escape'&&!frontPreview.hidden)closeFrontPreview()});
async function playRandomAlbum(){
    if(!playerId||randomAnimating||orderBusy||libraryRefreshing||!totalAlbums)return;
    stopFollowing();randomAnimating=true;randomPlay.classList.add('is-busy');updateBusyState();
    const connection=connectionGeneration,expectedPlayer=playerId;
    try{
        let index=Math.floor(Math.random()*totalAlbums);
        if(totalAlbums>1&&index===selectedIndex())index=modulo(index+1+Math.floor(Math.random()*(totalAlbums-1)),totalAlbums);
        await fetchBatch(Math.floor(index/PAGE_SIZE));
        if(connection!==connectionGeneration||expectedPlayer!==playerId)return;
        const album=albums[index];if(!album)throw Error('Album unavailable');
        const destination=nearestPositionForIndex(index),distance=Math.abs(destination-position);
        randomAnimationFrom=position;randomAnimationTo=destination;
        randomAnimationDuration=Math.min(RANDOM_SCROLL_MAX_MS,Math.max(450,250+distance*45));
        randomAnimationStart=performance.now();target=destination;lastSelected=-1;schedule();
        const arrived=await new Promise(resolve=>{
            const check=()=>{
                if(connection!==connectionGeneration||expectedPlayer!==playerId){resolve(false);return}
                if(Math.abs(destination-position)<.015){position=target=destination;resolve(true);return}
                requestAnimationFrame(check);
            };check();
        });
        if(arrived){await loadAlbum(album);prefetchAround(index)}
    }catch(_){if(connection===connectionGeneration){setConnection('Random album could not be played',false);scheduleReconnect()}}
    finally{
        if(connection===connectionGeneration){
            randomAnimating=false;randomAnimationDuration=0;randomPlay.classList.remove('is-busy');
            if(expectedPlayer!==playerId)target=Math.round(position);
            updateBusyState();schedule();if(libraryRefreshPending)handleLibraryEvent();
        }
    }
}
function formatTime(seconds){const v=Math.max(0,Math.floor(Number(seconds)||0));return Math.floor(v/60)+':'+String(v%60).padStart(2,'0')}function currentPlaybackTime(){const elapsed=playing?(performance.now()-statusUpdatedAt)/1000:0;return trackDuration?Math.min(trackDuration,playbackSeconds+elapsed):playbackSeconds+elapsed}function updateProgressDisplay(){const line=meta.querySelector('.bf-now-track'),text=line?.querySelector('.bf-now-track-text'),fill=meta.querySelector('.bf-progress-fill');if(!line)return;const current=currentPlaybackTime(),prefix=line.dataset.prefix||'',value=prefix+(trackDuration?' · '+formatTime(current)+' / '+formatTime(trackDuration):'');if(text)text.textContent=value;else line.textContent=value;if(fill)fill.style.width=trackDuration?Math.min(100,current/trackDuration*100)+'%':'0'}
function updateMeta(force=false){
    const selected=selectedIndex();
    if(stage.classList.contains('bf-shelf-active')&&selected!==renderedWindowAnchor)renderAlbums();
    const playingIndex=playing?playingCarouselIndex():-1;
    const displayIndex=hoveredAlbumIndex>=0?hoveredAlbumIndex:playingIndex;
    play.setAttribute('aria-label',playing?'Pause player':'Resume player');
    play.innerHTML='<span aria-hidden="true">'+(playing?'❚❚':'▶')+'</span>';
    if(!force&&displayIndex===lastSelected)return;
    lastSelected=displayIndex;
    const album=albums[displayIndex]||(hoveredAlbumIndex<0&&playing&&nowAlbumTitle?[nowAlbumTitle,nowAlbumArtist||'Unknown artist','','','','',playingAlbumId||'remote-now-playing']:null);
    nodes.forEach(n=>n.el.setAttribute('aria-selected',n.index===displayIndex?'true':'false'));
    if(!album){meta.replaceChildren();return}
    const title=document.createElement('strong');title.textContent=album[0];
    const detail=document.createElement('span');
    detail.textContent=' — '+album[1];
    const heading=document.createElement('div');heading.className='bf-album-detail';heading.append(title,detail);
    const content=[heading];
    const showingNowPlaying=playing&&hoveredAlbumIndex<0&&!!nowAlbumTitle;
    const differentLibrary=showingNowPlaying&&playingSource!=='unknown'&&playingSource!==catalogueSource;
    if(showingNowPlaying&&nowTrackTitle){
        const now=document.createElement('span');now.className='bf-now-track';
        // Keep compilation album artist in the heading; only add a distinct
        // track performer to the now-playing line when metadata supplies one.
        const artist=String(nowTrackArtist||'').trim(),albumArtist=String(album[1]||'').trim();
        const differentArtist=!!artist&&artist.toLocaleLowerCase()!==albumArtist.toLocaleLowerCase();
        now.dataset.prefix=(nowTrackNumber?'Track '+nowTrackNumber+' · ':'')+nowTrackTitle+(differentArtist?' — '+artist:'');
        const nowText=document.createElement('span');nowText.className='bf-now-track-text';
        if(differentLibrary){
            const source=document.createElement('span');
            source.className='bf-now-source-icon';
            source.setAttribute('role','img');
            source.setAttribute('aria-label',playingSource==='spotify'?'Playing from Spotify':'Playing from LMS Library');
            source.title=source.getAttribute('aria-label');
            source.innerHTML=playingSource==='spotify'?'<svg class="bf-spotify-logo" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#1ED760"/><path d="M17.45 17.27a.75.75 0 0 1-1.03.25c-2.82-1.72-6.37-2.11-10.55-1.16a.75.75 0 1 1-.33-1.46c4.57-1.04 8.5-.59 11.66 1.34.35.21.46.67.25 1.03Zm1.47-3.27a.94.94 0 0 1-1.29.31c-3.23-1.98-8.16-2.55-11.98-1.4a.94.94 0 1 1-.54-1.8c4.37-1.32 9.8-.68 13.5 1.59.44.27.58.85.31 1.3Zm.13-3.4C15.17 8.3 8.77 8.08 5.06 9.2a1.13 1.13 0 1 1-.65-2.16c4.26-1.29 11.33-1.03 15.79 1.61a1.13 1.13 0 0 1-1.15 1.95Z" fill="#000"/></svg>':'▤';
            now.append(source);
        }
        now.append(nowText);
        content.push(now);
        if(trackDuration>0){
            const progress=document.createElement('div');progress.className='bf-progress';
            const fill=document.createElement('div');fill.className='bf-progress-fill';progress.append(fill);content.push(progress);
        }
    }
    meta.replaceChildren(...content);updateProgressDisplay();
}
function draw(){if(raf){cancelAnimationFrame(raf);raf=0}if(!dragging){const error=target-position;if(followAnimation){const animation=followAnimation,p=clamp((performance.now()-animation.start)/animation.duration,0,1);position=animation.from+(animation.to-animation.from)*(1-Math.pow(1-p,3));if(p>=1){position=target=animation.to;followAnimation=null;animation.resolve(true)}}else if(randomAnimating&&randomAnimationDuration>0){const p=clamp((performance.now()-randomAnimationStart)/randomAnimationDuration,0,1),e=1-Math.pow(1-p,3);position=randomAnimationFrom+(randomAnimationTo-randomAnimationFrom)*e;if(p>=1)position=target}else{position+=error*.135;if(Math.abs(error)<.0004)position=target}}updateShelfWindow();updateMeta();prefetchAround(selectedIndex());prefetchCoverWindow(modulo(Math.round(target),totalAlbums));syncShelfDom();if(followAnimation||dragging||Math.abs(target-position)>.0004)raf=requestAnimationFrame(draw);else raf=0}function schedule(){if(!raf)raf=requestAnimationFrame(draw)}
let lastShelfScrollAt=-Infinity;
function shelfIsScrolling(){return dragging&&moved||!!followAnimation||randomAnimating||Math.abs(target-position)>.04||performance.now()-lastShelfScrollAt<160}
function scrollShelfWheel(e){if(randomAnimating)return;e.preventDefault();lastShelfScrollAt=performance.now();followingNowPlaying=false;cancelFollowAnimation();const delta=Math.abs(e.deltaX)>Math.abs(e.deltaY)?e.deltaX:e.deltaY;target=position=position+delta*.0028;draw();clearTimeout(wheelTimer);wheelTimer=setTimeout(()=>{target=Math.round(position);schedule()},110)}
// Shared pointer physics for shelf spines and the enlarged closed cover.
function beginShelfDrag(event,pressedIndex=null,captureTarget=stage){
    if(randomAnimating)return false;
    dragging=true;moved=false;pressedAlbumIndex=pressedIndex;
    startX=lastX=event.clientX;startPosition=position;target=position;
    lastTime=performance.now();pointerVelocity=0;
    stage.classList.add('is-dragging');
    captureTarget?.setPointerCapture(event.pointerId);
    schedule();
    return true;
}
function moveShelfDrag(event,closePreviewOnMove=true){
    if(!dragging)return;
    const now=performance.now(),dx=event.clientX-startX;
    if(Math.abs(dx)>6){
        moved=true;lastShelfScrollAt=now;
        // Both the stage and open-cover drag surfaces scroll without closing
        // the open album; the boolean is kept for existing gesture callers.
        followingNowPlaying=false;cancelFollowAnimation();
    }
    position=startPosition-dx/175;target=position;
    pointerVelocity=(event.clientX-lastX)/Math.max(1,now-lastTime);
    lastX=event.clientX;lastTime=now;
}
function finishShelfDrag(cancelled=false){
    if(!dragging)return;
    dragging=false;stage.classList.remove('is-dragging');
    if(cancelled)target=Math.round(position);
    else if(moved)target=Math.round(position-pointerVelocity*1.35);
    pressedAlbumIndex=null;schedule();
}
stage.addEventListener('pointerdown',event=>{
    const pressed=event.target.closest('.bf-album');
    beginShelfDrag(event,pressed?Number(pressed.dataset.index):null,stage);
});
stage.addEventListener('pointermove',event=>moveShelfDrag(event));
stage.addEventListener('pointerup',()=>finishShelfDrag(false));
stage.addEventListener('pointercancel',()=>finishShelfDrag(true));stage.addEventListener('wheel',scrollShelfWheel,{passive:false});frontPreview.addEventListener('wheel',scrollShelfWheel,{passive:false});root.addEventListener('pointerdown',noteUserActivity,{capture:true});root.addEventListener('wheel',noteUserActivity,{capture:true,passive:true});document.addEventListener('keydown',e=>{noteUserActivity();if(e.key==='Escape'&&!searchOverlay.hidden){closeSearch();return}const typing=e.target.matches?.('input,select,textarea,[contenteditable="true"]')||!!root.querySelector('.bf-settings-overlay:not([hidden])')||!trackOverlay.hidden||!albumMenu.hidden||!orderMenu.hidden;if(!typing&&e.key==='/'){e.preventDefault();openSearch();return}if(typing||randomAnimating||!searchOverlay.hidden)return;if(e.key==='ArrowLeft'||e.key==='ArrowRight'){e.preventDefault();browseWithArrow(e.key==='ArrowRight'?1:-1)}});powerButton.onclick=togglePlayerPower;searchOpen.onclick=openSearch;searchClose.onclick=closeSearch;searchOverlay.onclick=e=>{if(e.target===searchOverlay)closeSearch()};searchInput.oninput=()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>runSearch(searchInput.value),250)};randomPlay.onclick=playRandomAlbum;play.onclick=togglePlayback;playerSelect.addEventListener('change',()=>{cancelFollowAnimation();pinnedRequest++;playing=false;playingAlbumId=null;closeFrontPreview();updateMeta(true);playerId=playerSelect.value;setPlayerPower(null);try{localStorage.setItem('albumBrowserPlayer',playerId)}catch(_){}updateBusyState();refreshStatus();cometd.start(playerId)});new ResizeObserver(()=>{if(nodes.length)draw()}).observe(root);window.addEventListener('pagehide',()=>{cometd.stop();cancelFollowAnimation();clearInterval(progressTimer);clearTimeout(idleTimer);clearTimeout(frontTimer);clearTimeout(reconnectTimer)});
async function connectLyrion(){if(connecting)return;connecting=true;const connection=connectionGeneration;try{const result=await rpc('0',['players',0,100]),players=(result.players_loop||[]).filter(p=>String(p.connected)!=='0');if(connection!==connectionGeneration)return;playerSelect.replaceChildren();for(const p of players){const o=document.createElement('option');o.value=p.playerid;o.textContent=p.name||p.playerid;playerSelect.append(o)}let remembered='';try{remembered=localStorage.getItem('albumBrowserPlayer')||''}catch(_){}const selected=players.find(p=>p.playerid===remembered)||players.find(p=>String(p.isplaying)==='1')||players[0];playerId=selected?.playerid||'';setPlayerPower(null);if(playerId)playerSelect.value=playerId;playerSelect.disabled=!players.length;updateBusyState();if(catalogueSource==='spotify')await loadSpotifyCatalogue();else await loadInitialCatalogue();if(connection!==connectionGeneration)return;const status=await getStatus();if(connection!==connectionGeneration)return;await selectStartupAlbum(status);if(connection!==connectionGeneration)return;resetReconnect();armIdleReturn();cometd.start(playerId);clearInterval(progressTimer);progressTimer=setInterval(updateProgressDisplay,500)}catch(error){if(connection!==connectionGeneration)return;console.warn(error);cometd.stop();root.dataset.liveUpdates='false';emitStatus();if(!liveCatalogue){albums=demoAlbums.slice();totalAlbums=libraryAlbumCount=albums.length;position=target=Math.floor(Math.random()*albums.length);renderAlbums();draw();root.classList.remove('is-starting');root.dataset.ready='true';playerSelect.innerHTML='<option>Demo mode</option>'}playing=false;playingAlbumId=null;closeFrontPreview();updateMeta(true);root.classList.remove('is-starting');root.dataset.ready='true';playerId='';playerSelect.disabled=true;updateBusyState();setConnection('Lyrion Music Server unavailable',false);scheduleReconnect()}finally{if(connection===connectionGeneration)connecting=false}}
orderToggle.onclick=()=>orderMenu.hidden?openOrderMenu():closeOrderMenu();orderMenu.querySelectorAll('[data-order]').forEach(button=>button.onclick=()=>{closeOrderMenu();setDisplayOrder(button.dataset.order).catch(error=>{setConnection(error.message||'Could not change album order',false)}).finally(()=>{if(libraryRefreshPending)handleLibraryEvent()})});updateOrderToggle();
previousTrack.onclick=()=>skipTrack(-1);nextTrack.onclick=()=>skipTrack(1);
let focusClickIndex=null,focusClickX=0,focusClickY=0;
stage.addEventListener('pointerdown',event=>{
    focusClickIndex=null;
    if(shelfIsScrolling()||event.button!==0)return;
    const element=event.target.closest('.bf-album');
    if(!element)return;
    focusClickIndex=Number(element.dataset.index);
    focusClickX=event.clientX;focusClickY=event.clientY;
},true);
stage.addEventListener('pointerup',event=>{
    const index=focusClickIndex;
    focusClickIndex=null;
    if(randomAnimating||!Number.isInteger(index))return;
    const album=albums[index],wasClick=!moved&&performance.now()-lastShelfScrollAt>=160&&Math.abs(target-position)<.04&&Math.hypot(event.clientX-focusClickX,event.clientY-focusClickY)<=6;
    if(wasClick&&album){
        event.stopImmediatePropagation();dragging=false;moved=true;pressedAlbumIndex=null;
        stage.classList.remove('is-dragging');target=nearestPositionForIndex(index);
        // A deliberate spine click wins over any outstanding Now Playing lookup.
        pinnedRequest++;openFrontPreview(album,index);schedule();
    }
},true);
stage.addEventListener('pointercancel',()=>{focusClickIndex=null},true);
sourceButtons.forEach(button=>button.onclick=()=>setCatalogueSource(button.dataset.source));updateSourceButtons();
async function start(){await window.__lyrionLmsConfigReady;await loadRuntimeConfig();try{catalogueSource=localStorage.getItem('albumBrowserSource')==='spotify'?'spotify':'library'}catch(_){}updateSourceButtons();appStarted=true;setConnection('Connecting to Lyrion Music Server…',false);connectLyrion()}start();