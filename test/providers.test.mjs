import test from 'node:test';
import assert from 'node:assert/strict';
import {exactJson,parseXstocks,parseOndoPage,parseOndoApi,parsePyth,verifyChain,createHttp} from '../src/providers.mjs';
import {quotePair} from '../src/collect.mjs';
import {ASSETS,USDC,FEEDS,TOKEN_2022} from '../src/registry.mjs';
const now=1789236000000;
const xAsset={symbol:'NVDAx',underlyingSymbol:'NVDA',underlyingIsin:'US67066G1040',deployments:[{network:'Solana',address:ASSETS[0].mint}],isTradingHalted:false};
test('JSON preserves multiplier digits without modifying quoted text',()=>assert.deepEqual(exactJson('{"n":1.000000000000000001,"s":"123\\\"4"}'),{n:'1.000000000000000001',s:'123"4'}));
test('xStocks selects pending multiplier exactly at activation',()=>{
  const m={currentMultiplier:'1',newMultiplier:'2',activationDateTime:String(now/1000)};
  assert.equal(parseXstocks(xAsset,m,now-1).sharesPerToken,'1');assert.equal(parseXstocks(xAsset,m,now).sharesPerToken,'2');
});
test('xStocks never substitutes multiplier 1 for missing data',()=>assert.throws(()=>parseXstocks(xAsset,{newMultiplier:'0',activationDateTime:'0'},now)));
test('issuer address mismatch rejected',()=>assert.throws(()=>parseXstocks({...xAsset,deployments:[]},{currentMultiplier:'1',newMultiplier:'0',activationDateTime:'0'},now)));
test('public Ondo fallback remains unverified for freshness and action state',()=>{
  const props={symbol:'NVDAon',ticker:'NVDA',sharesMultiplier:'1.000000000000000001',supportedNetworks:[{network:'SOLANA',address:ASSETS[1].mint,decimals:9}]};
  const html='<script>self.__next_f.push('+JSON.stringify([1,'aa:'+JSON.stringify(['$',null,props])+'\n'])+')</script>';
  const m=parseOndoPage(html,now);assert.equal(m.sharesPerToken,props.sharesMultiplier);assert.equal(m.timestampQuality,'retrieval-only');assert.equal(m.actionTimes,null);
  assert.throws(()=>parseOndoPage('<script>alert(1)</script>',now),/SCHEMA_CHANGED/);
});
test('Ondo documented API validates address and current event intervals',()=>{
  const m=parseOndoApi({symbol:'NVDAon',addresses:[{networkChainId:'solana-900',address:ASSETS[1].mint,decimals:9}]},{primaryMarket:{symbol:'NVDAon',sharesMultiplier:'1.01'},underlyingMarket:{ticker:'NVDA'},timestamp:String(now)},[{symbol:'NVDAon',start:new Date(now-1000).toISOString(),end:new Date(now+1000).toISOString()}],now);
  assert.equal(m.halted,true);assert.equal(m.sharesPerToken,'1.01');
});
test('chain verification rejects wrong owner and checks scaled UI multiplier',()=>{
  const m=parseXstocks(xAsset,{currentMultiplier:'1.001',newMultiplier:'0',activationDateTime:'0'},now);
  const rpc={result:{context:{slot:123},value:[{owner:TOKEN_2022,data:{parsed:{type:'mint',info:{isInitialized:true,decimals:8,extensions:[{extension:'scaledUiAmountConfig',state:{multiplier:1.001,newMultiplier:1.001,newMultiplierEffectiveTimestamp:0}}]}}}}]}};
  assert.equal(verifyChain(m,rpc,0,now).chainVerified,true);rpc.result.value[0].owner='fake';assert.throws(()=>verifyChain(m,rpc,0,now));
});
test('Pyth validates feed IDs and exponent, preserves integer precision',()=>{
  const p={parsed:Object.values(FEEDS).map(id=>({id,price:{price:'20000000000',conf:'10000',expo:-8,publish_time:now/1000}}))};
  assert.equal(parsePyth(p).NVDA.price,'200.000000000000000000000000000000');p.parsed.pop();assert.throws(()=>parsePyth(p),/FEED_MISSING/);
});
test('quote requests start concurrently; failure retains the other route',async()=>{
  let started=0,release;const barrier=new Promise(r=>release=r);
  const http={get:async id=>{started++;if(started===2)release();await barrier;if(id.endsWith('NVDAon'))throw Object.assign(Error(),{code:'RATE_LIMITED'});return {data:{outAmount:'1'},startedAt:now,receivedAt:now,id};}};
  const rows=await quotePair(http,{underlying:'NVDA',amountRaw:'100000000'},{clock:()=>now});assert.equal(started,2);assert.ok(rows[0].quote.raw);assert.equal(rows[1].quote.error.code,'RATE_LIMITED');
});
test('HTTP evidence excludes authentication headers and private RPC URL',async()=>{
  const http=createHttp({clock:()=>now,fetchImpl:async()=>new Response('{}')});await http.get('rpc','https://rpc.test/secret',{headers:{Authorization:'secret'},privateUrl:true});assert.ok(!JSON.stringify(http.evidence).includes('secret'));
});
test('HTTP 403, 429 and malformed response classified',async()=>{
  for(const [status,body,code] of [[403,'{}','ACCESS_DENIED'],[429,'{}','RATE_LIMITED'],[200,'oops','INVALID_PROVIDER_JSON']]){
    const http=createHttp({fetchImpl:async()=>new Response(body,{status})});await assert.rejects(http.get('p','https://example.test'),e=>e.code===code);assert.equal(http.evidence.length,1);
  }
});
