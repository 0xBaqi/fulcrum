import test from 'node:test';
import assert from 'node:assert/strict';
import {walletSession} from '../src/app/wallet-session.mjs';
import {bundleSnapshotWithPythPro} from '../src/app/live.mjs';
import {fixture,wallet} from '../fixtures/execution.mjs';
import {sessionFixture,setPyth} from '../fixtures/session.mjs';
import {executionPipelineWithPythPro} from '../src/app/execution-pipeline.mjs';

test('fresh rejected quotes are diagnosed without reusing an earlier winner or invoking execution',async t=>{
  const original=fixture().snapshot;
  assert.equal(bundleSnapshotWithPythPro(original).result.status,'WINNER');
  const fresh=structuredClone(original);
  for(const c of fresh.candidates)c.quote={error:{code:'RATE_LIMITED'}};
  fresh.evidence.push({id:'private-sentinel',responseText:'SECRET_RESPONSE',request:{authorization:'SECRET_KEY'}});
  const logs=[];
  t.mock.method(console,'info',(...args)=>logs.push(args));
  let collected=0,executions=0;
  const session=walletSession({
    clock:()=>original.asOfMs,
    collector:async()=>structuredClone(++collected===1?original:fresh),
    executor:()=>({prepare:async()=>{executions++;return {status:'READY_FOR_SIGNATURE',inputAmount:'1000000'};}})
  });
  await session.prepare(wallet);
  await assert.rejects(session.prepare(wallet),{code:'NO_STRICT_WINNER'});
  assert.equal(collected,2);
  assert.equal(executions,1);
  assert.deepEqual(session.view(),{busy:false,attempted:false,receipt:null});
  assert.equal(logs[1][0],'[FULCRUM][WALLET_PREPARE][FRESH_ANALYSIS]');
  const d=JSON.parse(logs[1][1]);
  assert.equal(d.status,'NO_WINNER');
  assert.notEqual(d.snapshotSha256,JSON.parse(logs[0][1]).snapshotSha256);
  assert.ok(d.candidates.every(c=>c.reasonCodes.includes('RATE_LIMITED')));
  assert.ok(d.candidates.every(c=>c.failedMandatoryGates.some(g=>g.id==='QUOTE_VALIDITY')));
  assert.doesNotMatch(JSON.stringify(logs),/SECRET_RESPONSE|SECRET_KEY|authorization|responseText/);
});

test('pipeline diagnoses its second analysis when a winner becomes future-dated and blocks before build or RPC',async t=>{
  const analysis=bundleSnapshotWithPythPro(sessionFixture(Date.parse('2026-10-09T16:00:00Z')));
  assert.equal(bundleSnapshotWithPythPro(analysis.snapshot).result.status,'WINNER');
  const fresh=structuredClone(analysis.snapshot);
  setPyth(fresh,'TSLA',{publishedAt:fresh.asOfMs+10000});
  fresh.evidence.push({id:'private-sentinel',responseText:'SECRET_RESPONSE',request:{authorization:'SECRET_KEY'}});
  const logs=[];
  t.mock.method(console,'info',(...args)=>logs.push(args));
  let saved;
  const pipeline=executionPipelineWithPythPro({
    testOnly:true,clock:()=>fresh.asOfMs,collector:async()=>fresh,
    http:{evidence:[],get:async()=>assert.fail('must block before transaction build')},
    rpc:{evidence:[],call:async()=>assert.fail('must block before RPC')},
    persist:async b=>{saved=b;}
  });
  const r=await pipeline.prepare(bundleSnapshotWithPythPro(analysis.snapshot),wallet);
  assert.equal(r.status,'BLOCKED');
  assert.ok(r.reasonCodes.includes('NO_STRICT_WINNER'));
  assert.ok(r.reasonCodes.includes('REFERENCE_TSLA_FUTURE'));
  assert.equal(r.transaction,null);
  assert.equal(r.signature,null);
  assert.ok(saved);
  assert.equal(logs[0][0],'[FULCRUM][EXECUTION_PREPARE][FRESH_ANALYSIS]');
  const d=JSON.parse(logs[0][1]);
  assert.equal(d.status,'NO_WINNER');
  assert.notEqual(d.snapshotSha256,analysis.snapshotSha256);
  assert.ok(d.candidates[0].failedMandatoryGates.some(g=>g.reasonCodes.includes('REFERENCE_TSLA_FUTURE')));
  assert.doesNotMatch(JSON.stringify(logs),/SECRET_RESPONSE|SECRET_KEY|authorization|responseText/);
});

test('future reference remains blocked and its actual reason is logged before denial',async t=>{
  const s=sessionFixture(Date.parse('2026-10-07T16:00:00Z'));
  setPyth(s,'TSLA',{publishedAt:s.asOfMs+10000});
  const logs=[];
  t.mock.method(console,'info',(...args)=>logs.push(args));
  const session=walletSession({clock:()=>s.asOfMs,collector:async()=>s,
    executor:()=>assert.fail('future evidence must not reach execution')});
  await assert.rejects(session.prepare(wallet),e=>e.code==='NO_STRICT_WINNER'&&e.denialReasonCodes.includes('REFERENCE_TSLA_FUTURE'));
  const d=JSON.parse(logs[0][1]);
  assert.ok(d.candidates[0].reasonCodes.includes('REFERENCE_TSLA_FUTURE'));
  assert.equal(session.view().receipt,null);
  await assert.rejects(session.submit({authorizeBroadcast:true}),{code:'SESSION_NOT_READY'});
});
