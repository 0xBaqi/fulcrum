import {ASSETS,FEEDS,TOKEN_2022} from './registry.mjs';
import {createHash} from 'node:crypto';
import {decimal,display,mul,rational,abs,sub,cmp} from './math.mjs';

// Preserve numeric JSON lexemes as strings, before JS can round issuer multipliers.
export function exactJson(text){
  return JSON.parse(text.replace(/"(?:\\.|[^"\\])*"|-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/g,s=>s[0]==='"'?s:JSON.stringify(s)));
}
export function createHttp({fetchImpl=fetch,clock=Date.now,timeoutMs=12000}={}){
  const evidence=[];
  async function get(id,url,{headers={},body,text=false,privateUrl=false}={}){
    const startedAt=clock(); let entry;
    try{
      const r=await fetchImpl(url,{method:body?'POST':'GET',headers:{Accept:'application/json',...headers,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(timeoutMs)});
      let raw=await r.text();
      const secrets=[headers.Authorization?.replace(/^Bearer /,''),headers['x-api-key']].filter(Boolean);
      const original=raw;for(const secret of secrets)raw=raw.split(secret).join('[REDACTED]');
      entry={id,source:privateUrl?id:url,startedAt,receivedAt:clock(),status:r.status,request:body??null,responseHeaders:{date:r.headers.get('date'),age:r.headers.get('age'),cacheControl:r.headers.get('cache-control')},responseText:raw,responseSha256:createHash('sha256').update(raw).digest('hex'),responseRedacted:raw!==original};
      evidence.push(entry);
      if(!r.ok){const e=Error(r.status===429?'RATE_LIMITED':r.status===401||r.status===403?'ACCESS_DENIED':'HTTP_ERROR');e.code=e.message;throw e;}
      return {...entry,data:text?raw:JSON.parse(raw),exact:text?null:exactJson(raw)};
    }catch(e){
      const code=e.code??(e.name==='TimeoutError'?'TIMEOUT':e instanceof SyntaxError?'INVALID_PROVIDER_JSON':'NETWORK_ERROR');
      if(!entry)evidence.push({id,source:privateUrl?id:url,startedAt,receivedAt:clock(),error:{code}});
      const failure=Error(code);failure.code=code;failure.evidenceId=id;throw failure;
    }
  }
  return {get,evidence};
}
const ensure=(ok,message)=>{if(!ok)throw Error(message);};
const positive=s=>{ensure(decimal(s).n>0n,'INVALID_MULTIPLIER');return s;};
function epochSeconds(s){const n=Number(s);ensure(Number.isSafeInteger(n)&&n>=0,'INVALID_TIMESTAMP');return n*1000;}
export function parseXstocks(asset,multiplier,observedAt,a=ASSETS[0]){
  const d=asset.deployments?.filter(x=>x.network==='Solana');
  ensure(asset.symbol===a.symbol&&asset.underlyingSymbol===a.underlying&&asset.underlyingIsin===a.underlyingIsin&&d?.length===1&&d[0].address===a.mint,'ISSUER_IDENTITY_MISMATCH');
  const activation=epochSeconds(multiplier.activationDateTime);
  const pending=decimal(multiplier.newMultiplier);
  ensure(pending.n>=0n,'INVALID_PENDING_MULTIPLIER');
  ensure(!(pending.n>0n&&activation===0),'INVALID_ACTIVATION_TIME');
  const shares=activation>0&&activation<=observedAt&&pending.n>0n?multiplier.newMultiplier:multiplier.currentMultiplier;
  return {underlying:a.underlying,mint:a.mint,decimals:a.decimals,identityVerified:true,chainVerified:false,sharesPerToken:positive(shares),observedAt,timestampQuality:'issuer-or-chain',halted:asset.isTradingHalted,actionTimes:activation>0?[activation]:[],source:'xstocks-public-api',evidenceIds:['xstocks-asset','xstocks-multiplier'],primaryMarketOpen:asset.trading?.openNow??null};
}
// Parse data payloads only; NEVER execute website scripts.
export function parseOndoPage(html,observedAt,a=ASSETS[1]){
  const matches=[];
  const walk=x=>{if(!x||typeof x!=='object')return;if(x.symbol===a.symbol&&x.ticker===a.underlying&&x.sharesMultiplier&&Array.isArray(x.supportedNetworks))matches.push(x);for(const v of Object.values(x))walk(v);};
  for(const m of html.matchAll(/self\.__next_f\.push\((\[1,"(?:\\.|[^"\\])*"\])\)/g)){
    const payload=JSON.parse(m[1])[1];
    for(const line of payload.split('\n')){const i=line.indexOf(':');if(i<0)continue;try{walk(JSON.parse(line.slice(i+1)));}catch{/* Other Flight records are not JSON. */}}
  }
  ensure(matches.length===1,'ONDO_PAGE_SCHEMA_CHANGED');
  const x=matches[0],net=x.supportedNetworks.filter(n=>n.network==='SOLANA');
  ensure(net.length===1&&net[0].address===a.mint&&net[0].decimals===a.decimals,'ISSUER_IDENTITY_MISMATCH');
  return {underlying:a.underlying,mint:a.mint,decimals:a.decimals,identityVerified:true,chainVerified:false,sharesPerToken:positive(x.sharesMultiplier),observedAt,timestampQuality:'retrieval-only',halted:null,actionTimes:null,source:'ondo-public-page-fallback',evidenceIds:['ondo-page']};
}
export function parseOndoApi(addresses,marketExact,statuses,observedAt,a=ASSETS[1]){
  const net=addresses.addresses?.filter(n=>n.networkChainId==='solana-900');
  ensure(addresses.symbol===a.symbol&&net?.length===1&&net[0].address===a.mint&&net[0].decimals===a.decimals,'ISSUER_IDENTITY_MISMATCH');
  ensure(marketExact.primaryMarket?.symbol===a.symbol&&marketExact.underlyingMarket?.ticker===a.underlying,'ISSUER_IDENTITY_MISMATCH');
  ensure(Array.isArray(statuses),'ONDO_STATUS_SCHEMA_CHANGED');
  const events=statuses.filter(s=>s.symbol===a.symbol);
  const intervals=events.map(e=>({start:Date.parse(e.start),end:Date.parse(e.end)}));
  ensure(intervals.every(e=>Number.isSafeInteger(e.start)&&Number.isSafeInteger(e.end)&&e.start<=e.end),'ONDO_STATUS_SCHEMA_CHANGED');
  const timestamp=Number(marketExact.timestamp);ensure(Number.isSafeInteger(timestamp)&&timestamp>0,'INVALID_TIMESTAMP');
  return {underlying:a.underlying,mint:a.mint,decimals:a.decimals,identityVerified:true,chainVerified:false,sharesPerToken:positive(marketExact.primaryMarket.sharesMultiplier),observedAt:Math.min(observedAt,timestamp),timestampQuality:'issuer-or-chain',halted:intervals.some(e=>e.start<=observedAt&&e.end>=observedAt),actionTimes:intervals.flatMap(e=>[e.start,e.end]),source:'ondo-api',evidenceIds:['ondo-addresses','ondo-market','ondo-status']};
}
export function verifyChain(metadata,rpc,index,now){
  const value=rpc.result?.value?.[index],info=value?.data?.parsed?.info;
  ensure(value?.owner===TOKEN_2022&&value.data.parsed.type==='mint'&&info?.isInitialized===true&&info.decimals===metadata.decimals,'MINT_CHAIN_MISMATCH');
  const extensions=info.extensions??[];
  ensure(!extensions.some(x=>x.extension==='transferFeeConfig'||x.extension==='nonTransferable'||(x.extension==='transferHook'&&x.state?.programId)), 'UNSUPPORTED_TRANSFER_EXTENSION');
  ensure(!extensions.some(x=>x.extension==='defaultAccountState'&&x.state?.accountState!=='initialized'),'DEFAULT_ACCOUNT_FROZEN');
  const paused=extensions.find(x=>x.extension==='pausableConfig')?.state?.paused;
  const ext=extensions.find(x=>x.extension==='scaledUiAmountConfig');
  let result={...metadata,actionTimes:metadata.actionTimes?[...metadata.actionTimes]:null};
  if(metadata.source==='xstocks-public-api'){
    ensure(ext?.state,'SCALED_UI_EXTENSION_MISSING');
    const s=ext.state,t=Number(s.newMultiplierEffectiveTimestamp)*1000;
    ensure(Number.isSafeInteger(t)&&t>=0,'INVALID_CHAIN_MULTIPLIER_TIME');
    const v=t>0&&t<=now?s.newMultiplier:s.multiplier;
    ensure(String(v)===metadata.sharesPerToken,'MULTIPLIER_CHAIN_MISMATCH');
    if(t>0&&!result.actionTimes.includes(t))result.actionTimes.push(t);
  }else if(ext){
    const s=ext.state,t=Number(s?.newMultiplierEffectiveTimestamp)*1000;
    ensure(Number.isSafeInteger(t)&&t>=0,'INVALID_CHAIN_MULTIPLIER_TIME');
    const v=String(t>0&&t<=now?s.newMultiplier:s.multiplier);positive(v);
    // Solana stores a float64. The issuer's decimal share factor differs by one ULP
    // in the observed NVDAon response. Bound this discrepancy; apply the factor ONCE.
    ensure(cmp(abs(sub(decimal(v),decimal(metadata.sharesPerToken))),decimal('0.000000000001'))<=0,'MULTIPLIER_CHAIN_MISMATCH');
    result={...result,issuerSharesPerToken:metadata.sharesPerToken,sharesPerToken:v};
    if(result.actionTimes&&t>0&&!result.actionTimes.includes(t))result.actionTimes.push(t);
  }
  if(paused===true)result.halted=true;
  return {...result,chainVerified:true,chainSlot:rpc.result.context.slot,evidenceIds:[...(metadata.evidenceIds??[]),'solana-mints']};
}
export function parsePyth(data){
  const references={};
  for(const [name,id] of Object.entries(FEEDS)){
    const rows=data.parsed?.filter(p=>p.id.replace(/^0x/,'')===id);
    ensure(rows?.length===1,'PYTH_FEED_MISSING'); const r=rows[0].price;
    ensure(Number.isSafeInteger(r.expo)&&Math.abs(r.expo)<=30,'PYTH_EXPONENT_INVALID');
    const scale=r.expo<0?rational(1n,10n**BigInt(-r.expo)):rational(10n**BigInt(r.expo));
    // At most 30 exponent places; preserve all feed precision in decimal strings.
    references[name]={symbol:name==='NVDA'?'Equity.US.NVDA/USD':'Crypto.USDC/USD',feedId:id,price:display(mul(rational(r.price),scale),30),confidence:display(mul(rational(r.conf),scale),30),publishedAt:epochSeconds(r.publish_time),source:'pyth-hermes',evidenceId:'pyth-latest'};
  }
  return references;
}
