// Wait for actual local time; never shift the clock or grant a freshness grace period.
export function settledCollector(collect,{clock=Date.now,sleep=ms=>new Promise(r=>setTimeout(r,ms)),maxWaitMs=3000,onTiming=()=>{}}={}){
 return async options=>{
  const s=await collect(options),dates=s.evidence.map(e=>Date.parse(e.responseHeaders?.date)).filter(Number.isFinite),latest=Math.max(s.asOfMs,...dates),lead=latest-s.asOfMs;
  if(lead<=0||lead>maxWaitMs)return s;
  const startedAt=clock(),delay=Math.max(0,latest-startedAt)+1;if(delay>maxWaitMs+1)return s;await sleep(delay);const evaluatedAt=clock();
  onTiming({originalAsOfMs:s.asOfMs,providerDateMs:latest,waitStartedAt:startedAt,evaluatedAt,reasonCode:'WAITED_FOR_SOURCE_TIMESTAMP'});
  return {...s,asOfMs:Math.max(s.asOfMs,evaluatedAt)};
 };
}
