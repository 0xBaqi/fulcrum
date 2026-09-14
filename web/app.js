const $=id=>document.getElementById(id);let csrf='',current=null,generation=0,catalog=[];
const terminal=new Set(['STRICT_WINNER','NO_VERIFIED_REPRESENTATION','READY_FOR_SIGNATURE','SIMULATION_BLOCKED','EXECUTION_CHANGED','FAILED','CONFIRMED']);
const stamp=ms=>Number.isFinite(ms)?new Date(ms).toISOString():'Unavailable';
const reasonLabel=code=>{
  const labels={
    ALL_MANDATORY_GATES_PASSED:'All mandatory checks passed',
    SINGLE_VERIFIED_SURVIVOR:'Only verified representation',
    CLOSED_MARKET_REFERENCE:'Using last qualified market reference',
    LAST_MARKET_CONFIDENCE_UNAVAILABLE:'Reference confidence unavailable while market is closed',

    CORPORATE_ACTION_STATUS_UNKNOWN:'Corporate-action status unverified',
    ISSUER_STATUS_UNKNOWN:'Issuer status unverified',
    METADATA_TIMESTAMP_UNVERIFIED:'Metadata freshness unverified',

    REFERENCE_TSLA_CONFIDENCE_UNKNOWN:'Tesla reference confidence unavailable',
    REFERENCE_TSLA_STALE:'Tesla reference is stale',
    REFERENCE_TSLA_FUTURE:'Tesla reference timestamp is invalid',

    QUOTE_STALE:'Executable quote is stale',
    QUOTE_FUTURE:'Executable quote timestamp is invalid',
    QUOTE_MINT_MISMATCH:'Quote does not match representation mint',
    PRICE_IMPACT_LIMIT_EXCEEDED:'Price impact exceeds execution policy',

    FINAL_REQUOTE_PASSED:'Final execution quote passed',
    EXECUTION_MATERIALLY_CHANGED:'Execution changed materially',
    INSUFFICIENT_USDC:'Wallet does not contain enough USDC',
    TRANSACTION_SIMULATION_FAILED:'Transaction simulation failed'
  };

  return labels[code] ?? code
    .toLowerCase()
    .replaceAll('_',' ')
    .replace(/^./,c=>c.toUpperCase());
};

