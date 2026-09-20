import { rpc } from './lms.js?v=display-choice-1';

const root=document.getElementById('book-fan-browser');
const openButton=root?.querySelector('.bf-settings-open'),overlay=root?.querySelector('.bf-settings-overlay'),closeButton=root?.querySelector('.bf-settings-close');
const player=root?.querySelector('.bf-player-select'),idle=root?.querySelector('.bf-idle-return'),menuTimeout=root?.querySelector('.bf-album-menu-timeout'),frontTimeout=root?.querySelector('.bf-front-timeout'),keepPlayingOpen=root?.querySelector('.bf-keep-playing-open'),random=root?.querySelector('.bf-random-duration'),displayCount=root?.querySelector('.bf-display-count'),lmsUrl=root?.querySelector('.bf-lms-url'),lmsConnect=root?.querySelector('.bf-lms-connect-button');
const aboutConnection=root?.querySelector('.bf-about-connection'),aboutLive=root?.querySelector('.bf-about-live'),aboutPlayer=root?.querySelector('.bf-about-player'),aboutLibrary=root?.querySelector('.bf-about-library'),aboutCache=root?.querySelector('.bf-about-cache'),aboutVersion=root?.querySelector('.bf-about-version'),clearCacheButton=root?.querySelector('.bf-clear-cache'),cacheFeedback=root?.querySelector('.bf-cache-feedback');
const cacheConfirm=root?.querySelector('.bf-cache-confirm'),cacheCancel=root?.querySelector('.bf-cache-cancel'),cacheConfirmClear=root?.querySelector('.bf-cache-confirm-clear');
function dismissCacheConfirm(){if(cacheConfirm)cacheConfirm.hidden=true;if(clearCacheButton)clearCacheButton.hidden=false;}
const displayStyle=root?.querySelector('.bf-display-style');
const coverSize=root?.querySelector('.bf-cover-size');
const cacheLimit=root?.querySelector('.bf-cache-limit');
const genreList=root?.querySelector('.bf-genre-list'),genresStatus=root?.querySelector('.bf-genres-status'),genresAll=root?.querySelector('.bf-genres-all'),genresNone=root?.querySelector('.bf-genres-none');
const settingsTabs=Array.from(root?.querySelectorAll('.bf-settings-tab')||[]);
const connectionFeedback=root?.querySelector('.bf-connection-feedback');
function selectSettingsTab(tab,focus=false){
    dismissCacheConfirm();
    for(const button of settingsTabs){
        const selected=button===tab;
        button.setAttribute('aria-selected',String(selected));
        button.tabIndex=selected?0:-1;
        const panel=root.querySelector('#'+button.getAttribute('aria-controls'));
        if(panel)panel.hidden=!selected;
    }
    const body=root.querySelector('.bf-settings-body');if(body)body.scrollTop=0;
    if(focus)tab.focus();
}
settingsTabs.forEach((tab,index)=>{
    tab.addEventListener('click',()=>selectSettingsTab(tab));
    tab.addEventListener('keydown',event=>{
        let next=index;
        if(event.key==='ArrowRight')next=(index+1)%settingsTabs.length;
        else if(event.key==='ArrowLeft')next=(index+settingsTabs.length-1)%settingsTabs.length;
        else if(event.key==='Home')next=0;
        else if(event.key==='End')next=settingsTabs.length-1;
        else return;
        event.preventDefault();event.stopPropagation();selectSettingsTab(settingsTabs[next],true);
    });
});
const storage={displayStyle:'albumBrowserDisplayStyle',coverSize:'albumBrowserCoverSize',keepPlayingOpen:'albumBrowserKeepPlayingOpen',idle:'albumBrowserIdleReturnMs',menuTimeout:'albumBrowserAlbumMenuTimeoutMs',frontTimeout:'albumBrowserFrontPreviewTimeoutMs',random:'albumBrowserRandomScrollMs',displayCount:'albumBrowserDisplayCount',cacheLimit:'albumBrowserCacheLimitBytes',genres:'albumBrowserDisabledGenres',lms:'albumBrowserLmsUrl'}
function get(key,fallback){try{return localStorage.getItem(key)??fallback}catch(_){return fallback}}
function set(key,value){try{localStorage.setItem(key,value)}catch(_){}}
function disabledGenres(){try{const values=JSON.parse(get(storage.genres,'[]'));return new Set(Array.isArray(values)?values.filter(value=>typeof value==='string'):[])}catch(_){return new Set()}}
function applyGenres(fromBulkAction=false){
    if(!genreList)return;
    const inputs=[...genreList.querySelectorAll('input')],disabled=inputs.filter(input=>!input.checked).map(input=>input.value),enabled=inputs.length-disabled.length;
    set(storage.genres,JSON.stringify(disabled));
    if(!fromBulkAction){if(genresAll)genresAll.checked=false;if(genresNone)genresNone.checked=false}
    if(genresStatus)genresStatus.textContent=enabled+' of '+inputs.length+' genres enabled';
    window.dispatchEvent(new CustomEvent('lyrion-carousel-genres-change',{detail:{disabled}}));
}
function renderGenres(genres){
    if(!genreList)return;
    const disabled=disabledGenres();genreList.replaceChildren();
    for(const genre of genres){
        const label=document.createElement('label'),input=document.createElement('input'),text=document.createElement('span');
        label.className='bf-genre-item';input.type='checkbox';input.value=String(genre.id);input.checked=!disabled.has(input.value);text.textContent=genre.name;
        input.addEventListener('change',()=>applyGenres());label.append(input,text);genreList.append(label);
    }
    applyGenres();
}
async function loadGenres(){
    if(!genreList)return;
    if(genresStatus)genresStatus.textContent='Loading genres...';
    try{
        const result=await rpc('0',['genres',0,1000]),genres=(result.genres_loop||[]).map(item=>({id:Number(item.id),name:String(item.genre||item.name||'').trim()})).filter(item=>Number.isInteger(item.id)&&item.id>0&&item.name).sort((a,b)=>a.name.localeCompare(b.name));
        if(!genres.length)throw Error();renderGenres(genres);
    }catch(_){genreList.replaceChildren();if(genresStatus)genresStatus.textContent='Genres are unavailable while LMS reconnects.'}
}
function apply(value,name){set(storage[name],value);window.dispatchEvent(new CustomEvent('lyrion-carousel-setting',{detail:{name,value}}))}
function refreshStatus(){const label=root.querySelector('.bf-connection-label')?.textContent?.trim()||'—',cached=root.dataset.catalogueSource==='cache';aboutConnection.textContent=root.dataset.connected==='true'?'Connected':'Not connected';if(aboutLive)aboutLive.textContent=root.dataset.liveUpdates==='true'?'Connected':root.dataset.liveUpdates==='connecting'?'Connecting…':'Disconnected';aboutLibrary.textContent=cached?label+' · cached':label;aboutPlayer.textContent=player?.selectedOptions?.[0]?.textContent||'—';if(aboutCache)aboutCache.textContent=cached?'Using cached catalogue':'Album cache enabled'}
async function loadVersion(){try{const r=await fetch('VERSION',{cache:'no-store'});if(r.ok)aboutVersion.textContent='v'+(await r.text()).trim()}catch(_){aboutVersion.textContent=''}}
function initialise(){displayStyle.value=get(storage.displayStyle,'shelf')==='fan'?'fan':'shelf';coverSize.value=get(storage.coverSize,'512');keepPlayingOpen.value=get(storage.keepPlayingOpen,'true');idle.value=get(storage.idle,'30000');menuTimeout.value=get(storage.menuTimeout,'10000');frontTimeout.value=get(storage.frontTimeout,'10000');random.value=get(storage.random,'3000');displayCount.value=get(storage.displayCount,'30');cacheLimit.value=get(storage.cacheLimit,'512000000');window.__lyrionCarouselSettings={displayStyle:displayStyle.value,coverSize:Number(coverSize.value),keepPlayingOpen:keepPlayingOpen.value==='true',idle:Number(idle.value),menuTimeout:Number(menuTimeout.value),frontTimeout:Number(frontTimeout.value),random:Number(random.value),displayCount:Number(displayCount.value)};loadVersion()}
function validLmsUrl(value){return /^https?:\/\/[^/?#]+(?:\/[^?#]*)?$/.test(value)}
function applyRuntimeDefault(select,name,value){
    if(get(storage[name],null)!==null||!Number.isFinite(Number(value)))return;
    const text=String(value);
    if(!Array.from(select.options).some(option=>option.value===text)){
        const option=document.createElement('option');option.value=text;option.textContent=Number(value)===0?'Off':Number(value)/1000+' seconds';select.append(option);
    }
    select.value=text;window.__lyrionCarouselSettings[name]=Number(value);
}
function configureCacheLimit(softLimit,hardLimit){
    if(!cacheLimit)return;
    const hard=Number(hardLimit),soft=Number(softLimit);
    for(const option of Array.from(cacheLimit.options))option.hidden=!Number.isFinite(hard)||Number(option.value)>hard;
    if(Number.isFinite(hard)&&hard>0&&!Array.from(cacheLimit.options).some(option=>Number(option.value)===hard)){
        const option=document.createElement('option');option.value=String(hard);option.textContent=(hard/1_000_000).toLocaleString()+' MB';cacheLimit.append(option);
    }
    if(Array.from(cacheLimit.options).some(option=>Number(option.value)===soft))cacheLimit.value=String(soft);
}
function savedCacheLimit(hardLimit){
    const saved=Number(get(storage.cacheLimit,''));
    return Number.isInteger(saved)&&saved>0&&saved<=Number(hardLimit)?saved:null;
}
async function loadLmsConfig(){try{const response=await fetch('/api/config',{cache:'no-store'});if(!response.ok)return;const config=await response.json(),saved=get(storage.lms,'').trim(),hardLimit=config.cache_hard_limit_bytes||2_000_000_000,savedLimit=savedCacheLimit(hardLimit),value=saved||config.lms_url||'';if(lmsUrl)lmsUrl.value=value;configureCacheLimit(config.cache_limit_bytes||512_000_000,hardLimit);applyRuntimeDefault(idle,'idle',config.idle_return_ms);applyRuntimeDefault(random,'random',config.random_scroll_max_ms);if(saved&&saved!==config.lms_url&&validLmsUrl(saved)){const update=await fetch('/api/config/lms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lms_url:saved})});if(update.ok)window.dispatchEvent(new CustomEvent('lyrion-carousel-lms-change',{detail:{lmsUrl:saved}}))}if(savedLimit&&savedLimit!==config.cache_limit_bytes){const update=await fetch('/api/config/cache',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cache_limit_bytes:savedLimit})});if(update.ok){const result=await update.json();configureCacheLimit(result.cache_limit_bytes,result.cache_hard_limit_bytes);refreshWarmStatus()}}}catch(_){} }
const warmStart=root?.querySelector('.bf-warm-start'),warmCancel=root?.querySelector('.bf-warm-cancel'),warmStatus=root?.querySelector('.bf-warm-status');
let warmTimer=0,warmRequest=0;
function showWarmStatus(state){
    const usage=root.querySelector('.bf-cache-size');
    if(usage&&state.cache){
        const mb=bytes=>(bytes/1000000).toFixed(1)+' MB';
        usage.textContent=mb(state.cache.image_bytes)+' / '+mb(state.cache.limit_bytes)+' artwork';
        usage.title=mb(state.cache.total_bytes)+' total including '+mb(state.cache.metadata_bytes)+' metadata · '+state.cache.files+' files';
    }
    const busy=state.status==='running'||state.status==='cancelling';
    warmStart.disabled=busy;warmCancel.hidden=!busy;warmCancel.disabled=state.status==='cancelling';
    const labels={idle:'Not started',running:'Preparing artwork',cancelling:'Cancelling after current download',cancelled:'Cancelled',complete:'Complete',cache_full:'Stopped: album cache is full',error:'Could not prepare artwork'};
    warmStatus.textContent=(labels[state.status]||'Unknown status')+(state.total?' · '+state.completed+' / '+state.total:'')+(state.size?' · '+state.size+' px':'')+(state.failed?' · '+state.failed+' unavailable':'');
}
async function refreshWarmStatus(action=null){
    clearTimeout(warmTimer);const request=++warmRequest;
    try{
        const options=action?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action,size:Number(coverSize.value)})}:{cache:'no-store'};
        const response=await fetch('/api/cache/warm',options);
        if(!response.ok)throw Error();
        const state=await response.json();if(request!==warmRequest)return;
        showWarmStatus(state);
        if(!overlay.hidden)warmTimer=setTimeout(()=>refreshWarmStatus(),state.status==='running'||state.status==='cancelling'?2000:5000);
    }catch(_){if(request===warmRequest){warmStatus.textContent='Artwork preparation unavailable. Restart the updated server if needed.';warmStart.disabled=false;}}
}
warmStart?.addEventListener('click',()=>{warmStart.disabled=true;refreshWarmStatus('start')});
warmCancel?.addEventListener('click',()=>{warmCancel.disabled=true;refreshWarmStatus('cancel')});
window.addEventListener('pagehide',()=>{warmRequest++;clearTimeout(warmTimer)});
function openSettings(){if(!overlay)return;refreshStatus();overlay.hidden=false;refreshWarmStatus();closeButton?.focus()}
function closeSettings(){if(!overlay)return;dismissCacheConfirm();warmRequest++;clearTimeout(warmTimer);overlay.hidden=true;openButton?.focus()}
displayStyle?.addEventListener('change',()=>apply(displayStyle.value,'displayStyle'));
coverSize?.addEventListener('change',()=>apply(coverSize.value,'coverSize'));
cacheLimit?.addEventListener('change',async()=>{const limit=Number(cacheLimit.value);cacheLimit.disabled=true;try{const response=await fetch('/api/config/cache',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({cache_limit_bytes:limit})});if(!response.ok)throw Error();const result=await response.json();set(storage.cacheLimit,result.cache_limit_bytes);configureCacheLimit(result.cache_limit_bytes,result.cache_hard_limit_bytes);showWarmStatus({status:'idle',cache:result.cache})}catch(_){cacheFeedback.textContent='Could not update cache limit'}finally{cacheLimit.disabled=false}});
genresAll?.addEventListener('change',()=>{if(!genresAll.checked)return;genreList?.querySelectorAll('input').forEach(input=>input.checked=true);if(genresNone)genresNone.checked=false;applyGenres(true)});
genresNone?.addEventListener('change',()=>{if(!genresNone.checked)return;genreList?.querySelectorAll('input').forEach(input=>input.checked=false);if(genresAll)genresAll.checked=false;applyGenres(true)});
idle?.addEventListener('change',()=>apply(idle.value,'idle'));
menuTimeout?.addEventListener('change',()=>apply(menuTimeout.value,'menuTimeout'));
keepPlayingOpen?.addEventListener('change',()=>apply(keepPlayingOpen.value,'keepPlayingOpen'));
frontTimeout?.addEventListener('change',()=>apply(frontTimeout.value,'frontTimeout'));
random?.addEventListener('change',()=>apply(random.value,'random'));
displayCount?.addEventListener('change',()=>apply(displayCount.value,'displayCount'));
player?.addEventListener('change',()=>setTimeout(refreshStatus,0));
lmsConnect?.addEventListener('click',async()=>{const value=lmsUrl?.value.trim()||'';if(!validLmsUrl(value)){if(connectionFeedback)connectionFeedback.textContent='Enter a valid http(s) server URL';return}lmsConnect.disabled=true;if(connectionFeedback)connectionFeedback.textContent='Connecting to server…';try{const response=await fetch('/api/config/lms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lms_url:value})});if(!response.ok)throw Error('Invalid LMS URL');const result=await response.json();set(storage.lms,result.lms_url);window.dispatchEvent(new CustomEvent('lyrion-carousel-lms-change',{detail:{lmsUrl:result.lms_url}}));if(connectionFeedback)connectionFeedback.textContent='Server updated; discovering players…'}catch(_){if(connectionFeedback)connectionFeedback.textContent='Could not connect to that server'}finally{lmsConnect.disabled=false}});
clearCacheButton?.addEventListener('click',()=>{cacheConfirm.hidden=false;clearCacheButton.hidden=true;cacheFeedback.textContent='';cacheCancel?.focus()});
cacheCancel?.addEventListener('click',()=>{dismissCacheConfirm();clearCacheButton?.focus()});
cacheConfirmClear?.addEventListener('click',async()=>{if(clearCacheButton.disabled)return;dismissCacheConfirm();clearCacheButton.disabled=true;if(cacheFeedback)cacheFeedback.textContent='Clearing…';try{const response=await fetch('/api/cache/clear',{method:'POST'});if(!response.ok)throw Error('Cache clear failed');const result=await response.json();if(cacheFeedback)cacheFeedback.textContent=(result.removed??0)+' cached files removed';if(aboutCache)aboutCache.textContent='Album cache cleared';refreshWarmStatus();window.dispatchEvent(new Event('lyrion-carousel-cache-cleared'))}catch(_){if(cacheFeedback)cacheFeedback.textContent='Could not clear album cache'}finally{clearCacheButton.disabled=false;if(!overlay.hidden&&!root.querySelector('#settings-panel-cache')?.hidden)clearCacheButton.focus()}});
window.addEventListener('lyrion-carousel-status',refreshStatus);
openButton?.addEventListener('click',openSettings);closeButton?.addEventListener('click',closeSettings);overlay?.addEventListener('click',event=>{if(event.target===overlay)closeSettings()});document.addEventListener('keydown',event=>{if(event.key==='Escape'&&overlay&&!overlay.hidden){if(cacheConfirm&&!cacheConfirm.hidden){dismissCacheConfirm();clearCacheButton?.focus()}else closeSettings()}});
initialise();
window.__lyrionLmsConfigReady=loadLmsConfig();
loadGenres();
window.addEventListener('lyrion-carousel-lms-change',loadGenres);
