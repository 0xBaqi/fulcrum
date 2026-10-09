import test from 'node:test';
import assert from 'node:assert/strict';
import {PublicKey} from '@solana/web3.js';
import {walletPreflight,simulationCategory,failureCategory} from '../src/execution/preflight.mjs';
import {wallet} from '../fixtures/execution.mjs';
import {USDC} from '../src/registry.mjs';
import {TOKEN} from '../src/execution/transaction.mjs';
import {createHash} from 'node:crypto';
function evidenceRpc(result,change=()=>{}){
 const rpc={evidence:[],call:async(method,params)=>{
  const responseText=JSON.stringify({result});
  rpc.evidence.push({id:'balance',status:200,request:{method,params},startedAt:120,receivedAt:120,responseText,responseSha256:createHash('sha256').update(responseText).digest('hex')});
  change(rpc);return result;
 }};return rpc;
}
function account(amount){const b=Buffer.alloc(165);new PublicKey(USDC).toBuffer().copy(b);new PublicKey(wallet).toBuffer().copy(b,32);b.writeBigUInt64LE(BigInt(amount),64);b[108]=1;return {owner:TOKEN,data:[b.toString('base64'),'base64']};}
for(const [name,value,code] of [['zero',account(0),'INSUFFICIENT_USDC'],['insufficient',account(999999),'INSUFFICIENT_USDC'],['exact',account(1000000),null],['sufficient',account(1000001),null],['missing ATA',null,'INSUFFICIENT_USDC'],['unavailable',undefined,'TOKEN_ACCOUNT_UNVERIFIED'],['wrong owner',{...account(1000000),owner:wallet},'TOKEN_ACCOUNT_UNVERIFIED']])test('balance preflight '+name,async()=>{
 const receipt={inputAmount:'1000000'},result={context:{slot:42},value:[value,null]};
 const rpc=evidenceRpc(result);
 const run=()=>walletPreflight({rpc,clock:()=>120,wallet,inspection:{inputAccount:'input',outputAccount:'output'},receipt});
 if(code)await assert.rejects(run(),e=>e.code===code);else await run();
 assert.equal(receipt.walletPreflight.evidenceId,'balance');assert.equal(receipt.walletPreflight.requiredRaw,'1000000');
});
for(const [name,change,code] of [
 ['stale receipt',r=>r.evidence[0].startedAt=-20000,'BALANCE_STALE'],
 ['future receipt',r=>r.evidence[0].receivedAt=121,'BALANCE_STALE'],
 ['missing evidence',r=>r.evidence=[],'BALANCE_UNAVAILABLE'],
 ['RPC unavailable',r=>r.call=async()=>{throw Error('offline');},'BALANCE_UNAVAILABLE'],
 ['old slot',()=>{},'BALANCE_STALE'],
 ['wrong request accounts',r=>r.evidence[0].request.params[0]=['other','other'],'BALANCE_UNAVAILABLE'],
 ['wrong response hash',r=>r.evidence[0].responseSha256='invalid','BALANCE_UNAVAILABLE'],
 ['malformed response',r=>r.evidence[0].responseText='{','BALANCE_UNAVAILABLE'],
 ['cached balance',r=>r.evidence[0].responseHeaders={age:'16'},'BALANCE_STALE'],
])test(name+' fails closed',async()=>{
 const result={context:{slot:42},value:[account(1000000),null]},receipt={inputAmount:'1000000'};
 const rpc=evidenceRpc(result,change);if(name==='RPC unavailable')change(rpc);
 await assert.rejects(walletPreflight({rpc,clock:()=>120,wallet,inspection:{},receipt,minContextSlot:name==='old slot'?43:undefined}),e=>e.code===code);
});
test('simulation classification requires verified program identity for custom errors',()=>{
 const sim=(err,logs=[])=>({value:{err,logs}});
 assert.equal(simulationCategory(sim({InstructionError:[3,{Custom:6025}]})),'UNKNOWN');
 assert.equal(simulationCategory(sim({InstructionError:[3,'InvalidAccountData']})),'ACCOUNT');
 const j='JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
 assert.equal(simulationCategory(sim({InstructionError:[3,{Custom:6001}]},[`Program ${j} failed: custom program error: 0x1771`])),'ROUTING');
 assert.equal(simulationCategory(sim({InstructionError:[3,{Custom:6025}]},[`Program ${j} failed: custom program error: 0x1789`])),'ACCOUNT');
 assert.equal(simulationCategory(sim({InstructionError:[3,{Custom:6001}]},['Program Other failed: custom program error: 0x1771',`Program ${j} failed: custom program error: 0x1771`])),'UNKNOWN');
 assert.equal(simulationCategory(sim(undefined)),'UNKNOWN');
 assert.equal(simulationCategory(sim('AccountNotFound')),'ACCOUNT');
 assert.equal(simulationCategory(sim({InstructionError:[3,'InsufficientFunds']})),'UNKNOWN');
 assert.equal(simulationCategory({value:{err:{InstructionError:[3,{Custom:6025}]},logs:{}}}),'UNKNOWN');
 assert.equal(failureCategory('RPC_simulateTransaction_FAILED'),'RPC');assert.equal(failureCategory('NO_ROUTES_FOUND'),'ROUTING');assert.equal(failureCategory('TOKEN_ACCOUNT_UNVERIFIED'),'ACCOUNT');assert.equal(failureCategory('UNMAPPED'),'UNKNOWN');
});
test('production never reuses evidence from an earlier balance read',async()=>{
 const result={context:{slot:42},value:[account(1000000),null]},rpc=evidenceRpc(result);
 await rpc.call('getMultipleAccounts',[['input','output'],{encoding:'base64',commitment:'confirmed'}]);
 rpc.call=async()=>result;
 await assert.rejects(walletPreflight({rpc,clock:()=>120,wallet,inspection:{inputAccount:'input',outputAccount:'output'},receipt:{inputAmount:'1000000'}}),e=>e.code==='BALANCE_UNAVAILABLE');
});
