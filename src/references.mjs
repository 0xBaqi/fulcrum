import {createHash} from 'node:crypto';
import {FEEDS,TSLA_FEED} from './registry.mjs';
import {exactJson} from './providers.mjs';
import {decimal,rational,mul,display} from './math.mjs';
import {canonical} from './engine-v1.mjs';

const validTime=t=>Number.isSafeInteger(t)&&t>0;
const symbol=name=>name==='USDC'?'Crypto.USDC/USD':`Equity.US.${name}/USD`;
const feed=name=>name==='TSLA'?TSLA_FEED:FEEDS[name];
const ensure=(ok,code)=>{if(!ok)throw Error(code);};
const sha=s=>createHash('sha256').update(s).digest('hex');
export function referenceFreshness(t,now,max){return !validTime(t)?'UNKNOWN':t>now?'FUTURE':now-t>max?'STALE':'FRESH';}

// Provider interface: id, request(name) -> exact public request, parse(capture,name)
// -> normalized reference. Approval and response reconstruction live at this boundary;
// scoring consumes price/confidence/publishedAt/symbol regardless of provider.
export const yahooProvider=Object.freeze({
 id:'yahoo-chart',
 request(name){ensure(['TSLA','NVDA','USDC'].includes(name),'REFERENCE_UNSUPPORTED');const ticker=name==='USDC'?'USDC-USD':name;return {id:'reference-yahoo-'+name,url:`https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1m&range=1d&includePrePost=true`};},
 parse(e,name){
  const data=exactJson(e.responseText),rows=data.chart?.result;
  ensure(!data.chart?.error&&rows?.length===1,'REFERENCE_RESPONSE_INVALID');
  const m=rows[0].meta,ticker=name==='USDC'?'USDC-USD':name;
  ensure(m?.symbol===ticker&&m.currency==='USD'&&m.instrumentType===(name==='USDC'?'CRYPTOCURRENCY':'EQUITY'),'REFERENCE_IDENTITY_MISMATCH');
  ensure(decimal(m.regularMarketPrice).n>0n,'REFERENCE_PRICE_INVALID');
  const publishedAt=Number(m.regularMarketTime)*1000;ensure(validTime(publishedAt),'REFERENCE_TIMESTAMP_INVALID');
  const periods=m.currentTradingPeriod??{},active=Object.entries(periods).filter(([,p])=>Number(p.start)*1000<=e.receivedAt&&e.receivedAt<Number(p.end)*1000).map(([n])=>n);
  const delay=m.exchangeDataDelayedBy===undefined?null:Number(m.exchangeDataDelayedBy);
  ensure(delay===null||(Number.isSafeInteger(delay)&&delay>=0),'REFERENCE_DELAY_INVALID');
  return {provider:this.id,symbol:symbol(name),currency:'USD',price:m.regularMarketPrice,confidence:null,
   confidenceStatus:'UNKNOWN',publishedAt,observedAt:e.receivedAt,source:e.source,evidenceId:e.id,
   timestampBasis:'SOURCE_REGULAR_MARKET_TIME',priceKind:'REGULAR_MARKET_LAST_TRADE',
   delay:{status:delay===null?'UNKNOWN':delay>0?'DELAYED':'REALTIME_REPORTED',seconds:delay===0?0:null,label:delay===null?'POTENTIALLY_DELAYED_NOT_CERTIFIED_REALTIME':delay>0?'DELAYED':'SOURCE_REPORTS_NO_DELAY',...(delay===null?{}:{providerReportedValue:delay,providerReportedUnit:'UNSPECIFIED'})},
   marketSession:{atObservation:active.length===1?active[0]:Object.keys(periods).length?'closed':'unknown',priceSession:name==='USDC'?'continuous':'regular',timezone:m.exchangeTimezoneName??null,periods},
   limitations:['NO_PROVIDER_CONFIDENCE_INTERVAL','PUBLIC_CHART_ENDPOINT_NO_AVAILABILITY_GUARANTEE']};
 }
});
export const pythProvider=Object.freeze({
 id:'pyth-hermes',
 request(name){ensure(!!feed(name),'REFERENCE_UNSUPPORTED');return {id:'reference-pyth-'+name,url:'https://pyth.dourolabs.app/hermes/v2/updates/price/latest?ids[]='+feed(name)};},
 parse(e,name){
  const data=JSON.parse(e.responseText),rows=data.parsed?.filter(x=>x.id.replace(/^0x/,'')===feed(name));
  ensure(rows?.length===1,'PYTH_FEED_MISSING');const p=rows[0].price;
  ensure(Number.isSafeInteger(p.expo)&&Math.abs(p.expo)<=30,'PYTH_EXPONENT_INVALID');
  const scale=p.expo<0?rational(1n,10n**BigInt(-p.expo)):rational(10n**BigInt(p.expo));
  const price=display(mul(rational(p.price),scale),30),confidence=display(mul(rational(p.conf),scale),30),publishedAt=Number(p.publish_time)*1000;
  ensure(decimal(price).n>0n&&decimal(confidence).n>=0n&&validTime(publishedAt),'REFERENCE_RESPONSE_INVALID');
  return {provider:this.id,symbol:symbol(name),currency:'USD',feedId:feed(name),price,confidence,confidenceStatus:'REPORTED',publishedAt,observedAt:e.receivedAt,source:e.source,evidenceId:e.id,
   timestampBasis:'SOURCE_PUBLISH_TIME',priceKind:'ORACLE_AGGREGATE',delay:{status:'UNKNOWN',seconds:null,label:'SOURCE_PUBLISH_TIME_GATED'},marketSession:null,
   limitations:['HTTPS_AND_SCHEMA_VERIFIED_NOT_SIGNATURE_VERIFIED']};
 }
});
const approved=Object.freeze([pythProvider,yahooProvider]);

