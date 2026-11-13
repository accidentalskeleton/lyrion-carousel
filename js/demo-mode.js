/* Browser-independent visual demonstration runner.
 * Uses Carousel's own animations, never LMS playback/queue RPCs.
 * Shared viewers explicitly join an ephemeral server session with a code.
 */
export function createDemoMode({onStep,onActiveChange,onStop}) {
    const root=document.getElementById('book-fan-browser');
    const startLocal=root.querySelector('.bf-demo-local');
    const startShared=root.querySelector('.bf-demo-shared');
    const join=root.querySelector('.bf-demo-join');
    const stopButton=root.querySelector('.bf-demo-stop');
    const codeInput=root.querySelector('.bf-demo-code');
    const speedInput=root.querySelector('.bf-demo-speed');
    const status=root.querySelector('.bf-demo-status');
    const controls=root.querySelector('.bf-demo-controls');
    let mode='',code='',viewer='',controller='',timer=0,sequence=0,epoch=0,lastStep=-1;
    const delays={relaxed:8500,normal:6000,fast:3500};
    const delay=()=>delays[speedInput?.value]||6000;
    const say=text=>{status.textContent=text;};
    const active=()=>!!mode;
    function toggle(activeNow){
        root.dataset.demoActive=activeNow?'true':'false';
        controls.hidden=!activeNow;
        stopButton.disabled=!activeNow;
        startLocal.disabled=startShared.disabled=join.disabled=activeNow;
        onActiveChange(activeNow);
    }
    async function request(payload){
        const response=await fetch('/api/demo',{method:'POST',cache:'no-store',headers:{'Content-Type':'application/json','X-Lyrion-Request':'1'},body:JSON.stringify(payload)});
        if(!response.ok)throw new Error('Demo session unavailable ('+response.status+')');
        return response.json();
    }
    function clear(){clearTimeout(timer);timer=0;}
    function finish(message='Demo stopped'){
        if(!mode)return;
        clear();++epoch;
        mode='';code=viewer=controller='';lastStep=-1;
        toggle(false);onStop();say(message);
    }
    async function stop(){
        if(!mode)return;
        const sessionCode=code,secret=controller;
        finish();
        if(secret)try{await request({action:'stop',code:sessionCode,controller:secret})}catch(_){}
    }
    function play(step){
        if(!mode||step===lastStep)return;
        lastStep=step;
        try{Promise.resolve(onStep(step)).catch(error=>{console.warn('Demo step failed',error)})}
        catch(error){console.warn('Demo step failed',error)}
        say((controller?'Shared demo':'Demo')+' · scene '+(step+1)+'/8'+(code?' · code '+code:''));
    }
    function scheduleHost(generation,step=0){
        if(!mode||generation!==epoch)return;
        if(step>=8){void stop();return}
        play(step);
        if(controller){
            void request({action:'step',code,controller,step}).catch(error=>{
                if(generation===epoch)finish('Shared demo lost connection: '+error.message);
            });
        }
        timer=setTimeout(()=>scheduleHost(generation,step+1),delay());
    }
    async function poll(generation){
        if(mode!=='viewer'||generation!==epoch)return;
        try{
            const response=await fetch('/api/demo?'+new URLSearchParams({code,viewer}),{cache:'no-store'});
            if(!response.ok)throw new Error('Session ended or unavailable');
            const state=await response.json();
            if(generation!==epoch)return;
            if(!state.active){finish('Shared demo ended');return}
            if(Number.isInteger(state.seq)&&state.seq>sequence){
                sequence=state.seq;
                if(Number.isInteger(state.step))play(state.step);
            }
        }catch(error){if(generation===epoch){finish('Shared demo disconnected: '+error.message);return}}
        timer=setTimeout(()=>poll(generation),1000);
    }
    function begin(nextMode){
        if(mode)throw new Error('Stop the current demo first');
        mode=nextMode;lastStep=-1;sequence=0;++epoch;
        toggle(true);
        // Closing Settings prevents the dialog obscuring the demonstration.
        root.querySelector('.bf-settings-close')?.click();
        return epoch;
    }
    startLocal?.addEventListener('click',()=>{
        const generation=begin('local');say('Local visual demonstration');scheduleHost(generation);
    });
    startShared?.addEventListener('click',async()=>{
        if(mode)return;
        startShared.disabled=true;
        try{
            const session=await request({action:'create'});
            const generation=begin('host');
            ({code,viewer,controller}=session);
            scheduleHost(generation);
        }catch(error){say('Could not start shared demo: '+error.message);if(!mode)startShared.disabled=false}
    });
    join?.addEventListener('click',async()=>{
        if(mode)return;
        const entered=(codeInput?.value||'').trim().toUpperCase();
        if(!/^[0-9A-F]{8}$/.test(entered)){say('Enter the 8-character code displayed by the demo host');return}
        join.disabled=true;
        try{
            const credentials=await request({action:'join',code:entered});
            const generation=begin('viewer');
            code=entered;viewer=credentials.viewer;
            say('Connected to shared demo · '+code);
            void poll(generation);
        }catch(error){say('Could not join: '+error.message);if(!mode)join.disabled=false}
    });
    stopButton?.addEventListener('click',()=>void stop());
    // Any real touch/click interrupts local playback immediately. Settings is
    // still available after stop; automation never synthesises pointer events.
    document.addEventListener('pointerdown',event=>{
        if(mode&&event.isTrusted&&!event.target.closest('.bf-demo-controls'))void stop();
    },{capture:true});
    document.addEventListener('keydown',event=>{
        if(mode&&event.isTrusted&&(event.key==='Escape'||event.key===' '||event.key.startsWith('Arrow'))){
            if(event.key==='Escape')event.preventDefault();
            void stop();
        }
    },{capture:true});
    window.addEventListener('pagehide',()=>{if(controller)void request({action:'stop',code,controller}).catch(()=>{});finish()});
    toggle(false);
    return {active,stop};
}
