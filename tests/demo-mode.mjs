// Run with: node tests/demo-mode.mjs
import { createDemoMode } from '../js/demo-mode.js';

const assert=(value,message)=>{if(!value)throw Error(message)};
const listeners=new Map(),timers=new Map();let nextTimer=0;
globalThis.setTimeout=(fn,ms)=>{fn.__delay=ms;timers.set(++nextTimer,fn);return nextTimer};
globalThis.clearTimeout=id=>timers.delete(id);
function element(){
    return {disabled:false,hidden:false,value:'normal',textContent:'',dataset:{},listeners:{},
        addEventListener(type,fn){(this.listeners[type]??=[]).push(fn)},
        click(){for(const fn of this.listeners.click||[])fn({isTrusted:false,target:this})},
        closest(){return null}};
}
function surface(){
    const nodes=new Map();
    const root=element();
    root.querySelector=selector=>{
        if(!nodes.has(selector))nodes.set(selector,element());
        return nodes.get(selector);
    };
    const doc=element(),win=element();
    globalThis.document={getElementById:()=>root,addEventListener:doc.addEventListener.bind(doc)};
    globalThis.window={addEventListener:win.addEventListener.bind(win)};
    return {root,nodes,node:selector=>root.querySelector(selector),doc,win};
}
const sessions=new Map(),requests=[];let nextCode=1;
globalThis.fetch=async (url,options={})=>{
    requests.push({url,options});
    let state,body;
    if(options.method==='POST'){
        assert(options.headers['X-Lyrion-Request']==='1','POST must include application CSRF header');
        body=JSON.parse(options.body);
        if(body.action==='create'){
            const code=String(nextCode++).padStart(8,'0');
            state={code,controller:'controller:'+code,viewer:'viewer:'+code,seq:0,step:null,active:true};
            sessions.set(code,state);
            return {ok:true,json:async()=>({code,controller:state.controller,viewer:state.viewer})};
        }
        state=sessions.get(body.code);
        if(!state)return {ok:false,status:403};
        if(body.action==='join')return {ok:true,json:async()=>({viewer:state.viewer})};
        if(body.action==='state')return body.viewer===state.viewer?
            {ok:true,json:async()=>({...state})}:{ok:false,status:403};
        if(body.controller!==state.controller)return {ok:false,status:403};
        if(body.action==='step'){Object.assign(state,{seq:state.seq+1,step:body.step,source:body.source,album_id:body.album_id})}
        else if(body.action==='stop'){Object.assign(state,{seq:state.seq+1,active:false})}
        return {ok:true,json:async()=>({...state})};
    }
    return {ok:false,status:404};
};
const flush=async()=>{for(let n=0;n<25;n++)await Promise.resolve()};
const host=surface(),hostSteps=[],hostState=[];
createDemoMode({prepareStep:async step=>({source:'library',album_id:'album:'+step}),
    onStep:async (step,selection)=>hostSteps.push([step,selection]),
    onActiveChange:value=>hostState.push(value),onStop:()=>{}});
host.node('.bf-demo-local').click();await flush();
assert(hostSteps.length===1&&hostSteps[0][0]===0,'local demo runs first visual scene');
assert(requests.length===0,'local demo never contacts the server');
const pointerEvent={type:'pointerdown',isTrusted:true,target:{closest:()=>null}};
for(const listener of host.doc.listeners.pointerdown||[])listener(pointerEvent);
await flush();
assert(host.root.dataset.demoActive==='false','trusted touch interrupts local demo');
assert(host.node('.bf-demo-controls').hidden,'stop control hidden on stop');

const repeatHost=surface(),repeatSteps=[];
repeatHost.node('.bf-demo-repeat').checked=true;
createDemoMode({prepareStep:async step=>({source:'library',album_id:'repeat:'+step}),
    onStep:async step=>repeatSteps.push(step),
    onActiveChange:()=>{},onStop:()=>{}});
repeatHost.node('.bf-demo-local').click();await flush();
for(let i=0;i<17;i++){
    const entry=[...timers.entries()].at(-1);
    assert(!!entry,'repeat showcase schedules its next scene');
    if([3,4,9,11,15].includes(i))
        assert(entry[1].__delay===7500,
            'popup scene '+i+' receives 3 seconds extra after its UI opens');
    if([2,10,13,16].includes(i))
        assert(entry[1].__delay===5500,
            'open-cover scene '+i+' receives time to appreciate the artwork');
    timers.delete(entry[0]);await entry[1]();await flush();
}
assert(repeatSteps.length===18&&repeatSteps[0]===0&&repeatSteps[17]===0,
    'enabled repeat restarts the seventeen-scene sequence without stopping');
repeatHost.node('.bf-demo-stop').click();await flush();
assert(repeatHost.root.dataset.demoActive==='false','repeat demo stops on request');


const sharedHost=surface(),sharedHostSteps=[];
createDemoMode({prepareStep:async step=>({source:'library',album_id:'shared:'+step}),
    onStep:async (step,selection)=>sharedHostSteps.push([step,selection]),
    onActiveChange:()=>{},onStop:()=>{}});
sharedHost.node('.bf-demo-shared').click();await flush();
assert(sharedHost.node('.bf-demo-status').textContent.includes('00000001'),
    'host shows a usable session code before starting');
assert(sharedHost.node('.bf-demo-launch').hidden===false,'host explicitly launches after showing the code');
assert(sharedHostSteps.length===0,'creating a session does not start playback or animation');

const viewer=surface(),viewerSteps=[];
createDemoMode({prepareStep:async (step,selection)=>selection,
    onStep:async (step,selection)=>viewerSteps.push([step,selection]),
    onActiveChange:()=>{},onStop:()=>{}});
viewer.node('.bf-demo-code').value='00000001';
viewer.node('.bf-demo-join').click();await flush();
assert(viewer.root.dataset.demoActive==='true','viewer joins voluntarily');
sharedHost.node('.bf-demo-launch').click();await flush();
assert(sharedHostSteps.length===1,'host starts only after explicit launch');
const callbacks=[...timers.values()];timers.clear();
for(const callback of callbacks)await callback();
await flush();
assert(viewerSteps.length>=1&&viewerSteps[0][1].album_id==='shared:0',
    'viewer follows the host selected album ID');
assert(!requests.some(r=>String(r.url).includes('/api/lms')),
    'demo never sends LMS playback or queue commands');
sharedHost.node('.bf-demo-stop-floating').click();await flush();
assert(sessions.get('00000001').active===false,'host stop ends shared session');

const failingHost=surface();
createDemoMode({prepareStep:async()=>{throw Error('Fixture preparation failed')},
    onStep:async()=>{},onActiveChange:()=>{},onStop:()=>{}});
failingHost.node('.bf-demo-shared').click();await flush();
failingHost.node('.bf-demo-launch').click();await flush();
assert(sessions.get('00000002').active===false,
    'failed host scene sends stop to the server so joined viewers are released');
assert(failingHost.root.dataset.demoActive==='false',
    'failed host scene also exits its own visual demo');

console.log('Demo controller local/shared flow passed');
