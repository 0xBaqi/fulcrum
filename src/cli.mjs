import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {dirname} from 'node:path';
import {parseArgs} from 'node:util';
import {pathToFileURL} from 'node:url';
import {collect} from './collect.mjs';
import {evaluate,canonical,hash} from './engine.mjs';
import {usdcAmount} from './math.mjs';
import {synthetic} from '../fixtures/synthetic.mjs';
export function replay(bundle){
  if(bundle.snapshotSha256!==hash(bundle.snapshot))throw Error('SNAPSHOT_HASH_MISMATCH');
  const result=evaluate(bundle.snapshot);
  if(canonical(result)!==canonical(bundle.result))throw Error('REPLAY_RESULT_MISMATCH');
  return result;
}
async function main(){
  const {positionals,values}=parseArgs({allowPositionals:true,options:{out:{type:'string'},input:{type:'string'},usdc:{type:'string',default:'100'},underlying:{type:'string',default:'NVDA'},'public-reference':{type:'boolean',default:false}}});
  const command=positionals[0];let snapshot,result;
  if(positionals.length!==1)throw Error('Usage: node src/cli.mjs <live|demo|replay> [--usdc 100] [--out path] [--input path]');
  if(command==='replay'){
    if(!values.input)throw Error('REPLAY_REQUIRES_INPUT');
    result=replay(JSON.parse(await readFile(values.input,'utf8')));
    console.log(JSON.stringify({replayVerified:true,...result},null,2));return;
  }
  if(command==='live')snapshot=await collect({amountRaw:usdcAmount(values.usdc),underlying:values.underlying,env:values['public-reference']?{...process.env,PYTH_API_KEY:''}:process.env});
  else if(command==='demo')snapshot=synthetic();
  else throw Error('UNKNOWN_COMMAND');
  result=evaluate(snapshot);
  const out=values.out??'evidence/'+command+'-latest.json';
  await mkdir(dirname(out),{recursive:true});
  await writeFile(out,JSON.stringify({snapshotSha256:hash(snapshot),snapshot,result},null,2)+'\n');
  console.log(JSON.stringify({evidenceFile:out,...result},null,2));
  // NO_WINNER is a valid business outcome. Exit 2 distinguishes it for automation.
  if(result.status==='NO_WINNER')process.exitCode=2;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  main().catch(e=>{console.error(JSON.stringify({error:e.message}));process.exitCode=1;});
}
