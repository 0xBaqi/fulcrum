const $ = id => document.getElementById(id);

let csrf = '';
let adapter;
let publicKey;
let record;
let attempted = false;
let download;

async function api(path, input) {
  const res = await fetch(
    path,
    input
      ? {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'X-Fulcrum-Token': csrf
          },
          body: JSON.stringify(input)
        }
      : {}
  );

  const data = await res.json();

  if (!res.ok) {
    throw Error(data.error);
  }

  return data;
}

function status(message) {
  $('status').textContent = message;
}

function render(data) {
  attempted = data.attempted;
  record = data.receipt?.receipt;

  const r = record;

  $('prepare').disabled =
    !publicKey ||
    attempted ||
    data.busy;

  $('reconcile').disabled =
    !r?.signature ||
    data.busy;

  if (r) {
    $('review').textContent = JSON.stringify(
      {
        status: r.status,
        wallet: r.walletPublicKey,
        spendUSDC: '1.000000',

        expectedTSLAx:
          r.finalQuote?.raw?.outAmount
            ? (Number(r.finalQuote.raw.outAmount) / 1e8).toFixed(8)
            : null,

        minimumTSLAx:
          r.materialChange?.finalMinimumOutput
            ? (
                Number(r.materialChange.finalMinimumOutput) / 1e8
              ).toFixed(8)
            : null,

        route:
          r.finalQuote?.raw?.routePlan?.map(
            x => x.swapInfo.label
          ),

        networkFeeSOL:
          r.networkFeeLamports != null
            ? r.networkFeeLamports / 1e9
            : null,

        simulatedTotalSOLCost:
          r.simulatedBalances
            ? (
                r.preBalances.solLamports -
                r.simulatedBalances.solLamports
              ) / 1e9
            : null,

        approvalDeadline:
          r.authorization
            ? new Date(
                r.authorization.expiresAt
              ).toISOString()
            : null,

        lastValidBlockHeight:
          r.transaction?.blockhash?.lastValidBlockHeight,

        messageSha256:
          r.transaction?.messageSha256,

        reasons:
          r.reasonCodes,

        signature:
          r.signature,

        receivedTSLAx:
          r.actualReceivedAmount
            ? (
                Number(r.actualReceivedAmount) / 1e8
              ).toFixed(8)
            : null
      },
      null,
      2
    );

    if (download) {
      URL.revokeObjectURL(download);
    }

    download = URL.createObjectURL(
      new Blob(
        [JSON.stringify(data.receipt, null, 2)],
        {type: 'application/json'}
      )
    );

    $('receipt').href = download;
    $('receipt').download = 'fulcrum-execution.json';
    $('receipt').hidden = false;

    status(r.status);
  }

  eligibility();
}

function eligibility() {
  $('sign').disabled =
    attempted ||
    !$('authorize').checked ||
    record?.status !== 'READY_FOR_SIGNATURE' ||
    !record.authorization ||
    Date.now() > record.authorization.expiresAt;
}

async function freshPrepare(message = 'Collecting current evidence and simulating...') {
  $('prepare').disabled = true;
  $('authorize').checked = false;

  record = null;
  eligibility();

  status(message);

  const data = await api(
    '/api/prepare',
    {wallet: publicKey}
  );

  render(data);

  return data;
}

$('authorize').onchange = eligibility;

setInterval(eligibility, 250);

$('connect').onclick = async () => {
  try {
    adapter =
      $('provider').value === 'jupiter'
        ? await window.fulcrumStandardWallet('Jupiter')
        : $('provider').value === 'phantom'
          ? window.phantom?.solana
          : window.solflare;

    if (!adapter) {
      throw Error(
        'Open this page in a browser with the selected wallet installed.'
      );
    }

    await adapter.connect();

    publicKey = adapter.publicKey.toBase58();

    $('wallet').textContent = publicKey;
    $('prepare').disabled = attempted;

    status('Wallet connected.');
  } catch (e) {
    status(e.message);
  }
};

$('prepare').onclick = async () => {
  try {
    await freshPrepare();
  } catch (e) {
    status(e.message);
    $('prepare').disabled = attempted;
  }
};

$('sign').onclick = async () => {
  try {
    if (
      !$('authorize').checked ||
      attempted ||
      record?.status !== 'READY_FOR_SIGNATURE'
    ) {
      throw Error(
        'Explicit authorization and a fresh simulation are required.'
      );
    }

    if (
      adapter.publicKey.toBase58() !==
      record.walletPublicKey
    ) {
      throw Error(
        'Wallet changed. Prepare again.'
      );
    }

    const reviewed = record;

    /*
     * Do NOT consume the browser session merely because the wallet
     * prompt was opened. The server decides whether an execution
     * attempt has actually been consumed.
     */
    $('sign').disabled = true;
    $('prepare').disabled = true;

    status('Review and approve in your wallet...');

    const tx =
      solanaWeb3.VersionedTransaction.deserialize(
        Uint8Array.from(
          atob(reviewed.transaction.unsignedBase64),
          c => c.charCodeAt(0)
        )
      );

    const signed =
      await adapter.signTransaction(tx);

    if (
      adapter.publicKey.toBase58() !==
      reviewed.walletPublicKey
    ) {
      throw Error('Wallet changed.');
    }

    status(
      'Verifying signature, simulating and submitting...'
    );

    const result = await api(
      '/api/submit',
      {
        signedTransaction:
          btoa(
            String.fromCharCode(
              ...signed.serialize()
            )
          ),

        messageSha256:
          reviewed.transaction.messageSha256,

        authorizeBroadcast: true
      }
    );

    render(result);

    const reasons =
      result.receipt?.receipt?.reasonCodes ?? [];

    /*
     * The signed transaction was never broadcast if Fulcrum reports
     * this condition without a transaction signature.
     *
     * Obtain a completely fresh quote/blockhash/simulation.
     * The replacement transaction is NOT signed automatically.
     * The user must review and explicitly authorize it again.
     */
    if (
      reasons.includes(
        'BLOCKHASH_EXPIRED_REBUILD_REQUIRED'
      ) &&
      !result.receipt?.receipt?.signature &&
      !result.attempted
    ) {
      await freshPrepare(
        'Previous transaction expired before broadcast. Rebuilding and simulating a fresh transaction...'
      );

      status(
        'Transaction refreshed. Review the new minimum and authorize again.'
      );
    }
  } catch (e) {
    const message = e.message;

    try {
      const state =
        await api('/api/session');

      render(state);

      /*
       * A rejected wallet signature or ordinary request error must
       * never trigger an automatic trade.
       */
      status(message);
    } catch {
      status(
        'Connection uncertain. Reload and check the receipt before trying again.'
      );
    }
  }
};

$('reconcile').onclick = async () => {
  try {
    render(
      await api(
        '/api/reconcile',
        {}
      )
    );
  } catch (e) {
    status(e.message);
  }
};

api('/api/session')
  .then(data => {
    csrf = data.csrfToken;
    render(data);
  })
  .catch(e => status(e.message));