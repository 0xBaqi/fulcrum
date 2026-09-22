import {resolve} from '../registry.mjs';
import {evaluateV2} from '../engine-v2.mjs';
import {gate} from '../provenance.mjs';
import {
  sessionReferenceWithPythPro,
  proofFor
} from './session-reference.mjs';

export function evaluateV4WithPythPro(snapshot) {
  if (snapshot.schemaVersion !== 4) {
    throw Error('INVALID_SNAPSHOT_VERSION');
  }

  const assets = resolve(snapshot.order?.underlying);
  const underlying = assets[0].underlying;

  if (snapshot.order.underlying !== underlying) {
    throw Error('INVALID_ORDER');
  }

  const rp = sessionReferenceWithPythPro(snapshot);

  const sources = {
    'xstocks-asset': assets[0].source,
    'xstocks-multiplier':
      assets[0].source + '/multiplier?network=Solana',

    'ondo-page': assets[1].source,

    'ondo-addresses':
      `https://api.gm.ondo.finance/v1/assets/${assets[1].symbol}/addresses`,

    'ondo-market':
      `https://api.gm.ondo.finance/v1/assets/${assets[1].symbol}/market`,

    ...Object.fromEntries(
      assets.map(a => [
        'quote-' + a.symbol,
        'https://api.jup.ag/swap/v2/order'
      ])
    )
  };

  const context = {
    assets,
    underlying,
    sources,

    referenceReasons: () => [],
    referenceProof: proofFor,

    originalSnapshot: snapshot,
    engineVersion: '0.2.0',

    objective:
      `Maximize slippage-protected ${underlying}-equivalent shares ` +
      'for equal USDC input; excludes wallet-dependent network fees.',

    referenceEvaluation: () => ({
      underlyingPrice: rp.price,
      usdcPrice: rp.usd,
      reasonCodes: rp.reasonCodes
    }),

    referenceGates: rp.gates,

    deviationMandatory: rp.live,

    deviationGate(row, p) {
      const evidence = [
        ...proofFor(snapshot, underlying),
        ...rp.gates[1].evidence,
        ...p.quote(),
        ...p.multiplier()
      ];

      if (rp.live && rp.usd) {
        return gate(
          'REFERENCE_DEVIATION',
          row.reasonCodes.filter(
            r => r.startsWith('REFERENCE_DEVIATION')
          ),
          evidence,
          {
            scope:
              'LIVE_REFERENCE_SANITY_CHECK_WITH_QUALIFIED_USDC_CONVERSION'
          }
        );
      }

      return {
        id: rp.live
          ? 'REFERENCE_DEVIATION'
          : 'ANCHOR_DISLOCATION',

        mandatory: false,

        scope: rp.live
          ? 'USD_CONVERSION_UNAVAILABLE'
          : 'ECONOMIC_ANCHOR_NOT_CURRENT_FAIR_VALUE',

        outcome:
          rp.usd && rp.reference.qualified
            ? 'INFORMATIONAL'
            : 'UNKNOWN',

        reasonCodes: [],

        warningCodes: rp.live
          ? ['USD_CONVERSION_UNAVAILABLE']
          : [
              'CLOSED_MARKET_REFERENCE',
              'NOT_CURRENT_FAIR_VALUE'
            ],

        source: evidence.flatMap(e =>
          Array.isArray(e.source)
            ? e.source
            : [e.source]
        ),

        observedAt: evidence.map(e => e.observedAt),

        freshnessStatus: rp.classification,

        verificationStatus:
          rp.reference.qualified
            ? 'VERIFIED'
            : 'UNKNOWN',

        evidence
      };
    }
  };

  const result = evaluateV2(
    {
      ...snapshot,
      schemaVersion: 2
    },
    context
  );

  for (const row of result.candidates) {
    const quote = snapshot.candidates.find(
      c => c.symbol === row.symbol
    ).quote;

    row.quoteAgeMs =
      Number.isSafeInteger(quote?.startedAt)
        ? snapshot.asOfMs - quote.startedAt
        : null;

    row.quoteReceiptAgeMs =
      Number.isSafeInteger(quote?.receivedAt)
        ? snapshot.asOfMs - quote.receivedAt
        : null;

    if (row.normalized && !rp.live) {
      row.normalized.anchorDislocationBps =
        row.normalized.referenceDeviationBps ?? null;

      delete row.normalized.referenceDeviationBps;
    }
  }

  return {
    ...result,

    executionClassification: result.winner
      ? rp.live
        ? rp.session.state === 'UNDERLYING_EXTENDED'
          ? 'BEST_EXECUTION_EXTENDED_MARKET'
          : 'BEST_EXECUTION_OPEN_MARKET'
        : 'BEST_EXECUTION_CLOSED_MARKET'
      : 'NO_VERIFIED_EXECUTION',

    marketState: rp.session.state,
    marketSession: rp.session,
    reference: rp.reference,
    usdcReporting: rp.usdc,
    comparisonDenomination: 'USDC',
    warningCodes: rp.warningCodes,

    reasonCodes: [
      ...new Set([
        ...result.reasonCodes,
        ...rp.warningCodes
      ])
    ].sort()
  };
}