// Experimental GSAP jewel case. Isolated from LMS and the shelf state machine.
const preview=document.querySelector('.bf-front-preview');
const caseEl=preview?.querySelector('.bf-front-case');
if(preview&&caseEl){
  const front=caseEl.querySelector('.bf-front-art');
  const tray=document.createElement('div');tray.className='gsap-tray';
  tray.innerHTML='<div class="gsap-disc" aria-hidden="true"><span class="gsap-disc-hub"></span></div>';
  const booklet=document.createElement('div');booklet.className='gsap-booklet';
  const flap=document.createElement('div');flap.className='gsap-flap';
  // Move the existing artwork to the hinged front so LMS artwork updates still work.
  front.parentNode.insertBefore(tray,front);
  flap.append(front,booklet);
  caseEl.insertBefore(flap,caseEl.querySelector('.bf-front-play'));
  caseEl.tabIndex=0;
  caseEl.setAttribute('role','button');
  caseEl.setAttribute('aria-label','Open album jewel case');
  caseEl.setAttribute('aria-expanded','false');
  // Scans live inside the physical case; no detached image strip.
  const disc=tray.querySelector('.gsap-disc');
  const rear=document.createElement('div');
  rear.className='gsap-case-rear';
  rear.setAttribute('aria-hidden','true');
  caseEl.insertBefore(rear,tray);
  const rearArtwork=document.createElement('div');
  rearArtwork.className='gsap-rear-artwork';
  rear.append(rearArtwork);
  const turnButton=document.createElement('button');
  turnButton.type='button';
  turnButton.className='gsap-turn-case';
  turnButton.textContent='Turn over';
  turnButton.setAttribute('aria-label','Turn jewel case over to view rear artwork');
  caseEl.append(turnButton);
  // Separate the front-facing physical surfaces from the rear-facing inlay.
  // The case itself rotates in 3D; the rear scan is not swapped onto the tray.
  const pageIndicator=document.createElement('span');
  pageIndicator.className='gsap-booklet-page-indicator';
  booklet.append(pageIndicator);
  let turned=false;
  let rearScan=null;
  function updateTurnControl(){
    turnButton.hidden=!opened;
    turnButton.innerHTML=turned?'&#8634;':'&#8635;';
    turnButton.title=turned?'Turn to front':'Turn over';
    caseEl.classList.toggle('gsap-turned',turned);
    turnButton.setAttribute('aria-label',turned?'Turn jewel case back to the disc and booklet':'Turn jewel case over to view rear artwork');
    rear.setAttribute('aria-hidden',String(!turned));
    preview.classList.toggle('gsap-show-rear',turned);
  }
  turnButton.addEventListener('click',event=>{
    event.stopPropagation();
    if(!opened)return;
    turned=!turned;
    updateTurnControl();
  });
  let requestToken=0;
  let bookletPages=[],bookletIndex=0;
  function setBookletPage(index){
    if(!bookletPages.length)return;
    bookletIndex=(index+bookletPages.length)%bookletPages.length;
    booklet.style.backgroundImage='url("'+bookletPages[bookletIndex].url+'")';
    pageIndicator.textContent=bookletPages.length>1?(bookletIndex+1)+' / '+bookletPages.length:'';
    booklet.setAttribute('aria-label','Booklet: '+bookletPages[bookletIndex].caption);
  }
  booklet.addEventListener('click',event=>{
    if(!caseEl.matches('[aria-expanded="true"]')||bookletPages.length<2)return;
    event.stopPropagation();setBookletPage(bookletIndex+1);
  });
  async function lms(command){
    const response=await fetch('/api/lms',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:1,method:'slim.request',params:['',command]})});
    if(!response.ok)throw Error('LMS HTTP '+response.status);
    return (await response.json()).result;
  }
  function localArtworkItems(result){
    return (result?.data||[])
      .filter(item=>typeof item.image==='string'&&typeof item.caption==='string')
      .map(item=>{
        const parts=item.image.split('/');
        const valid=parts.length===5&&parts[0]==='imageproxy'&&parts[1]==='mai'&&parts[2]==='localartwork'&&/^[a-f0-9]{32}$/i.test(parts[3])&&parts[4]==='image.png';
        return valid?{caption:item.caption,url:'/api/local-artwork/'+parts[3]}:null;
      }).filter(Boolean);
  }
  // The Pi extracts the disc once and caches it; browser only displays the PNG.
  async function applyDiscScan(url,token){
    const match=String(url).split('/');
    if(match.length!==4||match[0]!==''||match[1]!=='api'||match[2]!=='local-artwork'||!/^[a-f0-9]{32}$/i.test(match[3]))return;
    const processed='/api/processed-disc/'+match[3];
    try{
      const response=await fetch(processed);
      if(!response.ok)throw Error('Disc detection unavailable');
      const blob=await response.blob();
      if(token!==requestToken)return;
      const objectUrl=URL.createObjectURL(blob);
      const previous=disc.dataset.objectUrl;
      disc.dataset.objectUrl=objectUrl;
      disc.style.backgroundImage='url("'+objectUrl+'")';
      if(previous)URL.revokeObjectURL(previous);
    }catch(error){
      // Do not show an unmasked rectangular scan on the circular tray.
      if(token===requestToken)disc.style.backgroundImage='';
      console.debug('Processed disc unavailable:',error);
    }
  }
  async function loadArtwork(albumId){
    const token=++requestToken;
    bookletPages=[];bookletIndex=0;
    booklet.style.backgroundImage='';booklet.removeAttribute('aria-label');
    pageIndicator.textContent='';
    rearScan=null;rearArtwork.style.backgroundImage='';rear.classList.remove('has-artwork');
    disc.style.backgroundImage='';
    if(disc.dataset.objectUrl){URL.revokeObjectURL(disc.dataset.objectUrl);delete disc.dataset.objectUrl;}
    if(!albumId||String(albumId).startsWith('spotify:'))return;
    try{
      // Discover the Local artwork entry for this album; its item_id is not globally stable.
      const menu=await lms(['albuminfo','items',0,250,'menu:albuminfo','album_id:'+albumId]);
      const candidates=[...(menu?.item_loop||[]),...(menu?.items||[]),...(menu?.data||[])];
      const entry=candidates.find(item=>/local artwork/i.test([item.text,item.title,item.name,item.label].filter(Boolean).join(' ')));
      const itemId=entry?.actions?.go?.params?.item_id??entry?.params?.item_id??entry?.item_id??entry?.id;
      if(itemId==null||token!==requestToken)return;
      const result=await lms(['albuminfo','items',0,250,'slideshow:1','menu:albuminfo','item_id:'+itemId,'album_id:'+albumId]);
      if(token!==requestToken)return;
      const images=localArtworkItems(result);
      if(!images.length)return;
      const find=(pattern)=>images.find(item=>pattern.test(item.caption));

      rearScan=find(/^(?:back|rear|backcover|back-cover|rear-cover|traycard|tray-card|inlay)(?:[-_. 0-9]|$)/i);
      if(rearScan){rearArtwork.style.backgroundImage='url("'+rearScan.url+'")';rear.classList.add('has-artwork');}
      const discScan=find(/^(?:disc|disk|cd|medium|media)(?:[-_. 0-9]|$)/i);
      if(discScan)applyDiscScan(discScan.url,token);
      bookletPages=images.filter(item=>/^(?:booklet|inside|front[-_. ]0[2-9]|page)(?:[-_. 0-9]|$)/i.test(item.caption));
      if(bookletPages.length)setBookletPage(0);
    }catch(error){console.debug('Additional LMS artwork unavailable:',error)}
  }
  preview.addEventListener('carousel:album-preview',event=>loadArtwork(event.detail?.albumId));
  const gsap=window.gsap;
  let opened=false;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function setOpen(value){
    opened=value;
    if(!opened)turned=false;
    updateTurnControl();
    caseEl.setAttribute('aria-expanded',String(opened));caseEl.setAttribute('aria-label',opened?'Close album jewel case':'Open album jewel case');
    if(gsap)gsap.to(flap,{rotationY:opened?-175:0,duration:reduced?0:0.85,ease:'power2.inOut',overwrite:true});
    else flap.style.transform='rotateY('+(opened?-175:0)+'deg)';
  }
  // Native click fallback: some browsers lose the app's pointer capture before
  // pointerup, so its custom toggle event never arrives.
  let lastToggleAt=0;
  let pressStartedAt=0;
  let pressMoved=false;
  caseEl.addEventListener('pointerdown',event=>{
    if(event.target.closest('button'))return;
    pressStartedAt=performance.now();
    pressMoved=false;
  });
  caseEl.addEventListener('pointermove',event=>{
    if(event.buttons&&pressStartedAt&&event.pointerType==='touch')pressMoved=true;
  });
  preview.addEventListener('carousel:toggle-jewel-case',()=>{
    lastToggleAt=performance.now();
    setOpen(!opened);
  });
  caseEl.addEventListener('click',event=>{
    if(event.target.closest('button')||event.target.closest('.gsap-booklet'))return;
    if(performance.now()-lastToggleAt<350)return;
    if(pressStartedAt&&(performance.now()-pressStartedAt>550||pressMoved))return;
    lastToggleAt=performance.now();
    setOpen(!opened);
  });
  caseEl.addEventListener('keydown',event=>{
    if(event.target!==caseEl||!['Enter',' '].includes(event.key))return;
    event.preventDefault();setOpen(!opened);
  });
  const observer=new MutationObserver(()=>{
    if(preview.hidden||preview.dataset.visible==='false')setOpen(false);
  });
  observer.observe(preview,{attributes:true,attributeFilter:['hidden','data-visible']});
  // Expose a test-only indicator without touching application playback state.
  caseEl.dataset.animationEngine=gsap?'gsap':'css-fallback';
}
