export async function runShelfGestures(page) {
  const reports = [];
  const base = await page.evaluate(() => location.origin);
  const assert = (condition, message) => {if (!condition) throw Error(message);};
  for (const viewport of [{width:1280,height:800},{width:2560,height:720},{width:390,height:844},{width:1280,height:800,multiDisc:true},{width:390,height:844,multiDisc:true}]) {
    await page.setViewportSize({width:viewport.width,height:viewport.height});
    await page.goto(base + '/tests/shelf-browser.html'+(viewport.multiDisc?'?multidisc=1':''), {waitUntil:'domcontentloaded'});
    const report = await page.evaluate(() => window.shelfBrowserResult);
    assert(!report.error, report.error);
    // The selected LMS player power must visually dim the CD display and
    // restore it when switched on, independent of any radio/Spotify source.
    const standby=await page.evaluate(()=>{
      const root=document.querySelector('#book-fan-browser');
      const stage=document.querySelector('.bf-stage');
      const casePreview=document.querySelector('.bf-front-preview');
      shelfBrowser.applyStatus({mode:'stop',power:0,playlist_loop:[]});
      const off={power:root.dataset.playerPower,shelf:getComputedStyle(stage).opacity,
        cover:getComputedStyle(casePreview).opacity};
      shelfBrowser.applyStatus({mode:'stop',playlist_loop:[]});
      const partial=root.dataset.playerPower;
      shelfBrowser.applyStatus({mode:'stop',power:1,playlist_loop:[]});
      const on={power:root.dataset.playerPower,shelf:getComputedStyle(stage).opacity,
        cover:getComputedStyle(casePreview).opacity};
      return {off,on,partial};
    });
    assert(standby.off.power==='off'&&standby.partial==='off'&&
      standby.on.power==='on','Player power on/off and partial status update correctly');
    assert(Number(standby.off.shelf)<Number(standby.on.shelf)&&
      Number(standby.off.cover)<Number(standby.on.cover),
      'Both the shelf and open-case surfaces visibly dim on standby');

    await page.evaluate(()=>shelfBrowser.set(49,false));
    await page.locator('.bf-album[data-index="49"]').click();
    assert(await page.evaluate(()=>shelfBrowser.state().opening),'A trusted spine click starts the opening transition');
    await page.waitForFunction(()=>!shelfBrowser.state().opening&&!shelfBrowser.state().raf);
    await page.keyboard.press('Escape');
    assert(await page.evaluate(()=>shelfBrowser.state().closing&&!shelfBrowser.state().hidden),'Escape starts reverse closing rather than hiding immediately');
    await page.waitForFunction(()=>shelfBrowser.state().hidden&&!shelfBrowser.state().raf);
    await page.evaluate(()=>{shelfBrowser.set(49,true);shelfBrowser.open(49,true)});
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,70)));
    const openingCase=await page.locator('.bf-front-case').boundingBox();
    await page.mouse.move(openingCase.x+openingCase.width/2,openingCase.y+openingCase.height/2);
    await page.mouse.down();
    await page.mouse.move(openingCase.x+openingCase.width/2-35,openingCase.y+openingCase.height/2,{steps:4});
    const interrupted=await page.evaluate(()=>shelfBrowser.state());
    assert(interrupted.dragging&&!interrupted.opening,'Dragging an opening case immediately takes control of the shelf');
    await page.mouse.up();
    await page.waitForFunction(()=>!shelfBrowser.state().raf);
    await page.emulateMedia({reducedMotion:'reduce'});
    await page.evaluate(()=>{shelfBrowser.set(0,false);shelfBrowser.open(0,true)});
    assert(!(await page.evaluate(()=>shelfBrowser.state().opening)),'Reduced motion skips the expanding transition');
    await page.evaluate(()=>shelfBrowser.close());
    assert(await page.evaluate(()=>shelfBrowser.state().hidden&&!shelfBrowser.state().closing),'Reduced motion closes immediately');
    await page.emulateMedia({reducedMotion:'no-preference'});
    for (const index of [0,97]) {
      for (const surface of ['cover','spine']) {
        await page.evaluate(index => {shelfBrowser.set(index,true);shelfBrowser.open(index);}, index);
        await page.evaluate(() => new Promise(resolve => setTimeout(resolve,260)));
        const start = await page.evaluate(({index,surface}) => {
          const cover = document.querySelector('.bf-front-case').getBoundingClientRect();
          const state = shelfBrowser.state();
          return {...state,x:surface==='cover'?cover.left+cover.width/2:
            index===0?cover.right+state.pitch/2:cover.left-state.pitch/2,y:cover.top+cover.height/2};
        }, {index,surface});
        const distance = index===0?-100:100;
        await page.mouse.move(start.x,start.y);
        await page.mouse.down();
        await page.mouse.move(start.x+distance,start.y,{steps:8});
        const during = await page.evaluate(() => shelfBrowser.state());
        assert(during.dragging, 'Pointer capture retains the ' + surface + ' drag');
        assert(Math.abs((during.spacePosition-start.spacePosition)*start.scrollPitch+distance)<1,
          'Pointer and shelf travel together at '+viewport.width+'px on '+surface);
        await page.mouse.up();
        await page.waitForFunction(() => !shelfBrowser.state().raf);
        assert(!(await page.evaluate(() => shelfBrowser.state().dragging)), 'Pointer release ends drag');
        const manual = await page.evaluate(() => {shelfBrowser.status();return shelfBrowser.state();});
        await page.evaluate(() => shelfBrowser.ensurePlayingCover());
        assert((await page.evaluate(() => shelfBrowser.state().position))===manual.position, 'Status preserves manual drag navigation');
      }
      await page.evaluate(index => {shelfBrowser.set(index,true);shelfBrowser.open(index);}, index);
      const wheelPoint=await page.locator('.bf-stage').boundingBox();
      await page.mouse.move(viewport.width/2,wheelPoint.y+wheelPoint.height/2);
      await page.mouse.wheel(0,index===0?120:-120);
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve,300)));
      const afterWheel=await page.evaluate(() => shelfBrowser.state());
      assert(index===0?afterWheel.position>afterWheel.bounds[0]:afterWheel.position<afterWheel.bounds[1], 'Trusted wheel notch survives release');
      await page.keyboard.press(index===0?'ArrowRight':'ArrowLeft');
      await page.waitForFunction(() => !shelfBrowser.state().raf);
      const afterKey=await page.evaluate(() => shelfBrowser.state());
      assert(Math.abs(Math.abs(afterKey.position-afterWheel.position)-1)<.001,'Trusted keyboard moves one position');
    }
    if(viewport.multiDisc){
      await page.evaluate(()=>shelfBrowser.menu(0,{clientX:innerWidth-1,clientY:innerHeight-1}));
      await page.locator('.bf-album-disc').selectOption('2');
      assert(await page.locator('.bf-clear-play').textContent()==='Clear queue and play disc 2','Trusted disc selection updates playback action');
      await page.keyboard.press('Escape');
      assert(await page.locator('.bf-album-menu').isHidden(),'Escape dismisses the multi-disc menu');
    }
    reports.push({...report,trustedGestures:true});
  }
  return reports;
}

if (typeof process !== 'undefined' && process.argv[1]?.endsWith('shelf-playwright.mjs')) {
  const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
  const browser = await chromium.launch({headless:true});
  try {
    const page = await browser.newPage();
    await page.goto(process.argv[2] || 'http://127.0.0.1:8089/');
    console.log(JSON.stringify(await runShelfGestures(page),null,2));
  } finally {await browser.close();}
}