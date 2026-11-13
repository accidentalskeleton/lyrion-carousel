/* Gesture-aware fast navigation. All actions remain visual-only. */
export const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
export function scrubIndex(ratio,total){
    return Math.round(clamp(Number(ratio)||0,0,1)*Math.max(0,total-1));
}
export function scrubRatio(index,total){
    return total>1?clamp(index/(total-1),0,1):0;
}
// Give a circular shelf one wrap position at either end of the scrubber.
// Moving left of album 1 selects the last album; moving right of the last
// selects album 1. Bounded orders retain their original finite endpoints.
export function scrubRange(total,circular=false){
    return circular&&total>1?{min:-1,max:total}:{min:0,max:Math.max(0,total-1)};
}
export function scrubAlbumIndex(value,total,circular=false){
    if(total<=0)return 0;
    const index=Math.round(Number(value)||0);
    return circular?((index%total)+total)%total:clamp(index,0,total-1);
}
// Velocity is measured in pixels per millisecond. A quick gesture now
// provides useful inertia even on a ~169-CD shelf; normal drags retain their
// original precisely controlled momentum. Reversed flicks do not chain.
export function acceleratedFlick(velocity,{previousVelocity=0,elapsed=Infinity,total=0,enabled=true}={}){
    const baseline=velocity*1.35;
    if(!enabled||total<100||Math.abs(velocity)<.55)return baseline;
    const intensity=clamp((Math.abs(velocity)-.55)/1.5,0,1);
    const travel=Math.abs(velocity)*(240/175)*(1+intensity*4);
    const sameDirection=Math.sign(velocity)===Math.sign(previousVelocity);
    const repeat=sameDirection&&elapsed<1000?1+1.25*(1-elapsed/1000):1;
    const limit=Math.min(48,Math.max(6,total*.32));
    return Math.sign(velocity)*Math.max(Math.abs(baseline),Math.min(limit,travel*repeat));
}
// A scroll-wheel notch is different from a precise trackpad movement.
// Only repeated wheel notches are boosted; small deltas stay exactly as before.
export function acceleratedWheel(delta,{total=0,streak=0}={}){
    if(total<100||Math.abs(delta)<65||streak<2)return delta;
    return Math.sign(delta)*Math.min(Math.abs(delta)*(1+Math.min(6,streak-1)*1.25),1500);
}
// Reveal only after deliberate extended navigation: quick flicks may still
// accelerate immediately, but the scrub panel must not interrupt casual use.
export function shouldRevealForWheel({streak=0,distance=0,total=0}={}){
    return total>=100&&streak>=8&&distance>=900;
}
export function createSwipeNavigationDetector(){
    let count=0,lastAt=-Infinity,lastDirection=0;
    return {
        record({distance=0,duration=Infinity,velocity=0,now=0,direction=0}={}){
            if(distance<70||duration>900||direction===0){count=0;return false}
            if(now-lastAt>2200||direction!==lastDirection)count=0;
            count++;lastAt=now;lastDirection=direction;
            const speed=Math.abs(velocity);
            return (speed>=.9&&distance>=90&&count>=3)||
                (speed>=.3&&distance>=75&&count>=5);
        },
        reset(){count=0;lastAt=-Infinity;lastDirection=0}
    };
}
export function createFastNavigator(root,{state,jump,onActivity,jumpLetter}){
    const shell=root.querySelector('.bf-fast-navigator');
    const slider=root.querySelector('.bf-fast-nav-range');
    const caption=root.querySelector('.bf-fast-nav-label');
    const count=root.querySelector('.bf-fast-nav-count');
    const letters=root.querySelector('.bf-fast-nav-letters');
    const exit=root.querySelector('.bf-fast-nav-close');
    let timer=0,dragging=false,opened=false,request=0;
    function modeLabel(mode){
        return mode==='artistAlbum'?'Artists A–Z':
            mode==='album'?'Albums A–Z':mode==='indexed'?'Recently added':
            mode==='recent'?'New music':mode==='colour'?'Spine colours':'Random order';
    }
    function render(){
        const {total,index,mode,album,circular=false}=state();
        const range=scrubRange(total,circular);
        slider.min=String(range.min);
        slider.max=String(range.max);
        if(!dragging)slider.value=String(clamp(index,0,Math.max(0,total-1)));
        slider.disabled=total<2;
        if(!dragging){
            count.textContent=total?(Math.min(index,total-1)+1).toLocaleString()+' / '+total.toLocaleString()+' CDs':'No CDs';
            caption.textContent=album?(album[1]+' — '+album[0]):modeLabel(mode);
        }
        letters.hidden=!(mode==='artistAlbum'||mode==='album');
        root.dataset.fastNavOrder=mode;
    }
    function cancelHide(){clearTimeout(timer);timer=0}
    function hide(){
        if(dragging)return;
        cancelHide();opened=false;shell.hidden=true;
    }
    function armHide(){
        cancelHide();
        if(opened&&!dragging)timer=setTimeout(hide,4200);
    }
    function show({keepOpen=false}={}){
        if(state().total<2)return;
        opened=true;shell.hidden=false;
        render();
        // Demo Mode can hold the navigation control visible until its scene
        // ends; user-invoked fast navigation retains the 4.2-second timeout.
        if(keepOpen)cancelHide();else armHide();
    }
    function commit(value,final){
        const current=state(),index=scrubAlbumIndex(value,current.total,current.circular);
        ++request;
        onActivity();
        jump(index,final,request);
        const album=state().albumAt?.(index);
        caption.textContent=album?album[1]+' — '+album[0]:modeLabel(current.mode);
        count.textContent=(index+1).toLocaleString()+' / '+current.total.toLocaleString()+' CDs';
        if(final)armHide();
    }
    exit.addEventListener('click',hide);
    slider.addEventListener('pointerdown',()=>{dragging=true;cancelHide()});
    slider.addEventListener('input',()=>commit(slider.value,false));
    slider.addEventListener('change',()=>{dragging=false;commit(slider.value,true)});
    for(const letter of 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'){
        const button=document.createElement('button');
        button.type='button';button.textContent=letter;
        button.setAttribute('aria-label','Jump to '+letter);
        button.addEventListener('click',()=>{onActivity();jumpLetter(letter);armHide()});
        letters.append(button);
    }
    function release(){if(dragging){dragging=false;commit(slider.value,true)}}
    slider.addEventListener('pointerup',release);
    slider.addEventListener('pointercancel',release);
    shell.addEventListener('pointerdown',cancelHide);
    shell.addEventListener('pointerup',armHide);
    shell.addEventListener('keydown',armHide);
    window.addEventListener('pagehide',cancelHide);
    return {render(){if(opened)render()},show,hide,visible:()=>opened,active:()=>dragging};
}
