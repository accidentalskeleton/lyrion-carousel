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
  const toggle=document.createElement('button');toggle.type='button';toggle.className='gsap-open-toggle';toggle.textContent='Open case';toggle.setAttribute('aria-expanded','false');
  caseEl.append(toggle);
  const gsap=window.gsap;
  let opened=false;
  const reduced=window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function setOpen(value){
    opened=value;toggle.textContent=opened?'Close case':'Open case';toggle.setAttribute('aria-expanded',String(opened));
    if(gsap)gsap.to(flap,{rotationY:opened?-155:0,duration:reduced?0:0.85,ease:'power2.inOut',overwrite:true});
    else flap.style.transform='rotateY('+(opened?-155:0)+'deg)';
  }
  toggle.addEventListener('pointerdown',event=>event.stopPropagation());
  toggle.addEventListener('click',event=>{event.preventDefault();event.stopPropagation();setOpen(!opened)});
  const observer=new MutationObserver(()=>{
    if(preview.hidden||preview.dataset.visible==='false')setOpen(false);
  });
  observer.observe(preview,{attributes:true,attributeFilter:['hidden','data-visible']});
  // Expose a test-only indicator without touching application playback state.
  caseEl.dataset.animationEngine=gsap?'gsap':'css-fallback';
}
