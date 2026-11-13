/* Large-library navigation: all selection operations are visual-only. */
export const clamp=(value,min,max)=>Math.min(max,Math.max(min,value));
export function scrubIndex(ratio,total){
    return Math.round(clamp(Number(ratio)||0,0,1)*Math.max(0,total-1));
}
export function scrubRatio(index,total){
    return total>1?clamp(index/(total-1),0,1):0;
}
// Preserve exact existing low-speed flick behaviour. Only deliberately fast,
// repeated gestures gain distance. Reversing direction resets the boost.
export function acceleratedFlick(velocity,{previousVelocity=0,elapsed=Infinity,total=0,enabled=true}={}){
    const baseline=velocity*1.35;
    if(!enabled||total<100||Math.abs(velocity)<.7)return baseline;
    const sameDirection=Math.sign(velocity)===Math.sign(previousVelocity);
    const repeat=sameDirection&&elapsed<750?Math.min(2.6,1+(750-elapsed)/470):1;
    const intensity=clamp((Math.abs(velocity)-.7)/2.5,0,1);
    return Math.sign(baseline)*Math.min(Math.max(1,total*.28),
        Math.abs(baseline)*(1+intensity*5)*repeat);
}
export function createFastNavigator(root,{state,jump,onActivity,jumpLetter}){
    const shell=root.querySelector('.bf-fast-navigator');
    const handle=root.querySelector('.bf-fast-nav-toggle');
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
        const {total,index,mode,album}=state();
        // The slider's native value is an *album index*, not a fixed 0–1000
        // percentage. Keyboard/assistive navigation can therefore select
        // every individual CD even in libraries containing 10,000+ titles.
        slider.max=String(Math.max(0,total-1));
        slider.value=String(clamp(index,0,Math.max(0,total-1)));
        slider.disabled=total<2;
        count.textContent=total?(Math.min(index,total-1)+1).toLocaleString()+' / '+total.toLocaleString()+' CDs':'No CDs';
        caption.textContent=album?(album[1]+' — '+album[0]):modeLabel(mode);
        letters.hidden=!(mode==='artistAlbum'||mode==='album');
        root.dataset.fastNavOrder=mode;
    }
    function cancelHide(){clearTimeout(timer);timer=0}
    function hide(){
        if(dragging)return;
        opened=false;shell.hidden=true;handle.setAttribute('aria-expanded','false');
    }
    function armHide(){
        cancelHide();
        if(opened&&!dragging)timer=setTimeout(hide,3200);
    }
    function show(){
        if(state().total<2)return;
        opened=true;shell.hidden=false;
        handle.setAttribute('aria-expanded','true');
        render();armHide();
    }
    function commit(value,final){
        const current=state(),index=clamp(Math.round(Number(value)||0),0,Math.max(0,current.total-1));
        ++request;
        onActivity();
        jump(index,final,request);
        const album=state().albumAt?.(index);
        caption.textContent=album?album[1]+' — '+album[0]:modeLabel(current.mode);
        count.textContent=(index+1).toLocaleString()+' / '+current.total.toLocaleString()+' CDs';
        if(final)armHide();
    }
    handle.addEventListener('click',()=>opened?hide():show());
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
    shell.addEventListener('pointerenter',cancelHide);
    shell.addEventListener('pointerleave',armHide);
    shell.addEventListener('focusin',cancelHide);
    shell.addEventListener('focusout',armHide);
    window.addEventListener('pagehide',cancelHide);
    handle.setAttribute('aria-expanded','false');
    return {render(){if(opened)render()},show,hide,active:()=>dragging};
}
