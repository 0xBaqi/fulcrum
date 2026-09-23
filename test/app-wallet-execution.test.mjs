import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey,VersionedTransaction} from '@solana/web3.js';
import {fixture,buildFixture,wallet,asset,testKey,confirmed} from '../fixtures/execution.mjs';
import {USDC,TOKEN_2022} from '../src/registry.mjs';
import {TOKEN,base58} from '../src/execution/transaction.mjs';
import {executionPipelineWithPythPro} from '../src/app/execution-pipeline.mjs';
import {replayReceipt,sealReceipt} from '../src/app/execution-receipt.mjs';
import {walletSession} from '../src/app/wallet-session.mjs';
import {sessionFixture} from '../fixtures/session.mjs';

function harness(options={}){
 const analysis=fixture(),build=buildFixture(),urls=[],calls=[];let attempt=0,signed,elapsed=0,validityChecks=0,blocks=0;
 const now=analysis.snapshot.asOfMs;
 function account(mint,program,amount){const b=Buffer.alloc(165);new PublicKey(mint).toBuffer().copy(b);testKey.publicKey.toBuffer().copy(b,32);b.writeBigUInt64LE(BigInt(amount),64);b[108]=1;return {owner:program,data:[b.toString('base64'),'base64']};}
 const http={evidence:[],get:async(id,url)=>{urls.push(url);attempt++;const b=structuredClone(build);b.routePlan.forEach(x=>x.swapInfo.label=attempt===1?'Venue A':'Venue B');if(options.ignoredExclusion&&attempt>1)b.routePlan[0].swapInfo.label='Venue A';if(options.intermediate)b.routePlan[0].swapInfo.outputMint=wallet;if(options.badDestination)b.swapInstruction.accounts[2].pubkey=wallet;
  if(id==='jupiter-prebroadcast-build'&&options.priceChangeBps){b.outAmount=String(BigInt(b.outAmount)*BigInt(10000-options.priceChangeBps)/10000n);b.otherAmountThreshold=String(BigInt(b.outAmount)*9950n/10000n);}
  return {id,startedAt:now+elapsed-(options.staleQuote&&id==='jupiter-prebroadcast-build'?16000:100),receivedAt:now+elapsed,data:b};}};
 const rpc={evidence:[],lookup:async()=>{throw Error('UNEXPECTED_LOOKUP');},call:async(method,params)=>{calls.push(method);
  if(method==='getLatestBlockhash')return {value:{blockhash:++blocks===1?'11111111111111111111111111111111':wallet,lastValidBlockHeight:100}};
  if(method==='getBlockHeight'){validityChecks++;return options.expiredBlockhash||options.expireAtSend&&validityChecks>=3?101:90;}
  if(method==='isBlockhashValid')return {context:{slot:1},value:!options.invalidBlockhash};
  if(method==='getMultipleAccounts')return {context:{slot:1},value:[account(USDC,TOKEN,options.unfunded?'0':'1000000000'),account(asset.mint,TOKEN_2022,0)]};
  if(method==='getBalance')return {value:100000000};if(method==='getFeeForMessage')return {value:19000};
  if(method==='simulateTransaction')return {context:{slot:1},value:{err:options.failAll||options.failFirst&&attempt===1?{InstructionError:[3,{Custom:6021}]}:null,accounts:[{lamports:99981000},account(USDC,TOKEN,1000000000n-BigInt(build.inAmount)),account(asset.mint,TOKEN_2022,options.below?'1':build.otherAmountThreshold)]}};
  if(method==='sendTransaction')return base58(signed.signatures[0]);
  if(method==='getTransaction')return confirmed(signed,build);
  throw Error('UNEXPECTED_RPC');
 }};
 const pipeline=executionPipelineWithPythPro({testOnly:true,allowBroadcast:true,http,rpc,persist:async b=>{if(options.slowPersist&&b.receipt.status==='REVALIDATED')elapsed+=16000;},collector:async()=>{if(options.staleComparison)return structuredClone(analysis.snapshot);const s=sessionFixture(now+elapsed);s.mode='synthetic';return s;},clock:()=>now+elapsed});
 const signTransaction=async encoded=>{elapsed+=options.signDelay??0;signed=VersionedTransaction.deserialize(Buffer.from(encoded,'base64'));signed.sign([testKey]);return Buffer.from(signed.serialize()).toString('base64');};
 return {analysis,pipeline,urls,calls,signTransaction,advance:ms=>{elapsed+=ms;}};
}
test('app pipeline requests direct routes and confirms verified receipt through wallet signature',async()=>{
 const h=harness(),r=await h.pipeline.prepare(h.analysis,wallet);assert.equal(r.status,'READY_FOR_SIGNATURE',r.reasonCodes.join());
 assert.equal(new URL(h.urls[0]).searchParams.get('onlyDirectRoutes'),'true');
 await h.pipeline.submit(r,{authorizeBroadcast:true,signTransaction:h.signTransaction});assert.equal(r.status,'SUCCEEDED');assert.equal(replayReceipt(sealReceipt(r)).actualReceivedAmount,r.actualReceivedAmount);
});
test('simulation failure gets exactly one fresh excluded-venue attempt with both receipts',async()=>{
 const h=harness({failFirst:true}),r=await h.pipeline.prepare(h.analysis,wallet);assert.equal(r.status,'READY_FOR_SIGNATURE',r.reasonCodes.join());assert.equal(h.urls.length,2);assert.equal(new URL(h.urls[1]).searchParams.get('excludeDexes'),'Venue A');assert.equal(replayReceipt(r.previousAttempts[0]).status,'BLOCKED');assert.ok(!h.calls.includes('sendTransaction'));
});
for(const [name,options,attempts,reason] of [
 ['all routes fail',{failAll:true},2,'TRANSACTION_SIMULATION_FAILED'],
 ['ignored exclusion',{failFirst:true,ignoredExclusion:true},2,'UNSUPPORTED_EXECUTION_ROUTE'],
 ['unsupported intermediate',{intermediate:true},1,'UNSUPPORTED_EXECUTION_ROUTE'],
 ['wrong destination',{badDestination:true},1,'TRANSACTION_ACCOUNT_MISMATCH'],
 ['unfunded route failure',{unfunded:true,failFirst:true},1,'INSUFFICIENT_USDC'],
 ['insufficient output',{below:true},1,'SIMULATED_RECEIVED_AMOUNT_BELOW_MINIMUM']
])test('app routing fails closed: '+name,async()=>{const h=harness(options),r=await h.pipeline.prepare(h.analysis,wallet);assert.equal(r.status,'BLOCKED');assert.ok(r.reasonCodes.includes(reason),r.reasonCodes.join());assert.equal(h.urls.length,attempts);assert.ok(!h.calls.includes('sendTransaction'));});
test('normal 45-second wallet delay succeeds with fresh revalidation and unchanged signed message',async()=>{const h=harness({signDelay:45000}),r=await h.pipeline.prepare(h.analysis,wallet),message=r.transaction.messageSha256;await h.pipeline.submit(r,{authorizeBroadcast:true,signTransaction:h.signTransaction});assert.equal(r.status,'SUCCEEDED',r.reasonCodes.join());assert.equal(r.transaction.messageSha256,message);assert.ok(r.preBroadcast.at-r.finalQuote.startedAt>15000);assert.equal(replayReceipt(sealReceipt(r)).status,'SUCCEEDED');});
for(const [name,options,reason] of [
 ['stale quote',{signDelay:45000,staleQuote:true},'QUOTE_EXPIRED'],
 ['stale comparison',{signDelay:45000,staleComparison:true},'QUOTE_EXPIRED'],
 ['approval window exceeded',{signDelay:121000},'AUTHORIZATION_EXPIRED_REBUILD_REQUIRED'],
 ['expired block height',{expiredBlockhash:true},'BLOCKHASH_EXPIRED_REBUILD_REQUIRED'],
 ['invalid blockhash',{invalidBlockhash:true},'BLOCKHASH_EXPIRED_REBUILD_REQUIRED'],
 ['expiry at send boundary',{expireAtSend:true},'BLOCKHASH_EXPIRED_REBUILD_REQUIRED'],
 ['material deterioration',{priceChangeBps:200},'EXECUTION_MATERIALLY_CHANGED'],
 ['old signed floor worse than current market',{priceChangeBps:-200},'SIGNED_MINIMUM_MATERIALLY_WORSE_REBUILD_REQUIRED'],
 ['freshness expires during persistence',{slowPersist:true},'QUOTE_EXPIRED']
])test('authorization blocks '+name,async()=>{const h=harness(options),r=await h.pipeline.prepare(h.analysis,wallet);await h.pipeline.submit(r,{authorizeBroadcast:true,signTransaction:h.signTransaction});assert.ok(r.reasonCodes.includes(reason),r.reasonCodes.join());assert.ok(!h.calls.includes('sendTransaction'));});
test('completed transaction cannot be broadcast again or have its receipt overwritten',async()=>{const h=harness(),r=await h.pipeline.prepare(h.analysis,wallet);await h.pipeline.submit(r,{authorizeBroadcast:true,signTransaction:h.signTransaction});const before=sealReceipt(structuredClone(r));await assert.rejects(h.pipeline.submit(r,{authorizeBroadcast:true,signTransaction:h.signTransaction}),/EXECUTION_ALREADY_USED_OR_BLOCKED/);assert.equal(h.calls.filter(x=>x==='sendTransaction').length,1);assert.deepEqual(sealReceipt(r),before);});
test('expired authorization requires new preparation and rejects an old signature',async()=>{const h=harness(),r=await h.pipeline.prepare(h.analysis,wallet),oldSigned=await h.signTransaction(r.transaction.unsignedBase64);h.advance(121000);await h.pipeline.submit(r,{authorizeBroadcast:true,signTransaction:async()=>oldSigned});assert.ok(r.reasonCodes.includes('AUTHORIZATION_EXPIRED_REBUILD_REQUIRED'));const fresh=await h.pipeline.prepare(h.analysis,wallet);assert.equal(fresh.status,'READY_FOR_SIGNATURE',fresh.reasonCodes.join());assert.notEqual(fresh.transaction.messageSha256,r.transaction.messageSha256);await h.pipeline.submit(fresh,{authorizeBroadcast:true,signTransaction:async()=>oldSigned});assert.ok(fresh.reasonCodes.includes('SIGNED_TRANSACTION_CHANGED'));assert.ok(!h.calls.includes('sendTransaction'));});
test('app broadcast authorization remains mandatory',async()=>{const h=harness(),r=await h.pipeline.prepare(h.analysis,wallet);await h.pipeline.submit(r,{signTransaction:h.signTransaction});assert.ok(r.reasonCodes.includes('BROADCAST_NOT_AUTHORIZED'));assert.ok(!h.calls.includes('sendTransaction'));});
test('wallet session binds review, requires explicit authorization and prevents a second submission',async()=>{
 const analysis=fixture();let submissions=0,requested;
 const session=walletSession({clock:()=>analysis.snapshot.asOfMs,collector:async options=>{requested=options;return structuredClone(analysis.snapshot);},executor:()=>({prepare:async()=>({status:'READY_FOR_SIGNATURE',inputAmount:'1000000',transaction:{messageSha256:'review'}}),submit:async r=>{submissions++;r.status='SUCCEEDED';r.signature='synthetic-signature';}})});
 await session.prepare(wallet);assert.equal(requested.amountRaw,'1000000');
 await assert.rejects(session.submit({signedTransaction:'AAAA',messageSha256:'review'}),/BROADCAST_NOT_AUTHORIZED/);
 await assert.rejects(session.submit({signedTransaction:'AAAA',messageSha256:'other',authorizeBroadcast:true}),/TRANSACTION_REVIEW_CHANGED/);
 await session.submit({signedTransaction:'AAAA',messageSha256:'review',authorizeBroadcast:true});
 await assert.rejects(session.submit({signedTransaction:'AAAA',messageSha256:'review',authorizeBroadcast:true}),/SESSION_NOT_READY/);
 await assert.rejects(session.prepare(wallet),/SESSION_ALREADY_ACTIVE_OR_SUBMITTED/);assert.equal(submissions,1);
});
