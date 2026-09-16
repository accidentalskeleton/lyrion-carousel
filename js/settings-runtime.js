const nativeFetch=window.fetch.bind(window);
window.fetch=async function(input,init){
  const response=await nativeFetch(input,init);
  const url=typeof input==='string'?input:input?.url||'';
  if(!url.endsWith('/api/config')&&!url.includes('/api/config?'))return response;
  try{
    const config=await response.clone().json();
    const idle=localStorage.getItem('albumBrowserIdleReturnMs');
    const random=localStorage.getItem('albumBrowserRandomScrollMs');
    if(idle!==null&&Number.isFinite(Number(idle)))config.idle_return_ms=Number(idle);
    if(random!==null&&Number(random)>0)config.random_scroll_max_ms=Number(random);
    return new Response(JSON.stringify(config),{status:response.status,statusText:response.statusText,headers:{'Content-Type':'application/json'}});
  }catch(_){return response}
};
