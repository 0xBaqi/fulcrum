import {createHash} from 'node:crypto';
import {ASSETS,USDC,FEEDS} from './registry.mjs';
import {rational,decimal,atomic,mul,div,sub,abs,cmp,json,display} from './math.mjs';
export const POLICY=Object.freeze({maxQuoteAgeMs:15000,maxQuoteStartSkewMs:250,maxQuoteReceiveSkewMs:5000,maxMetadataAgeMs:300000,maxReferenceAgeMs:120000,maxConfidenceBps:100,maxDeviationBps:300,maxImpactBps:100,maxSlippageBps:50,actionWindowMs:900000});
export function canonical(value){
  if(Array.isArray(value)) return '['+value.map(canonical).join(',')+']';
  if(value&&typeof value==='object') return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
  return JSON.stringify(value);
}
export const hash=value=>createHash('sha256').update(canonical(value)).digest('hex');
const unique=a=>[...new Set(a)].sort();
const timeOk=t=>Number.isSafeInteger(t)&&t>0;
function ageGate(t,now,max,code,reasons){if(!timeOk(t)||t>now||now-t>max) reasons.push(code);}
function refValue(ref,now,p,reasons,label,normalized=false){
  try{
    if(!ref) throw Error();
    const price=decimal(ref.price);
    if(normalized&&ref.confidence===null){
      if(price.n<=0n)throw Error();
      ageGate(ref.publishedAt,now,p.maxReferenceAgeMs,label+'_STALE',reasons);
      reasons.push(label+'_CONFIDENCE_UNKNOWN');return price;
    }
    const conf=decimal(ref.confidence);
    if(price.n<=0n||conf.n<0n) throw Error();
    ageGate(ref.publishedAt,now,p.maxReferenceAgeMs,label+'_STALE',reasons);
    if(cmp(mul(div(conf,price),rational(10000n)),rational(p.maxConfidenceBps))>0) reasons.push(label+'_CONFIDENCE_HIGH');
    return price;
  }catch{reasons.push(label+'_INVALID');return null;}
}
export function evaluate(snapshot,context={}){
  const assets=context.assets??ASSETS,underlying=context.underlying??'NVDA';
  if(snapshot.schemaVersion!==1||!['live','synthetic'].includes(snapshot.mode)||!timeOk(snapshot.asOfMs)) throw Error('INVALID_SNAPSHOT');
  const p=snapshot.policy;
  if(!p||Object.keys(p).length!==Object.keys(POLICY).length||Object.keys(POLICY).some(k=>!Number.isSafeInteger(p[k])||p[k]<0)) throw Error('INVALID_POLICY');
  if(snapshot.order?.underlying!==underlying||snapshot.order?.inputMint!==USDC) throw Error('INVALID_ORDER');
  atomic(snapshot.order.amountRaw);
  const now=snapshot.asOfMs,global=[];
  const referenceEvaluation=context.referenceEvaluation?.(snapshot);
  const nvda=referenceEvaluation?referenceEvaluation.underlyingPrice:refValue(snapshot.references?.[underlying],now,p,global,'REFERENCE_'+underlying,!!context.referenceReasons);
  const usdc=referenceEvaluation?referenceEvaluation.usdcPrice:refValue(snapshot.references?.USDC,now,p,global,'REFERENCE_USDC',!!context.referenceReasons);
  if(referenceEvaluation)global.push(...referenceEvaluation.reasonCodes);
  else if(context.referenceReasons)global.push(...context.referenceReasons(snapshot));
  else if(snapshot.references?.NVDA?.symbol!=='Equity.US.NVDA/USD'||snapshot.references?.USDC?.symbol!=='Crypto.USDC/USD'||Object.entries(FEEDS).some(([k,id])=>snapshot.references?.[k]?.feedId!==id)) global.push('REFERENCE_IDENTITY_MISMATCH');
  const rows=snapshot.candidates;
  if(!Array.isArray(rows)||rows.length!==2||assets.some(a=>rows.filter(c=>c.symbol===a.symbol).length!==1)) throw Error('INVALID_CANDIDATE_SET');
  const starts=rows.map(c=>c.quote?.startedAt).filter(timeOk),ends=rows.map(c=>c.quote?.receivedAt).filter(timeOk);
  if(starts.length===2&&Math.max(...starts)-Math.min(...starts)>p.maxQuoteStartSkewMs) global.push('QUOTE_START_SKEW');
  if(ends.length===2&&Math.max(...ends)-Math.min(...ends)>p.maxQuoteReceiveSkewMs) global.push('QUOTE_RECEIVE_SKEW');
  const scored=rows.map(c=>{
    const reasons=[...global],a=assets.find(a=>a.symbol===c.symbol),m=c.metadata,q=c.quote;
    let score=null,normalized=null;
    if(c.mint!==a.mint) reasons.push('MINT_MISMATCH');
    if(!m) reasons.push('METADATA_UNAVAILABLE');
    else {
      if(m.underlying!==underlying||m.mint!==a.mint||m.decimals!==a.decimals||m.identityVerified!==true) reasons.push('METADATA_IDENTITY_MISMATCH');
      ageGate(m.observedAt,now,p.maxMetadataAgeMs,'METADATA_STALE',reasons);
      if(m.timestampQuality!=='issuer-or-chain') reasons.push('METADATA_TIMESTAMP_UNVERIFIED');
      if(m.halted===true) reasons.push('ISSUER_HALTED');
      if(typeof m.halted!=='boolean') reasons.push('ISSUER_STATUS_UNKNOWN');
      if(!Array.isArray(m.actionTimes)) reasons.push('CORPORATE_ACTION_STATUS_UNKNOWN');
      else if(m.actionTimes.some(t=>!timeOk(t)||Math.abs(t-now)<=p.actionWindowMs)) reasons.push('CORPORATE_ACTION_WINDOW');
      if(m.chainVerified!==true) reasons.push('MINT_CHAIN_UNVERIFIED');
    }
    if(!q?.raw) reasons.push(q?.error?.code??'QUOTE_UNAVAILABLE');
    else try{
      const r=q.raw;
      ageGate(q.startedAt,now,p.maxQuoteAgeMs,'QUOTE_STALE',reasons);
      if(!timeOk(q.receivedAt)||q.receivedAt<q.startedAt||q.receivedAt>now) reasons.push('QUOTE_TIME_INVALID');
      if(r.inputMint!==USDC||r.outputMint!==a.mint||r.inAmount!==snapshot.order.amountRaw||r.swapMode!=='ExactIn') reasons.push('QUOTE_ORDER_MISMATCH');
      if(!Array.isArray(r.routePlan)||!r.routePlan.length||r.routePlan.some(x=>!x.swapInfo?.ammKey||!x.swapInfo?.inputMint||!x.swapInfo?.outputMint)) reasons.push('ROUTE_MISSING');
      if(!r.requestId||!['aggregator','rfq'].includes(r.swapType)) reasons.push('EXECUTION_ROUTE_INVALID');
      if(r.errorCode||r.errorMessage) reasons.push('QUOTE_PROVIDER_ERROR');
      if(!Number.isSafeInteger(r.slippageBps)||r.slippageBps<0||r.slippageBps>p.maxSlippageBps) reasons.push('SLIPPAGE_EXCEEDED');
      // Jupiter priceImpactPct is a fraction: 0.01 means 1%. Negative improvements are bounded too.
      if(cmp(mul(abs(decimal(r.priceImpactPct)),rational(10000n)),rational(p.maxImpactBps))>0) reasons.push('PRICE_IMPACT_EXCEEDED');
      const out=atomic(r.outAmount),minimum=atomic(r.otherAmountThreshold);
      if(minimum>out) reasons.push('MINIMUM_OUTPUT_INVALID');
      if(Number.isSafeInteger(r.slippageBps)&&minimum < out*BigInt(10000-r.slippageBps)/10000n) reasons.push('MINIMUM_OUTPUT_INVALID');
      if(m){
        const multiplier=decimal(m.sharesPerToken);
        if(multiplier.n<=0n) throw Error('INVALID_MULTIPLIER');
        const scale=rational(1n,10n**BigInt(a.decimals));
        const expected=mul(mul(rational(out),scale),multiplier);
        score=mul(mul(rational(minimum),scale),multiplier);
        const cost=rational(snapshot.order.amountRaw,1000000n);
        const costPerShare=div(cost,score);
        normalized={expectedShares:display(expected),minimumShares:display(score),minimumSharesExact:json(score),usdcPerMinimumShare:display(costPerShare),sharesPerToken:m.sharesPerToken};
        if(nvda&&usdc){
          const deviation=mul(abs(sub(div(mul(costPerShare,usdc),nvda),rational(1n))),rational(10000n));
          normalized.referenceDeviationBps=display(deviation,6);
          if(context.deviationMandatory!==false&&cmp(deviation,rational(p.maxDeviationBps))>0) reasons.push('REFERENCE_DEVIATION_EXCEEDED');
        }
      }
    }catch(e){reasons.push(e.message==='INVALID_MULTIPLIER'?'INVALID_MULTIPLIER':'QUOTE_OR_NORMALIZATION_INVALID');score=null;}
    return {symbol:c.symbol,mint:a.mint,eligible:reasons.length===0,reasonCodes:unique(reasons),normalized,score,route:q?.raw?{router:q.raw.router,swapType:q.raw.swapType,requestId:q.raw.requestId,transactionAvailable:!!q.raw.transaction}:null};
  });
  const sorted=scored.filter(x=>x.score).sort((a,b)=>-cmp(a.score,b.score)||(a.mint<b.mint?-1:1));
  const eligible=sorted.filter(x=>x.eligible);
  // Require BOTH representations to pass for a cross-representation winner.
  const winner=eligible.length===2?eligible[0]:null;
  return {engineVersion:'0.1.0',snapshotSha256:hash(snapshot),mode:snapshot.mode,asOfMs:now,status:winner?'WINNER':'NO_WINNER',winner:winner?.symbol??null,reasonCodes:winner?['MAXIMUM_MINIMUM_SHARE_EXPOSURE',...(cmp(eligible[0].score,eligible[1].score)===0?['TIE_BREAK_MINT_ASC']:[])]:['COMPARISON_INCOMPLETE'],ranking:sorted.map(x=>x.symbol),rankingIsProvisional:!winner,objective:context.objective??'Maximize slippage-protected NVIDIA-equivalent shares for equal USDC input; excludes wallet-dependent network fees.',executionReady:false,executionReasonCodes:['WALLET_ELIGIBILITY_NOT_EVALUATED','REQUOTE_AND_SIMULATE_REQUIRED','NETWORK_FEES_NOT_COMPARED'],candidates:scored.map(({score,...rest})=>rest)};
}
