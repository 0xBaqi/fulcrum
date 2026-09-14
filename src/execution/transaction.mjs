import {readFileSync} from 'node:fs';
import {createHash,createPublicKey,verify} from 'node:crypto';
import {PublicKey,TransactionInstruction,TransactionMessage,VersionedTransaction,ComputeBudgetProgram} from '@solana/web3.js';
import {USDC,TOKEN_2022} from '../registry.mjs';
import {ensure,EXECUTION_POLICY as P} from './policy.mjs';
export const JUPITER='JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4',TOKEN='TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',ATA='ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const bytes=readFileSync(new URL('../../data/execution/jupiter-current-idl.json',import.meta.url));
const source=JSON.parse(readFileSync(new URL('../../data/execution/jupiter-idl-source.json',import.meta.url)));
ensure(createHash('sha256').update(bytes).digest('hex')===source.sha256,'IDL_HASH_MISMATCH');
const idl=JSON.parse(bytes);
export function associated(wallet,mint,program){return PublicKey.findProgramAddressSync([new PublicKey(wallet).toBuffer(),new PublicKey(program).toBuffer(),new PublicKey(mint).toBuffer()],new PublicKey(ATA))[0].toBase58();}
export function decodeRoute(data){
 const b=Buffer.from(data,'base64');let p=8;const take=n=>{ensure(p+n<=b.length,'MALFORMED_INSTRUCTION');const r=b.subarray(p,p+n);p+=n;return r;};
 const read=t=>{
  if(typeof t==='string'){if(/^u(8|16|32|64|128)$/.test(t)){const n=Number(t.slice(1))/8;const v=take(n);let x=0n;for(let i=n-1;i>=0;i--)x=x*256n+BigInt(v[i]);return x.toString();}if(t==='bool'){const v=take(1)[0];ensure(v<2,'MALFORMED_INSTRUCTION');return !!v;}throw Error('UNSUPPORTED_IDL_TYPE');}
  if(t.vec){const n=Number(read('u32'));ensure(n<=64,'MALFORMED_INSTRUCTION');return Array.from({length:n},()=>read(t.vec));}
  if(t.option){const flag=Number(read('u8'));ensure(flag<2,'MALFORMED_INSTRUCTION');return flag?read(t.option):null;}
  if(t.array)return Array.from({length:t.array[1]},()=>read(t.array[0]));
  const def=idl.types.find(x=>x.name===(t.defined?.name??t.defined))?.type;ensure(def,'UNSUPPORTED_IDL_TYPE');
  const fields=f=>Object.fromEntries((f??[]).map((x,i)=>[x.name??String(i),read(x.type??x)]));
  if(def.kind==='struct')return fields(def.fields);
  if(def.kind==='enum'){const v=def.variants[Number(read('u8'))];ensure(v,'UNKNOWN_ROUTE_VARIANT');return {variant:v.name,fields:fields(v.fields)};}
  throw Error('UNSUPPORTED_IDL_TYPE');
 };
 const def=idl.instructions.find(x=>Buffer.from(x.discriminator).equals(b.subarray(0,8)));
 ensure(def&&['route','route_v2','shared_accounts_route','shared_accounts_route_v2'].includes(def.name),'UNSUPPORTED_JUPITER_INSTRUCTION');
 const args=Object.fromEntries(def.args.map(a=>[a.name,read(a.type)]));ensure(p===b.length&&args.route_plan?.length>0,'MALFORMED_INSTRUCTION');return {def,args};
}
export function inspectBuild(build,wallet,asset,amount){
 const key=new PublicKey(wallet);ensure(PublicKey.isOnCurve(key.toBytes()),'INVALID_WALLET');
 const input=associated(wallet,USDC,TOKEN),output=associated(wallet,asset.mint,TOKEN_2022);
 ensure(build.swapInstruction?.programId===JUPITER,'UNTRUSTED_TRANSACTION_PROGRAM');
 ensure(!(build.otherInstructions?.length)&&!build.cleanupInstruction&&!build.tipInstruction,'UNSUPPORTED_TRANSACTION_INSTRUCTION');
 const {def,args}=decodeRoute(build.swapInstruction.data),accounts=build.swapInstruction.accounts;
 ensure(Array.isArray(accounts)&&accounts.length>=def.accounts.length,'MALFORMED_INSTRUCTION');
 const expected={user_transfer_authority:wallet,user_source_token_account:input,source_token_account:input,user_destination_token_account:output,destination_token_account:output,source_mint:USDC,destination_mint:asset.mint,source_token_program:TOKEN,destination_token_program:TOKEN_2022,token_program:TOKEN,token_2022_program:TOKEN_2022,program:JUPITER};
 def.accounts.forEach((a,i)=>{const v=accounts[i];if(a.optional&&v.pubkey===JUPITER)return;if(expected[a.name])ensure(v.pubkey===expected[a.name],'TRANSACTION_ACCOUNT_MISMATCH');if(a.address)ensure(v.pubkey===a.address,'TRANSACTION_ACCOUNT_MISMATCH');if(a.signer)ensure(v.isSigner,'TRANSACTION_SIGNER_MISMATCH');if(a.writable)ensure(v.isWritable,'TRANSACTION_ACCOUNT_NOT_WRITABLE');if(a.name==='platform_fee_account')ensure(v.pubkey===JUPITER,'UNAUTHORIZED_PLATFORM_FEE');});
 ensure(args.in_amount===amount&&args.quoted_out_amount===build.outAmount&&Number(args.slippage_bps)===build.slippageBps,'TRANSACTION_AMOUNT_MISMATCH');
 ensure(Number(args.platform_fee_bps)===0&&Number(args.positive_slippage_bps??0)===0,'UNAUTHORIZED_PLATFORM_FEE');
 ensure((BigInt(args.quoted_out_amount)*BigInt(10000-Number(args.slippage_bps))+9999n)/10000n>=BigInt(build.otherAmountThreshold),'UNPROTECTED_MINIMUM_OUTPUT');
 for(const ix of build.setupInstructions??[]){
  const a=ix.accounts,d=Buffer.from(ix.data,'base64');ensure(ix.programId===ATA&&(d.length===0||(d.length===1&&d[0]===1))&&a?.length>=6,'UNSUPPORTED_SETUP_INSTRUCTION');
  const mint=a[3].pubkey,program=mint===USDC?TOKEN:TOKEN_2022;
  ensure([USDC,asset.mint].includes(mint)&&a[0].pubkey===wallet&&a[2].pubkey===wallet&&a[1].pubkey===associated(wallet,mint,program)&&a[4].pubkey==='11111111111111111111111111111111'&&a[5].pubkey===program,'TRANSACTION_ACCOUNT_MISMATCH');
 }
 const instructions=[...(build.setupInstructions??[]),build.swapInstruction];
 for(const ix of instructions)for(const a of ix.accounts)ensure(!a.isSigner||a.pubkey===wallet,'TRANSACTION_SIGNER_MISMATCH');
 return {verified:true,inputAccount:input,outputAccount:output,tokenProgram:TOKEN_2022,instruction:def.name,idlSha256:source.sha256,minimumOutput:build.otherAmountThreshold};
}
export function construct(build,wallet,blockhash,lookupTables=[]){
 const instructions=[ComputeBudgetProgram.setComputeUnitLimit({units:P.computeUnitLimit}),ComputeBudgetProgram.setComputeUnitPrice({microLamports:P.computeUnitPriceMicroLamports}),...[...(build.setupInstructions??[]),build.swapInstruction].map(i=>new TransactionInstruction({programId:new PublicKey(i.programId),keys:i.accounts.map(a=>({pubkey:new PublicKey(a.pubkey),isSigner:a.isSigner,isWritable:a.isWritable})),data:Buffer.from(i.data,'base64')}))];
 const tx=new VersionedTransaction(new TransactionMessage({payerKey:new PublicKey(wallet),recentBlockhash:blockhash,instructions}).compileToV0Message(lookupTables));ensure(tx.message.header.numRequiredSignatures===1,'TRANSACTION_SIGNER_MISMATCH');return tx;
}
export function signedTransaction(encoded,unsigned,wallet){
 const tx=VersionedTransaction.deserialize(Buffer.from(encoded,'base64'));
 ensure(Buffer.from(tx.message.serialize()).equals(Buffer.from(unsigned.message.serialize())),'SIGNED_TRANSACTION_CHANGED');
 const pub=createPublicKey({key:Buffer.concat([Buffer.from('302a300506032b6570032100','hex'),new PublicKey(wallet).toBuffer()]),format:'der',type:'spki'});
 ensure(verify(null,tx.message.serialize(),pub,tx.signatures[0]),'USER_SIGNATURE_INVALID');return tx;
}
export function base58(bytes){const alphabet='123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';let n=BigInt('0x'+Buffer.from(bytes).toString('hex')),s='';while(n){s=alphabet[Number(n%58n)]+s;n/=58n;}for(const b of bytes){if(b!==0)break;s='1'+s;}return s;}
export function verifyConfirmed(raw,transaction,inspection,wallet,asset,amount,minimum,signature){
 ensure(raw&&raw.meta&&raw.meta.err===null,'TRANSACTION_CONFIRMATION_FAILED');
 const tx=VersionedTransaction.deserialize(Buffer.from(raw.transaction[0],'base64'));
 signedTransaction(raw.transaction[0],transaction,wallet);
 ensure(Buffer.from(tx.message.serialize()).equals(Buffer.from(transaction.message.serialize()))&&base58(tx.signatures[0])===signature,'CONFIRMED_TRANSACTION_MISMATCH');
 const keys=[...tx.message.staticAccountKeys.map(k=>k.toBase58()),...(raw.meta.loadedAddresses?.writable??[]),...(raw.meta.loadedAddresses?.readonly??[])];
 const balance=(list,index,mint,program,decimals)=>{const row=list?.find(x=>x.accountIndex===index);ensure(row&&row.mint===mint&&row.owner===wallet&&row.programId===program&&row.uiTokenAmount?.decimals===decimals&&/^\d+$/.test(row.uiTokenAmount.amount),'RECEIVED_AMOUNT_UNVERIFIABLE');return BigInt(row.uiTokenAmount.amount);};
 const delta=(address,mint,program,decimals)=>{const i=keys.indexOf(address);ensure(i>=0,'RECEIVED_AMOUNT_UNVERIFIABLE');const before=raw.meta.preTokenBalances?.some(x=>x.accountIndex===i)?balance(raw.meta.preTokenBalances,i,mint,program,decimals):(ensure(raw.meta.preBalances?.[i]===0,'RECEIVED_AMOUNT_UNVERIFIABLE'),0n),after=balance(raw.meta.postTokenBalances,i,mint,program,decimals);return {pre:String(before),post:String(after),delta:String(after-before)};};
 const input=delta(inspection.inputAccount,USDC,TOKEN,6),output=delta(inspection.outputAccount,asset.mint,TOKEN_2022,asset.decimals);
 ensure(-BigInt(input.delta)===BigInt(amount),'INPUT_AMOUNT_MISMATCH');
 return {verified:BigInt(output.delta)>=BigInt(minimum),actualReceivedAmount:output.delta,input,output,slot:raw.slot,blockTime:raw.blockTime??null};
}
