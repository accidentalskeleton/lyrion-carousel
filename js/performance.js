/* Lightweight production diagnostics: no polling and no UI cost while idle. */
const root=document.getElementById('book-fan-browser');
let frames=0,start=0,lowWindows=0;
function sample(now){if(!start)start=now;frames++;if(now-start>=2000){const fps=frames*1000/(now-start);root.dataset.fps=String(Math.round(fps));if(fps<45)lowWindows++;else lowWindows=0;if(lowWindows===3)console.warn(`Lyrion Carousel: sustained carousel frame rate ${fps.toFixed(1)} fps; loaded DOM albums: ${root.querySelectorAll('.bf-album').length}`);frames=0;start=now}requestAnimationFrame(sample)}
if(!matchMedia('(prefers-reduced-motion: reduce)').matches)requestAnimationFrame(sample);
if('PerformanceObserver' in window){try{new PerformanceObserver(list=>{for(const entry of list.getEntries())if(entry.duration>=100)console.warn(`Lyrion Carousel: long task ${Math.round(entry.duration)} ms`)}).observe({type:'longtask',buffered:true})}catch(_){}}
