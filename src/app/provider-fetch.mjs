// Application adapter: preserve the frozen collector and its evidence policy.
// The collector's original AbortSignal covers BOTH read attempts (12 seconds).
function timeoutFailure(){const e=Error('TIMEOUT');e.code='TIMEOUT';return e;}
function responseWithSafeTimeout(response,signal){
  // Body reads can time out after fetch has already returned its headers.
  return new Proxy(response,{get(target,key){
    if(key==='text')return async()=>{
      try{return await target.text();}catch(e){
        if(e.name==='TimeoutError'||signal?.reason?.name==='TimeoutError')throw timeoutFailure();
        throw e;
      }
    };
    const value=Reflect.get(target,key,target);
    return typeof value==='function'?value.bind(target):value;
  }});
}
export function providerFetch(fetchImpl,{rpcUrl,clock=Date.now,onRetry=()=>{}}={}){
  return async(url,options={})=>{
    let method;
    try{method=JSON.parse(options.body).method;}catch{}
    const read=String(url)===rpcUrl&&['getMultipleAccounts','getBlockTime'].includes(method);
    for(let attempt=0;attempt<2;attempt++){
      const startedAt=clock();let response;
      try{
        options.signal?.throwIfAborted();
        response=await fetchImpl(url,options);
        if(!read||attempt||response.status<500||response.status>599||options.signal?.aborted)return responseWithSafeTimeout(response,options.signal);
        onRetry({method,startedAt,receivedAt:clock(),status:response.status,code:'HTTP_ERROR'});
        // Discard the failed body; it never becomes trusted chain evidence.
        response.body?.cancel().catch(()=>{});
      }catch(e){
        if(e.name==='TimeoutError'||options.signal?.reason?.name==='TimeoutError'){
          throw timeoutFailure();
        }
        if(!read||attempt||options.signal?.aborted||!(e instanceof TypeError))throw e;
        onRetry({method,startedAt,receivedAt:clock(),status:null,code:'NETWORK_ERROR'});
      }
    }
  };
}
