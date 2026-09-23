import {EXECUTION_POLICY as P,ensure} from '../execution/policy.mjs';
import {strictAsset,materialGuard} from './execution-guard.mjs';
import {canonical} from '../engine.mjs';
import {rational,decimal,mul,cmp} from '../math.mjs';

export const AUTHORIZATION_POLICY=Object.freeze({id:'WALLET_REVALIDATION_V1',maxApprovalAgeMs:120000});
export function approvalWindow(r,now){
 ensure(canonical(r.authorization?.policy)===canonical(AUTHORIZATION_POLICY),'AUTHORIZATION_POLICY_MISMATCH');
 ensure(r.authorization.expiresAt===r.finalQuote.startedAt+AUTHORIZATION_POLICY.maxApprovalAgeMs,'AUTHORIZATION_DEADLINE_MISMATCH');
 ensure(now>=r.finalQuote.startedAt&&now<=r.authorization.expiresAt,'AUTHORIZATION_EXPIRED_REBUILD_REQUIRED');
}
export function revalidationGuard(r,comparison,quote,now){
 approvalWindow(r,now);
 const guard=materialGuard(r.analysis,comparison,quote,now);
 const {asset}=strictAsset(r.analysis),fresh=strictAsset(comparison);
 const minimum=BigInt(r.materialChange.finalMinimumOutput);
 // A new quote never replaces the signed message or its promised floor.
 for(const floor of [guard.finalMinimumOutput,guard.comparisonMinimumOutput]){
  const current=BigInt(floor);
  ensure(minimum*10000n>=current*BigInt(10000-P.maxDegradationBps),'SIGNED_MINIMUM_MATERIALLY_WORSE_REBUILD_REQUIRED');
  ensure(current*10000n>=minimum*BigInt(10000-P.maxDegradationBps),'EXECUTION_MATERIALLY_CHANGED');
 }
 const exposure=mul(rational(minimum,10n**BigInt(asset.decimals)),decimal(fresh.candidate.metadata.sharesPerToken));
 for(const rival of fresh.result.candidates.filter(c=>c.eligible&&c.symbol!==asset.symbol)){
  const order=cmp(rational(rival.normalized.minimumSharesExact.numerator,rival.normalized.minimumSharesExact.denominator),exposure);
  ensure(order<0||(order===0&&asset.mint<rival.mint),'WINNING_REPRESENTATION_CHANGED');
 }
 return {...guard,signedMinimumOutput:String(minimum)};
}
