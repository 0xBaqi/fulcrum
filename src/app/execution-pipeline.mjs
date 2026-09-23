import {VersionedTransaction} from '@solana/web3.js';
import {createHttp} from '../providers.mjs';
import {hash} from '../engine.mjs';
import {USDC,TOKEN_2022} from '../registry.mjs';

import {
  strictAsset,
  materialGuard
} from './execution-guard.mjs';

import {
  EXECUTION_POLICY as P,
  ensure
} from '../execution/policy.mjs';

import {
  newReceipt,
  transition,
  sealReceipt
} from './execution-receipt.mjs';

import {
  inspectBuild,
  construct,
  associated,
  TOKEN,
  signedTransaction,
  base58,
  verifyConfirmed
} from '../execution/transaction.mjs';

import {rpcClient,tokenBalance} from '../execution/rpc.mjs';
import {fileReceiptStore} from '../execution/store.mjs';

import {
  collectWithPythPro,
  bundleSnapshotWithPythPro
} from './live.mjs';

import {settledCollector} from './collection.mjs';
import {AUTHORIZATION_POLICY,approvalWindow,revalidationGuard} from './authorization.mjs';

export function executionPipelineWithPythPro({
  env=process.env,
  clock=Date.now,
  http=createHttp({clock}),
  rpc=rpcClient({env}),
  collector=null,
  persist=fileReceiptStore(),
  testOnly=false,
  allowBroadcast=false,
  sleep=ms=>new Promise(r=>setTimeout(r,ms))
}={}){

const liveCollector = collector ?? settledCollector(
  options => collectWithPythPro({
    ...options,
    env,
    clock
  }),
  {
    clock,
    sleep
  }
);

 const prepared=new WeakMap();
 const save=async r=>{r.evidence=[...http.evidence,...rpc.evidence];await persist(sealReceipt(r));};
 async function prepareOnce(analysis,wallet,excludedDexes=[]){
  let r=newReceipt(analysis,wallet,clock());
  try{
   ensure(testOnly||analysis.snapshot.mode==='live','SYNTHETIC_ANALYSIS_FORBIDDEN');ensure(wallet,'WALLET_PUBLIC_KEY_REQUIRED');
   const {asset}=strictAsset(analysis),amount=analysis.snapshot.order.amountRaw;
r.comparison=bundleSnapshotWithPythPro(
  await liveCollector({
    amountRaw: amount,
    underlying: 'TSLA',
    env,
    clock
  })
);
   ensure(testOnly||r.comparison.snapshot.mode==='live','SYNTHETIC_ANALYSIS_FORBIDDEN');
   ensure(strictAsset(r.comparison).asset.mint===asset.mint,'WINNING_REPRESENTATION_CHANGED');
   // The inspector supports only the input/output ATAs; do not request
   // intermediate-token accounts that it intentionally refuses to authorize.
   r.routing={onlyDirectRoutes:true,excludedDexes:[...excludedDexes]};
   const params=new URLSearchParams({inputMint:USDC,outputMint:asset.mint,amount,taker:wallet,slippageBps:String(P.maxSlippageBps),platformFeeBps:'0',wrapAndUnwrapSol:'false',destinationTokenAccount:associated(wallet,asset.mint,TOKEN_2022),onlyDirectRoutes:'true'});
   if(excludedDexes.length)params.set('excludeDexes',excludedDexes.join(','));
   const e=await http.get('jupiter-build','https://api.jup.ag/swap/v2/build?'+params,{headers:env.JUPITER_API_KEY?{'x-api-key':env.JUPITER_API_KEY}:{}});
   r.finalQuote={startedAt:e.startedAt,receivedAt:e.receivedAt,raw:e.data,evidenceId:e.id};
   ensure(e.data.routePlan?.every(x=>x.swapInfo?.inputMint===USDC&&x.swapInfo?.outputMint===asset.mint&&!excludedDexes.includes(x.swapInfo?.label)),'UNSUPPORTED_EXECUTION_ROUTE');
   const guardedAt=clock();r.materialChange=materialGuard(analysis,r.comparison,r.finalQuote,guardedAt);transition(r,'REQUOTED',['FINAL_REQUOTE_PASSED'],guardedAt);
   const inspection=inspectBuild(e.data,wallet,asset,amount),tables=await Promise.all(Object.keys(e.data.addressesByLookupTableAddress??{}).map(a=>rpc.lookup(a)));
   const block=(await rpc.call('getLatestBlockhash',[{commitment:'confirmed'}])).value;
   ensure(typeof block?.blockhash==='string'&&Number.isSafeInteger(block.lastValidBlockHeight)&&block.lastValidBlockHeight>0,'BLOCKHASH_VALIDITY_UNVERIFIED');
   const tx=construct(e.data,wallet,block.blockhash,tables);
   r.transaction={unsignedBase64:Buffer.from(tx.serialize()).toString('base64'),messageSha256:hash(Array.from(tx.message.serialize())),inspection,blockhash:block};transition(r,'CONSTRUCTED',['TRANSACTION_INSPECTED'],clock());await save(r);
   const accounts=await rpc.call('getMultipleAccounts',[[inspection.inputAccount,inspection.outputAccount],{encoding:'base64',commitment:'confirmed'}]);
   const input=tokenBalance(accounts.value[0],wallet,USDC,TOKEN),output=tokenBalance(accounts.value[1],wallet,asset.mint,TOKEN_2022);
   const sol=await rpc.call('getBalance',[wallet,{commitment:'confirmed'}]);
   r.preBalances={input,output,solLamports:sol.value,slot:accounts.context.slot};
   const fee=await rpc.call('getFeeForMessage',[Buffer.from(tx.message.serialize()).toString('base64'),{commitment:'confirmed'}]);ensure(Number.isSafeInteger(fee.value)&&fee.value<=P.maxNetworkFeeLamports,'NETWORK_FEE_UNVERIFIED');r.networkFeeLamports=fee.value;
   r.simulation=await rpc.call('simulateTransaction',[r.transaction.unsignedBase64,{encoding:'base64',sigVerify:false,replaceRecentBlockhash:false,commitment:'confirmed',accounts:{encoding:'base64',addresses:[wallet,inspection.inputAccount,inspection.outputAccount]}}]);transition(r,'SIMULATED',['TRANSACTION_SIMULATION_ATTEMPTED'],clock());
   const reasons=[];if(BigInt(input)<BigInt(amount))reasons.push('INSUFFICIENT_USDC');if(sol.value<fee.value)reasons.push('INSUFFICIENT_SOL');if(r.simulation.value?.err!==null)reasons.push('TRANSACTION_SIMULATION_FAILED');
   if(reasons.length)transition(r,'BLOCKED',reasons,clock());else{
    const simulated=r.simulation.value.accounts;ensure(simulated?.length===3&&simulated[0]&&simulated[1]&&simulated[2],'SIMULATED_BALANCES_UNVERIFIABLE');
    const afterInput=tokenBalance(simulated[1],wallet,USDC,TOKEN),afterOutput=tokenBalance(simulated[2],wallet,asset.mint,TOKEN_2022);
    ensure(BigInt(input)-BigInt(afterInput)===BigInt(amount),'SIMULATED_INPUT_AMOUNT_MISMATCH');
    ensure(BigInt(afterOutput)-BigInt(output)>=BigInt(r.materialChange.finalMinimumOutput),'SIMULATED_RECEIVED_AMOUNT_BELOW_MINIMUM');
    ensure(Number.isSafeInteger(simulated[0].lamports)&&sol.value-simulated[0].lamports<=fee.value+P.maxAccountRentLamports,'SIMULATED_SOL_COST_LIMIT_EXCEEDED');
    r.simulatedBalances={input:afterInput,output:afterOutput,solLamports:simulated[0].lamports};
    materialGuard(analysis,r.comparison,r.finalQuote,clock());
    r.authorization={policy:{...AUTHORIZATION_POLICY},expiresAt:r.finalQuote.startedAt+AUTHORIZATION_POLICY.maxApprovalAgeMs};
    transition(r,'READY_FOR_SIGNATURE',['TRANSACTION_SIMULATION_PASSED','SIMULATED_BALANCES_VERIFIED'],clock());
   }
  }catch(e){transition(r,'BLOCKED',[e.code??e.message],clock());}
  await save(r);return r;
 }
 async function prepare(analysis,wallet){
  let r=await prepareOnce(analysis,wallet);
  // One fresh attempt after an actual route simulation failure, never after
  // an economic, identity, funding or instruction-inspection failure.
  const labels=[...new Set(r.finalQuote?.raw?.routePlan?.map(x=>x.swapInfo?.label)??[])];
  if(r.status==='BLOCKED'&&r.reasonCodes.includes('TRANSACTION_SIMULATION_FAILED')&&
     !r.reasonCodes.some(c=>c==='INSUFFICIENT_USDC'||c==='INSUFFICIENT_SOL')&&
     labels.length&&labels.every(x=>typeof x==='string'&&/^[A-Za-z0-9 _+.-]{1,64}$/.test(x))){
   const previous=sealReceipt(r);
   r=await prepareOnce(analysis,wallet,labels);
   r.previousAttempts=[previous];
   await save(r);
  }
  if(r.status==='READY_FOR_SIGNATURE')prepared.set(r,hash(r));return r;
 }
 const used=new WeakSet();
 async function checkValidity(r){
  const block=r.transaction.blockhash;
  const [height,valid]=await Promise.all([
   rpc.call('getBlockHeight',[{commitment:'confirmed'}]),
   rpc.call('isBlockhashValid',[block.blockhash,{commitment:'confirmed'}])
  ]);
  ensure(Number.isSafeInteger(height)&&height>=0&&typeof valid?.value==='boolean','BLOCKHASH_VALIDITY_UNVERIFIED');
  ensure(height<=block.lastValidBlockHeight&&valid.value,'BLOCKHASH_EXPIRED_REBUILD_REQUIRED');
  return {checkedAt:clock(),blockHeight:height,lastValidBlockHeight:block.lastValidBlockHeight,blockhash:block.blockhash,valid:true};
 }
 async function submit(r,{signTransaction,authorizeBroadcast=false}={}){
  // A second call must not mutate a pending/successful first attempt's receipt.
  ensure(!used.has(r),'EXECUTION_ALREADY_USED_OR_BLOCKED');
  let broadcastStarted=false;
  try{
   ensure(allowBroadcast&&authorizeBroadcast,'BROADCAST_NOT_AUTHORIZED');ensure(r.status==='READY_FOR_SIGNATURE'&&!used.has(r)&&prepared.get(r)===hash(r),'EXECUTION_ALREADY_USED_OR_BLOCKED');used.add(r);
   const {asset}=strictAsset(r.analysis),amount=r.inputAmount,tx=VersionedTransaction.deserialize(Buffer.from(r.transaction.unsignedBase64,'base64'));
   approvalWindow(r,clock());await checkValidity(r);
   let encoded;try{encoded=await signTransaction(r.transaction.unsignedBase64);}catch{ensure(false,'USER_SIGNATURE_REJECTED');}
   const signed=signedTransaction(encoded,tx,r.walletPublicKey);approvalWindow(r,clock());
   const comparison=bundleSnapshotWithPythPro(await liveCollector({amountRaw:amount,underlying:'TSLA',env,clock}));
   ensure(testOnly||comparison.snapshot.mode==='live','SYNTHETIC_ANALYSIS_FORBIDDEN');
   const params=new URLSearchParams({inputMint:USDC,outputMint:asset.mint,amount,taker:r.walletPublicKey,slippageBps:String(P.maxSlippageBps),platformFeeBps:'0',wrapAndUnwrapSol:'false',destinationTokenAccount:r.transaction.inspection.outputAccount,onlyDirectRoutes:'true'});
   if(r.routing.excludedDexes.length)params.set('excludeDexes',r.routing.excludedDexes.join(','));
   const e=await http.get('jupiter-prebroadcast-build','https://api.jup.ag/swap/v2/build?'+params,{headers:env.JUPITER_API_KEY?{'x-api-key':env.JUPITER_API_KEY}:{}});
   const quote={startedAt:e.startedAt,receivedAt:e.receivedAt,raw:e.data,evidenceId:e.id};
   revalidationGuard(r,comparison,quote,clock());
   const inspection=r.transaction.inspection;
   const before=await rpc.call('getMultipleAccounts',[[inspection.inputAccount,inspection.outputAccount],{encoding:'base64',commitment:'confirmed'}]);
   const input=tokenBalance(before.value[0],r.walletPublicKey,USDC,TOKEN),output=tokenBalance(before.value[1],r.walletPublicKey,asset.mint,TOKEN_2022);
   const sol=(await rpc.call('getBalance',[r.walletPublicKey,{commitment:'confirmed'}])).value;
   const fee=(await rpc.call('getFeeForMessage',[Buffer.from(tx.message.serialize()).toString('base64'),{commitment:'confirmed'}])).value;
   ensure(Number.isSafeInteger(fee)&&fee<=P.maxNetworkFeeLamports,'NETWORK_FEE_UNVERIFIED');
   ensure(BigInt(input)>=BigInt(amount),'INSUFFICIENT_USDC');ensure(sol>=fee,'INSUFFICIENT_SOL');
   r.signedSimulationStartedAt=clock();
   const sim=await rpc.call('simulateTransaction',[encoded,{encoding:'base64',sigVerify:true,replaceRecentBlockhash:false,commitment:'confirmed',accounts:{encoding:'base64',addresses:[r.walletPublicKey,inspection.inputAccount,inspection.outputAccount]}}]);r.signedSimulation=sim;ensure(sim.value?.err===null,'TRANSACTION_SIMULATION_FAILED');
   const accounts=sim.value.accounts;ensure(accounts?.length===3&&accounts.every(Boolean),'SIMULATED_BALANCES_UNVERIFIABLE');
   const afterInput=tokenBalance(accounts[1],r.walletPublicKey,USDC,TOKEN),afterOutput=tokenBalance(accounts[2],r.walletPublicKey,asset.mint,TOKEN_2022);
   ensure(BigInt(input)-BigInt(afterInput)===BigInt(amount),'SIMULATED_INPUT_AMOUNT_MISMATCH');
   ensure(BigInt(afterOutput)-BigInt(output)>=BigInt(r.materialChange.finalMinimumOutput),'SIMULATED_RECEIVED_AMOUNT_BELOW_MINIMUM');
   ensure(Number.isSafeInteger(accounts[0].lamports)&&sol-accounts[0].lamports<=fee+P.maxAccountRentLamports,'SIMULATED_SOL_COST_LIMIT_EXCEEDED');
   const validity=await checkValidity(r),at=clock(),guard=revalidationGuard(r,comparison,quote,at);
   r.preBroadcast={comparison,quote,at,guard,validity,preBalances:{input,output,solLamports:sol},simulatedBalances:{input:afterInput,output:afterOutput,solLamports:accounts[0].lamports},networkFeeLamports:fee};
   r.signature=base58(signed.signatures[0]);
   transition(r,'REVALIDATED',['FRESH_MARKET_REVALIDATION_PASSED','SIGNED_SIMULATED_BALANCES_VERIFIED','BLOCKHASH_VALID'],at);await save(r);
   // Persistence and RPC can take time: recheck freshness and chain validity
   // at the send boundary, always preserving the exact wallet-signed bytes.
   r.preBroadcast.sendValidity=await checkValidity(r);
   const sendAt=clock();revalidationGuard(r,comparison,quote,sendAt);
   ensure(sendAt-r.signedSimulationStartedAt<=P.maxFinalQuoteAgeMs,'SIGNED_SIMULATION_EXPIRED');
   r.preBroadcast.sendCheckedAt=sendAt;r.signature=base58(signed.signatures[0]);transition(r,'AUTHORIZED',['USER_SIGNATURE_VERIFIED'],sendAt);
   broadcastStarted=true;
   try{const signature=await rpc.call('sendTransaction',[encoded,{encoding:'base64',skipPreflight:false,preflightCommitment:'confirmed',maxRetries:0}]);ensure(signature===r.signature,'TRANSACTION_SIGNATURE_MISMATCH');}catch{transition(r,'BROADCAST_UNKNOWN',['TRANSACTION_BROADCAST_FAILED'],clock());await save(r);return r;}
   transition(r,'BROADCAST',['TRANSACTION_BROADCAST'],clock());await save(r);
   const deadline=clock()+P.confirmationTimeoutMs;
   while(clock()<deadline){const raw=await rpc.call('getTransaction',[r.signature,{encoding:'base64',commitment:'confirmed',maxSupportedTransactionVersion:0}]);if(raw){
     r.confirmation={raw,verified:raw.meta?.err===null};if(raw.meta?.err!==null){transition(r,'CONFIRMED_FAILED',['TRANSACTION_CONFIRMED_FAILED'],clock());await save(r);return r;}r.balances=verifyConfirmed(raw,tx,r.transaction.inspection,r.walletPublicKey,asset,amount,r.materialChange.finalMinimumOutput,r.signature);r.actualReceivedAmount=r.balances.actualReceivedAmount;
     transition(r,r.balances.verified?'SUCCEEDED':'CONFIRMED_BELOW_MINIMUM',['TRANSACTION_CONFIRMED',r.balances.verified?'RECEIVED_AMOUNT_VERIFIED':'RECEIVED_AMOUNT_BELOW_MINIMUM'],clock());await save(r);return r;
    }await sleep(P.confirmationPollMs);}
   transition(r,'CONFIRMATION_PENDING',['TRANSACTION_CONFIRMATION_TIMEOUT'],clock());
  }catch(e){if(!broadcastStarted)r.signature=null;transition(r,r.signature?'VERIFICATION_BLOCKED':'BLOCKED',[e.code??e.message],clock());}
  await save(r);return r;
 }
 async function reconcile(r){
  try{
   ensure(r.signature&&r.transaction,'NO_TRANSACTION_TO_RECONCILE');
   const raw=await rpc.call('getTransaction',[r.signature,{encoding:'base64',commitment:'confirmed',maxSupportedTransactionVersion:0}]);
   if(!raw){transition(r,'CONFIRMATION_PENDING',['TRANSACTION_CONFIRMATION_PENDING'],clock());await save(r);return r;}
   r.confirmation={raw,verified:raw.meta?.err===null};
   if(raw.meta?.err!==null){transition(r,'CONFIRMED_FAILED',['TRANSACTION_CONFIRMED_FAILED'],clock());await save(r);return r;}
   const tx=VersionedTransaction.deserialize(Buffer.from(r.transaction.unsignedBase64,'base64'));
   r.balances=verifyConfirmed(raw,tx,r.transaction.inspection,r.walletPublicKey,strictAsset(r.analysis).asset,r.inputAmount,r.materialChange.finalMinimumOutput,r.signature);r.actualReceivedAmount=r.balances.actualReceivedAmount;
   transition(r,r.balances.verified?'SUCCEEDED':'CONFIRMED_BELOW_MINIMUM',['TRANSACTION_CONFIRMED',r.balances.verified?'RECEIVED_AMOUNT_VERIFIED':'RECEIVED_AMOUNT_BELOW_MINIMUM'],clock());
  }catch(e){transition(r,'VERIFICATION_BLOCKED',[e.code??e.message],clock());}
  await save(r);return r;
 }
 return {prepare,submit,reconcile};
}
