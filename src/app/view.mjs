import {resolve} from '../registry.mjs';
export const STATES=Object.freeze(['IDLE','RESOLVING','QUOTING','VALIDATING','STRICT_WINNER','NO_VERIFIED_REPRESENTATION','READY_FOR_EXECUTION','REQUOTING','EXECUTION_CHANGED','READY_FOR_SIGNATURE','SIMULATION_BLOCKED','SUBMITTED','CONFIRMED','FAILED']);
export function decision(bundle,mode){
 const {snapshot:s,result:r}=bundle;
 return {underlying:s.order.underlying,inputAmountRaw:s.order.amountRaw,asOfMs:s.asOfMs,mode,isLive:mode==='LIVE',executionClassification:r.executionClassification,marketState:r.marketState,marketSession:r.marketSession,reference:r.reference,references:s.references,usdcReporting:r.usdcReporting,winner:r.winner,reasonCodes:r.reasonCodes,exclusions:r.excluded,comparisonGates:r.comparisonGates,executionReadiness:{preparationAvailable:mode==='LIVE'&&r.status==='WINNER',signingAvailable:false,broadcastAvailable:false},candidates:s.candidates.map(c=>{
  const row=r.candidates.find(x=>x.symbol===c.symbol);
  return {symbol:c.symbol,mint:c.mint,issuer:resolve('TSLA').find(a=>a.symbol===c.symbol)?.issuer??null,identityVerified:c.metadata?.identityVerified===true,eligible:row?.eligible===true,quote:c.quote,minimumOutputRaw:c.quote?.raw?.otherAmountThreshold??null,economicExposure:row?.normalized??null,gates:row?.gates??[],reasonCodes:row?.reasonCodes??[]};
 }),evidence:s.evidence.map(e=>({id:e.id,source:e.source,startedAt:e.startedAt,receivedAt:e.receivedAt,status:e.status,responseSha256:e.responseSha256,error:e.error})),warnings:s.warnings};
}
export function executionState(r){
 if(r.reasonCodes.some(c=>['EXECUTION_MATERIALLY_CHANGED','WINNING_REPRESENTATION_CHANGED','TOKEN_MECHANICS_CHANGED','ANALYSIS_EXPIRED','QUOTE_EXPIRED','MANDATORY_EVIDENCE_EXPIRED_OR_WINNER_CHANGED'].includes(c)))return 'EXECUTION_CHANGED';
 if(r.status==='READY_FOR_SIGNATURE')return 'READY_FOR_SIGNATURE';
 if(r.status==='SUCCEEDED')return 'CONFIRMED';
 if(r.status==='BROADCAST')return 'SUBMITTED';
 if(r.reasonCodes.some(c=>['INSUFFICIENT_USDC','INSUFFICIENT_SOL','TRANSACTION_SIMULATION_FAILED'].includes(c)))return 'SIMULATION_BLOCKED';
 return 'FAILED';
}
export function executionView(r){return {status:r.status,finalComparison:r.comparison?decision(r.comparison,'LIVE'):null,walletPublicKey:r.walletPublicKey,reasonCodes:r.reasonCodes,materialChange:r.materialChange,inspection:r.transaction?.inspection??null,transactionMessageSha256:r.transaction?.messageSha256??null,preBalances:r.preBalances??null,networkFeeLamports:r.networkFeeLamports??null,simulation:r.simulation??null,signature:r.signature,actualReceivedAmount:r.actualReceivedAmount,events:r.events,signingAvailable:false,broadcastAvailable:false};}
