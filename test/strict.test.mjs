import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {evaluate,hash} from '../src/engine.mjs';
import {replay} from '../src/cli.mjs';
import {fetchPyth,HERMES} from '../src/pyth.mjs';
import {createHttp,parsePyth} from '../src/providers.mjs';
import {strictFixture,rehash} from '../fixtures/strict.mjs';
import {freshness} from '../src/provenance.mjs';

test('all original test files and captures have their preserved hashes',()=>{
  const manifest=JSON.parse(readFileSync(new URL('../preservation/milestone-1-sha256.json',import.meta.url),'utf8'));
  for(const f of manifest){const bytes=readFileSync(new URL('../'+f.path,import.meta.url));assert.equal(createHash('sha256').update(bytes).digest('hex'),f.sha256,f.path);}
});
test('all legacy evidence still replays under the frozen M1 evaluator',()=>{
  for(const f of ['demo.json','live-2026-09-12.json','live-final-2026-09-12.json'])assert.ok(replay(JSON.parse(readFileSync(new URL('../evidence/'+f,import.meta.url),'utf8'))));
});
test('unknown Ondo corporate actions excluded; verified NVDAx wins alone',()=>{
  const result=evaluate(strictFixture());
  assert.equal(result.winner,'NVDAx',JSON.stringify(result.candidates[0].reasonCodes));
  assert.deepEqual(result.ranking,['NVDAx']);assert.ok(result.reasonCodes.includes('SINGLE_VERIFIED_SURVIVOR'));
  const ondo=result.candidates[1];assert.ok(ondo.reasonCodes.includes('CORPORATE_ACTION_STATUS_UNKNOWN'));
  assert.equal(ondo.gates.find(g=>g.id==='CORPORATE_ACTION').verificationStatus,'UNKNOWN');
});
test('two fully verified representations use strict economic ranking',()=>{
  const r=evaluate(strictFixture({verifiedOndo:true}));assert.equal(r.winner,'NVDAon',JSON.stringify(r.candidates.map(c=>c.reasonCodes)));assert.equal(r.ranking.length,2);assert.equal(r.excluded.length,0);
});
test('unknown optional descriptions and missing rival quote cannot block survivor',()=>{
  const s=strictFixture();s.warnings.push({provider:'ondo',code:'OPTIONAL_DESCRIPTION_UNAVAILABLE'});
  s.candidates[1].quote={startedAt:s.asOfMs-20000,receivedAt:s.asOfMs-1,error:{code:'RATE_LIMITED'}};
  assert.equal(evaluate(s).winner,'NVDAx');
});
test('excluded rival timing skew does not poison healthy comparison',()=>{
  const s=strictFixture(),e=s.evidence.find(e=>e.id==='quote-NVDAon');e.startedAt-=5000;e.receivedAt-=5000;s.candidates[1].quote.startedAt=e.startedAt;s.candidates[1].quote.receivedAt=e.receivedAt;
  assert.equal(evaluate(s).winner,'NVDAx');
});
test('two valid but noncontemporaneous quotes fail pair gate',()=>{
  const s=strictFixture({verifiedOndo:true}),e=s.evidence.find(e=>e.id==='quote-NVDAon');e.startedAt-=1000;s.candidates[1].quote.startedAt=e.startedAt;
  const r=evaluate(s);assert.equal(r.winner,null);assert.ok(r.comparisonGates[0].reasonCodes.includes('QUOTE_START_SKEW'));
});
test('stale Pyth data excludes every representation',()=>{
  const s=strictFixture(),e=s.evidence.find(e=>e.id==='pyth-latest'),data=JSON.parse(e.responseText);data.parsed[0].price.publish_time-=600;e.responseText=JSON.stringify(data);rehash(e);s.references=parsePyth(data);
  const r=evaluate(s);assert.equal(r.winner,null);assert.ok(r.candidates[0].reasonCodes.includes('REFERENCE_NVDA_STALE'));assert.equal(r.candidates[0].gates[0].freshnessStatus,'STALE');
});
test('reference timestamp tampering is not accepted',()=>{
  const s=strictFixture();s.references.NVDA.publishedAt+=1;const r=evaluate(s);assert.equal(r.winner,null);assert.ok(r.candidates[0].reasonCodes.includes('REFERENCE_NVDA_EVIDENCE_UNVERIFIED'));
});
test('raw body tampering is detected even with valid normalized quote',()=>{
  const s=strictFixture();s.evidence.find(e=>e.id==='quote-NVDAx').responseText+=' ';assert.equal(evaluate(s).winner,null);
});
test('unofficial Ondo source is not used as verification',()=>{
  const s=strictFixture({verifiedOndo:true});s.evidence.find(e=>e.id==='ondo-status').source='https://unofficial.example/status';assert.equal(evaluate(s).winner,'NVDAx');
});
test('every gate includes source, observation, freshness, verification and evidence',()=>{
  const r=evaluate(strictFixture());for(const g of r.candidates.flatMap(c=>c.gates)){assert.ok(g.source.length);assert.ok(Array.isArray(g.observedAt));assert.ok(g.freshnessStatus);assert.ok(g.verificationStatus);assert.ok(g.evidence.every(e=>Object.hasOwn(e,'observedAt')&&Object.hasOwn(e,'publishedAt')));}
});
test('v2 decisions replay deterministically without touching old captures',()=>{
  const s=strictFixture(),bundle={snapshot:s,snapshotSha256:hash(s),result:evaluate(s)};assert.deepEqual(replay(JSON.parse(JSON.stringify(bundle))),bundle.result);
});
test('Pyth missing/rejected credentials classified without leaking keys',async()=>{
  for(const [key,status,expected] of [[undefined,401,'PYTH_CREDENTIAL_MISSING'],['private-test-token',401,'PYTH_CREDENTIAL_REJECTED'],['private-test-token',403,'PYTH_CREDENTIAL_REJECTED']]){
    const http=createHttp({fetchImpl:async(url,options)=>{assert.ok(url.startsWith(HERMES));assert.equal(options.headers.Authorization,key?'Bearer '+key:undefined);return new Response(key??'unauthorized',{status});}});
    await assert.rejects(fetchPyth(http,{PYTH_API_KEY:key}),e=>e.code===expected);
    if(key)assert.ok(!JSON.stringify(http.evidence).includes(key));
  }
});
test('Pyth key is sent server-side to current Hermes endpoint and parsed',async()=>{
  const s=strictFixture(),body=s.evidence.find(e=>e.id==='pyth-latest').responseText;
  const http=createHttp({clock:()=>s.asOfMs,fetchImpl:async(url,o)=>{assert.equal(new URL(url).pathname,'/hermes/v2/updates/price/latest');assert.equal(o.headers.Authorization,'Bearer fixture-key');return new Response(body);}});
  const refs=await fetchPyth(http,{PYTH_API_KEY:'fixture-key'});assert.equal(refs.NVDA.publishedAt,s.asOfMs-1000);assert.equal(refs.NVDA.price,s.references.NVDA.price);
});
test('Pyth key is not sent to arbitrary configured endpoints',async()=>{
  let called=false;const http={get:async()=>{called=true;}};await assert.rejects(fetchPyth(http,{PYTH_API_KEY:'secret',PYTH_HERMES_URL:'https://untrusted.test'}),/ENDPOINT_NOT_APPROVED/);assert.equal(called,false);
});
test('freshness has explicit unknown, future, stale and fresh states',()=>{
  assert.equal(freshness(null,1000,100),'UNKNOWN');assert.equal(freshness(1001,1000,100),'FUTURE');assert.equal(freshness(1,1000,100),'STALE');assert.equal(freshness(900,1000,100),'FRESH');
});
test('block-time proof must correspond to the mint context slot',()=>{
  const s=strictFixture();s.evidence.find(e=>e.id==='solana-blocktime').request.params[0]++;
  const r=evaluate(s);assert.equal(r.winner,null);assert.ok(r.candidates[0].reasonCodes.includes('CHAIN_EVIDENCE_UNKNOWN'));
});
test('invalid comparison policy cannot be bypassed by a single survivor',()=>{
  const s=strictFixture();s.policy.maxQuoteStartSkewMs=NaN;assert.throws(()=>evaluate(s),/INVALID_POLICY/);
});
test('synthetic evidence cannot be relabelled as a live winner',()=>{
  const s=strictFixture();s.mode='live';assert.equal(evaluate(s).winner,null);
});
test('Pyth feed entitlement denial is distinguished from invalid credentials',async()=>{
  const body='Not entitled: feed b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593 (no grant accepts this feed)';
  const http=createHttp({fetchImpl:async()=>new Response(body,{status:403})});
  await assert.rejects(fetchPyth(http,{PYTH_API_KEY:'configured-test-key'}),e=>e.code==='PYTH_FEED_NOT_ENTITLED');
  assert.equal(http.evidence[0].responseText,body);
});
