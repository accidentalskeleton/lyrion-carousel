/* Screen-space Demo Mode explanations. All overlays are passive: no click
 * handlers and no LMS operations. Recompute arrows as a shelf/case animates.
 */
export const DEMO_SCENES=[
    {
        "title": "Your music, on a CD shelf",
        "detail": "Browse your collection as familiar CD spines.",
        "target": ".bf-stage"
    },
    {
        "title": "Scroll through the collection",
        "detail": "A smooth animated shelf lets you explore your albums.",
        "target": ".bf-stage"
    },
    {
        "title": "Open a jewel case",
        "extraMs": 1000,
        "detail": "Choose any album to see its artwork up close.",
        "target": ".bf-front-case"
    },
    {
        "title": "Album information",
        "extraMs": 3000,
        "popup": true,
        "detail": "See the track listing, discs and release details.",
        "target": ".bf-track-panel"
    },
    {
        "title": "Album actions",
        "extraMs": 3000,
        "popup": true,
        "detail": "Explore play and queue options without starting music.",
        "target": ".bf-album-menu"
    },
    {
        "title": "Sort by album",
        "detail": "Rearrange your shelf by album title.",
        "target": ".bf-order-toggle"
    },
    {
        "title": "Sort by artist",
        "detail": "Group albums together by artist.",
        "target": ".bf-order-toggle"
    },
    {
        "title": "Recently added CDs",
        "detail": "See the latest albums indexed in your library.",
        "target": ".bf-order-toggle"
    },
    {
        "title": "Random album discovery",
        "detail": "Select a surprise album, without playing it.",
        "target": ".bf-random"
    },
    {
        "title": "Discover forgotten music",
        "extraMs": 3000,
        "popup": true,
        "detail": "Explore Long Forgotten and Rarely Played options.",
        "target": ".bf-discovery-menu"
    },
    {
        "title": "An overlooked album",
        "extraMs": 1000,
        "detail": "Open a rediscovered album without changing playback.",
        "target": ".bf-front-case"
    },
    {
        "title": "Search your collection",
        "extraMs": 3000,
        "popup": true,
        "detail": "Find albums and artists quickly.",
        "target": ".bf-search-open"
    },
    {
        "title": "Choose your music source",
        "detail": "Switch between your Library and Spotify.",
        "target": ".bf-source-switch"
    },
    {
        "title": "Spotify on the CD shelf",
        "extraMs": 1000,
        "detail": "Explore Spotify albums using the same jewel cases.",
        "target": ".bf-front-case"
    },
    {
        "title": "Your personal library",
        "detail": "Return to the CDs in your own collection.",
        "target": ".bf-source-switch"
    },
    {
        "title": "Jump across large collections",
        "extraMs": 3000,
        "popup": true,
        "detail": "Use the fast scrubber or A–Z shortcuts to find CDs without endless swiping.",
        "target": ".bf-fast-nav-range"
    },
    {
        "title": "A final look at the cover",
        "extraMs": 1000,
        "detail": "Open a jewel case and enjoy the album artwork.",
        "target": ".bf-front-case"
    }
];
const clamp=(n,lo,hi)=>Math.max(lo,Math.min(hi,n));
export function createDemoGuide(root){
    const surface=root.querySelector('.bf-demo-guide');
    const banner=root.querySelector('.bf-demo-banner-progress');
    const bannerNote=root.querySelector('.bf-demo-banner-note');
    const callout=root.querySelector('.bf-demo-callout');
    const title=root.querySelector('.bf-demo-callout-title');
    const detail=root.querySelector('.bf-demo-callout-detail');
    const arrow=root.querySelector('.bf-demo-arrow');
    const path=root.querySelector('.bf-demo-arrow-path');
    let targetSelector='',currentStep=-1,frame=0,lastFrame=0,active=false,revealTimer=0,ready=false;
    // Guard the geometry methods so the standalone controller test doubles
    // can exercise the shared-session logic without implementing browser DOM.
    const canMeasure=()=>typeof root.getBoundingClientRect==='function'&&
      typeof callout?.getBoundingClientRect==='function';
    // All real popup surfaces are protected, not just the selected target.
    // In particular the track-information dialog and search panel must stay
    // readable throughout the tour on touchscreen and ultrawide displays.
    const popupSelector=[
        '.bf-track-overlay:not([hidden]) .bf-track-panel',
        '.bf-album-menu:not([hidden])',
        '.bf-discovery-menu:not([hidden])',
        '.bf-search-overlay:not([hidden]) .bf-search-panel',
        '.bf-fast-navigator:not([hidden])',
        '.bf-front-preview:not([hidden]) .bf-front-case'
    ].join(',');
    function locate(){
        if(!active||!ready||currentStep<0||!canMeasure())return;
        const selected=(targetSelector?root.querySelector(targetSelector):null)||
            root.querySelector(DEMO_SCENES[currentStep]?.target||'.bf-stage');
        if(!selected||typeof selected.getBoundingClientRect!=='function')return;
        const outer=root.getBoundingClientRect(),anchor=selected.getBoundingClientRect();
        if(outer.width<1||outer.height<1||anchor.width<1||anchor.height<1)return;
        const w=outer.width,h=outer.height;
        const tx=clamp(anchor.left+anchor.width/2-outer.left,14,w-14);
        const ty=clamp(anchor.top+anchor.height/2-outer.top,14,h-14);
        const bw=Math.min(294,Math.max(170,w-24));
        if(callout)callout.style.width=bw+'px';
        const bh=callout?.getBoundingClientRect().height||100;
        const limitX=Math.max(12,w-bw-12),limitY=Math.max(64,h-bh-12);
        // Coordinates are relative to the Carousel root. Include only
        // genuinely visible popup panels (hidden ancestors have zero rects).
        const blockers=Array.from(root.querySelectorAll?.(popupSelector)||[])
            .map(node=>node.getBoundingClientRect())
            .filter(rect=>rect.width>0&&rect.height>0)
            .map(rect=>({
                left:rect.left-outer.left-12,top:rect.top-outer.top-12,
                right:rect.right-outer.left+12,bottom:rect.bottom-outer.top+12
            }));
        const a={
            left:anchor.left-outer.left,right:anchor.right-outer.left,
            top:anchor.top-outer.top,bottom:anchor.bottom-outer.top
        };
        // Prefer the side of the highlighted control but also try above,
        // below and every corner. Never accept even a partial overlap with
        // a popup (including another open dialog from the previous scene).
        const candidates=[
            [a.right+20,ty-bh/2],[a.left-bw-20,ty-bh/2],
            [tx-bw/2,a.bottom+20],[tx-bw/2,a.top-bh-20],
            [12,64],[limitX,64],[12,limitY],[limitX,limitY],
            [tx-bw/2,64],[tx-bw/2,limitY]
        ];
        let best=null;
        for(const [cx,cy] of candidates){
            const x=clamp(cx,12,limitX),y=clamp(cy,64,limitY);
            if(blockers.some(rect=>
                Math.min(x+bw,rect.right)>Math.max(x,rect.left)&&
                Math.min(y+bh,rect.bottom)>Math.max(y,rect.top)))continue;
            const dx=Math.max(x-tx,0,tx-(x+bw));
            const dy=Math.max(y-ty,0,ty-(y+bh));
            const distance=Math.hypot(dx,dy);
            if(!best||distance<best.distance)best={x,y,distance};
        }
        if(!best){
            // Search and full-screen popups can occupy the entire viewport.
            // Show the explanation in a small bottom-docked banner instead
            // of masking the feature being demonstrated.
            if(surface)surface.dataset.compact='true';
            if(callout)callout.hidden=true;
            if(bannerNote){bannerNote.textContent=(title?.textContent||'')+' — '+(detail?.textContent||'');bannerNote.hidden=false}
            if(path?.setAttribute)path.setAttribute('d','');
            return;
        }
        if(surface)surface.dataset.compact='false';
        if(bannerNote)bannerNote.hidden=true;
        if(callout){
            callout.hidden=false;
            callout.style.left=best.x+'px';
            callout.style.top=best.y+'px';
        }
        const {x,y}=best;
        const sx=clamp(tx,x+8,x+bw-8),sy=clamp(ty,y+8,y+bh-8);
        // Start at the nearest card edge, away from the explanatory text.
        const right=tx>x+bw,left=tx<x,below=ty>y+bh,above=ty<y;
        let px=sx,py=sy;
        if(right)px=x+bw;else if(left)px=x;
        else if(below)py=y+bh;else if(above)py=y;
        const bendX=px+(tx-px)*.45,bendY=py+(ty-py)*.22;
        if(arrow)arrow.setAttribute('viewBox',`0 0 ${w} ${h}`);
        if(path)path.setAttribute('d',`M ${px.toFixed(1)} ${py.toFixed(1)} Q ${bendX.toFixed(1)} ${bendY.toFixed(1)} ${tx.toFixed(1)} ${ty.toFixed(1)}`);
    }
    function animate(now){
        if(!active)return;
        if(now-lastFrame>65){lastFrame=now;locate()}
        if(typeof requestAnimationFrame==='function')frame=requestAnimationFrame(animate);
    }
    function start(){
        clearTimeout(revealTimer);revealTimer=0;
        active=true;ready=false;currentStep=-1;
        if(surface){surface.hidden=false;surface.dataset.compact='false'}
        if(callout)callout.hidden=true;
        if(bannerNote)bannerNote.hidden=true;
        if(banner)banner.textContent='Starting showcase';
        if(!frame&&typeof requestAnimationFrame==='function')frame=requestAnimationFrame(animate);
    }
    function show(step,selector,selection){
        if(!active||!DEMO_SCENES[step])return;
        currentStep=step;targetSelector=selector||DEMO_SCENES[step].target;
        if(banner)banner.textContent=`Scene ${step+1} of ${DEMO_SCENES.length}`;
        const fallback=step===13&&selection?.source!=='spotify';
        if(title)title.textContent=fallback?'Spotify integration':DEMO_SCENES[step].title;
        if(detail)detail.textContent=fallback?
            'Spotify browsing is available when Spotty is connected. Your local CD shelf stays available.':
            DEMO_SCENES[step].detail;
        // Give a newly opened action menu, track dialog or navigator a
        // moment to settle before placing the annotation beside it.
        clearTimeout(revealTimer);revealTimer=0;ready=false;
        if(callout)callout.hidden=true;
        if(bannerNote)bannerNote.hidden=true;
        if(surface)surface.dataset.compact='false';
        const reveal=()=>{
            if(!active||currentStep!==step)return;
            ready=true;locate();
        };
        if(DEMO_SCENES[step].popup)revealTimer=setTimeout(reveal,500);
        else reveal();
    }
    function stop(){
        clearTimeout(revealTimer);revealTimer=0;
        active=false;ready=false;currentStep=-1;targetSelector='';
        if(frame&&typeof cancelAnimationFrame==='function')cancelAnimationFrame(frame);
        frame=0;lastFrame=0;
        if(surface){surface.hidden=true;surface.dataset.compact='false'}
        if(callout)callout.hidden=true;
        if(bannerNote)bannerNote.hidden=true;
        if(path?.setAttribute)path.setAttribute('d','');
    }
    window?.addEventListener?.('resize',()=>{if(active)locate()});
    return {start,show,stop};
}
