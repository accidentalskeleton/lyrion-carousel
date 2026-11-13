/* Browser-independent, opt-in visual demo. It never sends LMS RPCs.
 * Remote viewers join voluntarily with a session code, not by autoplay.
 */
export function createDemoMode({prepareStep,onStep,onActiveChange,onStop}) {
    const root=document.getElementById('book-fan-browser');
    const local=root.querySelector('.bf-demo-local');
    const shared=root.querySelector('.bf-demo-shared');
    const launch=root.querySelector('.bf-demo-launch');
    const join=root.querySelector('.bf-demo-join');
    const stopButton=root.querySelector('.bf-demo-stop');
    const floatingStop=root.querySelector('.bf-demo-stop-floating');
    const codeInput=root.querySelector('.bf-demo-code');
    const speedInput=root.querySelector('.bf-demo-speed');
    const status=root.querySelector('.bf-demo-status');
    const controls=root.querySelector('.bf-demo-controls');
    let mode='',code='',viewer='',controller='',timer=0,sequence=0,epoch=0,stepIndex=-1;
    const delays={relaxed:7000,normal:4500,fast:2500};
    const delay=()=>delays[speedInput?.value]||4500;
    const say=message=>{if(status)status.textContent=message;};
    const active=()=>!!mode;
    function toggle(isActive){
        root.dataset.demoActive=String(isActive);
        if(controls)controls.hidden=!isActive||mode==='ready';
        if(stopButton)stopButton.disabled=!isActive;
        for(const button of [local,shared,join])if(button)button.disabled=isActive;
        if(launch)launch.hidden=mode!=='ready';
        onActiveChange(isActive&&mode!=='ready');
    }
    async function request(payload){
        const response=await fetch('/api/demo',{method:'POST',cache:'no-store',
            headers:{'Content-Type':'application/json','X-Lyrion-Request':'1'},
            body:JSON.stringify(payload)});
        if(!response.ok)throw Error('Demo session unavailable ('+response.status+')');
        return response.json();
    }
    function cleanup(message='Demo stopped'){
        if(!mode)return;
        clearTimeout(timer);timer=0;++epoch;
        mode='';code=viewer=controller='';stepIndex=-1;
        toggle(false);onStop();say(message);
    }
    async function stop(){
        if(!mode)return;
        const sessionCode=code,secret=controller;
        cleanup();
        if(secret)try{await request({action:'stop',code:sessionCode,controller:secret})}catch(_){}
    }
    function begin(modeName){
        if(mode&&mode!=='ready')return -1;
        mode=modeName;stepIndex=-1;sequence=0;++epoch;
        toggle(true);
        // Display is unobstructed while showcasing; settings can be reopened
        // normally afterwards. The status text and code stay in settings.
        root.querySelector('.bf-settings-close')?.click?.();
        return epoch;
    }
    async function runStep(step,provided,generation){
        if(generation!==epoch||!mode)return;
        const selection=await prepareStep(step,provided);
        if(generation!==epoch||!mode)return;
        if(controller)await request({action:'step',code,controller,step,
            source:selection.source,album_id:selection.album_id});
        if(generation!==epoch||!mode)return;
        stepIndex=step;
        say((controller?'Shared demo':'Visual demo')+' · scene '+(step+1)+'/8'+(code?' · code '+code:''));
        await onStep(step,selection);
    }
    async function hostStep(generation,step=0){
        if(generation!==epoch||!mode)return;
        if(step>=8){await stop();return}
        try{await runStep(step,null,generation)}
        catch(error){if(generation===epoch)cleanup('Demo stopped: '+error.message);return}
        if(generation===epoch&&mode)timer=setTimeout(()=>void hostStep(generation,step+1),delay());
    }
    async function poll(generation){
        if(mode!=='viewer'||generation!==epoch)return;
        try{
            const response=await fetch('/api/demo?'+new URLSearchParams({code,viewer}),{cache:'no-store'});
            if(!response.ok)throw Error('Session ended or unavailable');
            const state=await response.json();
            if(generation!==epoch)return;
            if(!state.active){cleanup('Shared demo ended');return}
            if(Number.isInteger(state.seq)&&state.seq>sequence){
                sequence=state.seq;
                if(Number.isInteger(state.step))await runStep(state.step,state,generation);
            }
        }catch(error){if(generation===epoch){cleanup('Shared demo disconnected: '+error.message);return}}
        if(generation===epoch&&mode==='viewer')timer=setTimeout(()=>void poll(generation),1000);
    }
    local?.addEventListener('click',()=>{
        if(mode)return;
        const generation=begin('local');void hostStep(generation);
    });
    shared?.addEventListener('click',async()=>{
        if(mode)return;
        shared.disabled=true;
        try{
            const session=await request({action:'create'});
            if(mode)return;
            ({code,viewer,controller}=session);
            mode='ready';++epoch;toggle(true);
            say('Shared session code: '+code+'. Enter this in Demo settings on the other browsers, then select Begin shared showcase.');
        }catch(error){say('Could not create shared demo: '+error.message);if(!mode)shared.disabled=false}
    });
    launch?.addEventListener('click',()=>{
        if(mode!=='ready')return;
        const generation=begin('host');void hostStep(generation);
    });
    join?.addEventListener('click',async()=>{
        if(mode)return;
        const entered=(codeInput?.value||'').trim().toUpperCase();
        if(!/^[0-9A-F]{8}$/.test(entered)){say('Enter the 8-character code from the host');return}
        join.disabled=true;
        try{
            const session=await request({action:'join',code:entered});
            if(mode)return;
            code=entered;viewer=session.viewer;
            const generation=begin('viewer');
            say('Joined shared demo · '+code);
            void poll(generation);
        }catch(error){say('Could not join: '+error.message);if(!mode)join.disabled=false}
    });
    stopButton?.addEventListener('click',()=>void stop());
    floatingStop?.addEventListener('click',()=>void stop());
    document.addEventListener('pointerdown',event=>{
        if(mode&&mode!=='ready'&&event.isTrusted&&!event.target.closest?.('.bf-demo-controls')){
            void stop();
        }
    },{capture:true});
    document.addEventListener('keydown',event=>{
        if(mode&&event.isTrusted&&event.key==='Escape'){
            event.preventDefault();void stop();
        }
    },{capture:true});
    window.addEventListener('pagehide',()=>{void stop()});
    toggle(false);
    return {active,stop};
}
