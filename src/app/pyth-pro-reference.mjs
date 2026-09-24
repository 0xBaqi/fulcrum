import {canonical} from '../engine-v1.mjs';
import {createHash} from 'node:crypto';
import {createHttp} from '../providers.mjs';
import {
  PYTH_PRO_FEEDS,
  normalizePythResponse
} from './pyth-pro.mjs';

const PYTH_PRO_ENDPOINT =
  'https://pyth-lazer.dourolabs.app/v1/latest_price';

const PYTH_PRO_HISTORICAL_ENDPOINT =
  'https://pyth-lazer.dourolabs.app/v1/price';

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

export function pythProReferenceRequest(
  name,
  {atMs = null} = {}
) {
  if (name !== 'TSLA') {
    throw Error('REFERENCE_UNSUPPORTED');
  }

  const historical = atMs !== null;

  if (
    historical &&
    (!Number.isSafeInteger(atMs) || atMs <= 0)
  ) {
    throw Error('REFERENCE_HISTORICAL_TIMESTAMP_INVALID');
  }

  const timestampUs = historical
    ? atMs * 1000
    : null;

  if (
    historical &&
    !Number.isSafeInteger(timestampUs)
  ) {
    throw Error('REFERENCE_HISTORICAL_TIMESTAMP_INVALID');
  }

  return Object.freeze({
    id: historical
      ? 'reference-pyth-pro-TSLA-session'
      : 'reference-pyth-pro-TSLA',

    url: historical
      ? PYTH_PRO_HISTORICAL_ENDPOINT
      : PYTH_PRO_ENDPOINT,

    body: Object.freeze({
      priceFeedIds: Object.freeze([TSLA_FEED.id]),
      properties: PROPERTIES,
      formats: Object.freeze([]),
      channel: 'fixed_rate@1000ms',
      ...(historical
        ? {timestamp: timestampUs}
        : {})
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
      result =
        `${digits.slice(0, split)}.${digits.slice(split)}`;
    } else {
      result =
        `0.${'0'.repeat(places - digits.length)}${digits}`;
    }
  }

  if (result.includes('.')) {
    result = result.replace(/0+$/, '').replace(/\.$/, '');
  }

  if (result === '') {
    result = '0';
  }

  return negative && result !== '0'
    ? `-${result}`
    : result;
}

function historicalAtMsFromEvidence(evidence) {
  const timestampUs = evidence?.request?.timestamp;

  if (
    !Number.isSafeInteger(timestampUs) ||
    timestampUs <= 0 ||
    timestampUs % 1000 !== 0
  ) {
    return null;
  }

  const atMs = timestampUs / 1000;

  return Number.isSafeInteger(atMs) && atMs > 0
    ? atMs
    : null;
}

export function pythProReferenceFromEvidence(
  evidence,
  name = 'TSLA',
  {atMs = null} = {}
) {
  if (name !== 'TSLA') {
    throw Error('REFERENCE_UNSUPPORTED');
  }

  const request =
    pythProReferenceRequest(name, {atMs});

  if (
    !evidence ||
    evidence.id !== request.id ||
    evidence.source !== request.url ||
    evidence.status !== 200 ||
    evidence.responseRedacted
  ) {
    throw Error('REFERENCE_SOURCE_UNVERIFIED');
  }

  if (
    canonical(evidence.request) !==
    canonical(request.body)
  ) {
    throw Error('REFERENCE_REQUEST_MISMATCH');
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

  const publishedAt =
    Math.floor(feed.sourceTimestampUs / 1000);

  if (
    !Number.isSafeInteger(publishedAt) ||
    publishedAt <= 0
  ) {
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
      'HTTPS_AND_SCHEMA_VERIFIED_NOT_SIGNATURE_VERIFIED',
      ...(atMs === null
        ? []
        : ['HISTORICAL_POINT_IN_TIME_QUERY'])
    ])
  });
}

