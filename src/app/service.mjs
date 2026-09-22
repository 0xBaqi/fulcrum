import {settledCollector} from './collection.mjs';
import {readFile,mkdir,writeFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {PublicKey} from '@solana/web3.js';
import {
  collectWithPythPro,
  bundleSnapshotWithPythPro
} from './live.mjs';

import {
  executionPipelineWithPythPro
} from './execution-pipeline.mjs';
import {replay} from '../cli.mjs';
import {intent,candidates} from './intent.mjs';
import {decision,executionState,executionView,STATES} from './view.mjs';
export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const CAPTURES=Object.freeze([{id:'tesla-100-session',path:'evidence/session-live-2026-09-13.json',label:'Tesla · 100 USDC · historical session-aware winner'},{id:'tesla-1-wallet',path:'evidence/execution/m2a-wallet-attempt4-2026-09-13.json.analysis.json',label:'Tesla · 1 USDC · historical wallet validation analysis'}]);
const safeCode=e=>/^[A-Z][A-Z0-9_]{1,90}$/.test(e.code??e.message)?e.code??e.message:'UPSTREAM_FAILURE';
export function appService({
  collector=collectWithPythPro,
  executor=executionPipelineWithPythPro,
  env=process.env,clock=Date.now,sleep,load=async path=>JSON.parse(await readFile(join(ROOT,path),'utf8')),persist=async(id,kind,data)=>{const dir=join(ROOT,'evidence/app-live');await mkdir(dir,{recursive:true});await writeFile(join(dir,id+'-'+kind+'.json'),JSON.stringify(data,null,2));}}={}){
 const jobs=new Map(),pending=new Map();let active=0;
 function set(j,state,codes=[]){if(!STATES.includes(state))throw Error('INVALID_STATE');j.state=state;j.reasonCodes=codes;j.events.push({state,at:clock(),reasonCodes:codes});}
 function view(j){return structuredClone({id:j.id,intent:j.intent,state:j.state,createdAt:j.createdAt,events:j.events,reasonCodes:j.reasonCodes,resolved:j.resolved,decision:j.decision??null,execution:j.execution??null,replay:j.replay??null,collectionTiming:j.collectionTiming??[],error:j.error??null});}
 function getJob(id){const j=jobs.get(id);if(!j)throw Error('JOB_NOT_FOUND');return j;}
 async function catalog(){return Promise.all(CAPTURES.map(async c=>{const b=await load(c.path);replay(b);return {id:c.id,label:c.label,underlying:b.snapshot.order.underlying,amountRaw:b.snapshot.order.amountRaw,asOfMs:b.snapshot.asOfMs,snapshotSha256:b.snapshotSha256};}));}
 function start(input){
  const i=intent(input);if(active>=2)throw Error('APPLICATION_BUSY');
  for(const [id,j] of jobs)if(!pending.has(id)&&clock()-j.createdAt>1800000)jobs.delete(id);
  if(jobs.size>=50)throw Error('APPLICATION_CAPACITY_REACHED');
  const j={id:randomUUID(),intent:i,createdAt:clock(),state:'IDLE',reasonCodes:[],events:[],resolved:[]};jobs.set(j.id,j);active++;
  const task=(async()=>{try{
   set(j,'RESOLVING');j.resolved=candidates();let b;
   if(i.mode==='REPLAY'){
    const c=CAPTURES.find(c=>c.id===i.captureId);if(!c)throw Error('UNKNOWN_CAPTURE');
    b=await load(c.path);if(b.snapshot.order.underlying!==i.underlying||b.snapshot.order.amountRaw!==i.amountRaw)throw Error('REPLAY_INPUT_MISMATCH');
    set(j,'VALIDATING');replay(b);j.replay={captureId:c.id,capturedAt:b.snapshot.asOfMs,snapshotSha256:b.snapshotSha256,label:'REPLAYED EVIDENCE — not live; execution disabled'};
   }else{
    set(j,'QUOTING');const s=await settledCollector(collector,{clock,sleep,onTiming:t=>{(j.collectionTiming??=[]).push(t);}})({underlying:i.underlying,amountRaw:i.amountRaw,env,clock});
    if(s.mode!=='live'||s.order.underlying!==i.underlying||s.order.amountRaw!==i.amountRaw)throw Error('LIVE_SOURCE_MISMATCH');
    set(j,'VALIDATING');b=bundleSnapshotWithPythPro(s);await persist(j.id,'analysis',b);
   }
   j.bundle=b;j.decision=decision(b,i.mode);set(j,b.result.status==='WINNER'?'STRICT_WINNER':'NO_VERIFIED_REPRESENTATION',b.result.reasonCodes);
  }catch(e){j.error={code:safeCode(e)};set(j,'FAILED',[j.error.code]);}finally{active--;}})();
  pending.set(j.id,task);task.finally(()=>pending.delete(j.id));return view(j);
 }
 function prepare(id,input){
  const j=getJob(id);if(!input||Object.keys(input).some(k=>k!=='wallet'))throw Error('INVALID_PREPARATION_INPUT');
  if(j.intent.mode!=='LIVE')throw Error('REPLAY_EXECUTION_DISABLED');
  if(j.state!=='STRICT_WINNER'||j.bundle?.result.status!=='WINNER')throw Error('NO_EXECUTABLE_STRICT_WINNER');
  if(!input.wallet)throw Error('WALLET_PUBLIC_KEY_REQUIRED');
  try{const p=new PublicKey(input.wallet);if(p.toBase58()!==input.wallet||!PublicKey.isOnCurve(p.toBytes()))throw Error();}catch{throw Error('INVALID_WALLET_PUBLIC_KEY');}
  if(active>=2)throw Error('APPLICATION_BUSY');active++;
  set(j,'READY_FOR_EXECUTION',['WALLET_BOUND_PREPARATION_REQUESTED']);
  const task=(async()=>{try{
   set(j,'REQUOTING');const pipeline=executor({env,clock,collector:settledCollector(collector,{clock,onTiming:t=>{(j.collectionTiming??=[]).push(t);}}),allowBroadcast:false,persist:b=>persist(j.id,'execution',b)});
   const r=await pipeline.prepare(j.bundle,input.wallet);j.execution=executionView(r);set(j,executionState(r),r.reasonCodes);
  }catch(e){j.error={code:safeCode(e)};set(j,'FAILED',[j.error.code]);}finally{active--;}})();
  pending.set(j.id,task);task.finally(()=>pending.delete(j.id));return view(j);
 }
 return {catalog,start,prepare,get:id=>view(getJob(id)),async settled(id){await pending.get(id);return view(getJob(id));}};
}
