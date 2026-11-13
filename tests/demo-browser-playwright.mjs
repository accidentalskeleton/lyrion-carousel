// Real Chromium smoke test for the local visual Demo settings and stop gesture.
// Run against a static server; built-in sample albums need no LMS connection.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const url=process.argv[2]||'http://127.0.0.1:8089/';
const browser=await chromium.launch({headless:true});
try{
    const page=await browser.newPage({viewport:{width:1280,height:720}});
    const errors=[];
    page.on('pageerror',error=>errors.push(error.message));
    await page.goto(url,{waitUntil:'domcontentloaded'});
    await page.waitForFunction(()=>document.querySelector('#book-fan-browser')?.dataset.ready==='true',{timeout:15000});
    // Exercise actual rendered CD surfaces, not the synthetic shelf-geometry
    // harness (which deliberately starts with its front case hidden).
    const dim=await page.evaluate(()=>{
        const root=document.querySelector('#book-fan-browser');
        const shelf=root.querySelector('.bf-stage');
        const cover=root.querySelector('.bf-front-preview');
        const hidden=cover.hidden,visible=cover.dataset.visible;
        const previous=root.dataset.playerPower;
        shelf.style.transition='none';cover.style.transition='none';
        cover.hidden=false;cover.dataset.visible='true';
        root.dataset.playerPower='off';
        const off=[Number(getComputedStyle(shelf).opacity),Number(getComputedStyle(cover).opacity)];
        root.dataset.playerPower='on';
        const on=[Number(getComputedStyle(shelf).opacity),Number(getComputedStyle(cover).opacity)];
        root.dataset.playerPower=previous||'unknown';
        cover.hidden=hidden;
        if(visible===undefined)delete cover.dataset.visible;else cover.dataset.visible=visible;
        shelf.style.removeProperty('transition');cover.style.removeProperty('transition');
        return {off,on};
    });
    if(!(dim.off[0]<dim.on[0]&&dim.off[1]<dim.on[1]))
        throw Error('Power-off CD shelf/case opacity regression: '+JSON.stringify(dim));
    // Fast scrubber is contextual, shelf-centred and never occupies player space.
    if(await page.locator('.bf-fast-navigator').isVisible())
        throw Error('Fast navigator must start hidden');
    if(await page.locator('.bf-fast-nav-toggle').count())
        throw Error('Permanent Navigate pill should not exist');
    for(const viewport of [{width:2560,height:720},{width:1024,height:768},{width:1280,height:720}]){
        await page.setViewportSize(viewport);
        await page.keyboard.press('n');
        const state=await page.evaluate(()=>{
            const panel=document.querySelector('.bf-fast-navigator');
            const stage=document.querySelector('.bf-stage');
            const screen=document.querySelector('.bf-screen');
            const r=panel.getBoundingClientRect(),s=screen.getBoundingClientRect(),shelf=stage.getBoundingClientRect();
            return {visible:!panel.hidden,within:r.left>=s.left-1&&r.right<=s.right+1&&
                r.top>=s.top-1&&r.bottom<=s.bottom+1,
                centred:Math.abs((r.top+r.bottom)/2-(shelf.top+shelf.bottom)/2)<4,
                widthRatio:r.width/shelf.width};
        });
        if(!state.visible||!state.within||!state.centred||Math.abs(state.widthRatio-.8)>.015)
            throw Error('Fast navigator must be centred and 80% of shelf width at '+viewport.width+': '+JSON.stringify(state));
        const range=await page.locator('.bf-fast-nav-range').evaluate(input=>({min:Number(input.min),max:Number(input.max)}));
        if(range.min!==-1||range.max!==5)
            throw Error('Circular shelf requires wrap endpoints: '+JSON.stringify(range));
        for(const [value,label] of [[4,'5 / 5'],[5,'1 / 5'],[-1,'5 / 5']]){
            await page.locator('.bf-fast-nav-range').evaluate((input,value)=>{
                input.value=String(value);
                input.dispatchEvent(new Event('input',{bubbles:true}));
                input.dispatchEvent(new Event('change',{bubbles:true}));
            },value);
            if(!(await page.locator('.bf-fast-nav-count').textContent())?.includes(label))
                throw Error('Circular scrub seam '+value+' did not select '+label);
        }
        // Scrolling the CD shelf itself dismisses the floating navigator.
        await page.locator('.bf-stage').evaluate(stage=>
            stage.dispatchEvent(new WheelEvent('wheel',{deltaY:120,bubbles:true,cancelable:true})));
        if(await page.locator('.bf-fast-navigator').isVisible())
            throw Error('Direct CD wheel browsing must hide fast navigation');
        await page.keyboard.press('n');
        const bounds=await page.locator('.bf-stage').boundingBox();
        // Begin outside the slider/letter hit targets; those are intentionally
        // interactive even though the rest of the panel lets CD input through.
        const startX=bounds.x+bounds.width*.04,startY=bounds.y+bounds.height*.55;
        const hit=await page.evaluate(({x,y})=>{
            const element=document.elementFromPoint(x,y);
            return {name:element?.className||'',insideNavigator:!!element?.closest('.bf-fast-navigator')};
        },{x:startX,y:startY});
        if(hit.insideNavigator)throw Error('CD drag start intercepted by navigator: '+JSON.stringify(hit));
        await page.mouse.move(startX,startY);
        await page.mouse.down();
        await page.mouse.move(startX+95,startY,{steps:5});
        await page.mouse.up();
        if(await page.locator('.bf-fast-navigator').isVisible())
            throw Error('Direct CD pointer scrolling must hide fast navigation; hit='+JSON.stringify(hit));
    }
    // An actual pointer press on a CD closes the overlay immediately,
    // without requiring a drag or waiting for the case animation.
    await page.setViewportSize({width:1280,height:720});
    await page.keyboard.press('n');
    if(!await page.locator('.bf-fast-navigator').isVisible())
        throw Error('Fast navigation could not be opened for CD-click test');
    const cdClick=await page.evaluate(()=>{
        const stage=document.querySelector('.bf-stage'),bounds=stage.getBoundingClientRect();
        for(const album of stage.querySelectorAll('.bf-album')){
            const rect=album.getBoundingClientRect();
            for(const fraction of [.22,.52,.78]){
                const x=rect.left+rect.width/2,y=rect.top+rect.height*fraction;
                if(x<=bounds.left+4||x>=bounds.right-4||y<=bounds.top+4||y>=bounds.bottom-4)continue;
                if(document.elementFromPoint(x,y)?.closest('.bf-album')===album)
                    return {x,y,album:album.dataset.index};
            }
        }
        return null;
    });
    if(!cdClick)throw Error('No directly clickable CD is visible for navigator dismissal test');
    await page.mouse.move(cdClick.x,cdClick.y);
    await page.mouse.down();
    if(await page.locator('.bf-fast-navigator').isVisible())
        throw Error('CD pointerdown must immediately hide fast navigation: '+JSON.stringify(cdClick));
    await page.mouse.up();
    // Real CD selection opens a jewel case. Reopening fast navigation must
    // close that case FIRST; simply raising z-index hides the underlying bug.
    await page.waitForFunction(()=>
        document.querySelector('.bf-front-preview')?.hidden===false,null,{timeout:3000});
    await page.keyboard.press('n');
    const shelfOnly=await page.evaluate(()=>{
        const cover=document.querySelector('.bf-front-preview');
        const navigator=document.querySelector('.bf-fast-navigator');
        return {coverClosed:cover.hidden,caseOpening:cover.dataset.opening,
            navVisible:!navigator.hidden,
            coverDisplayed:getComputedStyle(cover).display};
    });
    if(!shelfOnly.coverClosed||!shelfOnly.navVisible||shelfOnly.caseOpening==='true')
        throw Error('Fast navigator must appear on closed CD shelf, not underneath open case: '+JSON.stringify(shelfOnly));
    await page.locator('.bf-fast-nav-close').click();
    // Test the real overlay positioner against large functional surfaces.
    // No screenshot heuristics: use measured rectangles across screen sizes.
    for(const viewport of [{width:1280,height:720},{width:1024,height:768},{width:600,height:700}]){
        await page.setViewportSize(viewport);
        const geometry=await page.evaluate(async()=>{
            const {createDemoGuide}=await import('/js/demo-guide.js');
            const root=document.querySelector('#book-fan-browser');
            const dialog=root.querySelector('.bf-track-overlay');
            const search=root.querySelector('.bf-search-overlay');
            const guide=createDemoGuide(root);
            const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
            const overlap=(a,b)=>{
                if(!a||!b)return 0;
                const x=Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left));
                const y=Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top));
                return x*y;
            };
            const snapshot=(selector)=>{
                const card=root.querySelector('.bf-demo-callout');
                const panel=root.querySelector(selector);
                return {popup:selector,compact:root.querySelector('.bf-demo-guide').dataset.compact,
                    calloutHidden:card.hidden,captionVisible:!root.querySelector('.bf-demo-banner-note').hidden,
                    overlap:card.hidden?0:overlap(card.getBoundingClientRect(),panel.getBoundingClientRect())};
            };
            try{
                dialog.hidden=false;
                guide.start();guide.show(3,'.bf-track-panel');
                await sleep(650);
                const information=snapshot('.bf-track-panel');
                dialog.hidden=true;
                search.hidden=false;
                guide.show(11,'.bf-search-panel');
                await sleep(650);
                const searching=snapshot('.bf-search-panel');
                return {information,searching};
            }finally{
                guide.stop();dialog.hidden=true;search.hidden=true;
            }
        });
        for(const result of Object.values(geometry)){
            if(result.overlap>0)
                throw Error('Guided annotation overlaps '+result.popup+' at '+viewport.width+': '+JSON.stringify(result));
            if(result.compact==='true'&&(!result.calloutHidden||!result.captionVisible))
                throw Error('Compact banner must replace obstructing callout at '+viewport.width+': '+JSON.stringify(result));
        }
    }
    await page.setViewportSize({width:1280,height:720});
    await page.locator('.bf-settings-open').click();
    await page.locator('#settings-tab-about').click();
    const about=await page.locator('#settings-panel-about').evaluate(panel=>({
        groups:[...panel.querySelectorAll('.bf-about-section')].map(x=>x.querySelector('h3')?.textContent),
        buildCards:panel.querySelectorAll('.bf-about-build-card').length,
        browserBuild:panel.querySelector('.bf-about-build-card .bf-about-browser-version')!==null,
        serverBuild:panel.querySelector('.bf-about-build-card .bf-about-version')!==null,
        buildStatus:panel.querySelector('.bf-about-build-card .bf-about-build-match')!==null
    }));
    if(JSON.stringify(about.groups)!==JSON.stringify(['Connection & library','Application & build','Project','Release updates'])||
        about.buildCards!==1||!about.browserBuild||!about.serverBuild||!about.buildStatus)
        throw Error('About sections and combined build panel incorrect: '+JSON.stringify(about));
    await page.locator('#settings-tab-demo').click();
    if(!await page.locator('.bf-demo-local').isVisible())throw Error('Local demo button unavailable');
    await page.locator('.bf-demo-local').click();
    await page.waitForFunction(()=>document.querySelector('#book-fan-browser')?.dataset.demoActive==='true',{timeout:5000});
    await page.waitForTimeout(1000);    await page.waitForFunction(()=>
        document.querySelector('.bf-demo-guide')?.hidden===false&&
        document.querySelector('.bf-demo-banner-progress')?.textContent.includes('Scene 1 of 17')&&
        document.querySelector('.bf-demo-callout')?.hidden===false,null,{timeout:8000});
    const annotations=await page.evaluate(()=>({
        banner:document.querySelector('.bf-demo-banner')?.getBoundingClientRect().width,
        title:document.querySelector('.bf-demo-callout-title')?.textContent,
        arrow:document.querySelector('.bf-demo-arrow-path')?.getAttribute('d')
    }));
    if(!(annotations.banner>0&&annotations.title&&annotations.arrow?.startsWith('M ')))
        throw Error('Guided callout/arrow missing: '+JSON.stringify(annotations));

    if(await page.locator('.bf-settings-overlay').isVisible())throw Error('Settings obscures the active demo');
    const point=await page.locator('.bf-stage').boundingBox();
    await page.mouse.click(point.x+point.width*.5,point.y+point.height*.5);
    await page.waitForFunction(()=>document.querySelector('#book-fan-browser')?.dataset.demoActive==='false',{timeout:5000});
    if(await page.locator('.bf-demo-guide').isVisible())
        throw Error('Demo guide remains on screen after stopping');
    if(errors.length)throw Error('Browser exceptions: '+errors.join(' | '));
    console.log('Local Demo Mode browser smoke test passed');
}finally{await browser.close();}
