// Narrow issuer-backed canonical registry, NOT symbol-search trust.
// Addresses verified against issuer responses on 2026-09-12; live collection rechecks them.
export const USDC='EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
export const TOKEN_2022='TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
export const ASSETS=Object.freeze([
  Object.freeze({underlying:'NVDA',underlyingIsin:'US67066G1040',symbol:'NVDAx',issuer:'xStocks',mint:'Xsc9qvGR1efVDFGLrVsmkzv3qi45LTBjeUKSPmx9qEh',decimals:8,source:'https://api.xstocks.fi/api/v2/public/assets/NVDAx'}),
  Object.freeze({underlying:'NVDA',underlyingIsin:'US67066G1040',symbol:'NVDAon',issuer:'Ondo',mint:'gEGtLTPNQ7jcg25zTetkbmF7teoDLcrfTnQfmn2ondo',decimals:9,source:'https://app.ondo.finance/assets/NVDAon'})
]);
export const FEEDS=Object.freeze({
  NVDA:'b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593',
  USDC:'eaa020c61cc479712813461ce153894a96a6c00b21ed0cfc2798d1f9a9e9c94a'});
export function resolve(underlying){
  if(['TSLA','TESLA'].includes(underlying.toUpperCase()))return TESLA_ASSETS.map(a=>({...a}));
  if(!['NVDA','NVIDIA'].includes(underlying.toUpperCase())) throw Error('UNSUPPORTED_UNDERLYING');
  return ASSETS.map(a=>({...a}));
}

// Official issuer identities rechecked at collection time; Tesla is the requested validation underlying.
export const TESLA_ASSETS=Object.freeze([
 Object.freeze({underlying:'TSLA',underlyingIsin:'US88160R1014',symbol:'TSLAx',issuer:'xStocks',mint:'XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB',decimals:8,source:'https://api.xstocks.fi/api/v2/public/assets/TSLAx'}),
 Object.freeze({underlying:'TSLA',underlyingIsin:'US88160R1014',symbol:'TSLAon',issuer:'Ondo',mint:'KeGv7bsfR4MheC1CkmnAVceoApjrkvBhHYjWb67ondo',decimals:9,source:'https://app.ondo.finance/assets/TSLAon'})
]);
export const TSLA_FEED='16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1';
