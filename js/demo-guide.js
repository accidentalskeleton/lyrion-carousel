/* Screen-space Demo Mode explanations. All overlays are passive: no click
 * handlers and no LMS operations. Recompute arrows as a shelf/case animates.
 */
const SCENES=[
    {title:'Your music, on a CD shelf',detail:'Browse your albums as familiar CD spines.',target:'.bf-stage'},
    {title:'Browse naturally',detail:'The shelf glides smoothly to another album.',target:'.bf-stage'},
    {title:'Open a jewel case',detail:'Select an album to reveal its full cover.',target:'.bf-front-case'},
    {title:'Explore your collection',detail:'Jump through your library without interrupting playback.',target:'.bf-stage'},
    {title:'Album artwork, up close',detail:'The jewel case opens right on the shelf.',target:'.bf-front-case'},
    {title:'Switch music sources',detail:'Browse your own music or Spotify independently.',target:'.bf-source-switch'},
    {title:'Discover Spotify albums',detail:'Spotify albums use the same interactive CD presentation.',target:'.bf-front-case'},
    {title:'Back to your own CDs',detail:'Return to your library and explore more covers.',target:'.bf-front-case'}
];
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
export function createDemoGuide(root){
    const surface=root.querySelector('.bf-demo-guide');
    const banner=root.querySelector('.bf-demo-banner-progress');
    const callout=root.querySelector('.bf-demo-callout');
    const title=root.querySelector('.bf-demo-callout-title');
    const detail=root.querySelector('.bf-demo-callout-detail');
    const arrow=root.querySelector('.bf-demo-arrow');
    const path=root.querySelector('.bf-demo-arrow-path');
    let targetSelector='',currentStep=-1,frame=0,lastFrame=0,active=false;
    // Guard the geometry methods so the standalone controller test doubles
    // can exercise the shared-session logic without implementing browser DOM.
    const canMeasure=()=>typeof root.getBoundingClientRect==='function'&&
      typeof callout?.getBoundingClientRect==='function';
    function locate(){
        if(!active||!canMeasure())return;
        const selected=root.querySelector(targetSelector)||
          root.querySelector(SCENES[currentStep]?.target||'.bf-stage');
        if(!selected||typeof selected.getBoundingClientRect!=='function')return;
        const outer=root.getBoundingClientRect(),anchor=selected.getBoundingClientRect();
        if(outer.width<1||outer.height<1||anchor.width<1||anchor.height<1)return;
        const w=outer.width,h=outer.height;
        const tx=clamp(anchor.left+anchor.width/2-outer.left,14,w-14);
        const ty=clamp(anchor.top+anchor.height/2-outer.top,14,h-14);
        // Prefer placing the explanation beside the album; move it below
        // top-bar controls and keep it in the visible viewport on iPad/Pi.
        const bw=Math.min(294,Math.max(170,w-24));
        callout.style.width=bw+'px';
        const bh=callout.getBoundingClientRect().height||90;
        const side=tx>w*.54?'left':'right';
        let x=side==='left'?tx-bw-62:tx+62;
        x=clamp(x,12,Math.max(12,w-bw-12));
        let y=clamp(ty-bh/2,70,Math.max(70,h-bh-12));
        // When pointing to a header control, the callout goes beneath it.
        if(ty<75)y=clamp(ty+55,70,Math.max(70,h-bh-12));
        // If the label would cover the target, move it above or below.
        if(tx>=x-12&&tx<=x+bw+12&&ty>=y-12&&ty<=y+bh+12)
            y=clamp(ty+54,70,Math.max(70,h-bh-12));
        callout.style.left=x+'px';
        callout.style.top=y+'px';
        const sx=clamp(tx,x+8,x+bw-8);
        const sy=clamp(ty,y+8,y+bh-8);
        // Start from the closest box edge so the arrow never crosses text.
        const right=tx>x+bw,left=tx<x,below=ty>y+bh,above=ty<y;
        let px=sx,py=sy;
        if(right)px=x+bw;else if(left)px=x;
        else if(below)py=y+bh;else if(above)py=y;
        const bendX=px+(tx-px)*.45,bendY=py+(ty-py)*.22;
        arrow.setAttribute('viewBox',`0 0 ${w} ${h}`);
        path.setAttribute('d',`M ${px.toFixed(1)} ${py.toFixed(1)} Q ${bendX.toFixed(1)} ${bendY.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)}`);
    }
    function animate(now){
        if(!active)return;
        if(now-lastFrame>65){lastFrame=now;locate()}
        if(typeof requestAnimationFrame==='function')frame=requestAnimationFrame(animate);
    }
    function start(){
        active=true;
        if(surface)surface.hidden=false;
        if(callout)callout.hidden=true;
        if(banner)banner.textContent='Starting showcase';
        if(!frame&&typeof requestAnimationFrame==='function')frame=requestAnimationFrame(animate);
    }
    function show(step,selector){
        if(!active||!SCENES[step])return;
        currentStep=step;targetSelector=selector||SCENES[step].target;
        if(banner)banner.textContent=`Scene ${step+1} of ${SCENES.length}`;
        if(title)title.textContent=SCENES[step].title;
        if(detail)detail.textContent=SCENES[step].detail;
        if(callout)callout.hidden=false;
        locate();
    }
    function stop(){
        active=false;currentStep=-1;targetSelector='';
        if(frame&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(frame);
        frame=0;lastFrame=0;
        if(surface)surface.hidden=true;
        if(callout)callout.hidden=true;
        if(path?.setAttribute)path.setAttribute('d','');
    }
    window?.addEventListener?.('resize',()=>{if(active)locate()});
    return {start,show,stop};
}
