import {evaluate as evaluateV1,hash} from './engine-v1.mjs';
import {rational,cmp} from './math.mjs';
import {provenance,gate} from './provenance.mjs';
export function evaluateV2(snapshot,context={}){
  const underlying=context.underlying??'NVDA';
  if(snapshot.schemaVersion!==2)throw Error('INVALID_SNAPSHOT_VERSION');
  for(const k of ['maxQuoteStartSkewMs','maxQuoteReceiveSkewMs'])if(!Number.isSafeInteger(snapshot.policy?.[k])||snapshot.policy[k]<0)throw Error('INVALID_POLICY');
  // Reuse exact M1 scoring; pair timing is checked only between eligible survivors.
  const base=evaluateV1({...snapshot,schemaVersion:1,policy:{...snapshot.policy,maxQuoteStartSkewMs:Number.MAX_SAFE_INTEGER,maxQuoteReceiveSkewMs:Number.MAX_SAFE_INTEGER}},context);
  const candidates=base.candidates.map(row=>{
    const c=snapshot.candidates.find(c=>c.symbol===row.symbol),p=provenance(snapshot,c,context);
    const reasons=prefixes=>row.reasonCodes.filter(code=>prefixes.some(x=>code.startsWith(x)));
    const refFailure=(snapshot.warnings??[]).filter(w=>!context.referenceReasons&&w.provider==='pyth').map(w=>w.code);
    const gates=[
      ...(context.referenceGates??[
        gate('REFERENCE_'+underlying,[...reasons(['REFERENCE_'+underlying,'REFERENCE_IDENTITY']),...refFailure],p.reference(underlying)),
        gate('REFERENCE_USDC',[...reasons(['REFERENCE_USDC','REFERENCE_IDENTITY']),...refFailure],p.reference('USDC'))]),
      gate('IDENTITY',reasons(['MINT_MISMATCH','METADATA_IDENTITY','METADATA_UNAVAILABLE']),p.identity()),
      gate('METADATA_FRESHNESS',reasons(['METADATA_STALE','METADATA_TIMESTAMP','METADATA_UNAVAILABLE']),p.metadata()),
      gate('ISSUER_STATUS',reasons(['ISSUER_']),p.issuerStatus(),{scope:'issuer reported halt; not user eligibility or primary-market opening hours'}),
      gate('CORPORATE_ACTION',reasons(['CORPORATE_']),p.corporateActions(),{scope:c.symbol===(underlying+'x')?'issuer current/pending multiplier and onchain activation window':'issuer explicit corporate-action status; public listing is insufficient'}),
      gate('CHAIN',reasons(['MINT_CHAIN_']),p.chain()),
      gate('QUOTE_VALIDITY',reasons(['QUOTE_ORDER','QUOTE_PROVIDER','QUOTE_UNAVAILABLE','ROUTE_','EXECUTION_ROUTE','RATE_LIMITED','ACCESS_DENIED','HTTP_ERROR','NETWORK_ERROR','TIMEOUT']),p.quote()),
      gate('QUOTE_FRESHNESS',reasons(['QUOTE_STALE','QUOTE_TIME']),p.quote()),
      gate('SLIPPAGE',reasons(['SLIPPAGE_','MINIMUM_OUTPUT_']),p.quote()),
      gate('PRICE_IMPACT',reasons(['PRICE_IMPACT_']),p.quote()),
      gate('NORMALIZATION',reasons(['INVALID_MULTIPLIER','QUOTE_OR_NORMALIZATION']),[...p.multiplier(),...p.quote()]),
      context.deviationGate?context.deviationGate(row,p):gate('REFERENCE_DEVIATION',reasons(['REFERENCE_DEVIATION']),[...p.reference(underlying),...p.reference('USDC'),...p.quote(),...p.multiplier()])
    ];
    const reasonCodes=[...new Set([...row.reasonCodes,...gates.filter(g=>g.mandatory).flatMap(g=>g.reasonCodes)])].sort();
    return {...row,eligible:reasonCodes.length===0,reasonCodes,gates};
  });
  const eligible=candidates.filter(c=>c.eligible),pairGates=[];
  if(eligible.length>1){
    const rows=eligible.map(c=>snapshot.candidates.find(x=>x.symbol===c.symbol));
    const starts=rows.map(c=>c.quote.startedAt),ends=rows.map(c=>c.quote.receivedAt),reasons=[];
    if(Math.max(...starts)-Math.min(...starts)>snapshot.policy.maxQuoteStartSkewMs)reasons.push('QUOTE_START_SKEW');
    if(Math.max(...ends)-Math.min(...ends)>snapshot.policy.maxQuoteReceiveSkewMs)reasons.push('QUOTE_RECEIVE_SKEW');
    const g=gate('QUOTE_COMPARABILITY',reasons,rows.flatMap(c=>provenance(snapshot,c,context).quote()),{scope:'independently verified survivors only'});
    pairGates.push(g);
    if(g.outcome!=='PASS')for(const c of eligible){c.eligible=false;c.reasonCodes.push(...g.reasonCodes);}
  }
  const value=c=>rational(c.normalized.minimumSharesExact.numerator,c.normalized.minimumSharesExact.denominator);
  const ranked=candidates.filter(c=>c.eligible).sort((a,b)=>-cmp(value(a),value(b))||(a.mint<b.mint?-1:1));
  const winner=ranked[0]??null,excluded=candidates.filter(c=>!c.eligible).map(c=>({symbol:c.symbol,reasonCodes:c.reasonCodes}));
  const reasonCodes=winner?['ALL_MANDATORY_GATES_PASSED',ranked.length===1?'SINGLE_VERIFIED_SURVIVOR':'MAXIMUM_MINIMUM_SHARE_EXPOSURE',...(excluded.length?['REPRESENTATIONS_EXCLUDED']:[]),...(ranked.length>1&&cmp(value(ranked[0]),value(ranked[1]))===0?['TIE_BREAK_MINT_ASC']:[])]:['NO_VERIFIED_REPRESENTATION'];
  return {engineVersion:context.engineVersion??'0.1.1',snapshotSha256:hash(context.originalSnapshot??snapshot),mode:snapshot.mode,asOfMs:snapshot.asOfMs,status:winner?'WINNER':'NO_WINNER',winner:winner?.symbol??null,reasonCodes,ranking:ranked.map(c=>c.symbol),rankingIsProvisional:false,excluded,comparisonGates:pairGates,objective:base.objective,executionReady:false,executionReasonCodes:base.executionReasonCodes,candidates};
}
