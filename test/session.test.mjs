import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {marketSession} from '../src/market-session.mjs';
import {sessionFixture,setPyth} from '../fixtures/session.mjs';
import {installYahoo} from '../fixtures/reference.mjs';
import {evaluate,hash} from '../src/engine.mjs';
import {replay} from '../src/cli.mjs';
const at=s=>Date.parse(s),winner=s=>{const r=evaluate(s);assert.equal(r.winner,'TSLAx',JSON.stringify(r.excluded));return r;};
test('all pre-session test and capture hashes remain unchanged',()=>{
 const m=JSON.parse(readFileSync(new URL('../preservation/pre-session-sha256.json',import.meta.url),'utf8'));for(const [f,h] of Object.entries(m))assert.equal(createHash('sha256').update(readFileSync(new URL('../'+f,import.meta.url))).digest('hex'),h,f);
});
test('Friday regular market with fresh reference gives open-market winner',()=>{
 const r=winner(sessionFixture(at('2026-09-11T14:00:00Z')));assert.equal(r.marketState,'UNDERLYING_OPEN');assert.equal(r.executionClassification,'BEST_EXECUTION_OPEN_MARKET');assert.equal(r.reference.classification,'LIVE_MARKET_REFERENCE');
});
test('Friday after regular close is extended, not closed',()=>{
 const r=winner(sessionFixture(at('2026-09-11T20:15:00Z')));assert.equal(r.marketState,'UNDERLYING_EXTENDED');assert.equal(r.executionClassification,'BEST_EXECUTION_EXTENDED_MARKET');
});
test('Friday after all scheduled sessions closes uses last-market anchor',()=>{
 const r=winner(sessionFixture(at('2026-09-12T01:00:00Z')));assert.equal(r.marketState,'UNDERLYING_CLOSED');assert.equal(r.executionClassification,'BEST_EXECUTION_CLOSED_MARKET');assert.equal(r.reference.isCurrentFairValue,false);
});
test('Saturday and Sunday use Friday completed session',()=>{
 for(const date of ['2026-09-12T16:00:00Z','2026-09-13T16:00:00Z']){const r=winner(sessionFixture(at(date)));assert.equal(r.marketState,'UNDERLYING_WEEKEND');assert.equal(r.marketSession.lastCompletedRegularSession.date,'2026-09-11');}
});
test('US equities Labor Day holiday uses preceding Friday',()=>{
 const r=winner(sessionFixture(at('2026-09-07T16:00:00Z')));assert.equal(r.marketState,'UNDERLYING_HOLIDAY');assert.equal(r.marketSession.lastCompletedRegularSession.date,'2026-09-04');assert.equal(r.marketSession.holiday,'Labor Day');
});
test('stale reference during open market fails',()=>{
 const s=sessionFixture(at('2026-09-11T14:00:00Z'));setPyth(s,'TSLA',{publishedAt:s.asOfMs-121000});const r=evaluate(s);assert.equal(r.winner,null);assert.ok(r.candidates[0].reasonCodes.includes('REFERENCE_TSLA_STALE'));
});
test('missing confidence remains mandatory during open market',()=>{
 const s=sessionFixture(at('2026-09-11T14:00:00Z'));installYahoo(s,'TSLA');const r=evaluate(s);assert.equal(r.winner,null);assert.ok(r.candidates[0].reasonCodes.includes('REFERENCE_TSLA_CONFIDENCE_UNKNOWN'));
});
test('last-market Yahoo reference without confidence qualifies with explicit limitations',()=>{
 const s=sessionFixture();installYahoo(s,'TSLA',{time:marketSession(s.asOfMs).lastCompletedRegularSession.regularClose});const r=winner(s);assert.equal(r.reference.classification,'LAST_MARKET_REFERENCE');assert.equal(r.reference.confidence,null);assert.ok(r.reasonCodes.includes('CLOSED_MARKET_REFERENCE'));assert.ok(r.reasonCodes.includes('LAST_MARKET_CONFIDENCE_UNAVAILABLE'));assert.ok(r.reference.ageMs>120000);assert.equal(r.candidates[0].gates[0].freshnessStatus,'QUALIFIED_LAST_MARKET');
});
test('last-market anchor from an older trading day is rejected',()=>{
 const s=sessionFixture();setPyth(s,'TSLA',{publishedAt:at('2026-09-10T20:00:00Z')});const r=evaluate(s);assert.equal(r.winner,null);assert.ok(r.candidates[0].reasonCodes.includes('LAST_MARKET_REFERENCE_NOT_LATEST_SESSION'));
});
test('stale Jupiter quote always fails even on weekend',()=>{
 const s=sessionFixture(),e=s.evidence.find(e=>e.id==='quote-TSLAx');e.startedAt=s.asOfMs-15001;s.candidates[0].quote.startedAt=e.startedAt;const r=evaluate(s);assert.equal(r.winner,null);assert.ok(r.candidates[0].reasonCodes.includes('QUOTE_STALE'));
});
test('same USDC comparison does not require any USD conversion',()=>{
 for(const time of ['2026-09-12T16:00:00Z','2026-09-11T14:00:00Z']){const s=sessionFixture(at(time));delete s.references.USDC;const r=winner(s);assert.equal(r.usdcReporting.conversionAvailable,false);assert.ok(r.warningCodes.includes('USD_CONVERSION_UNAVAILABLE'));assert.equal(r.comparisonDenomination,'USDC');}
});
test('three minute USDC quote can inform depeg guard without blocking relative ranking',()=>{
 const s=sessionFixture();setPyth(s,'USDC',{publishedAt:s.asOfMs-180000});const r=winner(s);assert.equal(r.usdcReporting.guardStatus,'WITHIN_THRESHOLD');assert.equal(r.usdcReporting.conversionAvailable,true);assert.ok(r.warningCodes.includes('USDC_CONVERSION_OLDER_THAN_LIVE_REFERENCE_LIMIT'));
});
test('USDC beyond guard horizon gives unknown conversion, not an assumed dollar',()=>{
 const s=sessionFixture();setPyth(s,'USDC',{publishedAt:s.asOfMs-900001});const r=winner(s);assert.equal(r.usdcReporting.guardStatus,'UNKNOWN');assert.equal(r.usdcReporting.price,null);
});
test('recent verified USDC depeg trips explicit guard',()=>{
 const s=sessionFixture();setPyth(s,'USDC',{price:'97000000'});const r=evaluate(s);assert.equal(r.winner,null);assert.equal(r.usdcReporting.guardStatus,'DEPEG_DETECTED');assert.ok(r.candidates[0].reasonCodes.includes('USDC_DEPEG_DETECTED'));
});
test('tampered USDC evidence is rejected rather than silently downgraded to unavailable',()=>{
 const s=sessionFixture();s.references.USDC.price='1.02';const r=evaluate(s);assert.equal(r.winner,null);assert.ok(r.candidates[0].reasonCodes.includes('USDC_CONVERSION_EVIDENCE_UNVERIFIED'));
});
test('unknown Ondo mandatory corporate actions explicitly excluded from single-survivor win',()=>{
 const r=winner(sessionFixture());assert.deepEqual(r.ranking,['TSLAx']);assert.ok(r.reasonCodes.includes('SINGLE_VERIFIED_SURVIVOR'));assert.ok(r.excluded[0].reasonCodes.includes('CORPORATE_ACTION_STATUS_UNKNOWN'));
});
test('closed market anchor dislocation is informational, not a fair-value rejection',()=>{
 const s=sessionFixture();setPyth(s,'TSLA',{publishedAt:marketSession(s.asOfMs).lastCompletedRegularSession.regularClose,price:'30000000000'});const r=winner(s),c=r.candidates[0];assert.ok(Number(c.normalized.anchorDislocationBps)>300);assert.equal(c.normalized.referenceDeviationBps,undefined);assert.equal(c.gates.find(g=>g.id==='ANCHOR_DISLOCATION').mandatory,false);
});
test('open market retains deviation gate with qualified conversion',()=>{
 const s=sessionFixture(at('2026-09-11T14:00:00Z'));setPyth(s,'TSLA',{price:'30000000000'});const r=evaluate(s);assert.equal(r.winner,null);assert.ok(r.candidates[0].reasonCodes.includes('REFERENCE_DEVIATION_EXCEEDED'));
});
test('extended market requires fresh extended observation, not a recent regular close',()=>{
 const s=sessionFixture(at('2026-09-11T20:00:30Z'));installYahoo(s,'TSLA',{time:at('2026-09-11T20:00:00Z')});const r=evaluate(s);assert.equal(r.winner,null);assert.ok(r.candidates[0].reasonCodes.includes('EXTENDED_SESSION_PRICE_REQUIRED'));
});
test('calendar handles spring and autumn DST in New York, independent of host timezone',()=>{
 assert.equal(marketSession(at('2026-03-06T14:00:00Z')).state,'UNDERLYING_EXTENDED');assert.equal(marketSession(at('2026-03-09T14:00:00Z')).state,'UNDERLYING_OPEN');assert.equal(marketSession(at('2026-11-02T14:00:00Z')).state,'UNDERLYING_EXTENDED');
});
test('early-close regular boundary is known; unverified extended hours fail closed',()=>{
 assert.equal(marketSession(at('2026-11-27T17:59:00Z')).state,'UNDERLYING_OPEN');const m=marketSession(at('2026-11-27T18:00:00Z'));assert.equal(m.state,'UNDERLYING_UNKNOWN');assert.ok(m.reasonCodes.includes('EARLY_CLOSE_EXTENDED_SCHEDULE_UNVERIFIED'));
});
test('calendar expires at announced Nasdaq overnight transition',()=>{
 const s=sessionFixture(at('2026-12-06T16:00:00Z'));const r=evaluate(s);assert.equal(r.winner,null);assert.equal(r.marketState,'UNDERLYING_UNKNOWN');assert.ok(r.candidates[0].reasonCodes.includes('MARKET_CALENDAR_OUT_OF_RANGE'));
});
test('calendar and session policy identity cannot be weakened by editing snapshot',()=>{
 let s=sessionFixture();s.marketCalendar.sha256='bad';assert.throws(()=>evaluate(s),/CALENDAR_VERSION/);s=sessionFixture();s.referencePolicy.lastCloseToleranceMs=86400000;assert.throws(()=>evaluate(s),/SESSION_REFERENCE_POLICY/);
});
test('future closed reference and old provider observation fail independently',()=>{
 let s=sessionFixture();setPyth(s,'TSLA',{publishedAt:s.asOfMs+1000});assert.equal(evaluate(s).winner,null);s=sessionFixture();const e=s.evidence.find(e=>e.id==='reference-pyth-TSLA');e.receivedAt=s.asOfMs-400000;e.startedAt=e.receivedAt-100;s.references.TSLA.observedAt=e.receivedAt;assert.ok(evaluate(s).candidates[0].reasonCodes.includes('REFERENCE_OBSERVATION_STALE'));
});
test('session-aware decisions replay deterministically with calendar identity',()=>{
 const s=sessionFixture(),b={snapshot:s,snapshotSha256:hash(s),result:evaluate(s)};assert.deepEqual(replay(JSON.parse(JSON.stringify(b))),b.result);
});
