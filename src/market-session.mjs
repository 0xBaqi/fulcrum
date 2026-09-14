import {readFileSync} from 'node:fs';
import {hash} from './engine-v1.mjs';
const calendar=JSON.parse(readFileSync(new URL('../data/nasdaq-calendar-2026-v1.json',import.meta.url),'utf8'));
export const CALENDAR_IDENTITY=Object.freeze({id:calendar.id,sha256:hash(calendar)});
const formatter=new Intl.DateTimeFormat('en-CA',{timeZone:calendar.timezone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'});
function local(t){const p=Object.fromEntries(formatter.formatToParts(t).map(p=>[p.type,p.value]));return {date:`${p.year}-${p.month}-${p.day}`,minute:Number(p.hour)*60+Number(p.minute)};}
const shift=(d,n)=>new Date(Date.parse(d+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const weekend=d=>[0,6].includes(new Date(d+'T12:00:00Z').getUTCDay());
const trading=d=>!weekend(d)&&!calendar.holidays[d];
// Noon UTC is unambiguous around US DST transitions. Derive that date's ET offset.
function epoch(d,minute){const noon=Date.parse(d+'T12:00:00Z'),offset=720-local(noon).minute;return Date.parse(d+'T00:00:00Z')+(minute+offset)*60000;}
function session(d){const early=calendar.earlyCloses[d];return {date:d,regularOpen:epoch(d,calendar.regularOpenMinute),regularClose:epoch(d,early??calendar.regularCloseMinute),extendedOpen:epoch(d,calendar.extendedOpenMinute),extendedClose:early?null:epoch(d,calendar.extendedCloseMinute),earlyClose:!!early};}
export function marketSession(asOfMs){
 if(!Number.isSafeInteger(asOfMs)||asOfMs<=0)throw Error('INVALID_SESSION_TIMESTAMP');
 const {date,minute}=local(asOfMs),known=date>=calendar.validFrom&&date<calendar.validUntilExclusive;
 const info={...CALENDAR_IDENTITY,timezone:calendar.timezone,localDate:date,localMinute:minute,source:calendar.sources,definitionReviewedDate:calendar.sourceReviewedDate,verificationStatus:known?'VERIFIED':'UNKNOWN',basis:'PUBLISHED_SCHEDULE_NOT_REALTIME_HALT_STATUS',holiday:calendar.holidays[date]??null};
 if(!known)return {...info,state:'UNDERLYING_UNKNOWN',reasonCodes:['MARKET_CALENDAR_OUT_OF_RANGE'],lastCompletedRegularSession:null};
 const today=session(date);let state;
 if(calendar.holidays[date])state='UNDERLYING_HOLIDAY';
 else if(weekend(date))state='UNDERLYING_WEEKEND';
 else if(asOfMs>=today.regularOpen&&asOfMs<today.regularClose)state='UNDERLYING_OPEN';
 else if(today.earlyClose&&asOfMs>=today.regularClose&&minute<calendar.extendedCloseMinute)state='UNDERLYING_UNKNOWN';
 else if(asOfMs>=today.extendedOpen&&asOfMs<(today.extendedClose??epoch(date,calendar.extendedCloseMinute)))state='UNDERLYING_EXTENDED';
 else state='UNDERLYING_CLOSED';
 let d=date,last=null;
 for(let i=0;i<10;i++,d=shift(d,-1)){if(d<'2025-12-31')break;if(trading(d)&&session(d).regularClose<=asOfMs){last=session(d);break;}}
 const reasons=state==='UNDERLYING_UNKNOWN'?['EARLY_CLOSE_EXTENDED_SCHEDULE_UNVERIFIED']:last?[]:['LAST_SESSION_UNAVAILABLE'];
 return {...info,state,verificationStatus:state==='UNDERLYING_UNKNOWN'?'UNKNOWN':'VERIFIED',reasonCodes:reasons,lastCompletedRegularSession:last};
}
