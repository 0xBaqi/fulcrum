import test from 'node:test';
import assert from 'node:assert/strict';
import {evaluate,hash,canonical} from '../src/engine.mjs';
import {synthetic} from '../fixtures/synthetic.mjs';
import {decimal,cmp,usdcAmount} from '../src/math.mjs';
import {replay} from '../src/cli.mjs';
test('economic exposure reverses nominal token winner',()=>{
  const r=evaluate(synthetic());assert.equal(r.winner,'NVDAon');assert.equal(r.candidates[1].normalized.minimumShares,'0.500345700000');assert.equal(r.executionReady,false);
});
test('tie breaks by mint, independently of input order',()=>{
  const s=synthetic();s.candidates[1].metadata.sharesPerToken='1';s.candidates[1].quote.raw.outAmount='500000000';s.candidates[1].quote.raw.otherAmountThreshold='497500000';
  assert.equal(evaluate(s).winner,'NVDAx');s.candidates.reverse();assert.equal(evaluate(s).winner,'NVDAx');assert.ok(evaluate(s).reasonCodes.includes('TIE_BREAK_MINT_ASC'));
});
test('no rounding near precision boundary',()=>assert.equal(cmp(decimal('1.000000000000000001'),decimal('1.000000000000000002')),-1));
test('amount parsing is exact and rejects unsafe input',()=>{
  assert.equal(usdcAmount('9007199254.740993'),'9007199254740993');
  for(const s of ['0','-1','1e3','NaN','0.0000001','Infinity','1.2.3'])assert.throws(()=>usdcAmount(s));
});
const cases=[
  ['quote stale',s=>s.candidates[0].quote.startedAt-=20000,'QUOTE_STALE'],
  ['future quote',s=>s.candidates[0].quote.receivedAt+=1000,'QUOTE_TIME_INVALID'],
  ['start skew',s=>s.candidates[0].quote.startedAt-=1000,'QUOTE_START_SKEW'],
  ['receipt skew',s=>s.candidates[0].quote.receivedAt-=6000,'QUOTE_RECEIVE_SKEW'],
  ['stale reference',s=>s.references.NVDA.publishedAt-=500000,'REFERENCE_NVDA_STALE'],
  ['future reference',s=>s.references.NVDA.publishedAt+=500000,'REFERENCE_NVDA_STALE'],
  ['reference confidence',s=>s.references.NVDA.confidence='50','REFERENCE_NVDA_CONFIDENCE_HIGH'],
  ['missing USDC reference',s=>delete s.references.USDC,'REFERENCE_USDC_INVALID'],
  ['reference identity',s=>s.references.NVDA.symbol='Equity.Index.NVDA/USD','REFERENCE_IDENTITY_MISMATCH'],
  ['reference deviation',s=>s.references.NVDA.price='100','REFERENCE_DEVIATION_EXCEEDED'],
  ['metadata stale',s=>s.candidates[0].metadata.observedAt-=600000,'METADATA_STALE'],
  ['metadata identity',s=>s.candidates[0].metadata.underlying='TSLA','METADATA_IDENTITY_MISMATCH'],
  ['page timestamp unknown',s=>s.candidates[0].metadata.timestampQuality='retrieval-only','METADATA_TIMESTAMP_UNVERIFIED'],
  ['chain unverified',s=>s.candidates[0].metadata.chainVerified=false,'MINT_CHAIN_UNVERIFIED'],
  ['halt',s=>s.candidates[0].metadata.halted=true,'ISSUER_HALTED'],
  ['unknown halt',s=>s.candidates[0].metadata.halted=null,'ISSUER_STATUS_UNKNOWN'],
  ['corporate action',s=>s.candidates[0].metadata.actionTimes=[s.asOfMs+1000],'CORPORATE_ACTION_WINDOW'],
  ['missing action schedule',s=>s.candidates[0].metadata.actionTimes=null,'CORPORATE_ACTION_STATUS_UNKNOWN'],
  ['zero multiplier',s=>s.candidates[0].metadata.sharesPerToken='0','INVALID_MULTIPLIER'],
  ['quote mint mismatch',s=>s.candidates[0].quote.raw.outputMint='fake','QUOTE_ORDER_MISMATCH'],
  ['quote amount mismatch',s=>s.candidates[0].quote.raw.inAmount='999','QUOTE_ORDER_MISMATCH'],
  ['missing route',s=>s.candidates[0].quote.raw.routePlan=[],'ROUTE_MISSING'],
  ['missing request id',s=>delete s.candidates[0].quote.raw.requestId,'EXECUTION_ROUTE_INVALID'],
  ['slippage',s=>s.candidates[0].quote.raw.slippageBps=500,'SLIPPAGE_EXCEEDED'],
  ['price impact',s=>s.candidates[0].quote.raw.priceImpactPct='0.02','PRICE_IMPACT_EXCEEDED'],
  ['invalid output',s=>s.candidates[0].quote.raw.outAmount='NaN','QUOTE_OR_NORMALIZATION_INVALID'],
  ['minimum exceeds expected',s=>s.candidates[0].quote.raw.otherAmountThreshold='99999999','MINIMUM_OUTPUT_INVALID'],
  ['minimum below slippage bound',s=>s.candidates[0].quote.raw.otherAmountThreshold='40000000','MINIMUM_OUTPUT_INVALID'],
  ['partial outage',s=>s.candidates[0].quote={error:{code:'RATE_LIMITED'}},'RATE_LIMITED'],
];
for(const [name,mutate,code] of cases)test(name+' fails closed',()=>{const s=synthetic();mutate(s);const r=evaluate(s);assert.equal(r.winner,null);assert.ok(r.candidates.some(c=>c.reasonCodes.includes(code)),JSON.stringify(r));});
test('RFQ zero slippage and negative price impact are accepted',()=>{const s=synthetic();const q=s.candidates[1].quote.raw;q.swapType='rfq';q.slippageBps=0;q.otherAmountThreshold=q.outAmount;q.priceImpactPct='-0.001';assert.equal(evaluate(s).winner,'NVDAon');});
test('duplicate or missing candidate rejected',()=>{const s=synthetic();s.candidates[1]=s.candidates[0];assert.throws(()=>evaluate(s),/CANDIDATE_SET/);});
test('invalid policy rejected',()=>{const s=synthetic();s.policy.maxQuoteAgeMs=NaN;assert.throws(()=>evaluate(s),/INVALID_POLICY/);});
test('replay is byte stable and detects tampering',()=>{
  const s=synthetic(),result=evaluate(s),bundle={snapshot:s,result,snapshotSha256:hash(s)};
  assert.equal(canonical(replay(JSON.parse(JSON.stringify(bundle)))),canonical(result));
  bundle.snapshot.order.amountRaw='200000000';assert.throws(()=>replay(bundle),/HASH_MISMATCH/);
});
test('replay rejects altered result',()=>{const s=synthetic();const bundle={snapshot:s,result:{...evaluate(s),winner:'NVDAx'},snapshotSha256:hash(s)};assert.throws(()=>replay(bundle),/RESULT_MISMATCH/);});
