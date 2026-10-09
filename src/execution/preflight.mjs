import {ensure,EXECUTION_POLICY as P} from './policy.mjs';
import {tokenBalance} from './rpc.mjs';
import {USDC} from '../registry.mjs';
import {TOKEN} from './transaction.mjs';
import {createHash} from 'node:crypto';

// Custom codes are program-specific. Never infer a funding failure from them.
// Jupiter Swap mapping: https://developers.jup.ag/docs/swap/v1/common-errors
const JUPITER='JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
export function simulationCategory(sim){
 const err=sim?.value?.err;
 const detail=err?.InstructionError?.[1];
 if(['AccountNotFound','ProgramAccountNotFound','InvalidAccountForFee','InvalidProgramForExecution','AccountLoadedTwice'].includes(err)||['InvalidAccountData','InvalidAccountOwner','MissingAccount','NotEnoughAccountKeys','UninitializedAccount','AccountNotExecutable'].includes(detail))return 'ACCOUNT';
 const code=detail?.Custom;
 const failures=(Array.isArray(sim?.value?.logs)?sim.value.logs:[]).filter(x=>typeof x==='string'&&/^Program \S+ failed:/.test(x));
 // The deepest failing program must match; an outer CPI wrapper is insufficient.
 if(Number.isInteger(code)&&failures[0]===`Program ${JUPITER} failed: custom program error: 0x${code.toString(16)}`){
  if([6001,6017].includes(code))return 'ROUTING';
  if([6008,6014,6025].includes(code))return 'ACCOUNT';
 }
 return 'UNKNOWN';
}
export function failureCategory(code){
 if(/^RPC_|^(TIMEOUT|RATE_LIMITED|NETWORK_ERROR|HTTP_ERROR|ACCESS_DENIED|INVALID_PROVIDER_JSON|HTTP_\d+)$/.test(code))return 'RPC';
 if(/^INSUFFICIENT_(USDC|SOL)$/.test(code))return 'FUNDS';
 if(/^BALANCE_(UNAVAILABLE|STALE)$/.test(code))return 'BALANCE';
 if(/^(TOKEN_ACCOUNT_UNVERIFIED|TRANSACTION_ACCOUNT_MISMATCH)$/.test(code))return 'ACCOUNT';
 if(/^(UNSUPPORTED_EXECUTION_ROUTE|NO_ROUTES_FOUND|COULD_NOT_FIND_ANY_ROUTE)$/.test(code))return 'ROUTING';
 return 'UNKNOWN';
}
export async function simulate(rpc,params,receipt,field='simulation'){
 try{return await rpc.call('simulateTransaction',params);}catch(e){
  receipt.failureCategory='RPC';
  receipt.simulationFailure={category:'RPC',field,code:e.code??null,message:e.message,evidenceId:e.evidenceId??null};
  e.denialReasonCodes=['TRANSACTION_SIMULATION_FAILED','SIMULATION_RPC_FAILED'];
  throw e;
 }
}
export function freshBalance(receipt,clock){
 const check=receipt.walletPreflight;
 if(!check||check.status!=='SUFFICIENT'||!Number.isSafeInteger(check.startedAt)||clock()<check.receivedAt||clock()-check.startedAt>P.maxFinalQuoteAgeMs){
  if(check){check.status='STALE';check.reasonCode='BALANCE_STALE';}
  ensure(false,'BALANCE_STALE');
 }
}
export async function walletPreflight({rpc,clock,wallet,inspection,receipt,testOnly=false,minContextSlot}){
 const check={status:'UNAVAILABLE',requiredRaw:receipt.inputAmount,checkedAt:clock(),evidenceId:null};
 receipt.walletPreflight=check;
 (receipt.walletPreflightChecks??=[]).push(check);
 try{
  const start=clock();
  const config={encoding:'base64',commitment:'confirmed',...(Number.isSafeInteger(minContextSlot)?{minContextSlot}:{})};
  const params=[[inspection.inputAccount,inspection.outputAccount],config];
  const requested=JSON.stringify(params);
  const previousEvidence=rpc.evidence?.length??0;
  let accounts;
  try{accounts=await rpc.call('getMultipleAccounts',params);}catch(e){check.evidenceId=e.evidenceId??null;check.technicalError={code:e.code??null,message:e.message};check.failureCategory='RPC';ensure(false,'BALANCE_UNAVAILABLE');}
  const evidence=rpc.evidence?.slice(previousEvidence).findLast(e=>e.request?.method==='getMultipleAccounts'&&JSON.stringify(e.request.params)===requested);
  check.evidenceId=evidence?.id??null;check.slot=accounts?.context?.slot;check.receivedAt=clock();
  ensure(Array.isArray(accounts?.value)&&accounts.value.length===2&&Number.isSafeInteger(check.slot)&&check.slot>=0,'BALANCE_UNAVAILABLE');
  if(evidence){
   ensure(!evidence.error&&evidence.status===200&&typeof evidence.responseText==='string'&&createHash('sha256').update(evidence.responseText).digest('hex')===evidence.responseSha256&&JSON.stringify(JSON.parse(evidence.responseText).result)===JSON.stringify(accounts),'BALANCE_UNAVAILABLE');
   check.startedAt=evidence.startedAt;check.receivedAt=evidence.receivedAt;
   const age=evidence.responseHeaders?.age;
   ensure(age==null||(/^\d+$/.test(String(age))&&Number(age)*1000<=P.maxFinalQuoteAgeMs),'BALANCE_STALE');
  }else{ensure(testOnly,'BALANCE_UNAVAILABLE');check.startedAt=start;check.synthetic=true;}
  ensure(Number.isSafeInteger(check.startedAt)&&Number.isSafeInteger(check.receivedAt)&&check.startedAt>=start&&check.startedAt<=check.receivedAt&&check.receivedAt<=clock()&&clock()-check.startedAt<=P.maxFinalQuoteAgeMs&&(!Number.isSafeInteger(minContextSlot)||check.slot>=minContextSlot),'BALANCE_STALE');
  const input=tokenBalance(accounts.value[0],wallet,USDC,TOKEN);
  check.availableRaw=input;check.status=BigInt(input)<BigInt(receipt.inputAmount)?'INSUFFICIENT':'SUFFICIENT';
  receipt.preBalances={...receipt.preBalances,input,slot:check.slot};
  ensure(check.status==='SUFFICIENT','INSUFFICIENT_USDC');
  return {accounts,input};
 }catch(e){check.reasonCode=e.code??'BALANCE_UNAVAILABLE';if(e.code==='BALANCE_STALE')check.status='STALE';if(!e.code){check.technicalError=e.message;ensure(false,'BALANCE_UNAVAILABLE');}throw e;}
}
