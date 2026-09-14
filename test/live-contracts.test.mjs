// Offline contract checks against the actual captured issuer/RPC bodies.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {parseOndoPage,parseXstocks,verifyChain,exactJson} from '../src/providers.mjs';
const bundle=JSON.parse(readFileSync(new URL('../evidence/live-2026-09-12.json',import.meta.url),'utf8'));
const evidence=id=>bundle.snapshot.evidence.find(e=>e.id===id);
test('captured xStocks multiplier agrees with live Solana extension',()=>{
  const m=parseXstocks(JSON.parse(evidence('xstocks-asset').responseText),exactJson(evidence('xstocks-multiplier').responseText),bundle.snapshot.asOfMs);
  assert.equal(verifyChain(m,JSON.parse(evidence('solana-mints').responseText),0,bundle.snapshot.asOfMs).chainVerified,true);
});
test('captured Ondo scaled UI factor applied once with bounded float64 discrepancy',()=>{
  const m=parseOndoPage(evidence('ondo-page').responseText,bundle.snapshot.asOfMs);
  const rpc=JSON.parse(evidence('solana-mints').responseText);
  const verified=verifyChain(m,rpc,1,bundle.snapshot.asOfMs);
  assert.equal(verified.sharesPerToken,'1.0017152487959897');assert.equal(verified.issuerSharesPerToken,'1.0017152487959898');assert.equal(verified.chainVerified,true);
  m.sharesPerToken='2';assert.throws(()=>verifyChain(m,rpc,1,bundle.snapshot.asOfMs),/MULTIPLIER_CHAIN_MISMATCH/);
});
test('onchain pause and unsupported transfer hook are not ignored',()=>{
  const m=parseOndoPage(evidence('ondo-page').responseText,bundle.snapshot.asOfMs),rpc=JSON.parse(evidence('solana-mints').responseText);
  const exts=rpc.result.value[1].data.parsed.info.extensions;
  exts.find(e=>e.extension==='pausableConfig').state.paused=true;
  assert.equal(verifyChain(m,rpc,1,bundle.snapshot.asOfMs).halted,true);
  exts.find(e=>e.extension==='transferHook').state.programId='new-hook';
  assert.throws(()=>verifyChain(m,rpc,1,bundle.snapshot.asOfMs),/UNSUPPORTED_TRANSFER_EXTENSION/);
});
