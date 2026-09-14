import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,readdirSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {evaluate,hash,canonical,POLICY} from '../src/engine.mjs';
import {replay} from '../src/cli.mjs';
import {createHttp} from '../src/providers.mjs';
import {resolve} from '../src/registry.mjs';
import {collectReferences,pythProvider,yahooProvider,referenceProof} from '../src/references.mjs';
import {referenceFixture,installYahoo,yahooResponse} from '../fixtures/reference.mjs';
import {rehash} from '../fixtures/strict.mjs';
test('all 73 prior tests and prior captures retain their bytes',()=>{
 const manifest=JSON.parse(readFileSync(new URL('../preservation/pre-tesla-sha256.json',import.meta.url),'utf8'));
 for(const [f,digest] of Object.entries(manifest))assert.equal(createHash('sha256').update(readFileSync(new URL('../'+f,import.meta.url))).digest('hex'),digest,f);
});
test('every saved bundle across schema 1, 2 and 3 replays',()=>{
 for(const f of readdirSync(new URL('../evidence/',import.meta.url)).filter(f=>f.endsWith('.json'))){const b=JSON.parse(readFileSync(new URL('../evidence/'+f,import.meta.url),'utf8'));if(b.snapshot&&b.result)assert.ok(replay(b),f);}
});
test('Tesla canonical resolver recognizes aliases and issuer-backed mints',()=>{
 assert.deepEqual(resolve('Tesla'),resolve('TSLA'));assert.deepEqual(resolve('TSLA').map(a=>a.symbol),['TSLAx','TSLAon']);assert.throws(()=>resolve('AAPL'));
});
test('schema 3 single verified Tesla survivor wins despite unknown Ondo facts',()=>{
 const r=evaluate(referenceFixture());assert.equal(r.winner,'TSLAx',JSON.stringify(r.excluded));assert.deepEqual(r.ranking,['TSLAx']);assert.ok(r.reasonCodes.includes('SINGLE_VERIFIED_SURVIVOR'));assert.ok(r.excluded[0].reasonCodes.includes('CORPORATE_ACTION_STATUS_UNKNOWN'));
});
test('missing rival quote and optional data cannot block schema 3 survivor',()=>{
 const s=referenceFixture();s.candidates[1].quote={error:{code:'RATE_LIMITED'}};s.warnings.push({provider:'ondo',code:'OPTIONAL_DESCRIPTION_MISSING'});assert.equal(evaluate(s).winner,'TSLAx');
});
test('schema 3 deterministic replay includes normalized references',()=>{
 const s=referenceFixture(),b={snapshot:s,snapshotSha256:hash(s),result:evaluate(s)};assert.deepEqual(replay(JSON.parse(JSON.stringify(b))),b.result);
});
test('keyless selection never sends Authorization or calls private Pyth',async()=>{
 const urls=[],http=createHttp({fetchImpl:async(u,o)=>{urls.push(u);assert.equal(o.headers.Authorization,undefined);return Response.json(yahooResponse(u.includes('/TSLA?')?'TSLA':'USDC'));}});
 const refs=await collectReferences(http,{underlying:'TSLA',env:{}});assert.equal(refs.TSLA.provider,'yahoo-chart');assert.equal(urls.length,2);assert.ok(urls.every(u=>u.startsWith('https://query1.finance.yahoo.com/')));
});
test('future configured Pyth credential activates optional provider',async()=>{
 const fixture=referenceFixture(),http=createHttp({fetchImpl:async(u,o)=>{assert.equal(o.headers.Authorization,'Bearer synthetic-key');return new Response(fixture.evidence.find(e=>e.source===u).responseText);}});
 const refs=await collectReferences(http,{underlying:'TSLA',env:{PYTH_API_KEY:'synthetic-key'}});assert.equal(refs.TSLA.provider,'pyth-hermes');assert.ok(!JSON.stringify(http.evidence).includes('synthetic-key'));
});
test('Pyth credential failures fall back per reference without leaking credentials',async()=>{
 const warnings=[],http=createHttp({fetchImpl:async(u)=>u.includes('dourolabs')?new Response('synthetic-key',{status:401}):Response.json(yahooResponse(u.includes('/TSLA?')?'TSLA':'USDC'))});
 const refs=await collectReferences(http,{underlying:'TSLA',env:{PYTH_API_KEY:'synthetic-key'},warnings});assert.equal(refs.TSLA.provider,'yahoo-chart');assert.equal(warnings.length,2);assert.ok(warnings.every(w=>w.code==='PYTH_CREDENTIAL_REJECTED'));assert.ok(!JSON.stringify(http.evidence).includes('synthetic-key'));
});
test('entitlement failure for equity does not discard an independently available USDC reference',async()=>{
 const f=referenceFixture(),warnings=[],http=createHttp({fetchImpl:async u=>u===pythProvider.request('TSLA').url?new Response('Not entitled: feed unavailable',{status:403}):u.includes('dourolabs')?new Response(f.evidence.find(e=>e.source===u).responseText):Response.json(yahooResponse('TSLA'))});
 const refs=await collectReferences(http,{underlying:'TSLA',env:{PYTH_API_KEY:'synthetic-key'},warnings});assert.equal(refs.TSLA.provider,'yahoo-chart');assert.equal(refs.USDC.provider,'pyth-hermes');assert.equal(warnings[0].code,'PYTH_FEED_NOT_ENTITLED');
});
test('complete reference outage returns missing evidence rather than fabricated prices',async()=>{
 const warnings=[],http=createHttp({fetchImpl:async()=>new Response('unavailable',{status:503})});assert.deepEqual(await collectReferences(http,{underlying:'TSLA',env:{},warnings}),{});assert.equal(warnings.length,2);
});
test('stale Pyth reference fails same 120 second gate in schema 3',()=>{
 const s=referenceFixture(),e=s.evidence.find(e=>e.id==='reference-pyth-TSLA'),d=JSON.parse(e.responseText);d.parsed[0].price.publish_time-=121;e.responseText=JSON.stringify(d);rehash(e);s.references.TSLA=pythProvider.parse(e,'TSLA');assert.ok(evaluate(s).candidates[0].reasonCodes.includes('REFERENCE_TSLA_STALE'));assert.equal(POLICY.maxReferenceAgeMs,120000);
});
test('fresh retrieval never refreshes stale Yahoo trade timestamp',()=>{
 const s=referenceFixture();installYahoo(s,'TSLA',{time:s.asOfMs-86400000});const g=evaluate(s).candidates[0].gates[0];assert.equal(g.freshnessStatus,'STALE');assert.equal(g.verificationStatus,'VERIFIED');assert.ok(g.reasonCodes.includes('REFERENCE_TSLA_STALE'));
});
test('Yahoo confidence unavailable is UNKNOWN, never zero or optional',()=>{
 const s=referenceFixture();installYahoo(s,'TSLA');const r=evaluate(s);assert.equal(s.references.TSLA.confidence,null);assert.equal(r.winner,null);assert.ok(r.candidates[0].reasonCodes.includes('REFERENCE_TSLA_CONFIDENCE_UNKNOWN'));
});
test('same normalized prices yield identical economic exposure across providers',()=>{
 const s=referenceFixture(),before=evaluate(s).candidates.map(c=>c.normalized);installYahoo(s,'TSLA');installYahoo(s,'USDC');assert.deepEqual(evaluate(s).candidates.map(c=>c.normalized),before);
});
test('unknown data delay is labeled without inventing a duration',()=>{
 const s=referenceFixture();installYahoo(s,'TSLA');assert.equal(s.references.TSLA.delay.status,'UNKNOWN');assert.equal(s.references.TSLA.delay.seconds,null);assert.match(s.references.TSLA.delay.label,/DELAYED/);
});
test('reported delayed data is labeled and retains original price time',()=>{
 const s=referenceFixture();installYahoo(s,'TSLA',{delay:15,time:s.asOfMs-900000});assert.equal(s.references.TSLA.delay.status,'DELAYED');assert.equal(s.references.TSLA.delay.providerReportedValue,15);assert.equal(s.references.TSLA.delay.seconds,null);assert.equal(referenceProof(s,'TSLA')[0].freshnessStatus,'STALE');
});
test('Yahoo wrong symbol or currency rejected at provider boundary',()=>{
 for(const [k,v] of [['symbol','NVDA'],['currency','EUR']]){const d=yahooResponse('TSLA');d.chart.result[0].meta[k]=v;assert.throws(()=>yahooProvider.parse({responseText:JSON.stringify(d)},'TSLA'),/IDENTITY/);}
});
test('unknown Yahoo timestamp rejected rather than replaced by retrieval',()=>{
 const d=yahooResponse('TSLA');delete d.chart.result[0].meta.regularMarketTime;assert.throws(()=>yahooProvider.parse({responseText:JSON.stringify(d)},'TSLA'),/TIMESTAMP/);
});
test('unapproved reference source and provider fail verification',()=>{
 for(const change of ['source','provider']){const s=referenceFixture();s.references.TSLA[change]='untrusted';assert.equal(evaluate(s).winner,null);assert.equal(referenceProof(s,'TSLA')[0].verificationStatus,'UNVERIFIED');}
});
test('reference body, price, timestamp, session and delay tampering fail provenance',()=>{
 for(const change of ['body','price','publishedAt','marketSession','delay']){const s=referenceFixture();if(change==='body')s.evidence.find(e=>e.id==='reference-pyth-TSLA').responseText+=' ';else s.references.TSLA[change]=change==='price'?'369.01':123;assert.equal(referenceProof(s,'TSLA')[0].verificationStatus,'UNVERIFIED',change);assert.equal(evaluate(s).winner,null);}
});
test('Pyth wrong feed cannot become a Tesla reference',()=>{
 const s=referenceFixture(),e=s.evidence.find(e=>e.id==='reference-pyth-USDC');assert.throws(()=>pythProvider.parse(e,'TSLA'),/FEED_MISSING/);
});
test('synthetic reference evidence cannot authorize live selection',()=>{
 const s=referenceFixture();s.mode='live';assert.equal(evaluate(s).winner,null);assert.equal(referenceProof(s,'TSLA')[0].verificationStatus,'UNVERIFIED');
});
test('Tesla live capture uses no private Pyth price call and never ranks stale data',()=>{
 const b=JSON.parse(readFileSync(new URL('../evidence/tesla-live-2026-09-13.json',import.meta.url),'utf8'));assert.equal(b.snapshot.order.amountRaw,'100000000');assert.equal(b.snapshot.references.TSLA.provider,'yahoo-chart');assert.equal(b.result.status,'NO_WINNER');assert.deepEqual(b.result.ranking,[]);assert.ok(b.snapshot.evidence.every(e=>!e.id.startsWith('reference-pyth')));assert.ok(b.result.candidates[1].reasonCodes.includes('CORPORATE_ACTION_STATUS_UNKNOWN'));
});
