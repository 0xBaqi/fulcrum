export const EXECUTION_POLICY=Object.freeze({
 id:'TESLA_WALLET_EXECUTION_V1',maxAnalysisAgeMs:300000,maxFinalQuoteAgeMs:15000,
 maxDegradationBps:50,maxSlippageBps:50,maxPriceImpactBps:100,
 computeUnitLimit:1400000,computeUnitPriceMicroLamports:10000,
 maxNetworkFeeLamports:100000,maxAccountRentLamports:5000000,
 confirmationTimeoutMs:60000,confirmationPollMs:1500,maxTestInputRaw:'1000000'
});
export function fail(code){const e=Error(code);e.code=code;throw e;}
export function ensure(ok,code){if(!ok)fail(code);}
