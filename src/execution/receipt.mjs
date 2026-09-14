import {hash,canonical} from '../engine.mjs';
import {strictAsset,materialGuard} from './guard.mjs';
import {EXECUTION_POLICY,ensure} from './policy.mjs';
import {VersionedTransaction} from '@solana/web3.js';
import {verifyConfirmed} from './transaction.mjs';
export function newReceipt(analysis,walletPublicKey,at){
 const {asset}=strictAsset(analysis);
 return {receiptSchemaVersion:1,mode:analysis.snapshot.mode,policy:{...EXECUTION_POLICY},underlying:'TSLA',inputAsset:analysis.snapshot.order.inputMint,inputAmount:analysis.snapshot.order.amountRaw,winningRepresentation:asset.symbol,winningMint:asset.mint,issuer:asset.issuer,walletPublicKey:walletPublicKey??null,analysis,comparison:null,finalQuote:null,materialChange:null,transaction:null,simulation:null,confirmation:null,balances:null,actualReceivedAmount:null,signature:null,status:'CREATED',reasonCodes:[],events:[],evidence:[],createdAt:at};
}
export function transition(r,status,reasonCodes,at,details={}){
 const event={index:r.events.length,previousHash:r.events.at(-1)?.sha256??null,at,status,reasonCodes:[...new Set(reasonCodes)].sort(),details};
 r.events.push({...event,sha256:hash(event)});r.status=status;r.reasonCodes=[...new Set([...r.reasonCodes,...reasonCodes])].sort();return r;
}
export function sealReceipt(receipt){return {receiptSha256:hash(receipt),receipt};}
export function replayReceipt(bundle){
 const r=bundle.receipt;ensure(r&&r.receiptSchemaVersion===1&&hash(r)===bundle.receiptSha256,'RECEIPT_HASH_MISMATCH');strictAsset(r.analysis);
 ensure(canonical(r.policy)===canonical(EXECUTION_POLICY),'EXECUTION_POLICY_MISMATCH');
 let previous=null;for(let i=0;i<r.events.length;i++){const {sha256,...e}=r.events[i];ensure(e.index===i&&e.previousHash===previous&&hash(e)===sha256,'RECEIPT_EVENT_MISMATCH');previous=sha256;}
 ensure(r.events.at(-1)?.status===r.status,'RECEIPT_STATE_MISMATCH');
 const identity=newReceipt(r.analysis,r.walletPublicKey,r.createdAt);
 for(const key of ['mode','underlying','inputAsset','inputAmount','winningRepresentation','winningMint','issuer'])ensure(r[key]===identity[key],'RECEIPT_IDENTITY_MISMATCH');
 ensure(canonical(r.reasonCodes)===canonical([...new Set(r.events.flatMap(e=>e.reasonCodes))].sort()),'RECEIPT_REASON_CODES_MISMATCH');
 if(r.materialChange){const event=r.events.find(e=>e.reasonCodes.includes('FINAL_REQUOTE_PASSED'));ensure(event,'RECEIPT_GUARD_EVENT_MISSING');const guard=materialGuard(r.analysis,r.comparison,r.finalQuote,event.at,r.policy);ensure(canonical(guard)===canonical(r.materialChange),'RECEIPT_GUARD_MISMATCH');}
 if(['SUCCEEDED','CONFIRMED_BELOW_MINIMUM'].includes(r.status)){
  const tx=VersionedTransaction.deserialize(Buffer.from(r.transaction.unsignedBase64,'base64'));
  const checked=verifyConfirmed(r.confirmation.raw,tx,r.transaction.inspection,r.walletPublicKey,strictAsset(r.analysis).asset,r.inputAmount,r.materialChange.finalMinimumOutput,r.signature);
  ensure(canonical(checked)===canonical(r.balances)&&r.actualReceivedAmount===checked.actualReceivedAmount&&(r.status==='SUCCEEDED')===checked.verified,'RECEIPT_SUCCESS_UNVERIFIED');
 }
 return r;
}
