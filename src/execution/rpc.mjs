import {AddressLookupTableAccount,PublicKey} from '@solana/web3.js';
import {createHttp} from '../providers.mjs';
import {ensure} from './policy.mjs';
export function rpcClient({env=process.env,http=createHttp()}={}){
 let id=0;const call=async(method,params)=>{const e=await http.get('rpc-'+method+'-'+(++id),env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com',{privateUrl:true,body:{jsonrpc:'2.0',id,method,params}});ensure(!e.data.error&&e.data.result!==undefined,'RPC_'+method+'_FAILED');return e.data.result;};
 return {call,evidence:http.evidence,async lookup(address){const a=await call('getAccountInfo',[address,{encoding:'base64',commitment:'confirmed'}]);ensure(a.value?.owner==='AddressLookupTab1e1111111111111111111111111','LOOKUP_TABLE_UNVERIFIED');return new AddressLookupTableAccount({key:new PublicKey(address),state:AddressLookupTableAccount.deserialize(Buffer.from(a.value.data[0],'base64'))});}};
}
export function tokenBalance(account,wallet,mint,program){
 if(account===null)return '0';ensure(account?.owner===program&&account.data?.[1]==='base64','TOKEN_ACCOUNT_UNVERIFIED');
 const b=Buffer.from(account.data[0],'base64');ensure(b.length>=165&&new PublicKey(b.subarray(0,32)).toBase58()===mint&&new PublicKey(b.subarray(32,64)).toBase58()===wallet&&b[108]===1,'TOKEN_ACCOUNT_UNVERIFIED');return b.readBigUInt64LE(64).toString();
}