export async function collectReferences(http,{underlying,env={},warnings=[]}){
 const result={};
 await Promise.all([underlying,'USDC'].map(async name=>{
  const providers=env.PYTH_API_KEY?.trim()?approved:[yahooProvider];
  for(const provider of providers){
   const req=provider.request(name);
   try{const e=await http.get(req.id,req.url,{headers:provider===pythProvider?{Authorization:'Bearer '+env.PYTH_API_KEY.trim()}: {}});result[name]=provider.parse(e,name);return;}
   catch(e){let code=e.code??e.message;
    if(provider===pythProvider&&code==='ACCESS_DENIED')code=http.evidence.find(x=>x.id===req.id)?.responseText?.startsWith('Not entitled:')?'PYTH_FEED_NOT_ENTITLED':'PYTH_CREDENTIAL_REJECTED';
    warnings.push({provider:provider.id,reference:name,code,evidenceId:req.id});
   }
  }
 }));return result;
}

export function referenceReasons(snapshot){
 const reasons=[];
 for(const name of [snapshot.order.underlying,'USDC']){
  const r=snapshot.references?.[name];
  if(r?.symbol!==symbol(name)||r?.currency!=='USD')reasons.push('REFERENCE_IDENTITY_MISMATCH');
 }
 return reasons;
}
export function referenceProof(snapshot,name){
 const ref=snapshot.references?.[name],provider=approved.find(p=>p.id===ref?.provider);
 let verified=false,e=null;
 try{
  ensure(provider,'REFERENCE_PROVIDER_UNAPPROVED');const req=provider.request(name),rows=snapshot.evidence.filter(x=>x.id===req.id);ensure(rows.length===1,'REFERENCE_EVIDENCE_AMBIGUOUS');e=rows[0];
  ensure(e.source===req.url&&e.request===null&&e.status===200&&!e.responseRedacted&&!(snapshot.mode==='live'&&e.synthetic),'REFERENCE_SOURCE_UNVERIFIED');
  ensure(validTime(e.startedAt)&&validTime(e.receivedAt)&&e.startedAt<=e.receivedAt&&e.receivedAt<=snapshot.asOfMs&&e.responseSha256===sha(e.responseText),'REFERENCE_CAPTURE_INVALID');
  verified=canonical(provider.parse(e,name))===canonical(ref);
 }catch{}
 return [{evidenceId:ref?.evidenceId??null,source:e?.source??ref?.source??null,observedAt:e?.receivedAt??null,publishedAt:ref?.publishedAt??null,sourceTimestamp:ref?.publishedAt??null,timestampBasis:ref?.timestampBasis??'UNKNOWN',
  freshnessStatus:referenceFreshness(ref?.publishedAt,snapshot.asOfMs,snapshot.policy.maxReferenceAgeMs),verificationStatus:verified?'VERIFIED':ref?'UNVERIFIED':'UNKNOWN',verificationBasis:'APPROVED_PROVIDER_RESPONSE_RECONSTRUCTION_OVER_HTTPS_NOT_SIGNATURE_VERIFIED',responseSha256:e?.responseSha256??null,
  delay:ref?.delay??null,marketSession:ref?.marketSession??null,confidenceStatus:ref?.confidenceStatus??'UNKNOWN'}];
}