export async function collectPythProReference({
  apiKey,
  http = createHttp(),
  atMs = null
} = {}) {
  if (
    typeof apiKey !== 'string' ||
    !apiKey.trim()
  ) {
    throw Error('PYTH_PRO_API_KEY_REQUIRED');
  }

  const request =
    pythProReferenceRequest('TSLA', {atMs});

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
    reference: pythProReferenceFromEvidence(
      evidence,
      'TSLA',
      {atMs}
    ),
    evidence
  });
}

export function pythProReferenceProof(
  snapshot,
  name = 'TSLA'
) {
  const reference = snapshot?.references?.[name];

  let evidence = null;
  let verified = false;

  try {
    if (
      !reference ||
      reference.provider !== 'pyth-pro'
    ) {
      throw Error('REFERENCE_PROVIDER_UNAPPROVED');
    }

    const possibleRows =
      (snapshot.evidence ?? []).filter(
        row =>
          row.id === 'reference-pyth-pro-TSLA' ||
          row.id === 'reference-pyth-pro-TSLA-session'
      );

    if (possibleRows.length !== 1) {
      throw Error('REFERENCE_EVIDENCE_AMBIGUOUS');
    }

    evidence = possibleRows[0];

    const historical =
      evidence.id ===
      'reference-pyth-pro-TSLA-session';

    const atMs = historical
      ? historicalAtMsFromEvidence(evidence)
      : null;

    if (historical && atMs === null) {
      throw Error('REFERENCE_REQUEST_MISMATCH');
    }

    const request =
      pythProReferenceRequest(name, {atMs});

    if (
      evidence.id !== request.id ||
      evidence.source !== request.url ||
      evidence.status !== 200 ||
      evidence.responseRedacted
    ) {
      throw Error('REFERENCE_SOURCE_UNVERIFIED');
    }

    if (
      canonical(evidence.request) !==
      canonical(request.body)
    ) {
      throw Error('REFERENCE_REQUEST_MISMATCH');
    }

    if (
      !Number.isSafeInteger(evidence.startedAt) ||
      !Number.isSafeInteger(evidence.receivedAt) ||
      evidence.startedAt <= 0 ||
      evidence.receivedAt <= 0 ||
      evidence.startedAt > evidence.receivedAt ||
      !Number.isSafeInteger(snapshot.asOfMs) ||
      evidence.receivedAt > snapshot.asOfMs
    ) {
      throw Error('REFERENCE_CAPTURE_INVALID');
    }

    const responseSha256 = createHash('sha256')
      .update(evidence.responseText)
      .digest('hex');

    if (
      responseSha256 !== evidence.responseSha256
    ) {
      throw Error('REFERENCE_CAPTURE_INVALID');
    }

    const reconstructed =
      pythProReferenceFromEvidence(
        evidence,
        name,
        {atMs}
      );

    if (
      canonical(reconstructed) !==
      canonical(reference)
    ) {
      throw Error('REFERENCE_RECONSTRUCTION_MISMATCH');
    }

    verified = true;
  } catch {
    verified = false;
  }

  return Object.freeze([
    Object.freeze({
      evidenceId: reference?.evidenceId ?? null,
      source:
        evidence?.source ??
        reference?.source ??
        null,
      observedAt: evidence?.receivedAt ?? null,
      publishedAt: reference?.publishedAt ?? null,
      sourceTimestamp:
        reference?.publishedAt ?? null,
      timestampBasis:
        reference?.timestampBasis ?? 'UNKNOWN',

      verificationStatus:
        verified
          ? 'VERIFIED'
          : reference
            ? 'UNVERIFIED'
            : 'UNKNOWN',

      verificationBasis:
        'APPROVED_PYTH_PRO_RESPONSE_RECONSTRUCTION_OVER_HTTPS_NOT_SIGNATURE_VERIFIED',

      responseSha256:
        evidence?.responseSha256 ?? null,
      delay: reference?.delay ?? null,
      marketSession:
        reference?.marketSession ?? null,
      confidenceStatus:
        reference?.confidenceStatus ?? 'UNKNOWN'
    })
  ]);
}