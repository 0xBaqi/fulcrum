import {FEEDS} from './registry.mjs';
import {parsePyth} from './providers.mjs';
export const HERMES='https://pyth.dourolabs.app/hermes';
// Server-only credentials never enter snapshots.
export async function fetchPyth(http,env=process.env){
  const credential=env.PYTH_API_KEY?.trim();
  const base=(env.PYTH_HERMES_URL||HERMES).replace(/\/$/,'');
  if(base!==HERMES)throw Object.assign(Error('PYTH_ENDPOINT_NOT_APPROVED'),{code:'PYTH_ENDPOINT_NOT_APPROVED'});
  const params=new URLSearchParams();for(const id of Object.values(FEEDS))params.append('ids[]','0x'+id);
  try{
    const response=await http.get('pyth-latest',base+'/v2/updates/price/latest?'+params,{headers:credential?{Authorization:'Bearer '+credential}:{}});
    const refs=parsePyth(response.data);
    for(const ref of Object.values(refs))ref.observedAt=response.receivedAt;
    return refs;
  }catch(e){
    const response=http.evidence?.findLast(x=>x.id==='pyth-latest');
    const notEntitled=response?.status===403&&/^Not entitled: feed [0-9a-f]{64}/i.test(response.responseText??'');
    const code=e.code==='ACCESS_DENIED'?(credential?(notEntitled?'PYTH_FEED_NOT_ENTITLED':'PYTH_CREDENTIAL_REJECTED'):'PYTH_CREDENTIAL_MISSING'):e.code==='RATE_LIMITED'?'PYTH_RATE_LIMITED':e.message;
    throw Object.assign(Error(code),{code,evidenceId:'pyth-latest'});
  }
}
