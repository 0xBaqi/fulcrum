import {createHash} from 'node:crypto';
import {ASSETS} from './registry.mjs';
import {canonical} from './engine-v1.mjs';
import {parseXstocks,parseOndoPage,parseOndoApi,parsePyth,exactJson,verifyChain} from './providers.mjs';
const sha=s=>createHash('sha256').update(s).digest('hex');
const validTime=t=>Number.isSafeInteger(t)&&t>0;
export function freshness(timestamp,now,maxAge){
  if(!validTime(timestamp))return 'UNKNOWN';
  if(timestamp>now)return 'FUTURE';
  return now-timestamp<=maxAge?'FRESH':'STALE';
}
const sources={
  'xstocks-asset':'https://api.xstocks.fi/api/v2/public/assets/NVDAx',
  'xstocks-multiplier':'https://api.xstocks.fi/api/v2/public/assets/NVDAx/multiplier?network=Solana',
  'ondo-page':'https://app.ondo.finance/assets/NVDAon',
  'ondo-addresses':'https://api.gm.ondo.finance/v1/assets/NVDAon/addresses',
  'ondo-market':'https://api.gm.ondo.finance/v1/assets/NVDAon/market',
  'ondo-status':'https://api.gm.ondo.finance/v1/status/assets',
  'solana-mints':'solana-mints','solana-blocktime':'solana-blocktime',
  'pyth-latest':'https://pyth.dourolabs.app/hermes/v2/updates/price/latest',
  'quote-NVDAx':'https://api.jup.ag/swap/v2/order','quote-NVDAon':'https://api.jup.ag/swap/v2/order'
};
export function provenance(snapshot,candidate,context={}){
  const assets=context.assets??ASSETS,underlying=context.underlying??'NVDA';
  const allowed={...sources,...context.sources};
  const asset=assets.find(a=>a.symbol===candidate.symbol);
  const now=snapshot.asOfMs,p=snapshot.policy,m=candidate.metadata,all=snapshot.evidence??[];
  function entry(id){const rows=all.filter(e=>e.id===id);return rows.length===1?rows[0]:null;}
  function trusted(id){
    const e=entry(id),expected=allowed[id];
    if(snapshot.mode==='live'&&e?.synthetic===true)return false;
    if(!e||!expected||typeof e.responseText!=='string'||e.responseSha256!==sha(e.responseText)||!Number.isInteger(e.status)||e.status<200||e.status>=300||e.responseRedacted===true||!validTime(e.startedAt)||!validTime(e.receivedAt)||e.startedAt>e.receivedAt||e.receivedAt>now)return false;
    if((id==='pyth-latest'||id.startsWith('quote-'))){
      try{const u=new URL(e.source);if(u.origin+u.pathname!==expected||u.username||u.password)return false;}catch{return false;}
    }else if(e.source!==expected)return false;
    return true;
  }
  const data=id=>JSON.parse(entry(id).responseText);
  function proof(id,{timestamp,known=true,verified=true,maxAge=p.maxMetadataAgeMs,basis='HTTPS_RESPONSE_AND_SCHEMA'}={}){
    const e=entry(id),ok=trusted(id)&&known&&verified;
    let t=timestamp;
    const timestampBasis=timestamp===undefined?'HTTP_SERVER_DATE_MINUS_CACHE_AGE_CURRENT_STATE_OBSERVATION':'EXPLICIT_SOURCE_OR_REQUEST_TIMESTAMP';
    if(t===undefined){
      const date=Date.parse(e?.responseHeaders?.date),age=Number(e?.responseHeaders?.age??0);
      t=Number.isFinite(date)&&Number.isFinite(age)&&age>=0?date-age*1000:null;
    }
    return {evidenceId:id,source:e?.source??allowed[id]??id,observedAt:e?.receivedAt??null,publishedAt:known&&timestamp!==undefined?timestamp:null,sourceTimestamp:known?t??null:null,timestampBasis:known?timestampBasis:'UNKNOWN',freshnessStatus:known?freshness(t,now,maxAge):'UNKNOWN',verificationStatus:!known?'UNKNOWN':ok?'VERIFIED':e?'UNVERIFIED':'UNKNOWN',verificationBasis:known?basis:'SOURCE_DOES_NOT_ESTABLISH_THIS_CLAIM',responseSha256:e?.responseSha256??null};
  }
  let expected=null,metadataVerified=false,chainVerified=false;
  const identityIds=candidate.symbol===(underlying+'x')?['xstocks-asset']:m?.source==='ondo-api'?['ondo-addresses','ondo-market']:['ondo-page'];
  const metadataIds=candidate.symbol===(underlying+'x')?['xstocks-asset','xstocks-multiplier']:m?.source==='ondo-api'?['ondo-addresses','ondo-market','ondo-status']:['ondo-page'];
  try{
    if(metadataIds.every(trusted)){
      const observedAt=Math.min(...metadataIds.map(id=>entry(id).receivedAt));
      if(candidate.symbol===(underlying+'x'))expected=parseXstocks(data('xstocks-asset'),exactJson(entry('xstocks-multiplier').responseText),observedAt,asset);
      else if(m?.source==='ondo-api')expected=parseOndoApi(data('ondo-addresses'),exactJson(entry('ondo-market').responseText),data('ondo-status'),observedAt,asset);
      else expected=parseOndoPage(entry('ondo-page').responseText,observedAt,asset);
      if(trusted('solana-mints')){
        expected=verifyChain(expected,data('solana-mints'),assets.findIndex(a=>a.symbol===candidate.symbol),now);
        chainVerified=true;
      }
      const fields=['underlying','mint','decimals','sharesPerToken','identityVerified','chainVerified','timestampQuality','halted','actionTimes','observedAt'];
      metadataVerified=!!m&&fields.every(k=>canonical(m[k])===canonical(expected[k]));
    }
  }catch{}
  const ondoPage=m?.source==='ondo-public-page-fallback';
  const metadataProof=()=>metadataIds.map(id=>{let timestamp;if(id==='ondo-market')try{timestamp=Number(data(id).timestamp);}catch{timestamp=null;}return proof(id,{verified:metadataVerified,...(timestamp!==undefined?{timestamp}:{})});});
  let chainTime=null;
  try{
    const mints=entry('solana-mints'),block=entry('solana-blocktime');
    if(trusted('solana-blocktime')&&mints?.request?.method==='getMultipleAccounts'&&canonical(mints.request.params[0])===canonical(assets.map(a=>a.mint))&&block.request?.method==='getBlockTime'&&block.request.params?.[0]===data('solana-mints').result.context.slot&&data('solana-blocktime').result!==null)chainTime=Number(data('solana-blocktime').result)*1000;
  }catch{}
  const chain=()=>[proof('solana-mints',{timestamp:chainTime,verified:chainVerified&&metadataVerified,basis:'SOLANA_CONFIRMED_MINT_AND_BLOCK_TIME'}),proof('solana-blocktime',{timestamp:chainTime,verified:chainVerified,basis:'SOLANA_CONTEXT_SLOT_BLOCK_TIME'})];
  function reference(name){
    if(context.referenceProof)return context.referenceProof(snapshot,name);
    const ref=snapshot.references?.[name];let matches=false;
    try{const expected=parsePyth(data('pyth-latest'))[name];matches=['price','confidence','publishedAt','feedId','symbol'].every(k=>expected[k]===ref?.[k]);}catch{}
    return [proof('pyth-latest',{timestamp:ref?.publishedAt??null,known:!!ref,verified:matches,maxAge:p.maxReferenceAgeMs,basis:'PYTH_FEED_ID_SCHEMA_AND_PUBLISH_TIME_OVER_TLS_NOT_SIGNATURE_VERIFIED'})];
  }
  function quote(){
    const id='quote-'+candidate.symbol;let matches=false;
    try{matches=canonical(data(id))===canonical(candidate.quote?.raw)&&candidate.quote.startedAt===entry(id).startedAt&&candidate.quote.receivedAt===entry(id).receivedAt;}catch{}
    return [proof(id,{timestamp:entry(id)?.startedAt??null,verified:matches,maxAge:p.maxQuoteAgeMs,basis:'JUPITER_ORDER_RESPONSE_MATCH_AND_LOCAL_REQUEST_TIME_NOT_EXECUTION_GUARANTEE'})];
  }
  return {
    identity:()=>identityIds.map(id=>proof(id,{verified:metadataVerified})),
    metadata:()=>ondoPage?[proof('ondo-page',{known:false})]:metadataProof(),
    multiplier:()=>[...metadataProof(),...chain()],chain,
    issuerStatus:()=>ondoPage?[proof('ondo-page',{known:false})]:[proof(candidate.symbol===(underlying+'x')?'xstocks-asset':'ondo-status',{verified:metadataVerified})],
    corporateActions:()=>ondoPage?[proof('ondo-page',{known:false})]:[proof(candidate.symbol===(underlying+'x')?'xstocks-multiplier':'ondo-status',{verified:metadataVerified}),...chain()],
    reference,quote
  };
}
export function gate(id,reasonCodes,evidence,{mandatory=true,scope=null}={}){
  const states=evidence.map(e=>e.freshnessStatus),verifications=evidence.map(e=>e.verificationStatus);
  const freshnessStatus=states.includes('FUTURE')?'FUTURE':states.includes('STALE')?'STALE':!states.length||states.includes('UNKNOWN')?'UNKNOWN':'FRESH';
  const verificationStatus=verifications.includes('UNVERIFIED')?'UNVERIFIED':!verifications.length||verifications.includes('UNKNOWN')?'UNKNOWN':'VERIFIED';
  const unknown=verificationStatus==='UNKNOWN'||freshnessStatus==='UNKNOWN';
  const extra=verificationStatus==='UNVERIFIED'?[id+'_EVIDENCE_UNVERIFIED']:verificationStatus==='UNKNOWN'?[id+'_EVIDENCE_UNKNOWN']:[];
  if(freshnessStatus!=='FRESH')extra.push(id+'_EVIDENCE_'+freshnessStatus);
  const reasons=[...new Set([...reasonCodes,...extra])].sort();
  return {id,mandatory,scope,outcome:reasons.length?(unknown?'UNKNOWN':'FAIL'):'PASS',reasonCodes:reasons,source:[...new Set(evidence.map(e=>e.source))],observedAt:evidence.map(e=>e.observedAt),freshnessStatus,verificationStatus,evidence};
}
