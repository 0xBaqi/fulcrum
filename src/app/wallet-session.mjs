import {collectWithPythPro,bundleSnapshotWithPythPro} from './live.mjs';
import {settledCollector} from './collection.mjs';
import {executionPipelineWithPythPro} from './execution-pipeline.mjs';
import {sealReceipt} from './execution-receipt.mjs';
import {ensure} from '../execution/policy.mjs';
import {PublicKey} from '@solana/web3.js';

// One broadcast-capable trade per local session.
// A preparation that never produced a transaction signature may be rebuilt.
export function walletSession({
  env=process.env,
  collector=collectWithPythPro,
  executor=executionPipelineWithPythPro,
  persist,
  clock=Date.now
}={}) {
  let busy=false;
  let attempted=false;
  let receipt=null;
  let pipeline=null;

  // Waiting for real time does not relax any evidence freshness check.
  const collect=settledCollector(collector,{
    clock,
    maxWaitMs:5000
  });

  function view(){
    return {
      busy,
      attempted,
      receipt:receipt ? sealReceipt(receipt) : null
    };
  }

  function validateWallet(wallet){
    const key=new PublicKey(wallet);

    ensure(
      key.toBase58()===wallet &&
      PublicKey.isOnCurve(key.toBytes()),
      'INVALID_WALLET_PUBLIC_KEY'
    );
  }

  async function freshPreparation(wallet){
    const analysis=bundleSnapshotWithPythPro(
      await collect({
        underlying:'TSLA',
        amountRaw:'1000000',
        env,
        clock
      })
    );

    ensure(
      analysis.result.status==='WINNER',
      'NO_STRICT_WINNER'
    );

    pipeline=executor({
      env,
      clock,
      collector:collect,
      persist,
      allowBroadcast:true
    });

    receipt=await pipeline.prepare(analysis,wallet);

    ensure(
      receipt.inputAmount==='1000000',
      'INPUT_AMOUNT_MISMATCH'
    );

    return receipt;
  }

  async function prepare(wallet){
    ensure(
      !busy && !attempted,
      'SESSION_ALREADY_ACTIVE_OR_SUBMITTED'
    );

    validateWallet(wallet);

    busy=true;
    receipt=null;

    try{
      await freshPreparation(wallet);

      return {
        ...view(),
        busy:false
      };
    }finally{
      busy=false;
    }
  }

  async function submit({
    signedTransaction,
    messageSha256,
    authorizeBroadcast
  }={}) {
    ensure(
      authorizeBroadcast===true,
      'BROADCAST_NOT_AUTHORIZED'
    );

    ensure(
      !busy &&
      !attempted &&
      receipt?.status==='READY_FOR_SIGNATURE',
      'SESSION_NOT_READY'
    );

    ensure(
      messageSha256===receipt.transaction.messageSha256,
      'TRANSACTION_REVIEW_CHANGED'
    );

    ensure(
      typeof signedTransaction==='string' &&
      signedTransaction.length<=2048 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(signedTransaction),
      'INVALID_SIGNED_TRANSACTION'
    );

    busy=true;

    try{
      await pipeline.submit(receipt,{
        authorizeBroadcast:true,
        signTransaction:async()=>signedTransaction
      });

      /*
       * Only consume the session once Fulcrum has a transaction signature.
       *
       * If the reviewed transaction expired before broadcast, pipeline.submit()
       * deliberately clears receipt.signature. That means no transaction was
       * broadcast and a fresh preparation is safe.
       */
      attempted=Boolean(receipt.signature);

      return {
        ...view(),
        busy:false
      };
    }finally{
      busy=false;
    }
  }

  async function reconcile(){
    ensure(
      !busy && receipt?.signature,
      'NO_TRANSACTION_TO_RECONCILE'
    );

    busy=true;

    try{
      await pipeline.reconcile(receipt);

      return {
        ...view(),
        busy:false
      };
    }finally{
      busy=false;
    }
  }

  return {
    prepare,
    submit,
    reconcile,
    view
  };
}