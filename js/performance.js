/* Optional, session-scoped browser performance measurements.
   Idle cost is limited to the existing long-task warning observer; sampling,
   mutation observation and requestAnimationFrame run only when explicitly started.
   Open browser DevTools and call:
     lyrionPerf.start({label:'Phase 4'});
     lyrionPerf.stop();
     lyrionPerf.compare(baselineReport,phase4Report);
   For a fixed window: await lyrionPerf.measure({seconds:15,label:'Phase 4'});
*/
if('PerformanceObserver' in window){
    try{
        new PerformanceObserver(list=>{
            for(const entry of list.getEntries())
                if(entry.duration>=100)console.warn(`Lyrion Carousel: long task ${Math.round(entry.duration)} ms`);
        }).observe({type:'longtask',buffered:true});
    }catch(_){}
}

const round=(value,digits=1)=>value==null?null:Number(value.toFixed(digits));
function percentile(values,percent){
    if(!values.length)return null;
    const sorted=[...values].sort((a,b)=>a-b);
    const rank=(sorted.length-1)*percent/100;
    const lo=Math.floor(rank),hi=Math.ceil(rank);
    return sorted[lo]+(sorted[hi]-sorted[lo])*(rank-lo);
}
// A robust rAF interval estimate, independent of the user's requested target.
function estimateRefreshRate(intervals){
    const reasonable=intervals.filter(ms=>ms>=4&&ms<=50);
    if(reasonable.length<15)return null;
    // The lower half avoids occasional missed frames dragging the median down.
    const fastCutoff=percentile(reasonable,60);
    const regular=reasonable.filter(ms=>ms<=fastCutoff);
    const interval=percentile(regular,50);
    return interval>0?round(Math.min(240,Math.max(24,1000/interval)),1):null;
}
function countAlbumNodes(node){
    if(node.nodeType!==1)return 0;
    return (node.matches?.('.bf-album')?1:0)+(node.querySelectorAll?.('.bf-album').length||0);
}
function classifyResource(name){
    try{
        const pathname=new URL(name,location.href).pathname;
        if(/^\/api\/(?:art|spotty-art)(?:\/|$)/.test(pathname))return 'artwork';
        if(/^\/api\/(?:catalogue|art-meta|spotty-art-meta)(?:\/|$)/.test(pathname))return 'metadata';
    }catch(_){}
    return null;
}
let active=null,lastReport=null;
function start({label='Carousel',targetFps=null}={}){
    // Explicit FPS remains useful for fixed-budget comparisons. Null selects
    // the display rate inferred from requestAnimationFrame timestamps.
    if(active)throw Error('Lyrion performance capture already running');
    if(targetFps!==null&&(!Number.isFinite(targetFps)||targetFps<24||targetFps>240))throw Error('targetFps must be 24–240');
    const stage=document.querySelector('#book-fan-browser .bf-stage');
    if(!stage)throw Error('Carousel shelf not found');
    const session={
        label,targetFps,started:performance.now(),frameTimes:[],activeTimes:[],lastFrame:null,
        activeUntil:0,activeMs:0,suspensions:[],lastVisible:document.visibilityState!=='hidden',
        listeners:[],
        frameHandle:0,observer:null,mutations:null,
        longTasks:[],resources:{artwork:{count:0,bytes:0},metadata:{count:0,bytes:0}},
        addedSpines:0,removedSpines:0,initialSpines:stage.querySelectorAll('.bf-album').length,
        stage,initialHeap:performance.memory?.usedJSHeapSize??null
    };
    const activity=()=>{
        if(active===session&&document.visibilityState!=='hidden')
            session.activeUntil=performance.now()+350;
    };
    const listen=(element,name,fn,options)=>{
        element.addEventListener?.(name,fn,options);
        session.listeners.push(()=>element.removeEventListener?.(name,fn,options));
    };
    // Only input on the carousel itself counts as browsing. A pointer
    // hovering elsewhere or DevTools interactions must not inflate active FPS.
    listen(stage,'wheel',activity,{passive:true});
    listen(stage,'pointermove',event=>{if(event.buttons)activity()},{passive:true});
    listen(stage,'pointerdown',activity,{passive:true});
    listen(stage,'touchmove',activity,{passive:true});
    listen(document,'keydown',event=>{
        if(['ArrowLeft','ArrowRight','PageUp','PageDown','Home','End'].includes(event.key))
            activity();
    });
    listen(document,'visibilitychange',()=>{
        session.lastVisible=document.visibilityState!=='hidden';
        session.lastFrame=null;
        session.activeUntil=0;
    });
    const frame=now=>{
        if(active!==session)return;
        if(session.lastFrame!==null){
            const ms=now-session.lastFrame;
            if(ms>0){
                // A seconds-long rAF gap is usually a tab/OS suspension,
                // not hundreds of individual frames missed by the renderer.
                if(ms>250||!session.lastVisible){
                    session.suspensions.push(ms);
                }else if(session.frameTimes.length<18000){
                    session.frameTimes.push(ms);
                    if(now<=session.activeUntil){
                        session.activeTimes.push(ms);
                        session.activeMs+=ms;
                    }
                }
            }
        }
        session.lastFrame=now;
        session.frameHandle=requestAnimationFrame(frame);
    };
    if(typeof MutationObserver==='function'){
        session.mutations=new MutationObserver(records=>{
            for(const record of records){
                for(const node of record.addedNodes)session.addedSpines+=countAlbumNodes(node);
                for(const node of record.removedNodes)session.removedSpines+=countAlbumNodes(node);
            }
        });
        session.mutations.observe(stage,{childList:true,subtree:false});
    }
    if(typeof PerformanceObserver==='function'){
        try{
            session.observer=new PerformanceObserver(list=>{
                for(const entry of list.getEntries()){
                    if(entry.entryType==='longtask'){
                        session.longTasks.push(entry.duration);
                    }else if(entry.entryType==='resource'){
                        const kind=classifyResource(entry.name);
                        if(kind){
                            session.resources[kind].count++;
                            session.resources[kind].bytes+=entry.transferSize||0;
                        }
                    }
                }
            });
            session.observer.observe({entryTypes:['longtask','resource']});
        }catch(_){session.observer?.disconnect();session.observer=null;}
    }
    active=session;
    session.frameHandle=requestAnimationFrame(frame);
    console.info(`Lyrion performance capture started: ${label}. Scroll the shelf; call lyrionPerf.stop() to finish.`);
    return {label,targetFps};
}
function stop(){
    if(!active)throw Error('No active Lyrion performance capture');
    const session=active;active=null;
    cancelAnimationFrame(session.frameHandle);
    session.mutations?.takeRecords().forEach(record=>{
        for(const node of record.addedNodes)session.addedSpines+=countAlbumNodes(node);
        for(const node of record.removedNodes)session.removedSpines+=countAlbumNodes(node);
    });
    session.mutations?.disconnect();
    session.observer?.takeRecords().forEach(entry=>{
        if(entry.entryType==='longtask')session.longTasks.push(entry.duration);
        else if(entry.entryType==='resource'){
            const kind=classifyResource(entry.name);
            if(kind){
                session.resources[kind].count++;
                session.resources[kind].bytes+=entry.transferSize||0;
            }
        }
    });
    session.observer?.disconnect();
    session.listeners.forEach(remove=>remove());
    const elapsed=Math.max(1,performance.now()-session.started);
    const detectedFps=estimateRefreshRate(session.frameTimes);
    const effectiveFps=session.targetFps||detectedFps;
    const budget=effectiveFps?1000/effectiveFps:null;
    const durations=session.frameTimes,activeDurations=session.activeTimes;
    const dropped=values=>budget?values.reduce((sum,ms)=>sum+Math.max(0,Math.round(ms/budget)-1),0):null;
    const summary=values=>({
        mean:round(values.length?values.reduce((sum,n)=>sum+n,0)/values.length:null,2),
        p95:round(percentile(values,95),2),p99:round(percentile(values,99),2),
        max:round(values.length?Math.max(...values):null,2)
    });
    const report={
        label:session.label,
        timestamp:new Date().toISOString(),
        seconds:round(elapsed/1000,2),
        targetFps:session.targetFps,
        detectedFps,
        effectiveFps,
        frameBudgetMs:round(budget,2),
        sampledFrames:durations.length,
        // Sampled FPS excludes tab suspension and rAF gaps >250ms.
        estimatedFps:round(durations.length?1000/(durations.reduce((a,b)=>a+b,0)/durations.length):null,2),
        frameMs:summary(durations),
        framesOverBudget:budget?durations.filter(ms=>ms>budget*1.1).length:null,
        estimatedDroppedFrames:dropped(durations),
        activeScrolling:{
            sampledFrames:activeDurations.length,
            estimatedFps:round(session.activeMs>0?activeDurations.length*1000/session.activeMs:null,2),
            frameMs:summary(activeDurations),
            framesOverBudget:budget?activeDurations.filter(ms=>ms>budget*1.1).length:null,
            estimatedDroppedFrames:dropped(activeDurations)
        },
        suspensions:{count:session.suspensions.length,
            totalMs:round(session.suspensions.reduce((a,b)=>a+b,0),1),
            longestMs:round(session.suspensions.length?Math.max(...session.suspensions):null,1)},
        longTasks:{count:session.longTasks.length,totalMs:round(session.longTasks.reduce((sum,n)=>sum+n,0),1)},
        dom:{initialSpines:session.initialSpines,finalSpines:session.stage.querySelectorAll('.bf-album').length,
            addedSpines:session.addedSpines,removedSpines:session.removedSpines},
        requests:session.resources,
        heapMB:{start:session.initialHeap==null?null:round(session.initialHeap/1048576,2),
            end:performance.memory?.usedJSHeapSize==null?null:round(performance.memory.usedJSHeapSize/1048576,2)}
    };
    lastReport=report;
    console.table({detectedHz:report.detectedFps,frames:report.sampledFrames,
        activeFps:report.activeScrolling.estimatedFps,activeP95Ms:report.activeScrolling.frameMs.p95,
        dropped:report.activeScrolling.estimatedDroppedFrames,suspensions:report.suspensions.count,
        longTasks:report.longTasks.count,spinesAdded:report.dom.addedSpines,
        spinesRemoved:report.dom.removedSpines,artRequests:report.requests.artwork.count});
    console.info('Full Lyrion performance report (copy this object):',report);
    return report;
}
function compare(baseline,candidate){
    if(!baseline||!candidate)throw Error('Provide baseline and candidate reports');
    const metrics={
        'Active frame p95 (ms)': [baseline.activeScrolling?.frameMs?.p95,candidate.activeScrolling?.frameMs?.p95],
        'Frame p95 (ms)': [baseline.frameMs.p95,candidate.frameMs.p95],
        'Frame p99 (ms)': [baseline.frameMs.p99,candidate.frameMs.p99],
        'Active estimated dropped frames':[baseline.activeScrolling?.estimatedDroppedFrames,candidate.activeScrolling?.estimatedDroppedFrames],
        'Estimated dropped frames':[baseline.estimatedDroppedFrames,candidate.estimatedDroppedFrames],
        'Long tasks':[baseline.longTasks.count,candidate.longTasks.count],
        'Created spine nodes':[baseline.dom.addedSpines,candidate.dom.addedSpines],
        'Removed spine nodes':[baseline.dom.removedSpines,candidate.dom.removedSpines],
        'Artwork requests':[baseline.requests.artwork.count,candidate.requests.artwork.count]
    };
    const result=Object.fromEntries(Object.entries(metrics).map(([name,[oldValue,newValue]])=>[
        name,{baseline:oldValue,candidate:newValue,
            improvementPercent:oldValue>0&&newValue!=null?round((oldValue-newValue)/oldValue*100,1):null}
    ]));
    console.table(result);
    return result;
}
async function measure({seconds=15,...options}={}){
    if(!Number.isFinite(seconds)||seconds<1||seconds>120)throw Error('seconds must be between 1 and 120');
    start(options);
    await new Promise(resolve=>setTimeout(resolve,seconds*1000));
    return stop();
}
window.lyrionPerf=Object.freeze({start,stop,measure,compare,get lastReport(){return lastReport},get active(){return !!active}});
