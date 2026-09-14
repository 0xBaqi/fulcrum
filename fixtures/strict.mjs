// Synthetic timestamps/references and response envelopes using captured schemas.
// Never used by live collection. Original capture stays byte-for-byte unchanged.
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {ASSETS,FEEDS} from '../src/registry.mjs';
import {parseXstocks,parseOndoPage,parseOndoApi,verifyChain,parsePyth,exactJson} from '../src/providers.mjs';
const old=JSON.parse(readFileSync(new URL('../evidence/live-2026-09-12.json',import.meta.url),'utf8')).snapshot;
export function rehash(e){e.responseSha256=createHash('sha256').update(e.responseText).digest('hex');return e;}
export function strictFixture({verifiedOndo=false}={}){
  const s=structuredClone(old);s.schemaVersion=2;s.mode='synthetic';s.asOfMs=1789240000000;s.warnings=[];
  const now=s.asOfMs;
  s.evidence=s.evidence.filter(e=>e.id!=='pyth-latest').map(e=>rehash({...e,synthetic:true,startedAt:now-1100,receivedAt:now-1000,responseHeaders:{date:new Date(now-1000).toUTCString(),age:'0'},request:null}));
  const entry=id=>s.evidence.find(e=>e.id===id);
  const data=id=>JSON.parse(entry(id).responseText);
  const add=(id,source,body)=>{const e=rehash({id,source,synthetic:true,status:200,startedAt:now-1100,receivedAt:now-1000,responseHeaders:{date:new Date(now-1000).toUTCString(),age:'0'},responseText:JSON.stringify(body),request:null});s.evidence.push(e);return e;};
  const rpc=data('solana-mints');
  entry('solana-mints').request={method:'getMultipleAccounts',params:[ASSETS.map(a=>a.mint),{encoding:'jsonParsed',commitment:'confirmed'}]};
  add('solana-blocktime','solana-blocktime',{jsonrpc:'2.0',id:2,result:(now-1000)/1000}).request={method:'getBlockTime',params:[rpc.result.context.slot]};
  const pyth={parsed:Object.entries(FEEDS).map(([name,id])=>({id,price:{price:name==='NVDA'?'22000000000':'100000000',conf:name==='NVDA'?'1000000':'10000',expo:-8,publish_time:(now-1000)/1000}}))};
  add('pyth-latest','https://pyth.dourolabs.app/hermes/v2/updates/price/latest?ids[]=fixture',pyth);
  s.references=parsePyth(pyth);
  let x=parseXstocks(data('xstocks-asset'),exactJson(entry('xstocks-multiplier').responseText),now-1000);
  let ondo=parseOndoPage(entry('ondo-page').responseText,now-1000);
  if(verifiedOndo){
    const addresses={symbol:'NVDAon',addresses:[{networkChainId:'solana-900',address:ASSETS[1].mint,decimals:9}]};
    const market={primaryMarket:{symbol:'NVDAon',sharesMultiplier:'1.0017152487959898'},underlyingMarket:{ticker:'NVDA'},timestamp:now-1000};
    add('ondo-addresses','https://api.gm.ondo.finance/v1/assets/NVDAon/addresses',addresses);
    add('ondo-market','https://api.gm.ondo.finance/v1/assets/NVDAon/market',market);
    add('ondo-status','https://api.gm.ondo.finance/v1/status/assets',[]);
    ondo=parseOndoApi(addresses,exactJson(JSON.stringify(market)),[],now-1000);
  }
  s.candidates.forEach((c,i)=>{
    c.metadata=verifyChain(i?ondo:x,rpc,i,now);
    const e=entry('quote-'+c.symbol);e.startedAt=now-300;e.receivedAt=now-100;
    c.quote={raw:data('quote-'+c.symbol),startedAt:e.startedAt,receivedAt:e.receivedAt,evidenceId:e.id};
  });
  return s;
}
