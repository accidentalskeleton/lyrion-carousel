const root=document.getElementById('book-fan-browser');
const openButton=root?.querySelector('.bf-settings-open'),overlay=root?.querySelector('.bf-settings-overlay'),closeButton=root?.querySelector('.bf-settings-close');
const player=root?.querySelector('.bf-player-select'),idle=root?.querySelector('.bf-idle-return'),menuTimeout=root?.querySelector('.bf-album-menu-timeout'),frontTimeout=root?.querySelector('.bf-front-timeout'),keepPlayingOpen=root?.querySelector('.bf-keep-playing-open'),random=root?.querySelector('.bf-random-duration'),displayCount=root?.querySelector('.bf-display-count'),lmsUrl=root?.querySelector('.bf-lms-url'),lmsConnect=root?.querySelector('.bf-lms-connect-button');
const aboutConnection=root?.querySelector('.bf-about-connection'),aboutLive=root?.querySelector('.bf-about-live'),aboutPlayer=root?.querySelector('.bf-about-player'),aboutLibrary=root?.querySelector('.bf-about-library'),aboutCache=root?.querySelector('.bf-about-cache'),aboutVersion=root?.querySelector('.bf-about-version'),clearCacheButton=root?.querySelector('.bf-clear-cache'),cacheFeedback=root?.querySelector('.bf-cache-feedback');
const cacheConfirm=root?.querySelector('.bf-cache-confirm'),cacheCancel=root?.querySelector('.bf-cache-cancel'),cacheConfirmClear=root?.querySelector('.bf-cache-confirm-clear');
function dismissCacheConfirm(){if(cacheConfirm)cacheConfirm.hidden=true;if(clearCacheButton)clearCacheButton.hidden=false;}
const displayStyle=root?.querySelector('.bf-display-style');
const coverSize=root?.querySelector('.bf-cover-size');
const storage={displayStyle:'albumBrowserDisplayStyle',coverSize:'albumBrowserCoverSize',keepPlayingOpen:'albumBrowserKeepPlayingOpen',idle:'albumBrowserIdleReturnMs',menuTimeout:'albumBrowserAlbumMenuTimeoutMs',frontTimeout:'albumBrowserFrontPreviewTimeoutMs',random:'albumBrowserRandomScrollMs',displayCount:'albumBrowserDisplayCount',lms:'albumBrowserLmsUrl'}
function get(key,fallback){try{return localStorage.getItem(key)??fallback}catch(_){return fallback}}
function set(key,value){try{localStorage.setItem(key,value)}catch(_){}}
function apply(value,name){set(storage[name],value);window.dispatchEvent(new CustomEvent('lyrion-carousel-setting',{detail:{name,value}}))}
function refreshStatus(){const label=root.querySelector('.bf-connection-label')?.textContent?.trim()||'—',cached=root.dataset.catalogueSource==='cache';aboutConnection.textContent=root.dataset.connected==='true'?'Connected':'Not connected';if(aboutLive)aboutLive.textContent=root.dataset.liveUpdates==='true'?'Connected':root.dataset.liveUpdates==='connecting'?'Connecting…':'Disconnected';aboutLibrary.textContent=cached?label+' · cached':label;aboutPlayer.textContent=player?.selectedOptions?.[0]?.textContent||'—';if(aboutCache)aboutCache.textContent=cached?'Using cached catalogue':'Album cache enabled'}
async function loadVersion(){try{const r=await fetch('VERSION',{cache:'no-store'});if(r.ok)aboutVersion.textContent='v'+(await r.text()).trim()}catch(_){aboutVersion.textContent=''}}
function initialise(){displayStyle.value=get(storage.displayStyle,'shelf')==='fan'?'fan':'shelf';coverSize.value=get(storage.coverSize,'512');keepPlayingOpen.value=get(storage.keepPlayingOpen,'true');idle.value=get(storage.idle,'30000');menuTimeout.value=get(storage.menuTimeout,'10000');frontTimeout.value=get(storage.frontTimeout,'10000');random.value=get(storage.random,'3000');displayCount.value=get(storage.displayCount,'30');window.__lyrionCarouselSettings={displayStyle:displayStyle.value,coverSize:Number(coverSize.value),keepPlayingOpen:keepPlayingOpen.value==='true',idle:Number(idle.value),menuTimeout:Number(menuTimeout.value),frontTimeout:Number(frontTimeout.value),random:Number(random.value),displayCount:Number(displayCount.value)};loadVersion()}
function validLmsUrl(value){return /^https?:\/\/[^/?#]+(?:\/[^?#]*)?$/.test(value)}
function applyRuntimeDefault(select,name,value){
    if(get(storage[name],null)!==null||!Number.isFinite(Number(value)))return;
    const text=String(value);
    if(!Array.from(select.options).some(option=>option.value===text)){
        const option=document.createElement('option');option.value=text;option.textContent=Number(value)===0?'Off':Number(value)/1000+' seconds';select.append(option);
    }
    select.value=text;window.__lyrionCarouselSettings[name]=Number(value);
}
async function loadLmsConfig(){try{const response=await fetch('/api/config',{cache:'no-store'});if(!response.ok)return;const config=await response.json(),saved=get(storage.lms,'').trim(),value=saved||config.lms_url||'';if(lmsUrl)lmsUrl.value=value;applyRuntimeDefault(idle,'idle',config.idle_return_ms);applyRuntimeDefault(random,'random',config.random_scroll_max_ms);if(saved&&saved!==config.lms_url&&validLmsUrl(saved)){const update=await fetch('/api/config/lms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lms_url:saved})});if(update.ok)window.dispatchEvent(new CustomEvent('lyrion-carousel-lms-change',{detail:{lmsUrl:saved}}))}}catch(_){} }
function openSettings(){if(!overlay)return;refreshStatus();overlay.hidden=false;closeButton?.focus()}
function closeSettings(){if(!overlay)return;dismissCacheConfirm();overlay.hidden=true;openButton?.focus()}
displayStyle?.addEventListener('change',()=>apply(displayStyle.value,'displayStyle'));
coverSize?.addEventListener('change',()=>apply(coverSize.value,'coverSize'));
idle?.addEventListener('change',()=>apply(idle.value,'idle'));
menuTimeout?.addEventListener('change',()=>apply(menuTimeout.value,'menuTimeout'));
keepPlayingOpen?.addEventListener('change',()=>apply(keepPlayingOpen.value,'keepPlayingOpen'));
frontTimeout?.addEventListener('change',()=>apply(frontTimeout.value,'frontTimeout'));
random?.addEventListener('change',()=>apply(random.value,'random'));
displayCount?.addEventListener('change',()=>apply(displayCount.value,'displayCount'));
player?.addEventListener('change',()=>setTimeout(refreshStatus,0));
lmsConnect?.addEventListener('click',async()=>{const value=lmsUrl?.value.trim()||'';if(!validLmsUrl(value)){if(cacheFeedback)cacheFeedback.textContent='Enter a valid http(s) server URL';return}lmsConnect.disabled=true;if(cacheFeedback)cacheFeedback.textContent='Connecting to server…';try{const response=await fetch('/api/config/lms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({lms_url:value})});if(!response.ok)throw Error('Invalid LMS URL');const result=await response.json();set(storage.lms,result.lms_url);window.dispatchEvent(new CustomEvent('lyrion-carousel-lms-change',{detail:{lmsUrl:result.lms_url}}));if(cacheFeedback)cacheFeedback.textContent='Server updated; discovering players…'}catch(_){if(cacheFeedback)cacheFeedback.textContent='Could not connect to that server'}finally{lmsConnect.disabled=false}});
clearCacheButton?.addEventListener('click',()=>{cacheConfirm.hidden=false;clearCacheButton.hidden=true;cacheFeedback.textContent='';cacheCancel?.focus()});
cacheCancel?.addEventListener('click',()=>{dismissCacheConfirm();clearCacheButton?.focus()});
cacheConfirmClear?.addEventListener('click',async()=>{if(clearCacheButton.disabled)return;dismissCacheConfirm();clearCacheButton.disabled=true;if(cacheFeedback)cacheFeedback.textContent='Clearing…';try{const response=await fetch('/api/cache/clear',{method:'POST'});if(!response.ok)throw Error('Cache clear failed');const result=await response.json();if(cacheFeedback)cacheFeedback.textContent=(result.removed??0)+' cached files removed';if(aboutCache)aboutCache.textContent='Album cache cleared';window.dispatchEvent(new Event('lyrion-carousel-cache-cleared'))}catch(_){if(cacheFeedback)cacheFeedback.textContent='Could not clear album cache'}finally{clearCacheButton.disabled=false;if(!overlay.hidden)clearCacheButton.focus()}});
window.addEventListener('lyrion-carousel-status',refreshStatus);
openButton?.addEventListener('click',openSettings);closeButton?.addEventListener('click',closeSettings);overlay?.addEventListener('click',event=>{if(event.target===overlay)closeSettings()});document.addEventListener('keydown',event=>{if(event.key==='Escape'&&overlay&&!overlay.hidden){if(cacheConfirm&&!cacheConfirm.hidden){dismissCacheConfirm();clearCacheButton?.focus()}else closeSettings()}});
initialise();
window.__lyrionLmsConfigReady=loadLmsConfig();
