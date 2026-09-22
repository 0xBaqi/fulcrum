import test from 'node:test';
import assert from 'node:assert/strict';

import {fixture} from '../fixtures/execution.mjs';

import {
  strictAsset as frozenStrictAsset,
  materialGuard as frozenMaterialGuard
} from '../src/execution/guard.mjs';

import {
  strictAsset as appStrictAsset,
  materialGuard as appMaterialGuard,
  replayWithPythPro
} from '../src/app/execution-guard.mjs';

import {bundleSnapshot} from '../src/execution/pipeline.mjs';
import {bundleSnapshotWithPythPro} from '../src/app/live.mjs';

test('app execution bundler preserves legacy V4 result', () => {
  const snapshot = structuredClone(fixture().snapshot);

  assert.deepEqual(
    bundleSnapshotWithPythPro(structuredClone(snapshot)),
    bundleSnapshot(structuredClone(snapshot))
  );
});

test('app strict asset preserves legacy execution semantics', () => {
  const analysis = fixture();

  assert.deepEqual(
    appStrictAsset(structuredClone(analysis)),
    frozenStrictAsset(structuredClone(analysis))
  );
});

test('app replay verifies a legacy execution bundle', () => {
  const analysis = fixture();

  assert.deepEqual(
    replayWithPythPro(structuredClone(analysis)),
    analysis.result
  );
});

test('app material guard preserves legacy execution semantics', () => {
  const analysis = fixture();
  const comparison = structuredClone(analysis);

  const finalQuote = structuredClone(
    analysis.snapshot.candidates.find(
      candidate => candidate.symbol === analysis.result.winner
    ).quote
  );

  const now = analysis.snapshot.asOfMs;

  assert.deepEqual(
    appMaterialGuard(
      structuredClone(analysis),
      structuredClone(comparison),
      structuredClone(finalQuote),
      now
    ),
    frozenMaterialGuard(
      structuredClone(analysis),
      structuredClone(comparison),
      structuredClone(finalQuote),
      now
    )
  );
});