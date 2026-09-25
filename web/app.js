const $=id=>document.getElementById(id);

let csrf='';
let current=null;
let generation=0;
let catalog=[];

let walletAdapter=null;
let walletPublicKey=null;
let walletRecord=null;
let walletAttempted=false;
let receiptDownload=null;

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
async function api(path,body){const r=await fetch(path,body?{method:'POST',headers:{'Content-Type':'application/json','X-Stocklana-Token':csrf},body:JSON.stringify(body)}:{});const b=await r.json();if(!r.ok)throw Error(b.error?.code??b.error??'REQUEST_FAILED');return b;}
function mode(){const replay=$('mode').value==='REPLAY';$('capture-label').hidden=!replay;$('amount').disabled=replay;$('mode-label').className=replay?'replay':'';$('mode-label').textContent=replay?'REPLAY  /  Historical evidence. Execution is disabled.':'LIVE  /  Current providers. No fallback to replay.';if(replay){const c=catalog.find(c=>c.id===$('capture').value);if(c)$('amount').value=String(Number(c.amountRaw)/1e6);}current=null;$('prepare').disabled=true;$('analysis').hidden=true;$('execution').hidden=true;$('status').textContent='IDLE';generation++;}
function eligibility(){
  const live=$('mode').value==='LIVE';

  const decisionReady=
    current?.state==='STRICT_WINNER' &&
    current.decision?.executionReadiness.preparationAvailable;

  const connected=Boolean(walletPublicKey);
  const amountReady=Number($('amount').value)===1;

  $('prepare').disabled=
    !live ||
    !decisionReady ||
    !connected ||
    !amountReady ||
    walletAttempted;

  if(!live){
    $('prepare-help').textContent=
      'Replay mode is evidence-only. Execution is disabled.';
  }else if(!decisionReady){
    $('prepare-help').textContent=
      current?.state==='REQUOTING'
        ? 'Preparation is in progress.'
        : 'A live strict winner is required.';
  }else if(!connected){
    $('prepare-help').textContent=
      'Connect a Solana wallet to continue.';
  }else if(!amountReady){
    $('prepare-help').textContent=
      'Wallet execution is fixed to 1 USDC for this hackathon build. Set order size to 1 USDC and rerun the live check.';
  }else if(walletAttempted){
    $('prepare-help').textContent=
      'This execution session has already submitted a transaction.';
  }else{
    $('prepare-help').textContent=
      'Ready for a fresh wallet-bound quote, inspection and simulation.';
  }
}

