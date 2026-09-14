// Synthetic market-clock scenarios. Never imported by live collection.
import {referenceFixture} from './reference.mjs';
import {rehash} from './strict.mjs';
import {parseXstocks,parseOndoPage,verifyChain,exactJson} from '../src/providers.mjs';
import {resolve} from '../src/registry.mjs';
import {pythProvider} from '../src/references.mjs';
import {SESSION_REFERENCE_POLICY} from '../src/session-reference.mjs';
import {CALENDAR_IDENTITY,marketSession} from '../src/market-session.mjs';
export function sessionFixture(now=Date.parse('2026-09-12T16:00:00Z')){
 const s=referenceFixture();s.schemaVersion=4;s.asOfMs=now;s.referencePolicy={...SESSION_REFERENCE_POLICY};s.marketCalendar={...CALENDAR_IDENTITY};
 for(const e of s.evidence){e.startedAt=now-1100;e.receivedAt=now-1000;e.responseHeaders={date:new Date(now-1000).toUTCString(),age:'0'};}
 const entry=id=>s.evidence.find(e=>e.id===id),data=id=>JSON.parse(entry(id).responseText),assets=resolve('TSLA');
 const block=entry('solana-blocktime'),b=data(block.id);b.result=Math.floor((now-1000)/1000);block.responseText=JSON.stringify(b);rehash(block);
 const metadata=[parseXstocks(data('xstocks-asset'),exactJson(entry('xstocks-multiplier').responseText),now-1000,assets[0]),parseOndoPage(entry('ondo-page').responseText,now-1000,assets[1])];
 s.candidates.forEach((c,i)=>{c.metadata=verifyChain(metadata[i],data('solana-mints'),i,now);const e=entry('quote-'+c.symbol);e.startedAt=now-500;e.receivedAt=now-200;c.quote={startedAt:e.startedAt,receivedAt:e.receivedAt,raw:data(e.id),evidenceId:e.id};});
 const session=marketSession(now),live=['UNDERLYING_OPEN','UNDERLYING_EXTENDED'].includes(session.state);
 for(const name of ['TSLA','USDC'])setPyth(s,name,{publishedAt:name==='TSLA'&&!live?session.lastCompletedRegularSession?.regularClose??now-1000:now-1000});
 return s;
}
export function setPyth(s,name,{publishedAt=s.asOfMs-1000,price,confidence}={}){
 const e=s.evidence.find(e=>e.id==='reference-pyth-'+name),d=JSON.parse(e.responseText),p=d.parsed[0].price;
 p.publish_time=Math.floor(publishedAt/1000);if(price!==undefined)p.price=price;if(confidence!==undefined)p.conf=confidence;
 e.responseText=JSON.stringify(d);rehash(e);s.references[name]=pythProvider.parse(e,name);return e;
}
