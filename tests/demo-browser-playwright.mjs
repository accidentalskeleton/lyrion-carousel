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
