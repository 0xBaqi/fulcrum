export const PYTH_PRO_FEEDS = Object.freeze({
  TSLA: Object.freeze({
    id: 1435,
    symbol: 'Equity.US.TSLA/USD',
    role: 'UNDERLYING'
  }),

  TSLAx: Object.freeze({
    id: 1847,
    symbol: 'Crypto.TSLAX/USD',
    role: 'REPRESENTATION'
  }),

  TSLAon: Object.freeze({
    id: 3128,
    symbol: 'Crypto.TSLAON/USD',
    role: 'REPRESENTATION'
  }),

  TSLAx_TSLA_RR: Object.freeze({
    id: 1846,
    symbol: 'Crypto.TSLAX/TSLA.RR',
    role: 'RELATIVE_RATE'
  })
});

export function normalizePythValue(rawValue, exponent) {
  if (rawValue === null || rawValue === undefined) return null;

  if (typeof rawValue !== 'string' || !/^-?\d+$/.test(rawValue)) {
    throw new TypeError('Pyth value must be an integer string');
  }

  if (!Number.isSafeInteger(exponent)) {
    throw new TypeError('Pyth exponent must be a safe integer');
  }

  return Object.freeze({
    raw: rawValue,
    exponent
  });
}

export function normalizePythFeed(feed) {
  if (!feed || typeof feed !== 'object') {
    throw new TypeError('Pyth feed must be an object');
  }

  const {
    priceFeedId,
    price,
    bestBidPrice,
    bestAskPrice,
    confidence,
    exponent,
    publisherCount,
    marketSession,
    feedUpdateTimestamp
  } = feed;

  if (!Number.isSafeInteger(priceFeedId)) {
    throw new TypeError('Pyth priceFeedId must be a safe integer');
  }

  if (!Number.isSafeInteger(publisherCount) || publisherCount < 0) {
    throw new TypeError(
      'Pyth publisherCount must be a non-negative safe integer'
    );
  }

  if (
    !Number.isSafeInteger(feedUpdateTimestamp) ||
    feedUpdateTimestamp <= 0
  ) {
    throw new TypeError(
      'Pyth feedUpdateTimestamp must be a positive safe integer'
    );
  }

  if (typeof marketSession !== 'string' || marketSession.length === 0) {
    throw new TypeError('Pyth marketSession must be a non-empty string');
  }

  return Object.freeze({
    priceFeedId,
    price: normalizePythValue(price, exponent),
    bid: normalizePythValue(bestBidPrice, exponent),
    ask: normalizePythValue(bestAskPrice, exponent),
    confidence: normalizePythValue(String(confidence), exponent),
    publisherCount,
    marketSession,
    sourceTimestampUs: feedUpdateTimestamp
  });
}

export function normalizePythResponse(payload, expectedFeedIds = []) {
  const parsed = payload?.parsed;

  if (!parsed || typeof parsed !== 'object') {
    throw new TypeError('Pyth response is missing parsed payload');
  }

  if (!Array.isArray(parsed.priceFeeds)) {
    throw new TypeError('Pyth response priceFeeds must be an array');
  }

  const feeds = parsed.priceFeeds.map(normalizePythFeed);

  const byId = new Map(feeds.map(feed => [feed.priceFeedId, feed]));

  if (byId.size !== feeds.length) {
    throw new Error('Pyth response contains duplicate feed IDs');
  }

  const missingFeedIds = expectedFeedIds.filter(id => !byId.has(id));

  if (missingFeedIds.length > 0) {
    throw new Error(
      `Pyth response missing requested feed IDs: ${missingFeedIds.join(', ')}`
    );
  }

  return Object.freeze({
    timestampUs: parsed.timestampUs,
    feeds: Object.freeze(feeds)
  });
}

const PYTH_PRO_LATEST_PRICE_URL =
'https://pyth-lazer.dourolabs.app/v1/latest_price';

export async function fetchPythProLatest({
  apiKey,
  feedIds,
  fetchImpl = fetch
}) {
  if (typeof apiKey !== 'string' || apiKey.length === 0) {
    throw new Error('Pyth Pro API key is required');
  }

  if (!Array.isArray(feedIds) || feedIds.length === 0) {
    throw new TypeError('Pyth feedIds must be a non-empty array');
  }

  const response = await fetchImpl(PYTH_PRO_LATEST_PRICE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      priceFeedIds: feedIds,
      properties: [
        'price',
        'confidence',
        'bestBidPrice',
        'bestAskPrice',
        'exponent',
        'publisherCount',
        'marketSession',
        'feedUpdateTimestamp'
      ],
      formats: [],
      channel: 'fixed_rate@1000ms'
    })
  });

  if (!response.ok) {
    throw new Error(`Pyth Pro request failed with HTTP ${response.status}`);
  }

  const payload = await response.json();

  return normalizePythResponse(payload, feedIds);
}


