import {canonical} from '../engine-v1.mjs';
import {marketSession, CALENDAR_IDENTITY} from '../market-session.mjs';
import {referenceProof, referenceFreshness} from '../references.mjs';
import {SESSION_REFERENCE_POLICY} from '../session-reference.mjs';
import {
  decimal,
  rational,
  div,
  mul,
  sub,
  abs,
  cmp,
  display
} from '../math.mjs';
import {pythProReferenceProof} from './pyth-pro-reference.mjs';

const unique = a => [...new Set(a)].sort();

const bps = (a, b) =>
  mul(
    abs(sub(div(a, b), rational(1n))),
    rational(10000n)
  );

function resultGate(
  id,
  reasons,
  evidence,
  {
    mandatory = true,
    classification = null,
    warningCodes = []
  } = {}
) {
  const verification =
    evidence.every(e => e.verificationStatus === 'VERIFIED')
      ? 'VERIFIED'
      : evidence.some(e => e.verificationStatus === 'UNVERIFIED')
        ? 'UNVERIFIED'
        : 'UNKNOWN';

  return {
    id,
    mandatory,
    outcome: reasons.length
      ? verification === 'UNKNOWN'
        ? 'UNKNOWN'
        : 'FAIL'
      : 'PASS',
    reasonCodes: unique(reasons),
    warningCodes: unique(warningCodes),
    scope: classification,
    source: evidence.flatMap(e =>
      Array.isArray(e.source) ? e.source : [e.source]
    ),
    observedAt: evidence.map(e => e.observedAt ?? null),
    freshnessStatus:
      classification === 'LAST_MARKET_REFERENCE' && !reasons.length
        ? 'QUALIFIED_LAST_MARKET'
        : evidence[0]?.freshnessStatus ?? 'UNKNOWN',
    verificationStatus: verification,
    evidence
  };
}

export function proofFor(snapshot, name) {
  const reference = snapshot.references?.[name];

  if (name === 'TSLA' && reference?.provider === 'pyth-pro') {
    return pythProReferenceProof(snapshot, name).map(proof =>
      Object.freeze({
        ...proof,
        freshnessStatus: referenceFreshness(
          reference?.publishedAt,
          snapshot.asOfMs,
          snapshot.policy.maxReferenceAgeMs
        )
      })
    );
  }

  return referenceProof(snapshot, name);
}

