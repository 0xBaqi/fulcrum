import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';

import {sessionFixture} from '../fixtures/session.mjs';
import {evaluateV4} from '../src/engine-v4.mjs';
import {evaluateV4WithPythPro} from '../src/app/engine-v4.mjs';

import {
  pythProReferenceFromEvidence,
  pythProReferenceRequest
} from '../src/app/pyth-pro-reference.mjs';

const at = value => Date.parse(value);

function installPythProTsla(snapshot) {
  const request = pythProReferenceRequest('TSLA');

  // Keep the observation one second behind the decision.
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

  snapshot.evidence = snapshot.evidence.filter(
    item => item.id !== 'reference-pyth-TSLA'
  );

  snapshot.evidence.push(evidence);

  return snapshot;
}

test('app V4 preserves frozen V4 behavior for legacy references', () => {
  const times = [
    '2026-09-11T14:00:00Z',
    '2026-09-11T20:15:00Z',
    '2026-09-12T01:00:00Z',
    '2026-09-12T16:00:00Z',
    '2026-09-13T16:00:00Z'
  ];

  for (const time of times) {
    const snapshot = sessionFixture(at(time));

    assert.deepEqual(
      evaluateV4WithPythPro(structuredClone(snapshot)),
      evaluateV4(structuredClone(snapshot)),
      time
    );
  }
});

test('Pyth Pro TSLA evidence reaches the V4 decision engine', () => {
  const snapshot = installPythProTsla(
    sessionFixture(at('2026-09-11T14:00:00Z'))
  );

  const result = evaluateV4WithPythPro(snapshot);

  assert.equal(result.marketState, 'UNDERLYING_OPEN');
  assert.equal(
    result.reference.classification,
    'LIVE_MARKET_REFERENCE'
  );

  assert.equal(result.reference.provider, 'pyth-pro');
  assert.equal(result.reference.price, '369');
  assert.equal(result.reference.confidence, '0.01');
  assert.equal(result.reference.qualified, true);

  const referenceGate =
    result.candidates[0].gates.find(
      gate => gate.id === 'REFERENCE_TSLA'
    );

  assert.ok(referenceGate);
  assert.equal(referenceGate.outcome, 'PASS');
  assert.equal(
    referenceGate.verificationStatus,
    'VERIFIED'
  );

  const allReasons = new Set([
    ...result.reasonCodes,
    ...result.candidates.flatMap(
      candidate => candidate.reasonCodes
    )
  ]);

  assert.equal(
    [...allReasons].some(
      reason =>
        reason.startsWith('REFERENCE_TSLA_EVIDENCE_') ||
        reason === 'REFERENCE_TSLA_CONFIDENCE_UNKNOWN' ||
        reason === 'REFERENCE_TSLA_STALE'
    ),
    false
  );
});