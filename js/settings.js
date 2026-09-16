const root=document.getElementById('book-fan-browser');
const openButton=root?.querySelector('.bf-settings-open'),overlay=root?.querySelector('.bf-settings-overlay'),closeButton=root?.querySelector('.bf-settings-close');
const player=root?.querySelector('.bf-player-select'),idle=root?.querySelector('.bf-idle-return'),random=root?.querySelector('.bf-random-duration'),density=root?.querySelector('.bf-carousel-density');
const aboutConnection=root?.querySelector('.bf-about-connection'),aboutPlayer=root?.querySelector('.bf-about-player'),aboutLibrary=root?.querySelector('.bf-about-library');
const storage={idle:'albumBrowserIdleReturnMs',random:'albumBrowserRandomScrollMs',density:'albumBrowserCarouselDensity'};
function get(key,fallback){try{return localStorage.getItem(key)??fallback}catch(_){return fallback}}
function set(key,value){try{localStorage.setItem(key,value)}catch(_){}}
function applyDensity(value){root.classList.remove('bf-density-compact','bf-density-normal','bf-density-spacious');root.classList.add('bf-density-'+value)}
function refreshStatus(){const label=root.querySelector('.bf-connection-label')?.textContent?.trim()||'—';aboutConnection.textContent=root.dataset.connected==='true'?'Connected · live':'Not connected';aboutLibrary.textContent=label;aboutPlayer.textContent=player?.selectedOptions?.[0]?.textContent||'—'}
function initialise(){idle.value=get(storage.idle,'30000');random.value=get(storage.random,'3000');density.value=get(storage.density,'normal');applyDensity(density.value)}
function openSettings(){if(!overlay)return;refreshStatus();overlay.hidden=false;closeButton?.focus()}
function closeSettings(){if(!overlay)return;overlay.hidden=true;openButton?.focus()}
idle?.addEventListener('change',()=>set(storage.idle,idle.value));
random?.addEventListener('change',()=>set(storage.random,random.value));
density?.addEventListener('change',()=>{set(storage.density,density.value);applyDensity(density.value)});
player?.addEventListener('change',()=>setTimeout(refreshStatus,0));
openButton?.addEventListener('click',openSettings);closeButton?.addEventListener('click',closeSettings);overlay?.addEventListener('click',event=>{if(event.target===overlay)closeSettings()});document.addEventListener('keydown',event=>{if(event.key==='Escape'&&overlay&&!overlay.hidden)closeSettings()});
initialise();
