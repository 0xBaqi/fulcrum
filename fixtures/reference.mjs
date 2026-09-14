// Explicitly synthetic reference prices atop captured Tesla response schemas.
// These fixtures are never called by the live collector.
import {readFileSync} from 'node:fs';
import {pythProvider,yahooProvider} from '../src/references.mjs';
import {rehash} from './strict.mjs';
export function referenceFixture(){
 const s=JSON.parse(readFileSync(new URL('../evidence/tesla-live-2026-09-13.json',import.meta.url),'utf8')).snapshot;
 s.mode='synthetic';s.evidence.forEach(e=>e.synthetic=true);s.references={};
 for(const name of ['TSLA','USDC']){
  const req=pythProvider.request(name),feedId=new URL(req.url).searchParams.get('ids[]');
  const body={parsed:[{id:feedId,price:{price:name==='TSLA'?'36900000000':'100000000',conf:'1000',expo:-8,publish_time:Math.floor((s.asOfMs-1000)/1000)}}]};
  const e=rehash({id:req.id,source:req.url,synthetic:true,request:null,status:200,startedAt:s.asOfMs-1100,receivedAt:s.asOfMs-500,responseHeaders:{date:new Date(s.asOfMs-500).toUTCString()},responseText:JSON.stringify(body)});
  s.evidence.push(e);s.references[name]=pythProvider.parse(e,name);
 }
 return s;
}
export function yahooResponse(name,{now=1789258311148,price=name==='USDC'?'1':'369',time=now-1000,delay}={}){
 return {chart:{result:[{meta:{symbol:name==='USDC'?'USDC-USD':name,currency:'USD',instrumentType:name==='USDC'?'CRYPTOCURRENCY':'EQUITY',regularMarketPrice:Number(price),regularMarketTime:Math.floor(time/1000),exchangeTimezoneName:'America/New_York',...(delay===undefined?{}:{exchangeDataDelayedBy:delay}),currentTradingPeriod:{regular:{start:Math.floor((now-3600000)/1000),end:Math.floor((now+3600000)/1000)}}}}],error:null}};
}
export function installYahoo(s,name,options={}){
 const req=yahooProvider.request(name),e=rehash({id:req.id,source:req.url,synthetic:true,status:200,request:null,startedAt:s.asOfMs-1100,receivedAt:s.asOfMs-500,responseHeaders:{},responseText:JSON.stringify(yahooResponse(name,{now:s.asOfMs,...options}))});
 s.evidence=s.evidence.filter(x=>x.id!==req.id);s.evidence.push(e);s.references[name]=yahooProvider.parse(e,name);return e;
}
