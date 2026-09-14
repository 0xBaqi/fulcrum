import {evaluate as evaluateV1} from './engine-v1.mjs';
import {evaluateV2} from './engine-v2.mjs';
import {evaluateV3} from './engine-v3.mjs';
import {evaluateV4} from './engine-v4.mjs';
export {POLICY,canonical,hash} from './engine-v1.mjs';
export function evaluate(snapshot){
  if(snapshot.schemaVersion===1)return evaluateV1(snapshot);
  if(snapshot.schemaVersion===2)return evaluateV2(snapshot);
  if(snapshot.schemaVersion===3)return evaluateV3(snapshot);
  if(snapshot.schemaVersion===4)return evaluateV4(snapshot);
  throw Error('INVALID_SNAPSHOT_VERSION');
}
