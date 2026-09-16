const root=document.getElementById('book-fan-browser');
const openButton=root?.querySelector('.bf-settings-open'),overlay=root?.querySelector('.bf-settings-overlay'),closeButton=root?.querySelector('.bf-settings-close');
const player=root?.querySelector('.bf-player-select'),idle=root?.querySelector('.bf-idle-return'),random=root?.querySelector('.bf-random-duration'),density=root?.querySelector('.bf-carousel-density');
const aboutConnection=root?.querySelector('.bf-about-connection'),aboutLive=root?.querySelector('.bf-about-live'),aboutPlayer=root?.querySelector('.bf-about-player'),aboutLibrary=root?.querySelector('.bf-about-library'),aboutCache=root?.querySelector('.bf-about-cache'),aboutVersion=root?.querySelector('.bf-about-version');
const storage={idle:'albumBrowserIdleReturnMs',random:'albumBrowserRandomScrollMs',density:'albumBrowserCarouselDensity'};
function get(key,fallback){try{return localStorage.getItem(key)??fallback}catch(_){return fallback}}
function set(key,value){try{localStorage.setItem(key,value)}catch(_){}}
function apply(value,name){set(storage[name],value);window.dispatchEvent(new CustomEvent('lyrion-carousel-setting',{detail:{name,value}}))}
function refreshStatus(){const label=root.querySelector('.bf-connection-label')?.textContent?.trim()||'—',cached=root.dataset.catalogueSource==='cache';aboutConnection.textContent=root.dataset.connected==='true'?'Connected':'Not connected';if(aboutLive)aboutLive.textContent=root.dataset.liveUpdates==='true'?'Connected':root.dataset.liveUpdates==='connecting'?'Connecting…':'Disconnected';aboutLibrary.textContent=cached?label+' · cached':label;aboutPlayer.textContent=player?.selectedOptions?.[0]?.textContent||'—';if(aboutCache)aboutCache.textContent=cached?'Using cached catalogue':'Artwork cache enabled'}
async function loadVersion(){try{const r=await fetch('VERSION',{cache:'no-store'});if(r.ok)aboutVersion.textContent='v'+(await r.text()).trim()}catch(_){aboutVersion.textContent=''}}
function initialise(){idle.value=get(storage.idle,'30000');random.value=get(storage.random,'3000');density.value=get(storage.density,'normal');window.__lyrionCarouselSettings={idle:Number(idle.value),random:Number(random.value),density:density.value};loadVersion()}
function openSettings(){if(!overlay)return;refreshStatus();overlay.hidden=false;closeButton?.focus()}
function closeSettings(){if(!overlay)return;overlay.hidden=true;openButton?.focus()}
idle?.addEventListener('change',()=>apply(idle.value,'idle'));
random?.addEventListener('change',()=>apply(random.value,'random'));
density?.addEventListener('change',()=>apply(density.value,'density'));
player?.addEventListener('change',()=>setTimeout(refreshStatus,0));
window.addEventListener('lyrion-carousel-status',refreshStatus);
openButton?.addEventListener('click',openSettings);closeButton?.addEventListener('click',closeSettings);overlay?.addEventListener('click',event=>{if(event.target===overlay)closeSettings()});document.addEventListener('keydown',event=>{if(event.key==='Escape'&&overlay&&!overlay.hidden)closeSettings()});
initialise();
