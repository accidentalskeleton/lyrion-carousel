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
  const multiDisc=new URLSearchParams(location.search).has('multidisc');
  const catalogue = Array.from({length:98}, (_, index) => ({
    id:index + 1, disccount:multiDisc&&index%4===0?2:1, album:'Fixture album ' + index, artist:'Fixture artist', textkey:'F'
  }));
  const rpc = async (_, command) => {
    if(command[0]==='tracks')return {count:4,titles_loop:[{id:4,disc:2,tracknum:2},{id:1,disc:1,tracknum:1},{id:3,disc:2,tracknum:1,discsubtitle:'Bonus tracks'},{id:2,disc:1,tracknum:2}]};
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
      menu:(index,event)=>openAlbumMenu(albums[index],event),closeMenu:closeAlbumMenu,
      loadInitialCatalogue,setDisplayOrder,draw,applyStatus,ensurePlayingCover,centreAlbumIndex,
      set(index,pinned=false){
        cancelFollowAnimation();clearTimeout(wheelTimer);wheelTimer=0;
        playing=pinned;paused=false;playingAlbumId=pinned?albums[index][6]:null;
        position=target=shelfPosition(index);closeFrontPreview(true);draw();
      },
      open(index,animate=false){openFrontPreview(albums[index],index,animate);draw()},
      close(){return closeFrontPreview(false,true)},
      widths:value=>applySetting('shelfVariety',value),
      timeout:ms=>applySetting('frontTimeout',ms),
      status(mode='play'){applyStatus({mode,playlist_loop:[{
        album_id:playingAlbumId,album:frontPreviewAlbum[0],artist:frontPreviewAlbum[1]
      }]})},
      source(value){catalogueSource=value;draw()},
      state:()=>({position,spacePosition:shelfSpace(position),target,dragging,raf,wheelTimer,frontPreviewIndex,
        bounds:finiteShelfBounds(),pitch:shelfPitch(),width:frontCaseWidth(),
        scrollPitch:finiteShelfLayout().scrollPitch,
        playing,followAnimation:!!followAnimation,opening:!!coverOpening&&!coverOpening.closing,
        closing:!!coverOpening?.closing,hidden:frontPreview.hidden})
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
  if(multiDisc){
    const rows=[...stage.querySelectorAll('.bf-album')];
    for(const row of rows){
      const index=Number(row.dataset.index),width=row.getBoundingClientRect().width;
      assert(Math.abs(width-api.state().pitch*(index%4===0?1.5:1))<1,'Mixed disc widths follow LMS metadata');
    }
  }
  if(multiDisc){
    api.widths(false);
    assert([...stage.querySelectorAll('.bf-album')].every(row=>Math.abs(row.getBoundingClientRect().width-api.state().pitch)<1),
      'The width setting restores uniform real browser geometry');
    api.widths(true);
  }
  await api.setDisplayOrder('recent');
  for (const index of [0,1,49,96,97]) {
    api.set(index,true);
    const closedState = api.state();
    api.open(index);
    if(multiDisc&&index===49){
      api.widths(false);coverage();noOverlap();
      api.widths(true);coverage();noOverlap();
    }
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
    assert(Math.abs(cover.getBoundingClientRect().left - coverBefore + (after.spacePosition - before.spacePosition) * after.scrollPitch) < 1,
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
  for(const mode of ['recent','album']){
    await api.setDisplayOrder(mode);
    for(const index of [0,1,49,96,97]){
      api.set(index,true);api.open(index,true);
      const initial=cover.getBoundingClientRect().width;
      const pool=[...stage.querySelectorAll('.bf-album')];
      let samples=0;
      assert(api.state().opening&&initial<cover.offsetWidth*.5,'Explicit opening starts as a narrow case in '+mode);
      while(api.state().opening){
        await frame();samples++;
        noOverlap();
        assert([...stage.querySelectorAll('.bf-album')].every(element=>pool.includes(element)),'Opening reuses its DOM pool');
        if(mode==='recent')coverage();
        if(samples>120)throw Error('Opening animation did not finish');
      }
      await settle();
      assert(samples>1&&Math.abs(cover.getBoundingClientRect().width-cover.offsetWidth)<1,'Opening progresses to the full layout width');
      await api.ensurePlayingCover();
      assert(!api.state().opening&&!api.state().raf,'Playback updates leave the completed animation idle');
      api.set(index,false);api.open(index);
      const beforeClose=api.state(),closed=api.close();
      const fullWidth=cover.getBoundingClientRect().width;
      assert(api.state().closing&&!preview.hidden,'Closing retains the case until the turn completes');
      await frame();
      assert(cover.getBoundingClientRect().width<fullWidth,'Closing progressively turns the cover toward spine width');
      let closingFrames=0;
      while(api.state().closing){
        await frame();closingFrames++;
        if(!preview.hidden){noOverlap();if(mode==='recent')coverage()}
        if(closingFrames>120)throw Error('Closing animation did not finish');
      }
      assert(await closed,'Closing resolves after the case is hidden');
      assert(preview.hidden&&!api.state().raf,'Completed closing returns the renderer to idle');
      assert(api.state().position===beforeClose.position&&api.state().target===beforeClose.target,
        'Closing never resets the browsed shelf position');
      assert(api.state().bounds.join()===beforeClose.bounds.join(),'Closing preserves the finite boundaries');
      assert(!stage.querySelector(`.bf-album[data-index="${index}"]`).hasAttribute('data-front-preview'),
        'Closing restores the original spine');
      if(mode==='recent')coverage();
    }
  }
  await api.setDisplayOrder('recent');api.set(49,false);api.open(49);
  const staleClose=api.close();await frame();api.open(50,true);
  assert(!await staleClose,'A replacement cancels the previous closing promise');
  await settle();
  assert(!preview.hidden&&api.state().frontPreviewIndex===50,'A stale closing completion never hides the replacement');
  api.set(49,false);api.open(49);api.timeout(30);
  await new Promise(resolve=>setTimeout(resolve,70));
  assert(api.state().closing&&!preview.hidden,'A real preview timeout starts reverse closing');
  await settle();
  assert(preview.hidden&&!api.state().raf,'Timeout hides only after reverse closing and leaves no animation loop');
  api.timeout(0);api.set(0,true);api.open(0);
  const pausedCover=preview.querySelector('.bf-front-case');
  api.status('pause');
  assert(!preview.hidden&&preview.dataset.pinned==='true','Pause keeps the current case open and pinned');
  assert(!await api.close()&&!preview.hidden,'Paused cover ignores dismissal just like the playing cover');
  await new Promise(resolve=>setTimeout(resolve,60));
  assert(preview.querySelector('.bf-front-case')===pausedCover&&!preview.hidden,'Paused status retains the existing cover DOM');
  assert(document.querySelector('.bf-play').getAttribute('aria-label')==='Resume player','Paused player still exposes Resume');
  api.status('play');
  assert(!preview.hidden,'Resuming retains the open case');
  await api.menu(0,{clientX:innerWidth-1,clientY:innerHeight-1});
  const menu=document.querySelector('.bf-album-menu'),discSelect=document.querySelector('.bf-album-disc');
  const menuBounds=menu.getBoundingClientRect();
  assert(menuBounds.left>=11&&menuBounds.right<=innerWidth-11&&menuBounds.top>=11&&menuBounds.bottom<=innerHeight-11,'Album menu stays inside viewport at bottom-right edge');
  assert(document.activeElement===document.querySelector('.bf-clear-play'),'Menu focuses its visible primary playback action');
  assert(document.querySelector('.bf-album-disc-label').hidden!==multiDisc,'Disc selector appears only for multi-disc library albums');
  if(multiDisc){
    assert(discSelect.options.length===3&&discSelect.value==='','Multi-disc menu defaults to full album with two actual discs');
    discSelect.value='2';discSelect.dispatchEvent(new Event('change'));
    assert(document.querySelector('.bf-add-queue').textContent==='Add disc 2 to end of queue','Disc selection updates visible queue label');
    await api.menu(0,{clientX:0,clientY:0});
    assert(discSelect.value==='','Reopening menu resets full-album selection');
  }
  api.closeMenu();
  return {checks,multiDisc,viewport:[innerWidth,innerHeight]};
}