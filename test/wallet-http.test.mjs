import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {once} from 'node:events';
import {createWalletServer} from '../src/app/wallet-server.mjs';
function request(url,{method='GET',headers={},body}={}){return new Promise((resolve,reject)=>{const req=http.request(url,{method,headers,agent:false},res=>{const chunks=[];res.on('data',c=>chunks.push(c));res.on('end',()=>resolve({status:res.statusCode,body:Buffer.concat(chunks).toString()}));});req.on('error',reject);req.end(body);});}
test('wallet HTTP rejects cross-origin, missing authorization token, oversized input and private paths',async t=>{
 let submits=0;const server=createWalletServer({session:{view:()=>({attempted:false}),submit:async()=>{submits++;return {ok:true};}}});server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
 const base='http://127.0.0.1:'+server.address().port,boot=JSON.parse((await request(base+'/api/session')).body);
 const headers={Origin:base,'Content-Type':'application/json','X-Fulcrum-Token':boot.csrfToken};
 assert.equal((await request(base+'/api/submit',{method:'POST',headers:{...headers,Origin:'https://other.invalid'},body:'{}'})).status,403);
 assert.equal((await request(base+'/api/submit',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:'{}'})).status,403);
 assert.equal((await request(base+'/api/submit',{method:'POST',headers,body:'x'.repeat(4097)})).status,413);
 assert.equal((await request(base+'/.env')).status,404);assert.equal(submits,0);
 assert.equal((await request(base+'/api/submit',{method:'POST',headers,body:'{}'})).status,200);assert.equal(submits,1);
 assert.match((await request(base+'/')).body,/Approve in wallet and broadcast/);
});
