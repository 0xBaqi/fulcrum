import {usdcAmount} from '../math.mjs';
import {resolve} from '../registry.mjs';
export function intent(input){
 if(!input||typeof input!=='object'||Object.keys(input).some(k=>!['underlying','amount','mode','captureId'].includes(k)))throw Error('INVALID_INTENT');
 if(input.underlying!=='TSLA')throw Error('UNSUPPORTED_UNDERLYING');
 if(!['LIVE','REPLAY'].includes(input.mode))throw Error('INVALID_MODE');
 if(typeof input.amount!=='string')throw Error('INVALID_AMOUNT');
 const amountRaw=usdcAmount(input.amount);
 if(input.mode==='REPLAY'&&typeof input.captureId!=='string')throw Error('CAPTURE_REQUIRED');
 return {underlying:'TSLA',name:'Tesla',inputAsset:'USDC',amount:input.amount,amountRaw,mode:input.mode,captureId:input.mode==='REPLAY'?input.captureId:null};
}
export const candidates=()=>resolve('TSLA');