export function sessionReferenceWithPythPro(snapshot) {
  if (
    canonical(snapshot.referencePolicy) !==
    canonical(SESSION_REFERENCE_POLICY)
  ) {
    throw Error('INVALID_SESSION_REFERENCE_POLICY');
  }

  if (
    canonical(snapshot.marketCalendar) !==
    canonical(CALENDAR_IDENTITY)
  ) {
    throw Error('MARKET_CALENDAR_VERSION_MISMATCH');
  }

  const now = snapshot.asOfMs;
  const session = marketSession(now);
  const name = snapshot.order.underlying;
  const ref = snapshot.references?.[name];
  const policy = snapshot.referencePolicy;

  const live = [
    'UNDERLYING_OPEN',
    'UNDERLYING_EXTENDED'
  ].includes(session.state);

  const closed = [
    'UNDERLYING_CLOSED',
    'UNDERLYING_WEEKEND',
    'UNDERLYING_HOLIDAY'
  ].includes(session.state);

  const classification = live
    ? 'LIVE_MARKET_REFERENCE'
    : closed
      ? 'LAST_MARKET_REFERENCE'
      : 'UNQUALIFIED_REFERENCE';

  const proof = proofFor(snapshot, name);
  const reasons = [...session.reasonCodes];
  const warnings = [];

  let price = null;

  if (proof[0].verificationStatus !== 'VERIFIED') {
    reasons.push(
      'REFERENCE_' +
        name +
        '_EVIDENCE_' +
        proof[0].verificationStatus
    );
  }

  if (
    ref?.symbol !== `Equity.US.${name}/USD` ||
    ref?.currency !== 'USD'
  ) {
    reasons.push('REFERENCE_IDENTITY_MISMATCH');
  }

  try {
    price = decimal(ref.price);

    if (price.n <= 0n) {
      throw Error();
    }
  } catch {
    reasons.push('REFERENCE_' + name + '_INVALID');
  }

  const observed = referenceFreshness(
    ref?.observedAt,
    now,
    policy.maxReferenceObservationAgeMs
  );

  if (observed !== 'FRESH') {
    reasons.push('REFERENCE_OBSERVATION_' + observed);
  }

  if (live) {
    if (proof[0].freshnessStatus !== 'FRESH') {
      reasons.push(
        'REFERENCE_' + name + '_' + proof[0].freshnessStatus
      );
    }

    try {
      const confidence = decimal(ref.confidence);

      if (confidence.n < 0n) {
        throw Error();
      }

      if (
        cmp(
          mul(
            div(confidence, price),
            rational(10000n)
          ),
          rational(snapshot.policy.maxConfidenceBps)
        ) > 0
      ) {
        reasons.push(
          'REFERENCE_' + name + '_CONFIDENCE_HIGH'
        );
      }
    } catch {
      reasons.push(
        'REFERENCE_' + name + '_CONFIDENCE_UNKNOWN'
      );
    }

    // A regular close may be very recent but is not an
    // extended-session observation.
    if (
      session.state === 'UNDERLYING_EXTENDED' &&
      ref?.priceKind === 'REGULAR_MARKET_LAST_TRADE'
    ) {
      reasons.push('EXTENDED_SESSION_PRICE_REQUIRED');
    }
  } else if (closed) {
    const last = session.lastCompletedRegularSession;
    const t = ref?.publishedAt;

    const upper =
      ref?.priceKind === 'REGULAR_MARKET_LAST_TRADE'
        ? last?.regularClose
        : last?.extendedClose ?? last?.regularClose;

    const qualified =
      Number.isSafeInteger(t) &&
      t > 0 &&
      t <= now &&
      last &&
      t >= last.regularClose - policy.lastCloseToleranceMs &&
      t <= upper;

    if (!qualified) {
      reasons.push(
        'LAST_MARKET_REFERENCE_NOT_LATEST_SESSION'
      );
    }

    warnings.push(
      'CLOSED_MARKET_REFERENCE',
      'NOT_CURRENT_FAIR_VALUE'
    );

    if (
      ref?.confidence === null ||
      ref?.confidence === undefined
    ) {
      warnings.push(
        'LAST_MARKET_CONFIDENCE_UNAVAILABLE'
      );
    } else {
      try {
        const confidence = decimal(ref.confidence);

        if (confidence.n < 0n) {
          throw Error();
        }

        if (
          cmp(
            mul(
              div(confidence, price),
              rational(10000n)
            ),
            rational(snapshot.policy.maxConfidenceBps)
          ) > 0
        ) {
          reasons.push(
            'REFERENCE_' + name + '_CONFIDENCE_HIGH'
          );
        }
      } catch {
        reasons.push(
          'REFERENCE_' + name + '_CONFIDENCE_INVALID'
        );
      }
    }
  }

  const calendarEvidence = {
    evidenceId: session.id,
    source: session.source,
    observedAt: null,
    publishedAt: null,
    sourceTimestamp: null,
    timestampBasis: 'VERSIONED_EXCHANGE_CALENDAR',
    freshnessStatus:
      session.verificationStatus === 'VERIFIED'
        ? 'VALID_FOR_DATE'
        : 'UNKNOWN',
    verificationStatus: session.verificationStatus,
    verificationBasis: session.basis,
    responseSha256: session.sha256
  };

  const equityGate = resultGate(
    'REFERENCE_' + name,
    reasons,
    [...proof, calendarEvidence],
    {
      classification,
      warningCodes: warnings
    }
  );

  const ur = snapshot.references?.USDC;
  const up = referenceProof(snapshot, 'USDC');
  const ugReasons = [];
  const ugWarnings = [];

  let usd = null;
  let depeg = null;

  // Same-input execution is ranked in USDC.
  // Conversion has its own 15-minute guard horizon.
  const ugFresh = referenceFreshness(
    ur?.publishedAt,
    now,
    policy.usdcGuardMaxAgeMs
  );

  const ugObserved = referenceFreshness(
    ur?.observedAt,
    now,
    policy.maxReferenceObservationAgeMs
  );

  if (
    ur &&
    up[0].verificationStatus === 'UNVERIFIED'
  ) {
    ugReasons.push(
      'USDC_CONVERSION_EVIDENCE_UNVERIFIED'
    );
  }

  if (
    up[0].verificationStatus === 'VERIFIED' &&
    ugFresh === 'FRESH' &&
    ugObserved === 'FRESH'
  ) {
    try {
      usd = decimal(ur.price);

      if (usd.n <= 0n) {
        throw Error();
      }

      depeg = bps(usd, rational(1n));

      if (
        cmp(
          depeg,
          rational(policy.usdcDepegThresholdBps)
        ) > 0
      ) {
        ugReasons.push('USDC_DEPEG_DETECTED');
      }
    } catch {
      usd = null;
    }
  }

  if (!usd) {
    ugWarnings.push(
      'USDC_DEPEG_GUARD_UNAVAILABLE',
      'USD_CONVERSION_UNAVAILABLE'
    );
  } else if (up[0].freshnessStatus !== 'FRESH') {
    ugWarnings.push(
      'USDC_CONVERSION_OLDER_THAN_LIVE_REFERENCE_LIMIT'
    );
  }

  const usdcGate = resultGate(
    'USDC_DEPEG_GUARD',
    ugReasons,
    up.map(e => ({
      ...e,
      freshnessStatus: ugFresh
    })),
    {
      mandatory: !!usd || ugReasons.length > 0,
      classification: 'COMMON_USDC_INPUT_DEPEG_GUARD',
      warningCodes: ugWarnings
    }
  );

  if (!usd && !ugReasons.length) {
    usdcGate.outcome = 'UNKNOWN';
  }

  return {
    session,
    classification,

    reference: {
      ...(ref ?? {}),
      ageMs: Number.isSafeInteger(ref?.publishedAt)
        ? now - ref.publishedAt
        : null,
      observedAgeMs: Number.isSafeInteger(ref?.observedAt)
        ? now - ref.observedAt
        : null,
      classification,
      isCurrentFairValue: false,
      usage: live
        ? 'LIVE_REFERENCE_SANITY_CHECK'
        : 'ECONOMIC_ANCHOR_AND_DISLOCATION_ONLY',
      qualified: reasons.length === 0
    },

    usdc: {
      denomination: 'USDC',
      requiredForRelativeRanking: false,
      guardStatus: usd
        ? ugReasons.length
          ? 'DEPEG_DETECTED'
          : 'WITHIN_THRESHOLD'
        : 'UNKNOWN',
      conversionAvailable: !!usd,
      price: usd ? ur.price : null,
      publishedAt: ur?.publishedAt ?? null,
      ageMs: Number.isSafeInteger(ur?.publishedAt)
        ? now - ur.publishedAt
        : null,
      thresholdBps: policy.usdcDepegThresholdBps,
      maxAgeMs: policy.usdcGuardMaxAgeMs,
      deviationBps: depeg
        ? display(depeg, 6)
        : null,
      confidenceStatus:
        ur?.confidenceStatus ?? 'UNKNOWN',
      evidence: up,
      warningCodes: ugWarnings
    },

    gates: [
      equityGate,
      usdcGate
    ],

    warningCodes: unique([
      ...warnings,
      ...ugWarnings
    ]),

    price,
    usd,
    live,

    reasonCodes: unique([
      ...reasons,
      ...ugReasons
    ])
  };
}