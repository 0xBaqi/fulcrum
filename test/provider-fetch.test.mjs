import test from 'node:test';
import assert from 'node:assert/strict';
import {createHttp} from '../src/providers.mjs';
import {providerFetch} from '../src/app/provider-fetch.mjs';
const rpcUrl='https://private.test/SECRET';
const body={jsonrpc:'2.0',id:1,method:'getMultipleAccounts',params:[['mint'],{encoding:'jsonParsed',commitment:'confirmed'}]};
test('timeout while reading a response body is classified without retrying or retaining raw errors',async()=>{
 let calls=0;
 const http=createHttp({fetchImpl:providerFetch(async()=>{calls++;return {status:200,ok:true,headers:new Headers(),text:async()=>{throw new DOMException('SECRET_BODY','TimeoutError');}};},{rpcUrl})});
 await assert.rejects(http.get('solana-mints',rpcUrl,{privateUrl:true,body}),{code:'TIMEOUT'});
 assert.equal(calls,1);assert.equal(http.evidence[0].error.code,'TIMEOUT');assert.doesNotMatch(JSON.stringify(http.evidence),/SECRET_BODY/);
});
test('early transport failure retries exact endpoint, body and original deadline signal once',async()=>{
  let calls=0;const requests=[],retries=[];
  const wrapped=providerFetch(async(url,options)=>{
    requests.push([url,options]);if(++calls===1)throw TypeError('private error');
    return new Response('{"result":{"context":{"slot":123},"value":[]}}');
  },{rpcUrl,onRetry:e=>retries.push(e)});
  const http=createHttp({fetchImpl:wrapped});const r=await http.get('solana-mints',rpcUrl,{privateUrl:true,body});
  assert.equal(r.data.result.context.slot,123);assert.equal(calls,2);
  assert.equal(requests[0][0],requests[1][0]);assert.equal(requests[0][1],requests[1][1]);
  assert.equal(retries.length,1);assert.equal(retries[0].code,'NETWORK_ERROR');
  assert.doesNotMatch(JSON.stringify([retries,http.evidence]),/SECRET|private.test|private error/);
  assert.equal(http.evidence.length,1);assert.equal(http.evidence[0].id,'solana-mints');
});
test('exhausted original signal stops retry; DOMException 23 becomes TIMEOUT',async()=>{
  let calls=0;const controller=new AbortController();
  const wrapped=providerFetch(async()=>{calls++;controller.abort(new DOMException('private','TimeoutError'));throw controller.signal.reason;},{rpcUrl});
  await assert.rejects(wrapped(rpcUrl,{body:JSON.stringify(body),signal:controller.signal}),{code:'TIMEOUT'});
  assert.equal(calls,1);
  const http=createHttp({fetchImpl:providerFetch(async()=>{throw new DOMException('private','TimeoutError');},{rpcUrl})});
  await assert.rejects(http.get('solana-mints',rpcUrl,{body,privateUrl:true}),{code:'TIMEOUT'});
  assert.equal(http.evidence[0].error.code,'TIMEOUT');
});
test('authentication, rate limits, invalid JSON and JSON-RPC errors are never retried',async()=>{
  for(const [status,raw] of [[403,'{}'],[429,'{}'],[200,'invalid'],[200,'{"error":{"code":-32000}}']]){
    let calls=0;const http=createHttp({fetchImpl:providerFetch(async()=>{calls++;return new Response(raw,{status});},{rpcUrl})});
    await http.get('solana-mints',rpcUrl,{privateUrl:true,body}).catch(()=>{});assert.equal(calls,1);
  }
});
test('only configured evidence reads retry 5xx; sending, execution and other endpoints get one call',async()=>{
  for(const [method,url,expected] of [['getMultipleAccounts',rpcUrl,2],['getBlockTime',rpcUrl,2],['sendTransaction',rpcUrl,1],['simulateTransaction',rpcUrl,1],['getMultipleAccounts','https://other.test',1]]){
    let calls=0;const wrapped=providerFetch(async()=>{calls++;return new Response('{}',{status:503});},{rpcUrl});
    const r=await wrapped(url,{body:JSON.stringify({method}),signal:AbortSignal.timeout(12000)});
    assert.equal(r.status,503);assert.equal(calls,expected);
  }
});
