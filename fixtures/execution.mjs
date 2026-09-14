// AUTOMATED TESTS ONLY. These deterministic keys and transactions are never live evidence.
import {Keypair,PublicKey,VersionedTransaction} from '@solana/web3.js';
import {sessionFixture} from './session.mjs';
import {bundleSnapshot,executionPipeline} from '../src/execution/pipeline.mjs';
import {associated,JUPITER,TOKEN,base58} from '../src/execution/transaction.mjs';
import {USDC,TOKEN_2022,resolve} from '../src/registry.mjs';
export const testKey=Keypair.fromSeed(new Uint8Array(32).fill(7)),wallet=testKey.publicKey.toBase58(),asset=resolve('TSLA')[0];
export function fixture(){const s=sessionFixture();s.mode='synthetic';return bundleSnapshot(s);}
export function buildFixture(q=fixture().snapshot.candidates[0].quote.raw){
 const input=associated(wallet,USDC,TOKEN),output=associated(wallet,asset.mint,TOKEN_2022),b=Buffer.alloc(39);Buffer.from([187,100,250,204,49,196,175,20]).copy(b);b.writeBigUInt64LE(BigInt(q.inAmount),8);b.writeBigUInt64LE(BigInt(q.outAmount),16);b.writeUInt16LE(q.slippageBps,24);b.writeUInt32LE(1,30);b[34]=7;b.writeUInt16LE(10000,35);b[38]=1;
 const keys=[wallet,input,output,USDC,asset.mint,TOKEN,TOKEN_2022,JUPITER,'D8cy77BBepLMngZx6ZukaTff5hCt1HrWyKk3Hnd9oitf',JUPITER];
 return {...q,setupInstructions:[],swapInstruction:{programId:JUPITER,data:b.toString('base64'),accounts:keys.map((pubkey,i)=>({pubkey,isSigner:i===0,isWritable:[1,2].includes(i)}))},addressesByLookupTableAddress:{}};
}
function account(mint,program,amount){const b=Buffer.alloc(165);new PublicKey(mint).toBuffer().copy(b);testKey.publicKey.toBuffer().copy(b,32);b.writeBigUInt64LE(BigInt(amount),64);b[108]=1;return {owner:program,data:[b.toString('base64'),'base64']};}
export function harness(options={}){
 const analysis=fixture(),now=analysis.snapshot.asOfMs,build=buildFixture(),calls=[];let signed,elapsed=0;
 const http={evidence:[],get:async()=>({id:'synthetic-build',startedAt:now-100,receivedAt:now, data:build})};
 const rpc={evidence:[],lookup:async()=>{throw Error('unexpected lookup');},call:async(method,params)=>{
  calls.push(method);if(options.rpcFailure===method)throw Error('RPC_FAILURE');
  if(method==='getLatestBlockhash')return {value:{blockhash:'11111111111111111111111111111111',lastValidBlockHeight:100}};
  if(method==='getMultipleAccounts')return {context:{slot:1},value:[account(USDC,TOKEN,options.unfunded?'0':'1000000000'),account(asset.mint,TOKEN_2022,'0')]};
  if(method==='getBalance')return {value:100000000};if(method==='getFeeForMessage')return {value:19000};
  if(method==='simulateTransaction')return {context:{slot:1},value:{err:options.simFail?{InstructionError:[0,'Custom']}:null,logs:['SYNTHETIC TEST'],accounts:[{lamports:options.solDrain?0:99981000},account(USDC,TOKEN,'900000000'),account(asset.mint,TOKEN_2022,options.simBelow?'1':build.otherAmountThreshold)]}};
  if(method==='sendTransaction'){if(options.broadcastFail)throw Error('network');return base58(signed.signatures[0]);}
  if(method==='getTransaction'){if(options.pending)return null;const raw=confirmed(signed,build,options.below);if(options.confirmedFail)raw.meta.err={InstructionError:[0,'Custom']};return raw;}
  throw Error('unexpected '+method);
 }};
 const pipeline=executionPipeline({testOnly:true,allowBroadcast:true,persist:async()=>{},http,rpc,collector:async()=>structuredClone(analysis.snapshot),clock:()=>now+elapsed,sleep:async ms=>{elapsed+=ms;}});
 const signTransaction=async encoded=>{if(options.reject)throw Error('4001');if(options.signSlow)elapsed+=20000;signed=VersionedTransaction.deserialize(Buffer.from(encoded,'base64'));signed.sign([testKey]);return Buffer.from(signed.serialize()).toString('base64');};
 return {analysis,now,build,calls,pipeline,signTransaction};
}
export function confirmed(tx,build,below=false){
 const keys=tx.message.staticAccountKeys.map(k=>k.toBase58()),input=keys.indexOf(associated(wallet,USDC,TOKEN)),output=keys.indexOf(associated(wallet,asset.mint,TOKEN_2022));
 const row=(i,mint,program,amount,decimals)=>({accountIndex:i,mint,owner:wallet,programId:program,uiTokenAmount:{amount:String(amount),decimals}});
 return {slot:10,blockTime:1789228800,transaction:[Buffer.from(tx.serialize()).toString('base64'),'base64'],meta:{err:null,preBalances:keys.map(()=>2039280),preTokenBalances:[row(input,USDC,TOKEN,1000000000,6),row(output,asset.mint,TOKEN_2022,0,8)],postTokenBalances:[row(input,USDC,TOKEN,1000000000n-BigInt(build.inAmount),6),row(output,asset.mint,TOKEN_2022,BigInt(build.otherAmountThreshold)+(below?-1n:1n),8)]}};
}