function addReasonChips(container,codes=[]){
  const wrap=document.createElement('div');
  wrap.className='reason-chips';

  for(const code of codes.slice(0,4)){
    const chip=document.createElement('span');
    chip.className='reason-chip';
    chip.textContent=reasonLabel(code);
    wrap.append(chip);
  }

  if(codes.length>4){
    const more=document.createElement('span');
    more.className='reason-more';
    more.textContent=`+${codes.length-4} more`;
    wrap.append(more);
  }

  container.append(wrap);
}
async function api(path,body){const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json','X-Stocklana-Token':csrf},body:JSON.stringify(body)}:{});const b=await r.json();if(!r.ok)throw Error(b.error?.code??'REQUEST_FAILED');return b;}
function mode(){const replay=$('mode').value==='REPLAY';$('capture-label').hidden=!replay;$('amount').disabled=replay;$('mode-label').className=replay?'replay':'';$('mode-label').textContent=replay?'REPLAY  /  Historical evidence. Execution is disabled.':'LIVE  /  Current providers. No fallback to replay.';if(replay){const c=catalog.find(c=>c.id===$('capture').value);if(c)$('amount').value=String(Number(c.amountRaw)/1e6);}current=null;$('prepare').disabled=true;$('analysis').hidden=true;$('execution').hidden=true;$('status').textContent='IDLE';generation++;}
function eligibility(){const ready=current?.state==='STRICT_WINNER'&&current.decision?.executionReadiness.preparationAvailable;const wallet=$('wallet').value.trim();$('prepare').disabled=!ready||!wallet;$('prepare-help').textContent=!ready?(current?.execution?'Preparation ended with '+current.state+'. Run a new analysis before retrying.':current?.state==='REQUOTING'?'Preparation is in progress.':'A live strict winner is required.'):!wallet?'Enter a public wallet address to prepare.':'Preparation obtains a fresh comparison and wallet-bound quote before inspection and simulation.';}
function render(j){current=j;$('status').textContent=j.state;$('history').textContent=JSON.stringify(j.events,null,2);$('error').textContent=j.error?.code??'';
 if(j.decision){const d=j.decision;$('analysis').hidden=false;$('winner').textContent=d.winner?'Strict winner: '+d.winner:'No verified representation  -  preparation unavailable.';$('session').textContent='Underlying market: '+d.marketState+'  /  '+d.executionClassification;$('reference').textContent='Reference: '+d.reference?.classification+'  /  '+(d.reference?.isCurrentFairValue?'Current reference':'Economic anchor only; not current fair value')+'  /  age at analysis: '+(d.reference?.ageMs==null?'unknown':Math.round(d.reference.ageMs/1000)+' seconds');$('asof').textContent=(j.intent.mode==='REPLAY'?'Historical capture: ':'Live analysis captured: ')+stamp(d.asOfMs);$('readiness').textContent=j.state==='STRICT_WINNER'&&d.executionReadiness.preparationAvailable?'Strict decision passed. Wallet-bound preparation is available; this is not an executed trade.':'Preparation status: '+j.state+'. No trade has been executed.';
 $('candidates').replaceChildren();

for(const c of d.candidates){
  const tr=document.createElement('tr');

  const isWinner=d.winner===c.symbol;
  tr.className=[
    'candidate-row',
    c.eligible?'candidate-verified':'candidate-excluded',
    isWinner?'candidate-winner':''
  ].filter(Boolean).join(' ');

  const identity=document.createElement('td');

  const identityTop=document.createElement('div');
  identityTop.className='candidate-identity';

  const symbol=document.createElement('strong');
  symbol.className='candidate-symbol';
  symbol.textContent=c.symbol;

  const issuer=document.createElement('span');
  issuer.className='candidate-issuer';
  issuer.textContent=c.issuer;

  identityTop.append(symbol,issuer);

  if(isWinner){
    const winnerBadge=document.createElement('span');
    winnerBadge.className='candidate-badge winner-badge';
    winnerBadge.textContent='FULCRUM PICK';
    identityTop.append(winnerBadge);
  }

  const mint=document.createElement('code');
  mint.className='candidate-mint';
  mint.textContent=c.mint;

  identity.append(identityTop,mint);

  const verification=document.createElement('td');

  const verificationBadge=document.createElement('span');
  verificationBadge.className=
    'candidate-badge '+(c.eligible?'verified-badge':'excluded-badge');
  verificationBadge.textContent=
    c.eligible?'VERIFIED':'EXCLUDED';

  const verificationCopy=document.createElement('p');
  verificationCopy.className='candidate-copy';
  verificationCopy.textContent=c.eligible
    ? 'Passed every mandatory representation gate.'
    : 'Failed one or more mandatory representation gates.';

  verification.append(verificationBadge,verificationCopy);

  const output=document.createElement('td');

  const outputValue=document.createElement('strong');
  outputValue.className='metric-value';
  outputValue.textContent=c.minimumOutputRaw??'Unavailable';

  const outputLabel=document.createElement('span');
  outputLabel.className='metric-label';
  outputLabel.textContent='raw token units';

  output.append(outputValue,outputLabel);

  const exposure=document.createElement('td');

  const exposureValue=document.createElement('strong');
  exposureValue.className='metric-value exposure-value';
  exposureValue.textContent=c.economicExposure?.minimumShares??'Unavailable';

  const exposureLabel=document.createElement('span');
  exposureLabel.className='metric-label';
  exposureLabel.textContent='minimum TSLA exposure';

  exposure.append(exposureValue,exposureLabel);

  const evidence=document.createElement('td');

  const evidenceHeadline=document.createElement('strong');
  evidenceHeadline.className='evidence-headline';
  evidenceHeadline.textContent=c.eligible
    ? (isWinner?'Selected after mandatory verification':'Eligible for economic ranking')
    : 'Not eligible for ranking';

  evidence.append(evidenceHeadline);
  addReasonChips(evidence,c.reasonCodes);

  const detail=document.createElement('details');
  detail.className='candidate-details';

  const summary=document.createElement('summary');
  summary.textContent='Inspect raw gate evidence';

  const pre=document.createElement('pre');
  pre.textContent=JSON.stringify({
    symbol:c.symbol,
    issuer:c.issuer,
    mint:c.mint,
    identityVerified:c.identityVerified,
    quoteStartedAt:stamp(c.quote?.startedAt),
    quoteReceivedAt:stamp(c.quote?.receivedAt),
    minimumOutputUnit:'raw token units',
    economicExposure:c.economicExposure,
    reasonCodes:c.reasonCodes,
    gates:c.gates
  },null,2);

  detail.append(summary,pre);
  evidence.append(detail);

  tr.append(identity,verification,output,exposure,evidence);
  $('candidates').append(tr);
}
 $('decision-details').textContent=JSON.stringify({reasonCodes:d.reasonCodes,exclusions:d.exclusions,comparisonGates:d.comparisonGates},null,2);$('provenance').textContent=JSON.stringify({mode:d.mode,replay:j.replay,collectionTiming:j.collectionTiming,references:d.references,reference:d.reference,evidence:d.evidence},null,2);
 }
 if(j.execution){const e=j.execution;$('execution').hidden=false;$('execution-state').textContent=j.state+'  /  '+e.reasonCodes.join(', ');$('material').textContent=e.materialChange?'Final requote: '+e.materialChange.reasonCodes.join(', ')+'  /  degradation '+e.materialChange.degradationBps+' bps  /  protected minimum '+e.materialChange.finalMinimumOutput+' raw units':'Final requote has not passed.';$('funds').textContent=e.preBalances?'Source USDC balance: '+e.preBalances.input+' raw units  /  SOL: '+e.preBalances.solLamports+' lamports. No funds were spent.':'Balances not reached.';$('execution-details').textContent=JSON.stringify(e,null,2);}
 eligibility();}
async function poll(j,g){if(g!==generation)return;render(j);while(!terminal.has(j.state)){await new Promise(r=>setTimeout(r,700));if(g!==generation)return;j=await api('/api/jobs/'+j.id);if(g!==generation)return;render(j);}}
$('intent').addEventListener('submit',async event=>{event.preventDefault();const g=++generation;current=null;$('error').textContent='';$('analysis').hidden=true;$('execution').hidden=true;$('prepare').disabled=true;$('analyze').disabled=true;$('status').textContent='RESOLVING';try{const j=await api('/api/analyses',{underlying:'TSLA',amount:$('amount').value,mode:$('mode').value,...($('mode').value==='REPLAY'?{captureId:$('capture').value}:{})});if(g===generation)await poll(j,g);}catch(e){$('error').textContent=e.message;$('status').textContent='FAILED';}finally{$('analyze').disabled=false;}});
$('prepare').addEventListener('click',async()=>{const g=++generation;$('prepare').disabled=true;$('error').textContent='';try{await poll(await api('/api/jobs/'+current.id+'/prepare',{wallet:$('wallet').value.trim()}),g);}catch(e){$('error').textContent=e.message;eligibility();}});
$('mode').addEventListener('change',mode);$('capture').addEventListener('change',mode);$('wallet').addEventListener('input',eligibility);$('amount').addEventListener('input',()=>{generation++;current=null;$('analysis').hidden=true;$('execution').hidden=true;$('status').textContent='IDLE';eligibility();});
try{const b=await api('/api/bootstrap');csrf=b.csrfToken;catalog=b.captures;for(const c of catalog){const option=document.createElement('option');option.value=c.id;option.textContent=c.label+'  /  '+stamp(c.asOfMs);$('capture').append(option);}}catch(e){$('error').textContent=e.message;$('analyze').disabled=true;}

