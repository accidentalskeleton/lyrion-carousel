/* Offline catalogue resilience.
   Cache successful read-only LMS discovery/catalogue responses and replay them when LMS
   is temporarily unavailable. Mutating/player-control RPCs are never replayed. */
const nativeFetch=window.fetch.bind(window);
const PREFIX='lyrionCarouselRpc:';
const CACHEABLE=new Set(['players','albums']);
function parseRequest(init){try{const body=JSON.parse(init?.body||'null'),cmd=body?.params?.[1];if(!Array.isArray(cmd)||!CACHEABLE.has(cmd[0]))return null;return {body,key:PREFIX+JSON.stringify(body.params)}}catch(_){return null}}
function save(key,text){try{localStorage.setItem(key,JSON.stringify({savedAt:Date.now(),text}))}catch(_){}}
function load(key){try{const value=JSON.parse(localStorage.getItem(key)||'null');return value?.text||null}catch(_){return null}}
window.fetch=async function(input,init){const url=typeof input==='string'?input:input?.url||'';if(!url.endsWith('/api/lms'))return nativeFetch(input,init);const cached=parseRequest(init);if(!cached)return nativeFetch(input,init);try{const response=await nativeFetch(input,init);if(response.ok){response.clone().text().then(text=>save(cached.key,text)).catch(()=>{});return response}throw new Error('LMS response '+response.status)}catch(error){const text=load(cached.key);if(text!==null){document.getElementById('book-fan-browser')?.setAttribute('data-catalogue-source','cache');return new Response(text,{status:200,headers:{'Content-Type':'application/json','X-Lyrion-Carousel-Cache':'STALE'}})}throw error}}
