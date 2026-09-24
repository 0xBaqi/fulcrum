import {createHash} from 'node:crypto';
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  pythValueToDecimal,
  pythProReferenceFromEvidence,
  collectPythProReference,
  pythProReferenceRequest,
  pythProReferenceProof
} from '../src/app/pyth-pro-reference.mjs';
import {
  PYTH_PRO_FEEDS,
  normalizePythValue,
  normalizePythFeed,
  normalizePythResponse,
  fetchPythProLatest
} from '../src/app/pyth-pro.mjs';

const validFeed = Object.freeze({
  priceFeedId: 1435,
  price: '37507500',
  bestBidPrice: '37505000',
  bestAskPrice: '37510000',
  confidence: 5000,
  exponent: -5,
  publisherCount: 11,
  marketSession: 'postMarket',
  feedUpdateTimestamp: 1790029070000000
});

test('normalizePythValue preserves exact integer and exponent',()=>{
  const value=normalizePythValue('37494375165',-8);
  assert.deepEqual(value,{raw:'37494375165',exponent:-8});
  assert.equal(Object.isFrozen(value),true);
});

test('normalizePythValue rejects non-integer strings',()=>{
  assert.throws(
    ()=>normalizePythValue('374.94',-8),
    /Pyth value must be an integer string/
  );
});

test('normalizePythFeed preserves market evidence without float conversion',()=>{
  const feed=normalizePythFeed(validFeed);

  assert.deepEqual(feed,{
    priceFeedId:1435,
    price:{raw:'37507500',exponent:-5},
    bid:{raw:'37505000',exponent:-5},
    ask:{raw:'37510000',exponent:-5},
    confidence:{raw:'5000',exponent:-5},
    publisherCount:11,
    marketSession:'postMarket',
    sourceTimestampUs:1790029070000000
  });

  assert.equal(Object.isFrozen(feed),true);
});

test('normalizePythResponse fails closed when a requested feed is missing',()=>{
  const payload={
    parsed:{
      timestampUs:'1790029070000000',
      priceFeeds:[validFeed]
    }
  };

  assert.throws(
    ()=>normalizePythResponse(payload,[1435,1847]),
    /Pyth response missing requested feed IDs: 1847/
  );
});

test('normalizePythResponse rejects duplicate feed IDs',()=>{
  const payload={
    parsed:{
      timestampUs:'1790029070000000',
      priceFeeds:[validFeed,{...validFeed}]
    }
  };

  assert.throws(
    ()=>normalizePythResponse(payload,[1435]),
    /Pyth response contains duplicate feed IDs/
  );
});

test('fetchPythProLatest sends the expected authenticated request',async()=>{
  let captured;

  const fetchImpl=async(url,options)=>{
    captured={url,options};
    return {
      ok:true,
      status:200,
      async json(){
        return {
          parsed:{
            timestampUs:'1790029070000000',
            priceFeeds:[validFeed]
          }
        };
      }
    };
  };

  const result=await fetchPythProLatest({
    apiKey:'test-key',
    feedIds:[PYTH_PRO_FEEDS.TSLA.id],
    fetchImpl
  });

  assert.equal(captured.options.method,'POST');
  assert.equal(captured.options.headers.Authorization,'Bearer test-key');
  assert.equal(captured.options.headers['Content-Type'],'application/json');

  const body=JSON.parse(captured.options.body);
  assert.deepEqual(body.priceFeedIds,[1435]);
  assert.equal(body.channel,'fixed_rate@1000ms');
  assert.deepEqual(body.formats,[]);
  assert.equal(result.feeds[0].priceFeedId,1435);
});

test('fetchPythProLatest rejects non-success HTTP responses',async()=>{
  const fetchImpl=async()=>({
    ok:false,
    status:401
  });

  await assert.rejects(
    ()=>fetchPythProLatest({
      apiKey:'test-key',
      feedIds:[1435],
      fetchImpl
    }),
    /Pyth Pro request failed with HTTP 401/
  );
});

test('pythValueToDecimal converts exact Pyth values without float rounding', () => {
  assert.equal(
    pythValueToDecimal({raw: '37507500', exponent: -5}),
    '375.075'
  );

  assert.equal(
    pythValueToDecimal({raw: '37494375165', exponent: -8}),
    '374.94375165'
  );

  assert.equal(
    pythValueToDecimal({raw: '1', exponent: -8}),
    '0.00000001'
  );

  assert.equal(
    pythValueToDecimal({raw: '5000', exponent: -5}),
    '0.05'
  );
});

test('pythValueToDecimal handles zero, negative and positive exponents', () => {
  assert.equal(
    pythValueToDecimal({raw: '0', exponent: -8}),
    '0'
  );

  assert.equal(
    pythValueToDecimal({raw: '-125', exponent: -2}),
    '-1.25'
  );

  assert.equal(
    pythValueToDecimal({raw: '125', exponent: 2}),
    '12500'
  );
});

