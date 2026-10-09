import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createServer} from '../src/app/server.mjs';
import {appService} from '../src/app/service.mjs';
import {readFileSync} from 'node:fs';
import {walletSession} from '../src/app/wallet-session.mjs';
import {sessionFixture,setPyth} from '../fixtures/session.mjs';
import {wallet} from '../fixtures/execution.mjs';
// Use explicit, fully consumed loopback connections for boundary tests.
let step=0;function fetch(url,options={}){const label=++step;console.log("HTTP_STEP",label,options.method??"GET",url);return new Promise((resolve,reject)=>{
 const req=http.request(url,{method:options.method??'GET',headers:options.headers,agent:false},res=>{
  console.log("HTTP_STATUS",label,res.statusCode);const chunks=[];res.on('data',c=>chunks.push(c));res.on('error',reject);res.on('end',()=>{const body=Buffer.concat(chunks).toString('utf8');resolve({status:res.statusCode,headers:{get:k=>res.headers[k.toLowerCase()]},json:async()=>JSON.parse(body),text:async()=>body});});
 });req.on('error',e=>reject(new Error('HTTP boundary '+url+': '+e.message,{cause:e})));req.setTimeout(20000,()=>req.destroy(Error('TEST_CLIENT_TIMEOUT')));req.end(options.body);
});}
const bundle=JSON.parse(readFileSync('evidence/execution/m2a-wallet-attempt4-2026-09-13.json.analysis.json'));
test('wallet HTTP returns fresh mandatory denial reasons without raw private evidence',async t=>{
 const s=sessionFixture(Date.parse('2026-10-09T16:00:00Z'));setPyth(s,'TSLA',{publishedAt:s.asOfMs+10000});
 s.evidence.push({id:'private-sentinel',responseText:'SECRET_SENTINEL'});
 t.mock.method(console,'info',()=>{});
 const session=walletSession({collector:async()=>s,clock:()=>s.asOfMs,executor:()=>assert.fail('must not execute')});
 const server=createServer({service:{catalog:async()=>[]},wallet:session});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port;
 const boot=await (await fetch(base+'/api/bootstrap')).json();
 const response=await fetch(base+'/api/wallet/prepare',{method:'POST',headers:{Origin:base,'Content-Type':'application/json','X-Stocklana-Token':boot.csrfToken},body:JSON.stringify({wallet})});
 assert.equal(response.status,400);const data=await response.json();
 assert.equal(data.error.code,'NO_STRICT_WINNER');assert.ok(data.error.reasonCodes.includes('REFERENCE_TSLA_FUTURE'));
 assert.doesNotMatch(JSON.stringify(data),/SECRET_SENTINEL|responseText|private-sentinel/);assert.equal(session.view().receipt,null);
});
test('HTTP boundary supports replay and rejects cross-origin, mint injection and broadcast',async t=>{
 const service=appService({persist:async()=>{},load:async()=>structuredClone(bundle)}),server=createServer({service});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));const url='http://127.0.0.1:'+server.address().port;
 const boot=await (await fetch(url+'/api/bootstrap')).json(),headers={'Content-Type':'application/json','X-Stocklana-Token':boot.csrfToken,Origin:url};
 let response=await fetch(url+'/api/analyses',{method:'POST',headers,body:JSON.stringify({underlying:'TSLA',amount:'1',mode:'REPLAY',captureId:'tesla-1-wallet'})});assert.equal(response.status,202);const j=await response.json();await service.settled(j.id);const result=await (await fetch(url+'/api/jobs/'+j.id)).json();assert.equal(result.state,'STRICT_WINNER');assert.equal(result.decision.mode,'REPLAY');
 response=await fetch(url+'/api/analyses',{method:'POST',headers:{...headers,Origin:'https://malicious.example'},body:'{}'});assert.equal(response.status,403);await response.json();
 response=await fetch(url+'/api/analyses',{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(response.status,403);
 response=await fetch(url+'/api/analyses',{method:'POST',headers,body:JSON.stringify({underlying:'TSLA',amount:'1',mode:'LIVE',mint:'untrusted'})});assert.equal((await response.json()).error.code,'INVALID_INTENT');
 response=await fetch(url+'/api/broadcast',{method:'POST',headers,body:'{}'});assert.equal(response.status,404);await response.json();
 response=await fetch(url+'/.env');assert.equal(response.status,404);
 response=await fetch(url+'/');assert.equal(response.status,200);assert.ok(response.headers.get('content-security-policy').includes("frame-ancestors 'none'"));assert.ok((await response.text()).includes('Acquire Tesla'));
});
