import {collect} from '../collect.mjs';
import {hash} from '../engine.mjs';
import {createHttp} from '../providers.mjs';

import {evaluateV4WithPythPro} from './engine-v4.mjs';
import {collectPythProReference} from './pyth-pro-reference.mjs';

export function bundleSnapshotWithPythPro(snapshot) {
  return Object.freeze({
    snapshotSha256: hash(snapshot),
    snapshot,
    result: evaluateV4WithPythPro(snapshot)
  });
}

export async function collectWithPythPro({
  amountRaw = '100000000',
  underlying = 'NVDA',
  env = process.env,
  fetchImpl = fetch,
  clock = Date.now
} = {}) {
  /*
   * The frozen collector knows about the old Pyth provider.
   * Never give the Pyth Pro credential to that provider.
   */
  const legacyEnv = {
    ...env,
    PYTH_API_KEY: ''
  };

  const snapshot = await collect({
    amountRaw,
    underlying,
    env: legacyEnv,
    fetchImpl,
    clock
  });

  /*
   * Pyth Pro is currently an explicitly supported TSLA reference path.
   * Other underlyings preserve the frozen collector result.
   */
  if (snapshot.order.underlying !== 'TSLA') {
    return snapshot;
  }

  if (!env.PYTH_API_KEY) {
    return snapshot;
  }

  const http = createHttp({
    fetchImpl,
    clock
  });

  const {reference, evidence} =
    await collectPythProReference({
      apiKey: env.PYTH_API_KEY,
      http
    });

  /*
   * Do not mutate the frozen collector's snapshot.
   *
   * Replace only the TSLA reference. USDC and every other reference,
   * candidate, warning and piece of issuer/quote evidence remain intact.
   */
  return {
    ...snapshot,

    references: {
      ...snapshot.references,
      TSLA: reference
    },

    evidence: [
      ...snapshot.evidence.filter(
        item =>
          item.id !== evidence.id &&
          item.id !== 'reference-pyth-TSLA'
      ),
      evidence
    ].sort((a, b) => a.id < b.id ? -1 : 1)
  };
}

