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
    await page.locator('.bf-settings-open').click();
    await page.locator('#settings-tab-demo').click();
    if(!await page.locator('.bf-demo-local').isVisible())throw Error('Local demo button unavailable');
    await page.locator('.bf-demo-local').click();
    await page.waitForFunction(()=>document.querySelector('#book-fan-browser')?.dataset.demoActive==='true',{timeout:5000});
    await page.waitForTimeout(1000);    await page.waitForFunction(()=>
        document.querySelector('.bf-demo-guide')?.hidden===false&&
        document.querySelector('.bf-demo-banner-progress')?.textContent.includes('Scene 1 of 16')&&
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