test('pythProReferenceFromEvidence produces Fulcrum-compatible TSLA reference', () => {
  const responseText = JSON.stringify({
    parsed: {
      timestampUs: '1790029070000000',
      priceFeeds: [{
        priceFeedId: 1435,
        price: '37507500',
        bestBidPrice: '37505000',
        bestAskPrice: '37510000',
        publisherCount: 11,
        exponent: -5,
        confidence: 5000,
        marketSession: 'postMarket',
        feedUpdateTimestamp: 1790029070000000
      }]
    }
  });

  const reference = pythProReferenceFromEvidence({
  id: 'reference-pyth-pro-TSLA',
  source: 'https://pyth-lazer.dourolabs.app/v1/latest_price',
  request: {
    priceFeedIds: [1435],
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
  },
  status: 200,
  responseRedacted: false,
  responseText,
  receivedAt: 1790029070123
});

  assert.equal(reference.provider, 'pyth-pro');
  assert.equal(reference.symbol, 'Equity.US.TSLA/USD');
  assert.equal(reference.currency, 'USD');
  assert.equal(reference.feedId, 1435);

  assert.equal(reference.price, '375.075');
  assert.equal(reference.confidence, '0.05');
  assert.equal(reference.confidenceStatus, 'REPORTED');

  assert.equal(reference.publishedAt, 1790029070000);
  assert.equal(reference.observedAt, 1790029070123);

  assert.equal(reference.timestampBasis, 'SOURCE_FEED_UPDATE_TIMESTAMP');
  assert.equal(reference.priceKind, 'ORACLE_AGGREGATE');

  assert.equal(reference.marketSession.atObservation, 'postMarket');
});

test('collectPythProReference uses authenticated POST evidence and returns normalized reference', async () => {
  let captured;

  const responseText = JSON.stringify({
    parsed: {
      timestampUs: '1790029070000000',
      priceFeeds: [{
        priceFeedId: 1435,
        price: '37507500',
        bestBidPrice: '37505000',
        bestAskPrice: '37510000',
        publisherCount: 11,
        exponent: -5,
        confidence: 5000,
        marketSession: 'postMarket',
        feedUpdateTimestamp: 1790029070000000
      }]
    }
  });

  const http = {
    async get(id, url, options) {
      captured = {id, url, options};

      return {
        id,
        source: url,
        startedAt: 1790029070000,
        receivedAt: 1790029070123,
        status: 200,
        request: options.body,
        responseText,
        responseSha256: 'fixture-sha256',
        responseRedacted: false
      };
    }
  };

  const result = await collectPythProReference({
    apiKey: 'test-secret',
    http
  });

  assert.equal(captured.id, 'reference-pyth-pro-TSLA');
  assert.equal(
    captured.url,
    'https://pyth-lazer.dourolabs.app/v1/latest_price'
  );

  assert.equal(
    captured.options.headers.Authorization,
    'Bearer test-secret'
  );

  assert.deepEqual(
    captured.options.body.priceFeedIds,
    [1435]
  );

  assert.equal(
    captured.options.body.channel,
    'fixed_rate@1000ms'
  );

  assert.equal(result.reference.provider, 'pyth-pro');
  assert.equal(result.reference.price, '375.075');
  assert.equal(result.reference.confidence, '0.05');
  assert.equal(result.reference.marketSession.atObservation, 'postMarket');

  assert.equal(result.evidence.id, 'reference-pyth-pro-TSLA');
  assert.equal(result.evidence.request, captured.options.body);
});

test('pythProReferenceProof verifies exact captured evidence and rejects tampering', () => {
  const responseText = JSON.stringify({
    parsed: {
      timestampUs: '1790029070000000',
      priceFeeds: [{
        priceFeedId: 1435,
        price: '37507500',
        bestBidPrice: '37505000',
        bestAskPrice: '37510000',
        publisherCount: 11,
        exponent: -5,
        confidence: 5000,
        marketSession: 'postMarket',
        feedUpdateTimestamp: 1790029070000000
      }]
    }
  });

  const request = pythProReferenceRequest('TSLA');

  const evidence = {
    id: request.id,
    source: request.url,
    startedAt: 1790029070000,
    receivedAt: 1790029070123,
    status: 200,
    request: request.body,
    responseText,
    responseSha256: createHash('sha256')
      .update(responseText)
      .digest('hex'),
    responseRedacted: false
  };

  const reference =
    pythProReferenceFromEvidence(evidence, 'TSLA');

  const snapshot = {
    asOfMs: 1790029070200,
    references: {
      TSLA: reference
    },
    evidence: [evidence]
  };

  assert.equal(
    pythProReferenceProof(snapshot, 'TSLA')[0].verificationStatus,
    'VERIFIED'
  );

  const tamperedResponse = structuredClone(snapshot);
  tamperedResponse.evidence[0].responseText =
    tamperedResponse.evidence[0].responseText.replace(
      '37507500',
      '99999999'
    );

  assert.equal(
    pythProReferenceProof(tamperedResponse, 'TSLA')[0].verificationStatus,
    'UNVERIFIED'
  );

  const tamperedRequest = structuredClone(snapshot);
  tamperedRequest.evidence[0].request.priceFeedIds = [1847];

  assert.equal(
    pythProReferenceProof(tamperedRequest, 'TSLA')[0].verificationStatus,
    'UNVERIFIED'
  );

  const futureCapture = structuredClone(snapshot);
  futureCapture.evidence[0].receivedAt =
    futureCapture.asOfMs + 1;

  assert.equal(
    pythProReferenceProof(futureCapture, 'TSLA')[0].verificationStatus,
    'UNVERIFIED'
  );
});
