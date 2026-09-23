import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {dirname} from 'node:path';

import {
  collectWithPythPro,
  bundleSnapshotWithPythPro
} from './live.mjs';

import {
  executionPipelineWithPythPro
} from './execution-pipeline.mjs';

import {replayReceipt} from '../execution/receipt.mjs';
import {settledCollector} from './collection.mjs';

const args=process.argv.slice(2);
const value=k=>args[args.indexOf(k)+1];

if(args[0]==='replay'){
  const r=replayReceipt(
    JSON.parse(await readFile(args[1],'utf8'))
  );

  console.log(JSON.stringify({
    verified:true,
    status:r.status,
    reasonCodes:r.reasonCodes
  }));
}else{
  const out=args.includes('--out')
    ?value('--out')
    :'evidence/execution/live-prepare.json';

  await mkdir(dirname(out),{recursive:true});

  const env={...process.env};

  // Use the same Pyth-Pro-aware collection path as the live app.
  // settledCollector still preserves strict future-evidence rejection
  // while allowing bounded provider/local-clock skew to settle against
  // actual elapsed time.
 const liveCollector=settledCollector(
  options=>collectWithPythPro({
    ...options,
    env
  })
);

  const snapshot=await liveCollector({
    underlying:'TSLA',
    amountRaw:'1000000',
    env
  });

  const analysis=bundleSnapshotWithPythPro(snapshot);

  await writeFile(
    out+'.analysis.json',
    JSON.stringify(analysis,null,2)
  );

  if(analysis.result.status!=='WINNER'){
    const result={
      mode:'live',
      status:'BLOCKED',
      reasonCodes:['NO_STRICT_WINNER'],
      analysisPath:out+'.analysis.json',
      result:analysis.result
    };

    await writeFile(
      out,
      JSON.stringify(result,null,2)
    );

    console.log(JSON.stringify(result,null,2));
  }else{
    const pipeline=executionPipelineWithPythPro({
      env,
      collector:liveCollector,
      persist:b=>writeFile(
        out,
        JSON.stringify(b,null,2)
      )
    });

    const r=await pipeline.prepare(
      analysis,
      args.includes('--wallet')
        ?value('--wallet')
        :null
    );

    console.log(JSON.stringify({
      status:r.status,
      winner:r.winningRepresentation,
      reasonCodes:r.reasonCodes,
      materialChange:r.materialChange,
      signature:r.signature,
      actualReceivedAmount:r.actualReceivedAmount,
      evidencePath:out
    },null,2));
  }
}