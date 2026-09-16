/* Zero-idle-cost production diagnostics. The carousel itself owns animation frames;
   this module only reports genuinely long main-thread tasks when the browser supports it. */
if('PerformanceObserver' in window){try{new PerformanceObserver(list=>{for(const entry of list.getEntries())if(entry.duration>=100)console.warn(`Lyrion Carousel: long task ${Math.round(entry.duration)} ms`)}).observe({type:'longtask',buffered:true})}catch(_){}}
