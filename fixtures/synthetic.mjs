import {ASSETS,USDC,FEEDS} from '../src/registry.mjs';
import {POLICY} from '../src/engine.mjs';
// Deliberately synthetic: larger nominal token output loses after multiplier normalization.
export function synthetic(){
  const now=1789236000000;
  return {schemaVersion:1,mode:'synthetic',asOfMs:now,policy:{...POLICY},order:{underlying:'NVDA',inputMint:USDC,amountRaw:'100000000'},references:{
    NVDA:{symbol:'Equity.US.NVDA/USD',feedId:FEEDS.NVDA,price:'200',confidence:'0.01',publishedAt:now-1000},
    USDC:{symbol:'Crypto.USDC/USD',feedId:FEEDS.USDC,price:'1',confidence:'0.0001',publishedAt:now-1000}
  },candidates:ASSETS.map((a,i)=>({symbol:a.symbol,mint:a.mint,metadata:{underlying:'NVDA',mint:a.mint,decimals:a.decimals,identityVerified:true,chainVerified:true,sharesPerToken:i?'1.02':'1',observedAt:now-1000,timestampQuality:'issuer-or-chain',halted:false,actionTimes:[],source:'synthetic'},quote:{startedAt:now-400,receivedAt:now-100,raw:{inputMint:USDC,outputMint:a.mint,inAmount:'100000000',outAmount:i?'493000000':'50000000',otherAmountThreshold:i?'490535000':'49750000',swapMode:'ExactIn',slippageBps:50,priceImpactPct:'0.001',routePlan:[{percent:100,swapInfo:{ammKey:'synthetic-pool',inputMint:USDC,outputMint:a.mint}}],requestId:'synthetic-'+a.symbol,swapType:'aggregator',router:'synthetic',transaction:null}}})),warnings:[],evidence:[]};
}
