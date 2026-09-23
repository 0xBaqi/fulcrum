import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('../web/wallet-standard.js',import.meta.url),'utf8');
test('Jupiter standard wallet signs only the selected mainnet account and never broadcasts',async()=>{
 const account={address:'selected',chains:['solana:mainnet'],features:['solana:signTransaction']};let connects=0,signs=0;
 const wallet={name:'Jupiter',accounts:[account],features:{'standard:connect':{connect:async()=>{connects++;}},'solana:signTransaction':{supportedTransactionVersions:[0],signTransaction:async input=>{assert.equal(input.account,account);assert.equal(input.chain,'solana:mainnet');assert.deepEqual([...input.transaction],[1,2]);signs++;return [{signedTransaction:new Uint8Array([3,4])}];}},'solana:signAndSendTransaction':{signAndSendTransaction:()=>{throw Error('MUST_NOT_BROADCAST');}}}};
 let listener;const window={addEventListener:(name,fn)=>{listener=fn;},dispatchEvent:event=>event.detail.register(wallet)};
 class CustomEvent{constructor(type,{detail}){this.type=type;this.detail=detail;}}
 vm.runInNewContext(source,{window,CustomEvent,solanaWeb3:{VersionedTransaction:{deserialize:bytes=>bytes}}});
 const adapter=await window.fulcrumStandardWallet('Jupiter');assert.equal(connects,1);assert.equal(adapter.publicKey.toBase58(),'selected');
 assert.deepEqual([...await adapter.signTransaction({serialize:()=>new Uint8Array([1,2])})],[3,4]);assert.equal(signs,1);
 wallet.accounts=[];assert.throws(()=>adapter.publicKey.toBase58(),/changed/);await assert.rejects(adapter.signTransaction({}),/changed/);
 assert.equal(typeof listener,'function');
});
