// Allowlisted decision fields only: no wallets, URLs or raw provider data.
export function denialReasons(analysis){
  return [...new Set(analysis.result.candidates.flatMap(row=>row.gates
    .filter(g=>g.mandatory&&g.outcome!=='PASS')
    .flatMap(g=>g.reasonCodes??[])))].filter(code=>typeof code==='string'&&/^[A-Z][A-Z0-9_]{1,90}$/.test(code));
}
export function requireWinner(analysis){
  if(analysis.result.status==='WINNER'&&analysis.result.winner)return;
  const e=Error('NO_STRICT_WINNER');e.code='NO_STRICT_WINNER';
  e.denialReasonCodes=denialReasons(analysis);throw e;
}
export function logFreshAnalysis(tag,analysis){
  console.info(tag,JSON.stringify({
    snapshotSha256:analysis.snapshotSha256,
    asOfMs:analysis.snapshot.asOfMs,
    status:analysis.result.status,
    winner:analysis.result.winner,
    reasonCodes:analysis.result.reasonCodes,
    candidates:analysis.result.candidates.map(row=>({
      symbol:row.symbol,
      reasonCodes:row.reasonCodes,
      quoteAgeMs:row.quoteAgeMs,
      failedMandatoryGates:row.gates
        .filter(g=>g.mandatory && g.outcome!=='PASS')
        .map(g=>({id:g.id,outcome:g.outcome,reasonCodes:g.reasonCodes}))
    }))
  }));
}
