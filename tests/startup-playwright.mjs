// Exercise the real application startup, not the shelf fixture.
// Run against a separate Carousel server with a reachable LMS and a nonempty library.
import assert from 'node:assert/strict';
import { setTimeout as delay } from 'node:timers/promises';

const {chromium} = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const base = process.argv[2] || 'http://127.0.0.1:18088/';
const screenshot = process.argv[3] || '/tmp/carousel-startup.png';
const browser = await chromium.launch({headless:true});
let release;
const gate = new Promise(resolve => { release = resolve; });

try {
  // A fresh browser context cannot inherit a saved LMS, Spotify source or order.
  const page = await browser.newPage({viewport:{width:1280,height:800}});
  const root = page.locator('#book-fan-browser');
  const message = page.locator('.bf-startup-message');
  const detail = message.locator('.bf-startup-detail');
  const isInitialAlbums = request => {
    if (new URL(request.url()).pathname !== '/api/lms' || request.method() !== 'POST') return false;
    const command = request.postDataJSON()?.params?.[1];
    return Array.isArray(command) && command[0] === 'albums' && command[1] === 0;
  };
  let held = false;
  await page.route('**/api/lms', async route => {
    if (!held && isInitialAlbums(route.request())) {
      held = true;
      await gate;
    }
    await route.continue();
  });

  // Hold the initial LMS album request before it reaches the server. Static
  // assets, settings, player discovery and all other requests remain normal.
  await Promise.all([
    page.waitForRequest(isInitialAlbums,{timeout:30000}),
    page.goto(base,{waitUntil:'domcontentloaded'})
  ]);
  assert(held,'The initial LMS albums request must be intercepted');
  await message.waitFor({state:'visible',timeout:5000});
  const assertLoading = async () => {
    assert(await message.isVisible(),'Startup message must remain visible during the delay');
    assert.equal(await root.getAttribute('data-ready'),'false','Shelf must not be marked ready');
    assert.match(await message.innerText(),/Preparing your music library/);
    assert.equal(await detail.innerText(),'Loading albums from Lyrion Music Server…');
    const box = await message.locator('strong').boundingBox();
    assert(box && box.width > 0 && box.height > 0 && box.x >= 0 && box.y >= 0 &&
      box.x + box.width <= 1280 && box.y + box.height <= 800,
      'Startup heading must be inside the viewport');
  };

  await assertLoading();
  await delay(10000);
  await assertLoading();
  await page.screenshot({path:screenshot});
  console.log('PASS: startup message remains visible for 10 seconds; screenshot: '+screenshot);

  release();
  await page.waitForFunction(() => {
    const root = document.getElementById('book-fan-browser');
    return root.dataset.ready === 'true' && !root.classList.contains('is-starting');
  },null,{timeout:60000});
  await message.waitFor({state:'hidden',timeout:5000});
  assert(['live','cache'].includes(await root.getAttribute('data-catalogue-source')),
    'Expected LMS catalogue data, not the offline demo shelf');
  await page.locator('.bf-stage .bf-album').first().waitFor({state:'visible',timeout:10000});
  console.log('PASS: loading message disappears and LMS album shelf is visible');
} finally {
  release();
  await browser.close();
}