function render(j){
  current=j;
  $('status').textContent=j.state;
  $('history').textContent=JSON.stringify(j.events??[],null,2);
  $('error').textContent=j.error?.code??'';
  const historySummary=$('history-summary');
if(historySummary){
  historySummary.replaceChildren();

  const label=document.createElement('span');
  label.className='audit-summary-label';
  label.textContent='Flow';

  const value=document.createElement('strong');

  const stateLabels={
    IDLE:'Idle',
    RESOLVING:'Resolving',
    QUOTING:'Quoting',
    VALIDATING:'Validating',
    STRICT_WINNER:'Strict winner',
    NO_VERIFIED_REPRESENTATION:'No verified representation',
    READY_FOR_EXECUTION:'Ready for execution',
    REQUOTING:'Requoting',
    EXECUTION_CHANGED:'Execution changed',
    READY_FOR_SIGNATURE:'Ready for signature',
    SIMULATION_BLOCKED:'Simulation blocked',
    SUBMITTED:'Submitted',
    CONFIRMED:'Confirmed',
    FAILED:'Failed'
  };

  const states=(j.events??[])
    .map(event=>event.state)
    .filter(Boolean)
    .filter((state,index,array)=>index===0||state!==array[index-1]);

  if(states.length){
    value.textContent=states
      .map(state=>stateLabels[state]??state.replaceAll('_',' ').toLowerCase())
      .join(' -> ');
  }else{
    value.textContent=stateLabels[j.state]??j.state??'No state history';
  }

  historySummary.append(label,value);
}
 if(j.decision){const d=j.decision;$('analysis').hidden=false;$('winner').textContent=d.winner?'Strict winner: '+d.winner:'No verified representation  -  preparation unavailable.';$('session').textContent='Underlying market: '+d.marketState+'  /  '+d.executionClassification;$('reference').textContent='Reference: '+d.reference?.classification+'  /  '+(d.reference?.isCurrentFairValue?'Current reference':'Economic anchor only; not current fair value')+'  /  age at analysis: '+(d.reference?.ageMs==null?'unknown':Math.round(d.reference.ageMs/1000)+' seconds');$('asof').textContent=(j.intent.mode==='REPLAY'?'Historical capture: ':'Live analysis captured: ')+stamp(d.asOfMs);$('readiness').textContent=j.state==='STRICT_WINNER'&&d.executionReadiness.preparationAvailable?'Strict decision passed. Wallet-bound preparation is available; this is not an executed trade.':'Preparation status: '+j.state+'. No trade has been executed.';
 const decisionPanel=$('fulcrum-decision');
const decisionBadge=$('decision-badge');
const decisionTitle=$('decision-title');
const decisionExplanation=$('decision-explanation');
const decisionExposure=$('decision-exposure');
const decisionWhy=$('decision-why');
const decisionModeNote=$('decision-mode-note');

decisionPanel.hidden=false;
decisionWhy.replaceChildren();
decisionExposure.replaceChildren();

const winnerCandidate=d.candidates?.find(c=>c.symbol===d.winner);

if(d.winner && winnerCandidate){
  decisionPanel.className='fulcrum-decision decision-success';
  decisionBadge.textContent='VERIFIED';
  decisionTitle.textContent=`${winnerCandidate.symbol} / ${winnerCandidate.issuer}`;
  decisionExplanation.textContent='Selected to represent this Tesla order.';

  const value=document.createElement('strong');
  value.textContent=winnerCandidate.economicExposure?.minimumShares??'Unavailable';

  const label=document.createElement('span');
  label.textContent='minimum protected TSLA exposure';

  decisionExposure.append(value,label);

  for(const text of [
    'Identity and representation evidence passed mandatory verification.',
    'This representation survived every required integrity gate.',
    'Verification completed before economic ranking.'
  ]){
    const row=document.createElement('div');
    row.className='decision-reason decision-reason-pass';
   row.textContent=`PASS / ${text}`;
    decisionWhy.append(row);
  }
}else{
  decisionPanel.className='fulcrum-decision decision-blocked';
  decisionBadge.textContent='BLOCKED';
  decisionTitle.textContent='No verified representation';
  decisionExplanation.textContent='Fulcrum will not prepare this Tesla order.';

  const label=document.createElement('span');
  label.textContent='No execution route prepared';
  decisionExposure.append(label);

  for(const c of d.candidates??[]){
    const row=document.createElement('div');
    row.className='decision-reason decision-reason-fail';

    const firstReason=c.reasonCodes?.[0]
      ? reasonLabel(c.reasonCodes[0])
      : 'Mandatory verification failed';

    row.textContent=`FAIL / ${c.symbol}: ${firstReason}`;
    decisionWhy.append(row);
  }
}

 if($('mode').value==='REPLAY'){
  decisionModeNote.textContent='Historical replay evidence. Execution is disabled.';
  decisionModeNote.className='decision-mode-note replay-note';
}else{
  decisionModeNote.textContent='Live provider evidence. Execution requires a verified winner.';
  decisionModeNote.className='decision-mode-note live-note';
}
const decisionSummary=$('decision-summary');

if(decisionSummary){
  decisionSummary.replaceChildren();

  const label=document.createElement('span');
  label.className='audit-summary-label';
  label.textContent='Decision';

  const value=document.createElement('strong');

  if(d.winner){
    const excluded=(d.candidates??[]).filter(c=>!c.eligible).length;
    value.textContent=`${d.winner} selected / ${excluded} representation${excluded===1?'':'s'} excluded`;
  }else{
    value.textContent='No representation passed every mandatory gate';
  }

  decisionSummary.append(label,value);
}
const provenanceSummary=$('provenance-summary');

if(provenanceSummary){
  provenanceSummary.replaceChildren();

  const label=document.createElement('span');
  label.className='audit-summary-label';
  label.textContent='Reference';

  const value=document.createElement('strong');

  const referenceKind=d.reference?.classification
  ?? 'Unavailable';

  if($('mode').value==='REPLAY'){
    value.textContent=`${referenceKind} / historical replay evidence`;
  }else{
    value.textContent=`${referenceKind} / live provider evidence`;
  }

  provenanceSummary.append(label,value);
}
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
function walletStatus(message){
  $('wallet-status').textContent=message;
}

function executionAmount(raw){
  if(raw==null)return 'Unavailable';
  return (Number(raw)/1e8).toFixed(8)+' TSLAx';
}

function renderWallet(data){
  walletAttempted=Boolean(data.attempted);
  walletRecord=data.receipt?.receipt??null;

  const r=walletRecord;

  $('reconcile').disabled=
    !r?.signature ||
    Boolean(data.busy);

  if(!r){
    $('wallet-review').hidden=true;
    $('execution-success').hidden=true;
    $('execution-denied').hidden=true;
    $('receipt').hidden=true;
    eligibility();
    return;
  }

  $('execution').hidden=false;
  $('execution-badge').textContent=r.status;
  $('execution-state').textContent=
    'Execution state: '+r.status;

  $('material').textContent=
    r.materialChange
      ? 'Final requote: '+
        (r.materialChange.reasonCodes??[]).join(', ')+
        ' / protected minimum '+
        r.materialChange.finalMinimumOutput+
        ' raw units'
      : 'Final requote pending.';

  $('funds').textContent=
    r.preBalances
      ? 'USDC before execution: '+
        r.preBalances.input+
        ' raw units / SOL: '+
        r.preBalances.solLamports+
        ' lamports'
      : 'Wallet balances pending.';

  $('review-spend').textContent='1.000000 USDC';

  $('review-expected').textContent=
    executionAmount(
      r.finalQuote?.raw?.outAmount
    );

  $('review-minimum').textContent=
    executionAmount(
      r.materialChange?.finalMinimumOutput
    );

  const routes=
    r.finalQuote?.raw?.routePlan
      ?.map(x=>x.swapInfo?.label)
      .filter(Boolean)??[];

  $('review-route').textContent=
    routes.length
      ? routes.join(' -> ')
      : 'Unavailable';

  $('wallet-review').hidden=
    r.status!=='READY_FOR_SIGNATURE';

  $('sign').disabled=
    walletAttempted ||
    !$('authorize').checked ||
    r.status!=='READY_FOR_SIGNATURE' ||
    !r.authorization ||
    Date.now()>r.authorization.expiresAt;

  $('reconcile').disabled=
    !r.signature ||
    Boolean(data.busy);

  $('execution-details').textContent=
    JSON.stringify(r,null,2);

  if(receiptDownload){
    URL.revokeObjectURL(receiptDownload);
  }

  receiptDownload=URL.createObjectURL(
    new Blob(
      [JSON.stringify(data.receipt,null,2)],
      {type:'application/json'}
    )
  );

  $('receipt').href=receiptDownload;
  $('receipt').download='fulcrum-execution.json';
  $('receipt').hidden=!(
    r.status==='SUCCEEDED' ||
    r.status==='CONFIRMED'
  );

  const denied=r.status==='BLOCKED' || r.status==='SIMULATION_BLOCKED';
  $('execution-denied').hidden=!denied;

  if(denied){
    const reason=(r.reasonCodes??[])[0]??'EXECUTION_POLICY_BLOCKED';
    $('denial-reason').textContent=reasonLabel(reason);
    $('denial-explanation').textContent=
      reason==='UNSUPPORTED_EXECUTION_ROUTE'
        ? 'The current Jupiter route is outside Fulcrum\'s verified execution policy. Fulcrum stopped before wallet signature or broadcast.'
        : 'The current transaction did not satisfy Fulcrum\'s execution policy. Fulcrum stopped before wallet signature or broadcast.';
    $('execution-badge').textContent='EXECUTION DENIED';
    $('execution-state').textContent='Policy decision: execution denied.';
    $('material').textContent='No authorized execution route was produced.';
    $('funds').textContent='No signature / no broadcast / no funds spent.';
  }

  if(
    r.status==='SUCCEEDED' ||
    r.status==='CONFIRMED'
  ){
    $('wallet-review').hidden=true;
    $('execution-denied').hidden=true;
    $('execution-success').hidden=false;

    $('received-amount').textContent=
      executionAmount(r.actualReceivedAmount);

    $('execution-signature').textContent=
      r.signature??'Unavailable';

    $('execution-verification').replaceChildren();

    for(const message of [
      'Transaction confirmed on Solana.',
      'Received amount verified from balance change.',
      'Reviewed wallet authorization matched the signed transaction.'
    ]){
      const row=document.createElement('div');
      row.className='decision-reason decision-reason-pass';
     row.textContent='PASS / '+message;
      $('execution-verification').append(row);
    }
  }else{
    $('execution-success').hidden=true;
  }

  walletStatus(r.status);
  eligibility();
}

async function freshWalletPrepare(
  message='Collecting fresh evidence and simulating...'
){
  $('prepare').disabled=true;
  $('authorize').checked=false;
  walletRecord=null;

  walletStatus(message);

  const data=await api(
    '/api/wallet/prepare',
    {wallet:walletPublicKey}
  );

  renderWallet(data);
  return data;
}

function walletSignEligibility(){
  const r=walletRecord;

  $('sign').disabled=
    walletAttempted ||
    !$('authorize').checked ||
    r?.status!=='READY_FOR_SIGNATURE' ||
    !r?.authorization ||
    Date.now()>r.authorization.expiresAt;
}

async function poll(j,g){if(g!==generation)return;render(j);while(!terminal.has(j.state)){await new Promise(r=>setTimeout(r,700));if(g!==generation)return;j=await api('/api/jobs/'+j.id);if(g!==generation)return;render(j);}}
$('intent').addEventListener('submit',async event=>{event.preventDefault();const g=++generation;current=null;$('error').textContent='';$('analysis').hidden=true;$('execution').hidden=true;$('prepare').disabled=true;$('analyze').disabled=true;$('status').textContent='RESOLVING';try{const j=await api('/api/analyses',{underlying:'TSLA',amount:$('amount').value,mode:$('mode').value,...($('mode').value==='REPLAY'?{captureId:$('capture').value}:{})});if(g===generation)await poll(j,g);}catch(e){$('error').textContent=e.message;$('status').textContent='FAILED';}finally{$('analyze').disabled=false;}});
$('prepare').addEventListener('click',async()=>{
  try{
    if(!walletPublicKey){
      throw Error('Connect a wallet first.');
    }

    if(
      current?.state!=='STRICT_WINNER' ||
      !current.decision?.executionReadiness.preparationAvailable
    ){
      throw Error('A live strict winner is required.');
    }

    if(Number($('amount').value)!==1){
      throw Error('Set order size to exactly 1 USDC and rerun the live representation check.');
    }

    await freshWalletPrepare();
  }catch(e){
    walletStatus(e.message);
    eligibility();
  }
});

$('mode').addEventListener('change',mode);$('capture').addEventListener('change',mode);$('amount').addEventListener('input',()=>{generation++;current=null;$('analysis').hidden=true;$('execution').hidden=true;$('status').textContent='IDLE';eligibility();});
$('authorize').addEventListener(
  'change',
  walletSignEligibility
);

setInterval(
  walletSignEligibility,
  250
);

$('connect-wallet').addEventListener(
  'click',
  async()=>{
    try{
     const provider=$('wallet-provider').value;

if(!provider){
  throw Error('Select a wallet provider first.');
}

walletAdapter=
        provider==='jupiter'
          ? await window.fulcrumStandardWallet('Jupiter')
          : provider==='phantom'
            ? window.phantom?.solana
            : window.solflare;

      if(!walletAdapter){
        throw Error(
          'Selected wallet was not detected in this browser.'
        );
      }

      await walletAdapter.connect();

      walletPublicKey=
        walletAdapter.publicKey.toBase58();

      $('wallet').textContent=
        walletPublicKey.slice(0,6)+'...'+walletPublicKey.slice(-6);

      $('wallet').title=walletPublicKey;
      $('connect-wallet').textContent='Change wallet';
      walletStatus('Connected / '+walletPublicKey.slice(0,6)+'...'+walletPublicKey.slice(-6));
      eligibility();
    }catch(e){
      walletStatus(e.message);
    }
  }
);

$('sign').addEventListener(
  'click',
  async()=>{
    try{
      if(
        !$('authorize').checked ||
        walletAttempted ||
        walletRecord?.status!=='READY_FOR_SIGNATURE'
      ){
        throw Error(
          'Explicit authorization and a fresh simulation are required.'
        );
      }

      if(
        walletAdapter.publicKey.toBase58()!==
        walletRecord.walletPublicKey
      ){
        throw Error(
          'Wallet changed. Prepare again.'
        );
      }

      const reviewed=walletRecord;

      $('sign').disabled=true;
      $('prepare').disabled=true;

      walletStatus(
        'Review and approve in your wallet...'
      );

      const tx=
        solanaWeb3.VersionedTransaction.deserialize(
          Uint8Array.from(
            atob(
              reviewed.transaction.unsignedBase64
            ),
            c=>c.charCodeAt(0)
          )
        );

      const signed=
        await walletAdapter.signTransaction(tx);

      if(
        walletAdapter.publicKey.toBase58()!==
        reviewed.walletPublicKey
      ){
        throw Error('Wallet changed.');
      }

      walletStatus(
        'Revalidating, simulating signed transaction and submitting...'
      );

      const result=await api(
        '/api/wallet/submit',
        {
          signedTransaction:btoa(
            String.fromCharCode(
              ...signed.serialize()
            )
          ),
          messageSha256:
            reviewed.transaction.messageSha256,
          authorizeBroadcast:true
        }
      );

      renderWallet(result);

      const reasons=
        result.receipt?.receipt?.reasonCodes??[];

      if(
        reasons.includes(
          'BLOCKHASH_EXPIRED_REBUILD_REQUIRED'
        ) &&
        !result.receipt?.receipt?.signature &&
        !result.attempted
      ){
        await freshWalletPrepare(
          'Previous transaction expired before broadcast. Preparing a fresh transaction...'
        );

        walletStatus(
          'Transaction refreshed. Review and authorize the replacement transaction.'
        );
      }
    }catch(e){
      const message=e.message;

      try{
        const state=
          await api('/api/wallet/session');

        renderWallet(state);
        walletStatus(message);
      }catch{
        walletStatus(
          'Connection uncertain. Check the execution state before trying again.'
        );
      }
    }
  }
);


$('retry-route').addEventListener(
  'click',
  async()=>{
    try{
      if(!walletPublicKey)throw Error('Connect a wallet first.');
      if(walletAttempted)throw Error('This execution session has already submitted a transaction.');
      await freshWalletPrepare('Refreshing market evidence and requesting a new route...');
    }catch(e){
      walletStatus(e.message);
      eligibility();
    }
  }
);

$('reconcile').addEventListener(
  'click',
  async()=>{
    try{
      renderWallet(
        await api(
          '/api/wallet/reconcile',
          {}
        )
      );
    }catch(e){
      walletStatus(e.message);
    }
  }
);
try{
  const b=await api('/api/bootstrap');
  csrf=b.csrfToken;
  catalog=b.captures;

  for(const c of catalog){
    const option=document.createElement('option');
    option.value=c.id;
    option.textContent=c.label+'  /  '+stamp(c.asOfMs);
    $('capture').append(option);
  }
}catch(e){
  $('error').textContent=e.message;
  $('analyze').disabled=true;
}

try{
  renderWallet(
    await api('/api/wallet/session')
  );
}catch(e){
  walletStatus(e.message);
}
