// Experimental photorealistic jewel-case renderer.
// Three.js is deliberately loaded only on this branch. The existing carousel owns
// interaction/position; this renderer mirrors its centre position into a single WebGL scene.
const THREE_URL='https://cdn.jsdelivr.net/npm/three@0.180.0/build/three.module.js';
let ThreePromise=null;
const loadThree=()=>ThreePromise||(ThreePromise=import(THREE_URL));
const clamp=(v,a,b)=>Math.max(a,Math.min(b,v));
const mod=(v,n)=>n?((v%n)+n)%n:0;
function delta(index,centre,total){let d=mod(index-mod(centre,total),total);if(d>total/2)d-=total;return d}

export class JewelCaseRenderer {
  constructor(stage){
    this.stage=stage;this.albums=[];this.THREE=null;this.renderer=null;this.scene=null;this.camera=null;
    this.cases=[];this.textures=new Map();this.pending=new Map();this.ready=false;this.failed=false;
    this.latestCentre=0;this.latestTotal=0;this.resizeObserver=null;this.animate=this.animate.bind(this);
    this.init();
  }
  async init(){
    try{
      const T=await loadThree();this.THREE=T;
      const canvas=document.createElement('canvas');canvas.className='bf-photoreal-canvas';canvas.setAttribute('aria-hidden','true');
      this.stage.prepend(canvas);
      const renderer=new T.WebGLRenderer({canvas,alpha:true,antialias:true,powerPreference:'high-performance',premultipliedAlpha:true});
      renderer.setPixelRatio(Math.min(devicePixelRatio||1,2));renderer.outputColorSpace=T.SRGBColorSpace;
      renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.18;
      renderer.setClearColor(0x000000,0);this.renderer=renderer;
      this.scene=new T.Scene();this.camera=new T.PerspectiveCamera(31,1,.1,100);this.camera.position.set(0,.08,7.7);this.camera.lookAt(0,0,0);
      // Soft studio-light rig. Highlights move over the physical geometry as cases rotate.
      this.scene.add(new T.HemisphereLight(0xdde8f2,0x15100c,1.35));
      const key=new T.RectAreaLight(0xfff4e6,7.5,4.5,1.8);key.position.set(-3.2,3.8,4.5);key.lookAt(0,0,0);this.scene.add(key);
      const strip=new T.RectAreaLight(0xb9dcff,5.5,1.0,5.0);strip.position.set(4.2,.7,3.5);strip.lookAt(0,0,0);this.scene.add(strip);
      const rim=new T.DirectionalLight(0xffffff,2.2);rim.position.set(-4,1,-3);this.scene.add(rim);
      this.resizeObserver=new ResizeObserver(()=>this.resize());this.resizeObserver.observe(this.stage);this.resize();
      this.ready=true;this.stage.classList.add('bf-photoreal-active');this.rebuild();requestAnimationFrame(this.animate);
    }catch(error){this.failed=true;console.warn('Photorealistic jewel-case renderer unavailable; using CSS cases.',error)}
  }
  setAlbums(albums){this.albums=albums||[];if(this.ready)this.rebuild()}
  makePlasticMaterial(){const T=this.THREE;return new T.MeshPhysicalMaterial({color:0xf7fbff,metalness:0,roughness:.055,transmission:.94,thickness:.075,ior:1.49,transparent:true,opacity:.62,clearcoat:1,clearcoatRoughness:.035,reflectivity:.72,side:T.DoubleSide,depthWrite:false})}
  box(group,size,pos,material,bevel=false){const T=this.THREE;const g=new T.BoxGeometry(...size);const mesh=new T.Mesh(g,material);mesh.position.set(...pos);group.add(mesh);return mesh}
  makeCase(index){
    const T=this.THREE,group=new T.Group();group.userData.index=index;
    // Standard jewel-case proportions: 142 x 125 x 10 mm, scaled to scene units.
    const W=2.84,H=2.50,D=.20,plastic=this.makePlasticMaterial();
    const tray=new T.MeshStandardMaterial({color:0x101112,roughness:.36,metalness:.03});
    const edge=new T.MeshPhysicalMaterial({color:0xffffff,roughness:.09,transmission:.72,thickness:.04,ior:1.49,transparent:true,opacity:.72,depthWrite:false});
    // Rear shell and black tray sit behind the printed booklet.
    this.box(group,[W,H,.055],[0,0,-D*.47],plastic);this.box(group,[W*.94,H*.91,.055],[W*.018,0,-D*.23],tray);
    // Front booklet/art plane, inset from the left hinge.
    const artMat=new T.MeshStandardMaterial({color:0xffffff,roughness:.72,metalness:0});
    const artGeo=new T.PlaneGeometry(W*.865,H*.91),art=new T.Mesh(artGeo,artMat);art.position.set(W*.052,0,D*.012);group.add(art);group.userData.art=art;group.userData.artMat=artMat;
    // Front clear lid is a real transmissive layer in front of the artwork.
    this.box(group,[W,H,.052],[0,0,D*.45],plastic);
    // Thick clear perimeter rails catch the moving studio lights.
    const rail=.032;this.box(group,[W,rail,D*.18],[0,H/2-rail/2,D*.04],edge);this.box(group,[W,rail,D*.18],[0,-H/2+rail/2,D*.04],edge);this.box(group,[rail,H,D*.18],[W/2-rail/2,0,D*.04],edge);
    // Characteristic black ribbed hinge, around 9% of width.
    const hingeW=W*.087;this.box(group,[hingeW,H*.96,D*.16],[-W/2+hingeW/2+.025,0,.005],tray);
    const ribMat=new T.MeshStandardMaterial({color:0x252627,roughness:.28,metalness:.02});
    for(let y=-H*.42;y<=H*.42;y+=.085)this.box(group,[hingeW*.84,.012,D*.175],[-W/2+hingeW/2+.025,y,.018],ribMat);
    // Clear separator next to hinge.
    this.box(group,[.026,H*.94,D*.18],[-W/2+hingeW+.052,0,.02],edge);
    // Four small front-lid latch tabs and hinge knuckles add close-up realism.
    const latchMat=edge;for(const y of [-H*.31,H*.31]){this.box(group,[.055,.19,D*.12],[W/2-.045,y,D*.055],latchMat);this.box(group,[.075,.16,D*.14],[-W/2+.018,y,D*.03],latchMat)}
    // Fine bevel-like highlight lines just inside the shell.
    const lineMat=new T.MeshBasicMaterial({color:0xdff4ff,transparent:true,opacity:.25,depthWrite:false});
    this.box(group,[W*.965,.009,.008],[.015,H*.465,D*.105],lineMat);this.box(group,[W*.965,.009,.008],[.015,-H*.465,D*.105],lineMat);
    group.scale.setScalar(.82);return group;
  }
  rebuild(){
    if(!this.ready)return;for(const c of this.cases)this.scene.remove(c);this.cases=[];
    // Keep the GPU scene bounded. Only the cases around the current centre are needed.
    for(let slot=0;slot<11;slot++){const c=this.makeCase(slot);this.scene.add(c);this.cases.push(c)}
  }
  loadArtwork(group,album){
    const url=album?.[8];if(!url||group.userData.url===url)return;group.userData.url=url;
    const apply=texture=>{if(group.userData.url!==url)return;group.userData.artMat.map=texture;group.userData.artMat.needsUpdate=true};
    if(this.textures.has(url)){apply(this.textures.get(url));return}if(this.pending.has(url)){this.pending.get(url).then(apply);return}
    const T=this.THREE,p=new Promise(resolve=>new T.TextureLoader().load(url,texture=>{texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=Math.min(8,this.renderer.capabilities.getMaxAnisotropy());this.textures.set(url,texture);resolve(texture)},undefined,()=>resolve(null))).finally(()=>this.pending.delete(url));
    this.pending.set(url,p);p.then(t=>t&&apply(t));
  }
  render(centre,total){this.latestCentre=centre;this.latestTotal=total;if(!this.ready||!total)return;this.layout()}
  layout(){
    const total=this.latestTotal;if(!total)return;const centre=this.latestCentre,base=Math.round(centre);
    this.cases.forEach((group,slot)=>{
      const offset=slot-5,index=mod(base+offset,total),d=delta(index,centre,total),ad=Math.abs(d),visible=ad<5.7;
      group.visible=visible;if(!visible)return;this.loadArtwork(group,this.albums[index]);
      // Book/fan motion: selected case faces camera; neighbours turn progressively edge-on.
      const side=Math.sign(d)||1,curve=Math.min(ad,4.8);group.position.x=side*(.28+curve*.58);if(ad<.45)group.position.x=d*1.05;
      group.position.y=-.03-Math.min(ad*.012,.05);group.position.z=-ad*.18;
      group.rotation.y=-side*(Math.min(.18+curve*.205,1.13));if(ad<.5)group.rotation.y=-d*.42;
      group.rotation.z=-d*.008;const focus=1-clamp(ad/5.2,0,1);group.scale.setScalar(.80+.055*focus);
      group.userData.artMat.opacity=1;group.userData.artMat.transparent=false;
    })
  }
  animate(){if(!this.ready)return;this.layout();this.renderer.render(this.scene,this.camera);requestAnimationFrame(this.animate)}
  resize(){if(!this.renderer)return;const r=this.stage.getBoundingClientRect(),w=Math.max(1,r.width),h=Math.max(1,r.height);this.renderer.setSize(w,h,false);this.camera.aspect=w/h;this.camera.updateProjectionMatrix()}
  dispose(){this.ready=false;this.resizeObserver?.disconnect();this.renderer?.dispose();for(const t of this.textures.values())t.dispose();this.renderer?.domElement.remove()}
}
