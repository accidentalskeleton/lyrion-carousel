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
  // Additional artwork comes from the LMS Album Information slideshow, not a filesystem scan.
  const artworkViewer=document.createElement('div');
  artworkViewer.className='gsap-artwork-viewer';
  artworkViewer.hidden=true;
  artworkViewer.innerHTML='<button type="button" class="gsap-art-prev" aria-label="Previous artwork">‹</button><img alt="Album artwork"><button type="button" class="gsap-art-next" aria-label="Next artwork">›</button><span class="gsap-art-caption"></span>';
  caseEl.append(artworkViewer);
  let images=[],page=0,requestToken=0;
  const imageElement=artworkViewer.querySelector('img');
  function showPage(next){
    if(!images.length)return;
    page=(next+images.length)%images.length;
    imageElement.src=images[page].url;
    imageElement.alt=images[page].caption;
    artworkViewer.querySelector('.gsap-art-caption').textContent=images[page].caption+' ('+(page+1)+'/'+images.length+')';
  }
  for(const [selector,delta] of [['.gsap-art-prev',-1],['.gsap-art-next',1]]){
    const button=artworkViewer.querySelector(selector);
    button.addEventListener('pointerdown',event=>event.stopPropagation());
    button.addEventListener('click',event=>{event.stopPropagation();showPage(page+delta)});
  }
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
    images=[];page=0;artworkViewer.hidden=true;
    booklet.textContent='';booklet.style.backgroundImage='';
    if(!albumId||String(albumId).startsWith('spotify:'))return;
    try{
      // Discover the Local artwork entry for this album; its item_id is not globally stable.
      const menu=await lms(['albuminfo','items',0,250,'menu:albuminfo','album_id:'+albumId]);
      const candidates=[...(menu?.item_loop||[]),...(menu?.items||[]),...(menu?.data||[])];
      const entry=candidates.find(item=>/local artwork/i.test([item.text,item.title,item.name,item.label].filter(Boolean).join(' ')));
      const itemId=entry?.params?.item_id??entry?.item_id??entry?.id;
      if(itemId==null||token!==requestToken)return;
      const result=await lms(['albuminfo','items',0,250,'slideshow:1','menu:albuminfo','item_id:'+itemId,'album_id:'+albumId]);
      if(token!==requestToken)return;
      images=localArtworkItems(result);
      if(!images.length)return;
      artworkViewer.hidden=false;showPage(0);
      const bookletImage=images.find(item=>/booklet|inside|front-0[2-9]/i.test(item.caption));
      if(bookletImage){
        booklet.style.backgroundImage='url("'+bookletImage.url+'")';
        booklet.textContent='';
      }
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
