import test from 'node:test';
import assert from 'node:assert/strict';
import {settledCollector} from '../src/app/collection.mjs';
test('bounded source-time wait advances only to actual decision time, preserving evidence',async()=>{let now=1000;const s={asOfMs:1000,evidence:[{responseHeaders:{date:new Date(2000).toUTCString()},receivedAt:1000}],quote:{startedAt:999}},before=structuredClone(s);const result=await settledCollector(async()=>s,{clock:()=>now,sleep:async ms=>{now+=ms;}})({});assert.equal(result.asOfMs,2001);assert.deepEqual(result.evidence,before.evidence);assert.deepEqual(s,before);assert.equal(result.quote.startedAt,999);});
test('source far in future remains unmodified for existing gate rejection',async()=>{const s={asOfMs:1000,evidence:[{responseHeaders:{date:new Date(10000).toUTCString()}}]};let waited=false;const result=await settledCollector(async()=>s,{clock:()=>1000,sleep:async()=>{waited=true;}})({});assert.equal(result,s);assert.equal(waited,false);});
test('wait never assigns source time if actual clock has not caught up',async()=>{const s={asOfMs:1000,evidence:[{responseHeaders:{date:new Date(2000).toUTCString()}}]};const result=await settledCollector(async()=>s,{clock:()=>1000,sleep:async()=>{}})({});assert.equal(result.asOfMs,1000);});
test('settleable source time still waits when another source is beyond the wait bound',async()=>{
  let now=1000;
  const s={
    asOfMs:1000,
    evidence:[
      {sourceTimestamp:2500},
      {sourceTimestamp:5000}
    ]
  };
  const before=structuredClone(s);

  const result=await settledCollector(
    async()=>s,
    {
      clock:()=>now,
      sleep:async ms=>{now+=ms;},
      maxWaitMs:3000
    }
  )({});

  assert.equal(result.asOfMs,2501);
  assert.deepEqual(result.evidence,before.evidence);
  assert.deepEqual(s,before);
});
