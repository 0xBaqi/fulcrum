import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

import {appService} from '../src/app/service.mjs';

import {
  pythProReferenceRequest,
  pythProReferenceFromEvidence
} from '../src/app/pyth-pro-reference.mjs';

function usdcDisplay(amountRaw) {
  const raw = BigInt(amountRaw);
  const whole = raw / 1_000_000n;
  const fraction = raw % 1_000_000n;

  if (fraction === 0n) {
    return whole.toString();
  }

  return `${whole}.${fraction
    .toString()
    .padStart(6, '0')
    .replace(/0+$/, '')}`;
}

function pythSnapshot() {
  const legacyBundle = JSON.parse(
    readFileSync(
      'evidence/execution/m2a-wallet-attempt4-2026-09-13.json.analysis.json',
      'utf8'
    )
  );

  const snapshot = structuredClone(legacyBundle.snapshot);

  // The injected collector represents the LIVE collector boundary in this test.
  snapshot.mode = 'live';

  const request = pythProReferenceRequest('TSLA');

  const feedUpdateTimestamp =
    (snapshot.asOfMs - 1000) * 1000;

  const responseText = JSON.stringify({
    parsed: {
      timestampUs: String(feedUpdateTimestamp),
      priceFeeds: [{
        priceFeedId: 1435,
        price: '36900000',
        bestBidPrice: '36899000',
        bestAskPrice: '36901000',
        publisherCount: 11,
        exponent: -5,
        confidence: 1000,
        marketSession: 'regular',
        feedUpdateTimestamp
      }]
    }
  });

  const evidence = {
    id: request.id,
    source: request.url,
    startedAt: snapshot.asOfMs - 1100,
    receivedAt: snapshot.asOfMs - 900,
    status: 200,
    request: request.body,
    responseText,
    responseSha256: createHash('sha256')
      .update(responseText)
      .digest('hex'),
    responseRedacted: false
  };

  snapshot.references.TSLA =
    pythProReferenceFromEvidence(evidence, 'TSLA');

  snapshot.evidence = [
    ...snapshot.evidence.filter(
      row =>
        row.id !== 'reference-pyth-TSLA' &&
        row.id !== evidence.id
    ),
    evidence
  ];

  return snapshot;
}

test(
  'LIVE app service accepts Pyth Pro through the normal decision path',
  async () => {
    const snapshot = pythSnapshot();

    let collectorCalls = 0;
    const persisted = [];

    const service = appService({
      collector: async () => {
        collectorCalls += 1;
        return structuredClone(snapshot);
      },

      env: {
        PYTH_API_KEY: 'test-only-key'
      },

      clock: () => snapshot.asOfMs,

      sleep: async () => {},

      persist: async (id, kind, data) => {
        persisted.push({id, kind, data});
      }
    });

    const started = service.start({
      underlying: 'TSLA',
      amount: usdcDisplay(snapshot.order.amountRaw),
      mode: 'LIVE'
    });

    const completed = await service.settled(started.id);

    assert.equal(collectorCalls, 1);

assert.equal(
  completed.state,
  'NO_VERIFIED_REPRESENTATION'
);

assert.equal(
  completed.decision.reference.provider,
  'pyth-pro'
);

console.log(
  'REFERENCE:',
  JSON.stringify(completed.decision.reference, null, 2)
);

console.log(
  'TSLAX GATES:',
  JSON.stringify(
    completed.decision.candidates.find(
      candidate => candidate.symbol === 'TSLAx'
    )?.gates,
    null,
    2
  )
);

assert.equal(
  completed.decision.reference.qualified,
  false
);

assert.ok(
  completed.decision.candidates
    .find(candidate => candidate.symbol === 'TSLAx')
    .reasonCodes
    .includes('LAST_MARKET_REFERENCE_NOT_LATEST_SESSION')
);

assert.ok(
  completed.decision.reasonCodes.includes(
    'NO_VERIFIED_REPRESENTATION'
  )
);

const analysis = persisted.find(
  row => row.kind === 'analysis'
);

assert.ok(analysis);

assert.equal(
  analysis.data.snapshot.references.TSLA.provider,
  'pyth-pro'
);

assert.equal(
  analysis.data.result.reference.provider,
  'pyth-pro'
);

assert.equal(
  analysis.data.result.reference.qualified,
  false
);

assert.equal(
  analysis.data.result.status,
  'NO_WINNER'
);

assert.equal(
  analysis.data.result.reference.provider,
  'pyth-pro'
);
});