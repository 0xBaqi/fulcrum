import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {
  pythProReferenceFromEvidence,
  pythProReferenceRequest
} from '../src/app/pyth-pro-reference.mjs';

import {sessionFixture} from '../fixtures/session.mjs';
import {sessionReference as frozenSessionReference} from '../src/session-reference.mjs';
import {sessionReferenceWithPythPro} from '../src/app/session-reference.mjs';

const at = value => Date.parse(value);

test('app session adapter preserves frozen session behavior', () => {
  const times = [
    '2026-09-11T14:00:00Z',
    '2026-09-11T20:15:00Z',
    '2026-09-12T01:00:00Z',
    '2026-09-12T16:00:00Z',
    '2026-09-13T16:00:00Z',
    '2026-09-07T16:00:00Z'
  ];

  for (const time of times) {
    const snapshot = sessionFixture(at(time));

    assert.deepEqual(
      sessionReferenceWithPythPro(snapshot),
      frozenSessionReference(snapshot),
      time
    );
  }
});

test('Pyth Pro TSLA evidence passes the existing live session policy', () => {
  const asOfMs = at('2026-09-11T14:00:00Z');
  const snapshot = sessionFixture(asOfMs);

  const request = pythProReferenceRequest('TSLA');

  const feedUpdateTimestamp = (asOfMs - 1000) * 1000;

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
    startedAt: asOfMs - 1100,
    receivedAt: asOfMs - 900,
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

  const result = sessionReferenceWithPythPro(snapshot);

  assert.equal(result.session.state, 'UNDERLYING_OPEN');
  assert.equal(result.classification, 'LIVE_MARKET_REFERENCE');

  assert.equal(result.reference.provider, 'pyth-pro');
  assert.equal(result.reference.price, '369');
  assert.equal(result.reference.confidence, '0.01');

  assert.equal(result.reference.qualified, true);
  assert.equal(result.gates[0].verificationStatus, 'VERIFIED');
  assert.equal(result.gates[0].freshnessStatus, 'FRESH');
  assert.equal(result.gates[0].outcome, 'PASS');

  assert.deepEqual(result.gates[0].reasonCodes, []);
  assert.deepEqual(result.reasonCodes, []);

  assert.equal(
    result.gates[0].evidence[0].verificationBasis,
    'APPROVED_PYTH_PRO_RESPONSE_RECONSTRUCTION_OVER_HTTPS_NOT_SIGNATURE_VERIFIED'
  );
});