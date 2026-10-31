// Experimental GSAP jewel case. Isolated from LMS and the shelf state machine.
const preview=document.querySelector('.bf-front-preview');
const caseEl=preview?.querySelector('.bf-front-case');
if(preview&&caseEl){
  const front=caseEl.querySelector('.bf-front-art');
  const tray=document.createElement('div');tray.className='gsap-tray';
  tray.innerHTML='<div class="gsap-disc" aria-hidden="true"><span class="gsap-disc-hub"></span></div>';
  const booklet=document.createElement('div');booklet.className='gsap-booklet';booklet.textContent='Inside booklet';
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
  const inlay=document.createElement('div');
  inlay.className='gsap-rear-inlay';
  tray.prepend(inlay);
  let requestToken=0;
  let bookletPages=[],bookletIndex=0;
  function setBookletPage(index){
    if(!bookletPages.length)return;
    bookletIndex=(index+bookletPages.length)%bookletPages.length;
    booklet.style.backgroundImage='url("'+bookletPages[bookletIndex].url+'")';
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
  async function loadArtwork(albumId){
    const token=++requestToken;
    bookletPages=[];bookletIndex=0;
    booklet.textContent='';booklet.style.backgroundImage='';booklet.removeAttribute('aria-label');
    inlay.style.backgroundImage='';disc.style.backgroundImage='';
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
      const rear=find(/^(?:back|rear|inlay|tray)(?:[-_. ]|$)/i);
      if(rear)inlay.style.backgroundImage='url("'+rear.url+'")';
      const discScan=find(/^(?:disc|disk|cd|medium|media)(?:[-_. 0-9]|$)/i);
      if(discScan)disc.style.backgroundImage='url("'+discScan.url+'")';
      bookletPages=images.filter(item=>/^(?:booklet|inside|front[-_. ]0[2-9]|page)(?:[-_. 0-9]|$)/i.test(item.caption));
      if(bookletPages.length)setBookletPage(0);
    }catch(error){console.debug('Additional LMS artwork unavailable:',error)}
  }
  preview.addEventListener('carousel:album-preview',event=>loadArtwork(event.detail?.albumId));
  const gsap=window.gsap;
  let opened=false;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function setOpen(value){
    opened=value;caseEl.setAttribute('aria-expanded',String(opened));caseEl.setAttribute('aria-label',opened?'Close album jewel case':'Open album jewel case');
    if(gsap)gsap.to(flap,{rotationY:opened?-155:0,duration:reduced?0:0.85,ease:'power2.inOut',overwrite:true});
    else flap.style.transform='rotateY('+(opened?-155:0)+'deg)';
  }
  preview.addEventListener('carousel:toggle-jewel-case',()=>setOpen(!opened));
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
