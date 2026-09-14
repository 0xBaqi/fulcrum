import {resolve} from './registry.mjs';
import {evaluateV2} from './engine-v2.mjs';
import {referenceReasons,referenceProof} from './references.mjs';
export function evaluateV3(snapshot){
 if(snapshot.schemaVersion!==3)throw Error('INVALID_SNAPSHOT_VERSION');
 const assets=resolve(snapshot.order?.underlying),underlying=assets[0].underlying;
 if(snapshot.order.underlying!==underlying)throw Error('INVALID_ORDER');
 const sources={
  'xstocks-asset':assets[0].source,'xstocks-multiplier':assets[0].source+'/multiplier?network=Solana',
  'ondo-page':assets[1].source,'ondo-addresses':`https://api.gm.ondo.finance/v1/assets/${assets[1].symbol}/addresses`,
  'ondo-market':`https://api.gm.ondo.finance/v1/assets/${assets[1].symbol}/market`,
  ...Object.fromEntries(assets.map(a=>['quote-'+a.symbol,'https://api.jup.ag/swap/v2/order']))
 };
 return evaluateV2({...snapshot,schemaVersion:2},{assets,underlying,sources,referenceReasons,referenceProof,originalSnapshot:snapshot,engineVersion:'0.1.2',
  objective:`Maximize slippage-protected ${underlying}-equivalent shares for equal USDC input; excludes wallet-dependent network fees.`});
}
