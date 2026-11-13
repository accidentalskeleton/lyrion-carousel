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
    // Fast scrubber floats over the shelf without extending its height.
    for(const viewport of [{width:2560,height:720},{width:1024,height:768},{width:1280,height:720}]){
        await page.setViewportSize(viewport);
        await page.locator('.bf-fast-nav-toggle').click();
        const state=await page.evaluate(()=>{
            const panel=document.querySelector('.bf-fast-navigator');
            const screen=document.querySelector('.bf-screen');
            const r=panel.getBoundingClientRect(),s=screen.getBoundingClientRect();
            return {visible:!panel.hidden,within:r.left>=s.left-1&&r.right<=s.right+1&&
                r.top>=s.top-1&&r.bottom<=s.bottom+1};
        });
        if(!state.visible||!state.within)throw Error('Fast navigator is clipped at '+viewport.width+': '+JSON.stringify(state));
        await page.locator('.bf-fast-nav-range').evaluate(input=>{
            input.value=input.max;
            input.dispatchEvent(new Event('input',{bubbles:true}));
            input.dispatchEvent(new Event('change',{bubbles:true}));
        });
        const label=await page.locator('.bf-fast-nav-count').textContent();
        if(!label?.includes('5 / 5'))throw Error('Scrub did not reach last offline CD: '+label);
        await page.locator('.bf-fast-nav-close').click();
        if(await page.locator('.bf-fast-navigator').isVisible())throw Error('Scrubber did not close');
    }
    await page.locator('.bf-settings-open').click();
    await page.locator('#settings-tab-demo').click();
    if(!await page.locator('.bf-demo-local').isVisible())throw Error('Local demo button unavailable');
    await page.locator('.bf-demo-local').click();
    await page.waitForFunction(()=>document.querySelector('#book-fan-browser')?.dataset.demoActive==='true',{timeout:5000});
    await page.waitForTimeout(1000);
    if(await page.locator('.bf-settings-overlay').isVisible())throw Error('Settings obscures the active demo');
    const point=await page.locator('.bf-stage').boundingBox();
    await page.mouse.click(point.x+point.width*.5,point.y+point.height*.5);
    await page.waitForFunction(()=>document.querySelector('#book-fan-browser')?.dataset.demoActive==='false',{timeout:5000});
    if(errors.length)throw Error('Browser exceptions: '+errors.join(' | '));
    console.log('Local Demo Mode browser smoke test passed');
}finally{await browser.close();}
