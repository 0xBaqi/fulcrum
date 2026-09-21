import {createHash} from 'node:crypto';
import {createHttp} from '../providers.mjs';
import {
  PYTH_PRO_FEEDS,
  normalizePythResponse
} from './pyth-pro.mjs';

const PYTH_PRO_ENDPOINT =
  'https://pyth-lazer.dourolabs.app/v1/latest_price';

const TSLA_FEED = PYTH_PRO_FEEDS.TSLA;

const PROPERTIES = Object.freeze([
  'price',
  'confidence',
  'bestBidPrice',
  'bestAskPrice',
  'exponent',
  'publisherCount',
  'marketSession',
  'feedUpdateTimestamp'
]);

export function pythProReferenceRequest(name) {
  if (name !== 'TSLA') {
    throw Error('REFERENCE_UNSUPPORTED');
  }

  return Object.freeze({
    id: 'reference-pyth-pro-TSLA',
    url: PYTH_PRO_ENDPOINT,
    body: Object.freeze({
      priceFeedIds: Object.freeze([TSLA_FEED.id]),
      properties: PROPERTIES,
      formats: Object.freeze([]),
      channel: 'fixed_rate@1000ms'
    })
  });
}

export function pythValueToDecimal(value) {
  if (
    !value ||
    typeof value.raw !== 'string' ||
    !/^-?\d+$/.test(value.raw) ||
    !Number.isSafeInteger(value.exponent)
  ) {
    throw new TypeError('Invalid normalized Pyth value');
  }

  const negative = value.raw.startsWith('-');
  let digits = negative ? value.raw.slice(1) : value.raw;

  digits = digits.replace(/^0+(?=\d)/, '');

  let result;

  if (value.exponent >= 0) {
    result = digits + '0'.repeat(value.exponent);
  } else {
    const places = -value.exponent;

    if (digits.length > places) {
      const split = digits.length - places;
      result = `${digits.slice(0, split)}.${digits.slice(split)}`;
    } else {
      result = `0.${'0'.repeat(places - digits.length)}${digits}`;
    }
  }

  if (result.includes('.')) {
    result = result.replace(/0+$/, '').replace(/\.$/, '');
  }

  if (result === '') {
    result = '0';
  }

  return negative && result !== '0' ? `-${result}` : result;
}

export function pythProReferenceFromEvidence(evidence, name = 'TSLA') {
  if (name !== 'TSLA') {
    throw Error('REFERENCE_UNSUPPORTED');
  }

  if (
    !evidence ||
    evidence.id !== 'reference-pyth-pro-TSLA' ||
    evidence.source !== PYTH_PRO_ENDPOINT ||
    evidence.status !== 200 ||
    evidence.responseRedacted
  ) {
    throw Error('REFERENCE_SOURCE_UNVERIFIED');
  }

  const normalized = normalizePythResponse(
    JSON.parse(evidence.responseText),
    [TSLA_FEED.id]
  );

  const feed = normalized.feeds.find(
    row => row.priceFeedId === TSLA_FEED.id
  );

  if (!feed) {
    throw Error('PYTH_FEED_MISSING');
  }

  const publishedAt = Math.floor(feed.sourceTimestampUs / 1000);

  if (!Number.isSafeInteger(publishedAt) || publishedAt <= 0) {
    throw Error('REFERENCE_TIMESTAMP_INVALID');
  }

  return Object.freeze({
    provider: 'pyth-pro',
    symbol: 'Equity.US.TSLA/USD',
    currency: 'USD',
    feedId: TSLA_FEED.id,

    price: pythValueToDecimal(feed.price),
confidence: pythValueToDecimal(feed.confidence),
    confidenceStatus: 'REPORTED',

    publishedAt,
    observedAt: evidence.receivedAt,
    source: evidence.source,
    evidenceId: evidence.id,

    timestampBasis: 'SOURCE_FEED_UPDATE_TIMESTAMP',
    priceKind: 'ORACLE_AGGREGATE',

    delay: Object.freeze({
      status: 'UNKNOWN',
      seconds: null,
      label: 'SOURCE_FEED_UPDATE_TIMESTAMP_GATED'
    }),

    marketSession: Object.freeze({
      atObservation: feed.marketSession,
      priceSession: feed.marketSession,
      timezone: null,
      periods: null
    }),

    limitations: Object.freeze([
      'HTTPS_AND_SCHEMA_VERIFIED_NOT_SIGNATURE_VERIFIED'
    ])
  });
}

export async function collectPythProReference({
  apiKey,
  http = createHttp()
} = {}) {
  if (typeof apiKey !== 'string' || !apiKey.trim()) {
    throw Error('PYTH_PRO_API_KEY_REQUIRED');
  }

  const request = pythProReferenceRequest('TSLA');

  const evidence = await http.get(
    request.id,
    request.url,
    {
      headers: {
        Authorization: `Bearer ${apiKey.trim()}`
      },
      body: request.body
    }
  );

  return Object.freeze({
    reference: pythProReferenceFromEvidence(evidence, 'TSLA'),
    evidence
  });
}