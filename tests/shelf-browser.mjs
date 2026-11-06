import {clamp, modulo, circularDelta, nearestPositionForIndex} from '../js/browser.js';
import {buildAlbumPositionIndex, locateAlbum} from '../js/catalogue.js';
import {createLmsProvider} from '../js/providers/lms-provider.js';
import {createSpotifyProvider} from '../js/providers/spotify-provider.js';
import {spotifyAlbumInformation, spotifyAlbumUrl, spotifyAlbumSearchUrl} from '../js/spotify.js';

export async function runShelfBrowserTests() {
  const [html, source] = await Promise.all([
    fetch('../index.html').then(response => response.text()),
    fetch('../js/app.js').then(response => response.text())
  ]);
  const markup = new DOMParser().parseFromString(html, 'text/html');
  markup.querySelectorAll('script').forEach(element => element.remove());
  for (const link of markup.querySelectorAll('link[rel="stylesheet"]')) {
    link.href = new URL('../' + link.getAttribute('href'), location.href).href;
    document.head.append(link);
  }
  document.body.replaceChildren(...markup.body.childNodes);
  await Promise.all([...document.querySelectorAll('link[rel="stylesheet"]')].map(link =>
    link.sheet ? Promise.resolve() : new Promise(resolve => { link.onload = resolve; })
  ));
  const catalogue = Array.from({length:98}, (_, index) => ({
    id:index + 1, album:'Fixture album ' + index, artist:'Fixture artist', textkey:'F'
  }));
  const rpc = async (_, command) => {
    if (command[0] === 'albums') return {count:catalogue.length, albums_loop:catalogue.slice(command[1], command[1] + command[2])};
    throw Error('Unexpected LMS command: ' + JSON.stringify(command));
  };
  const env = {
    rpc, CometDClient:class {stop() {} start() {}}, resetRpcSession() {},
    clamp, modulo, circularDelta, nearestPosition:nearestPositionForIndex,
    buildAlbumPositionIndex, locateIndexedAlbum:locateAlbum,
    createLmsProvider, createSpotifyProvider, spotifyAlbumInformation, spotifyAlbumUrl, spotifyAlbumSearchUrl,
    fetch:async url => url.startsWith('/api/catalogue')
      ? {ok:true, json:async () => ({albums_loop:catalogue, library_count:catalogue.length})}
      : {ok:false}
  };
  const app = source.replace(/^import .*;\n/gm, '').replace(/start\(\);\s*$/, '');
  const api = new Function(...Object.keys(env), app + `
    IDLE_RETURN_MS=0; FRONT_TIMEOUT_MS=0;
    return {
      loadInitialCatalogue,setDisplayOrder,draw,applyStatus,ensurePlayingCover,centreAlbumIndex,
      set(index,pinned=false){
        cancelFollowAnimation();clearTimeout(wheelTimer);wheelTimer=0;
        playing=pinned;playingAlbumId=pinned?albums[index][6]:null;
        position=target=shelfPosition(index);closeFrontPreview(true);draw();
      },
      open(index){openFrontPreview(albums[index],index);draw()},
      status(mode='play'){applyStatus({mode,playlist_loop:[{
        album_id:playingAlbumId,album:frontPreviewAlbum[0],artist:frontPreviewAlbum[1]
      }]})},
      source(value){catalogueSource=value;draw()},
      state:()=>({position,target,dragging,raf,wheelTimer,frontPreviewIndex,
        bounds:finiteShelfBounds(),pitch:shelfPitch(),width:frontCaseWidth(),
        scrollPitch:finiteShelfLayout().scrollPitch,
        playing,followAnimation:!!followAnimation})
    };
  `)(...Object.values(env));
  window.shelfBrowser = api;
  let checks = 0;
  const assert = (condition, message) => {if (!condition) throw Error(message); checks++;};
  const frame = () => new Promise(resolve => requestAnimationFrame(resolve));
  const settle = async () => {
    for (let count = 0; count < 240; count++) {
      await frame();
      if (!api.state().raf && !api.state().followAnimation) return;
    }
    throw Error('Shelf animation did not settle');
  };
  const stage = document.querySelector('.bf-stage');
  const preview = document.querySelector('.bf-front-preview');
  const cover = document.querySelector('.bf-front-case');
  const wheel = async (target, delta) => {
    target.dispatchEvent(new WheelEvent('wheel', {deltaY:delta, bubbles:true, cancelable:true}));
    await new Promise(resolve => setTimeout(resolve, 130));
    await settle();
  };
  const coverage = () => {
    const shelf = stage.getBoundingClientRect();
    const intervals = [...stage.querySelectorAll('.bf-album:not([data-front-preview])')].map(element => element.getBoundingClientRect());
    if (!preview.hidden) intervals.push(cover.getBoundingClientRect());
    assert(Array.from({length:100}, (_, index) => shelf.left + (index + .5) * shelf.width / 100)
      .every(point => intervals.some(rect => point >= rect.left - 1 && point <= rect.right + 1)), 'No gaps across the real shelf');
  };
  const noOverlap = () => {
    const rect = cover.getBoundingClientRect();
    assert([...stage.querySelectorAll('.bf-album:not([data-front-preview])')].every(element => {
      const spine = element.getBoundingClientRect();
      return spine.right <= rect.left + 1 || spine.left >= rect.right - 1;
    }), 'The real open case never covers another spine');
  };
  await api.loadInitialCatalogue();
  await api.setDisplayOrder('recent');
  for (const index of [0,1,49,96,97]) {
    api.set(index,true);
    const closedState = api.state();
    api.open(index);
    preview.dataset.visible = 'false';
    await new Promise(resolve => setTimeout(resolve, 250));
    api.open(index);
    await new Promise(resolve => setTimeout(resolve, 16));
    noOverlap();
    await new Promise(resolve => setTimeout(resolve, 250));
    api.centreAlbumIndex(index);await settle();
    const before = api.state();
    const rect = cover.getBoundingClientRect(), shelf = stage.getBoundingClientRect();
    assert(Math.abs(api.state().width - cover.offsetWidth) < 1, 'Cached cover width ignores the opening transform');
    assert(rect.left >= shelf.left - 1 && rect.right <= shelf.right + 1, 'Open cover is visible at index ' + index);
    assert(api.state().bounds.join() === closedState.bounds.join(), 'Opening never changes physical bounds');
    if(index===49)assert(Math.abs(rect.left+rect.width/2-shelf.left-shelf.width/2)<1,'Interior cover is centred');
    coverage();noOverlap();
    const direction = index > 49 ? -1 : 1;
    const coverBefore = cover.getBoundingClientRect().left;
    await wheel(cover, direction * 1200);
    const after = api.state();
    assert((after.position - before.position) * direction > 0, 'Wheel browses away with playing cover open');
    assert(Math.abs(cover.getBoundingClientRect().left - coverBefore + (after.position - before.position) * after.scrollPitch) < 1,
      'Cover travels at exactly the shelf speed');
    await api.ensurePlayingCover();api.status();await settle();
    assert(api.state().position === after.position && api.state().target === after.target, 'Status updates do not reset browsing');
    document.body.dispatchEvent(new KeyboardEvent('keydown', {key:direction > 0 ? 'ArrowRight' : 'ArrowLeft', bubbles:true,cancelable:true}));
    await settle();
    assert(Math.abs(api.state().position - after.position - direction) < .001, 'Keyboard advances exactly one spine');
    coverage();noOverlap();
    await wheel(stage, -direction * 50000);
    assert(api.state().position === (direction > 0 ? before.bounds[0] : before.bounds[1]), 'Reverse wheel reaches the exact endpoint');
    coverage();noOverlap();
    await wheel(stage, -direction * 1000);
    assert(api.state().position === (direction > 0 ? before.bounds[0] : before.bounds[1]), 'Outward wheel never wraps');
    const endpoint=api.state().position;
    await wheel(cover,direction*120);
    assert((api.state().position-endpoint)*direction>.3,'A single normal wheel notch is not snapped back');
    coverage();noOverlap();
  }
  await api.setDisplayOrder('album');
  api.set(97);document.body.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight',bubbles:true,cancelable:true}));
  await settle();assert(Math.abs(api.state().position - 98) < .001, 'Other orders still wrap');
  api.source('spotify');
  api.set(97);document.body.dispatchEvent(new KeyboardEvent('keydown', {key:'ArrowRight',bubbles:true,cancelable:true}));
  await settle();assert(Math.abs(api.state().position - 98) < .001, 'Spotify still wraps');
  api.source('library');api.set(49,true);api.open(49);
  await api.setDisplayOrder('recent');await settle();
  let rect=cover.getBoundingClientRect(),shelf=stage.getBoundingClientRect();
  assert(Math.abs(rect.left+rect.width/2-shelf.left-shelf.width/2)<1,'Order changes centre the newly opened playing case');
  const bounds=api.state().bounds.join();
  const previousWidth=api.state().width;
  cover.style.height='75%';
  await new Promise(resolve=>setTimeout(resolve,80));
  assert(api.state().width<previousWidth,'ResizeObserver refreshes the actual case layout width');
  assert(api.state().bounds.join()===bounds,'Resizing an open case never changes the scroll limits');
  coverage();noOverlap();
  cover.style.height='';
  await new Promise(resolve=>setTimeout(resolve,80));
  api.set(0,true);api.open(0);
  return {checks,viewport:[innerWidth,innerHeight]};
}