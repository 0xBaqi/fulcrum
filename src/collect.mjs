import {USDC,resolve} from './registry.mjs';
import {POLICY} from './engine.mjs';
import {atomic} from './math.mjs';
import {createHttp,parseXstocks,parseOndoPage,parseOndoApi,verifyChain} from './providers.mjs';
import {collectReferences} from './references.mjs';
import {SESSION_REFERENCE_POLICY} from './session-reference.mjs';
import {CALENDAR_IDENTITY} from './market-session.mjs';
const failure=e=>({code:e.code??e.message,evidenceId:e.evidenceId??null});
export async function quotePair(http,order,{key='',clock=Date.now}={}){
  return Promise.all(resolve(order.underlying).map(async a=>{
    const params=new URLSearchParams({inputMint:USDC,outputMint:a.mint,amount:order.amountRaw,slippageBps:String(POLICY.maxSlippageBps)});
    const startedAt=clock();
    try{
      const q=await http.get('quote-'+a.symbol,'https://api.jup.ag/swap/v2/order?'+params,{headers:key?{'x-api-key':key}:{}});
      return {symbol:a.symbol,mint:a.mint,quote:{startedAt:q.startedAt,receivedAt:q.receivedAt,raw:q.data,evidenceId:q.id}};
    }catch(e){return {symbol:a.symbol,mint:a.mint,quote:{startedAt,receivedAt:clock(),error:failure(e)}};}
  }));
}
export async function collect({amountRaw='100000000',underlying='NVDA',env=process.env,fetchImpl=fetch,clock=Date.now}={}){
  const assets=resolve(underlying);underlying=assets[0].underlying;atomic(amountRaw);
  const http=createHttp({fetchImpl,clock}),warnings=[];
  const order={underlying,inputMint:USDC,amountRaw};
  const ondoHeaders=env.ONDO_API_KEY?{'x-api-key':env.ONDO_API_KEY}:{};
  const xTask=async()=>{
    const responses=await Promise.allSettled([
      http.get('xstocks-asset',assets[0].source),
      http.get('xstocks-multiplier',assets[0].source+'/multiplier?network=Solana')]);
    for(const r of responses)if(r.status==='rejected')warnings.push({provider:'xstocks',...failure(r.reason)});
    if(responses.some(r=>r.status==='rejected'))return null;
    return parseXstocks(responses[0].value.data,responses[1].value.exact,Math.min(...responses.map(r=>r.value.receivedAt)),assets[0]);
  };
  const ondoTask=async()=>{
    if(env.ONDO_API_KEY){
      const r=await Promise.allSettled([
        http.get('ondo-addresses','https://api.gm.ondo.finance/v1/assets/'+assets[1].symbol+'/addresses',{headers:ondoHeaders}),
        http.get('ondo-market','https://api.gm.ondo.finance/v1/assets/'+assets[1].symbol+'/market',{headers:ondoHeaders}),
        http.get('ondo-status','https://api.gm.ondo.finance/v1/status/assets',{headers:ondoHeaders})]);
      for(const x of r)if(x.status==='rejected')warnings.push({provider:'ondo',...failure(x.reason)});
      if(r.every(x=>x.status==='fulfilled'))return parseOndoApi(r[0].value.data,r[1].value.exact,r[2].value.data,Math.min(...r.map(x=>x.value.receivedAt)),assets[1]);
    }else warnings.push({provider:'ondo',code:'ONDO_API_KEY_MISSING'});
    const page=await http.get('ondo-page',assets[1].source,{text:true});
    return parseOndoPage(page.data,page.receivedAt,assets[1]);
  };
  const rpcTask=http.get('solana-mints',env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com',{privateUrl:true,body:{jsonrpc:'2.0',id:1,method:'getMultipleAccounts',params:[assets.map(a=>a.mint),{encoding:'jsonParsed',commitment:'confirmed'}]}});
  const metadata=await Promise.allSettled([xTask(),ondoTask(),rpcTask]);
  for(let i=0;i<metadata.length;i++)if(metadata[i].status==='rejected')warnings.push({provider:['xstocks','ondo','solana'][i],...failure(metadata[i].reason)});
  if(metadata[2].status==='fulfilled'){
    const slot=metadata[2].value.data.result?.context?.slot;
    if(Number.isSafeInteger(slot))try{
      await http.get('solana-blocktime',env.SOLANA_RPC_URL||'https://api.mainnet-beta.solana.com',{privateUrl:true,body:{jsonrpc:'2.0',id:2,method:'getBlockTime',params:[slot]}});
    }catch(e){warnings.push({provider:'solana-blocktime',...failure(e)});}
  }
  // Start BOTH quotes in one batch AFTER metadata; reference collection runs alongside it.
  const [quotes,reference]=await Promise.allSettled([
    quotePair(http,order,{key:env.JUPITER_API_KEY,clock}),
    collectReferences(http,{underlying,env,warnings})]);
  let refs={};
  if(reference.status==='fulfilled')refs=reference.value;
  else warnings.push({provider:'pyth',...failure(reference.reason)});
  if(quotes.status==='rejected')throw quotes.reason;
  const candidates=quotes.value.map((c,i)=>{
    let m=metadata[i].status==='fulfilled'?metadata[i].value:null;
    if(m&&metadata[2].status==='fulfilled')try{m=verifyChain(m,metadata[2].value.data,i,clock());}catch(e){warnings.push({provider:c.symbol,...failure(e)});}
    return {...c,metadata:m};
  });
  return {schemaVersion:4,mode:'live',asOfMs:clock(),policy:{...POLICY},referencePolicy:{...SESSION_REFERENCE_POLICY},marketCalendar:{...CALENDAR_IDENTITY},order,references:refs,candidates,warnings,evidence:http.evidence.sort((a,b)=>a.id<b.id?-1:1)};
}
