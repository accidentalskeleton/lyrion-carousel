const root=document.getElementById('book-fan-browser');
const screen=root?.querySelector('.bf-screen-sleep');
const delaySelect=root?.querySelector('.bf-screen-sleep-delay');
const STORAGE_KEY='lyrionCarouselScreenSleepMs';
const DEFAULT_DELAY=900000;
let timer=0,sleeping=false;

function savedDelay(){
    try{
        const value=Number(localStorage.getItem(STORAGE_KEY));
        return Number.isFinite(value)&&value>=0?value:DEFAULT_DELAY;
    }catch(_){return DEFAULT_DELAY}
}
function currentDelay(){const value=Number(delaySelect?.value);return Number.isFinite(value)&&value>=0?value:DEFAULT_DELAY}
function armSleep(){clearTimeout(timer);timer=0;if(!sleeping&&currentDelay()>0)timer=setTimeout(sleepScreen,currentDelay())}
function sleepScreen(){clearTimeout(timer);timer=0;sleeping=true;screen.hidden=false;root.dataset.screenSleeping='true'}
function wakeScreen(){if(!sleeping)return false;sleeping=false;screen.hidden=true;root.dataset.screenSleeping='false';armSleep();return true}
function noteActivity(event){
    if(sleeping){
        event?.preventDefault?.();event?.stopImmediatePropagation?.();wakeScreen();return;
    }
    armSleep();
}

if(screen&&delaySelect){
    delaySelect.value=String(savedDelay());
    delaySelect.addEventListener('change',()=>{
        try{localStorage.setItem(STORAGE_KEY,delaySelect.value)}catch(_){}
        wakeScreen();armSleep();
    });
    screen.addEventListener('pointerdown',noteActivity,{capture:true});
    document.addEventListener('pointerdown',noteActivity,{capture:true,passive:false});
    document.addEventListener('wheel',noteActivity,{capture:true,passive:true});
    document.addEventListener('keydown',noteActivity,{capture:true});
    document.addEventListener('visibilitychange',()=>{if(!document.hidden)noteActivity()});
    armSleep();
}
