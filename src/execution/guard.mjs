import {replay} from '../cli.mjs';
import {resolve,USDC} from '../registry.mjs';
import {atomic,decimal,rational,sub,mul,div,abs,cmp,display,json} from '../math.mjs';
import {EXECUTION_POLICY,ensure} from './policy.mjs';
import {evaluate} from '../engine.mjs';
export function strictAsset(bundle){
 const result=replay(bundle);
 ensure(bundle.snapshot.order?.underlying==='TSLA','UNSUPPORTED_EXECUTION_UNDERLYING');
 ensure(result.status==='WINNER'&&result.winner,'NO_STRICT_WINNER');
 const asset=resolve('TSLA').find(a=>a.symbol===result.winner),candidate=bundle.snapshot.candidates.find(c=>c.symbol===result.winner);
 ensure(asset&&candidate?.mint===asset.mint&&candidate.metadata?.identityVerified&&candidate.metadata?.chainVerified,'UNVERIFIED_WINNING_MINT');
 return {asset,candidate,result};
}
export function validateQuote(q,asset,amountRaw,now,policy=EXECUTION_POLICY){
 const r=q?.raw;
 ensure(Number.isSafeInteger(q?.startedAt)&&q.startedAt<=now&&now-q.startedAt<=policy.maxFinalQuoteAgeMs&&Number.isSafeInteger(q.receivedAt)&&q.receivedAt>=q.startedAt&&q.receivedAt<=now,'QUOTE_EXPIRED');
 ensure(r&&!r.error&&!r.errorCode&&!r.errorMessage,'MALFORMED_JUPITER_RESPONSE');
 ensure(r.inputMint===USDC&&r.outputMint===asset.mint&&r.inAmount===amountRaw&&r.swapMode==='ExactIn','UNVERIFIED_EXECUTION_MINT_OR_INPUT');
 ensure(Number.isSafeInteger(r.slippageBps)&&r.slippageBps>=0&&r.slippageBps<=policy.maxSlippageBps,'SLIPPAGE_LIMIT_EXCEEDED');
 ensure(Array.isArray(r.routePlan)&&r.routePlan.length>0&&r.routePlan.every(x=>typeof x.swapInfo?.ammKey==='string'&&x.swapInfo.inputMint&&x.swapInfo.outputMint),'MALFORMED_JUPITER_RESPONSE');
 let output,minimum,impact;try{output=atomic(r.outAmount);minimum=atomic(r.otherAmountThreshold);impact=mul(abs(decimal(r.priceImpactPct)),rational(10000n));}catch{ensure(false,'MALFORMED_JUPITER_RESPONSE');}
 ensure(cmp(impact,rational(policy.maxPriceImpactBps))<=0,'PRICE_IMPACT_LIMIT_EXCEEDED');
 ensure(minimum<=output&&minimum>=output*BigInt(10000-r.slippageBps)/10000n,'MINIMUM_OUTPUT_INVALID');
 return {output,minimum};
}
export function materialGuard(analysis,comparison,finalQuote,now,policy=EXECUTION_POLICY){
 const old=strictAsset(analysis),fresh=strictAsset(comparison),amount=analysis.snapshot.order.amountRaw;
 ensure(analysis.snapshot.asOfMs<=now&&now-analysis.snapshot.asOfMs<=policy.maxAnalysisAgeMs,'ANALYSIS_EXPIRED');
 ensure(comparison.snapshot.asOfMs<=now&&now-comparison.snapshot.asOfMs<=policy.maxFinalQuoteAgeMs,'QUOTE_EXPIRED');
 ensure(comparison.snapshot.order.inputMint===USDC&&comparison.snapshot.order.amountRaw===amount,'ORIGINAL_INPUT_CHANGED');
 ensure(old.asset.symbol===fresh.asset.symbol&&old.asset.mint===fresh.asset.mint,'WINNING_REPRESENTATION_CHANGED');
 const current=evaluate({...comparison.snapshot,asOfMs:now});
 ensure(current.status==='WINNER'&&current.winner===old.asset.symbol,'MANDATORY_EVIDENCE_EXPIRED_OR_WINNER_CHANGED');
 ensure(old.candidate.metadata.sharesPerToken===fresh.candidate.metadata.sharesPerToken,'TOKEN_MECHANICS_CHANGED');
 for(const row of fresh.result.candidates.filter(c=>c.eligible))validateQuote(comparison.snapshot.candidates.find(c=>c.symbol===row.symbol).quote,resolve('TSLA').find(a=>a.symbol===row.symbol),amount,now,policy);
 const {minimum}=validateQuote(finalQuote,old.asset,amount,now,policy),analyzed=atomic(old.candidate.quote.raw.otherAmountThreshold),compared=atomic(fresh.candidate.quote.raw.otherAmountThreshold);
 const change=mul(div(sub(rational(analyzed),rational(minimum)),rational(analyzed)),rational(10000n));
 const immediate=mul(div(sub(rational(compared),rational(minimum)),rational(compared)),rational(10000n));
 ensure(cmp(change,rational(policy.maxDegradationBps))<=0&&cmp(immediate,rational(policy.maxDegradationBps))<=0,'EXECUTION_MATERIALLY_CHANGED');
 const exposure=mul(rational(minimum,10n**BigInt(old.asset.decimals)),decimal(fresh.candidate.metadata.sharesPerToken));
 for(const rival of fresh.result.candidates.filter(c=>c.eligible&&c.symbol!==old.asset.symbol)){
  const rivalExposure=rational(rival.normalized.minimumSharesExact.numerator,rival.normalized.minimumSharesExact.denominator),order=cmp(rivalExposure,exposure);
  ensure(order<0||(order===0&&old.asset.mint<rival.mint),'WINNING_REPRESENTATION_CHANGED');
 }
 return {allowed:true,reasonCodes:['FINAL_REQUOTE_PASSED'],analyzedMinimumOutput:String(analyzed),comparisonMinimumOutput:String(compared),finalMinimumOutput:String(minimum),degradationBps:display(change,9),degradationExact:json(change),comparisonDegradationBps:display(immediate,9),maxDegradationBps:policy.maxDegradationBps,analyzedQuoteTimestamp:old.candidate.quote.startedAt,finalQuoteTimestamp:finalQuote.startedAt,winningMint:old.asset.mint,winningRepresentation:old.asset.symbol};
}
