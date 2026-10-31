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
