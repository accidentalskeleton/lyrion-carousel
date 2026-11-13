// Verify two independent Chromium pages opt into the same server-managed
// visual demo. The real Carousel server runs with an unavailable LMS, so the
// built-in offline album fixture is used and no playback can occur.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const base=process.argv[2]||'http://127.0.0.1:8090/';
const browser=await chromium.launch({headless:true});
try{
    const context=await browser.newContext({viewport:{width:1280,height:720}});
    const host=await context.newPage(),viewer=await context.newPage();
    const failures=[];
    for(const page of [host,viewer]){
        page.on('pageerror',error=>failures.push(error.message));
        await page.goto(base,{waitUntil:'domcontentloaded'});
        await page.waitForFunction(()=>document.querySelector('#book-fan-browser')?.dataset.ready==='true',
            null,{timeout:15000});
        await page.locator('.bf-settings-open').click();
        await page.locator('#settings-tab-demo').click();
    }
    await host.locator('.bf-demo-shared').click();
    await host.waitForFunction(()=>
        /Shared session code: [A-F0-9]{8}/.test(document.querySelector('.bf-demo-status')?.textContent||''));
    const status=await host.locator('.bf-demo-status').textContent();
    const code=status.match(/Shared session code: ([A-F0-9]{8})/)[1];
    await viewer.locator('.bf-demo-code').fill(code);
    await viewer.locator('.bf-demo-join').click();
    await viewer.waitForFunction(()=>
        document.querySelector('#book-fan-browser')?.dataset.demoActive==='true');
    await host.locator('.bf-demo-launch').click();
    await host.waitForFunction(()=>
        document.querySelector('#book-fan-browser')?.dataset.demoActive==='true');
    await host.waitForFunction(()=>
        document.querySelector('.bf-demo-status')?.textContent.includes('scene 1/16'));
    await viewer.waitForFunction(()=>
        document.querySelector('.bf-demo-status')?.textContent.includes('scene 1/16'),
        null,{timeout:12000});
    // Stop from the host; viewers must be released by the server session.
    await host.keyboard.press('Escape');
    await host.waitForFunction(()=>
        document.querySelector('#book-fan-browser')?.dataset.demoActive==='false');
    await viewer.waitForFunction(()=>
        document.querySelector('#book-fan-browser')?.dataset.demoActive==='false',
        null,{timeout:12000});
    if(failures.length)throw Error('Browser errors: '+failures.join(' | '));
    console.log('Real server shared Demo Mode passed: explicit join, synchronized scene and remote stop');
}finally{await browser.close();}
