# Milestone 1.1 — Tesla reference-provider validation

Implementation complete; strict-live acceptance remains unmet. No private Pyth key was used. No wallet execution, transaction submission, UI, AI or portfolio work was added.

## Exact live result

Captured at **2026-09-13T00:11:51.148Z** for **100 USDC**, underlying **TSLA**, candidates **TSLAx / TSLAon**.

- Status: **NO_WINNER**; winner: **none**; strict ranking: **[]**.
- Decision reason: **NO_VERIFIED_REPRESENTATION**.
- Capture: [tesla-live-2026-09-13.json](evidence/tesla-live-2026-09-13.json).
- Snapshot SHA-256: `2f2d50e531e1139d8308e40c2b46cb6d7c390f071b5de56414803e2ebbe23fac`.
- Both Jupiter order responses were HTTP 200. No transaction was signed or submitted.

| Reference | Provider | Price | Source price timestamp | Age at decision | Session at observation |
|---|---|---|---|---|---|
| USDC | yahoo-chart | 0.9998593 USD | 2026-09-13T00:09:04.000Z | 167.148 seconds | regular |
| TSLA | yahoo-chart | 365.44 USD | 2026-09-11T20:00:00.000Z | 101511.148 seconds | closed |

Both references exceed the unchanged **120-second** age limit. Yahoo did not report an exact delay duration; both carry **POTENTIALLY_DELAYED_NOT_CERTIFIED_REALTIME**, delay status UNKNOWN, duration null. The Tesla price is the source's regular-market last trade, not an extended-hours substitute. Current period metadata indicates closed at retrieval. Confidence is **null / UNKNOWN**, never zero; the existing confidence requirement remains mandatory. Retrieved-at timestamps are separately retained and never substitute for price timestamps.

| Representation | Expected shares | Minimum shares | USDC per minimum share | Strict result |
|---|---:|---:|---:|---|
| TSLAx | 0.271882530000 | 0.270523110000 | 369.654185921491 | Excluded |
| TSLAon | 0.271424520000 | 0.271424520000 | 368.426551882637 | Excluded |

These are raw normalized quote comparisons, not an eligible ranking. TSLAx passed all ten non-reference gates. Ondo's public page establishes identity and the displayed multiplier; it does **not** establish current corporate-action state, issuer halt status, or mandatory metadata freshness. Those remain UNKNOWN and exclude TSLAon independently.

## Exact exclusion reason codes

### TSLAx

- `REFERENCE_DEVIATION_EVIDENCE_STALE`
- `REFERENCE_TSLA_CONFIDENCE_UNKNOWN`
- `REFERENCE_TSLA_EVIDENCE_STALE`
- `REFERENCE_TSLA_STALE`
- `REFERENCE_USDC_CONFIDENCE_UNKNOWN`
- `REFERENCE_USDC_EVIDENCE_STALE`
- `REFERENCE_USDC_STALE`

### TSLAon

- `CORPORATE_ACTION_EVIDENCE_UNKNOWN`
- `CORPORATE_ACTION_STATUS_UNKNOWN`
- `ISSUER_STATUS_EVIDENCE_UNKNOWN`
- `ISSUER_STATUS_UNKNOWN`
- `METADATA_FRESHNESS_EVIDENCE_UNKNOWN`
- `METADATA_TIMESTAMP_UNVERIFIED`
- `REFERENCE_DEVIATION_EVIDENCE_STALE`
- `REFERENCE_TSLA_CONFIDENCE_UNKNOWN`
- `REFERENCE_TSLA_EVIDENCE_STALE`
- `REFERENCE_TSLA_STALE`
- `REFERENCE_USDC_CONFIDENCE_UNKNOWN`
- `REFERENCE_USDC_EVIDENCE_STALE`
- `REFERENCE_USDC_STALE`

## Reference access investigation

1. The [current Hermes documentation](https://docs.pyth.network/price-feeds/core/how-pyth-works/hermes) specifies Bearer authentication at the upgraded endpoint. Both the legacy public and upgraded endpoint returned 401 for the exact Tesla equity feed without a key. Public USDC Hermes access also returned 401 during diagnostics.
2. The [Pyth Playground](https://docs.pyth.network/playground) documents a rate-limited shared demo when its key field is empty. Its public client sends a blank accessToken to its own stream proxy. A bounded request for feed 1435 (Equity.US.TSLA/USD), including confidence, exponent, marketSession and feedUpdateTimestamp, returned an application-level **WebSocket connection error**, followed by close code 1006. HTTP 200 alone was not treated as a price. See [demo capture](evidence/tesla-demo-probe.json). No shared token was extracted or stored.
3. Yahoo's public chart endpoint was accessible and was selected for TSLA and USDC. This endpoint is an integration availability risk, and its responses have no provider confidence interval. The adapter explicitly preserves those limitations.

## Implementation and provider contract

- The existing engine is reused through explicit underlying/provider context. Schema 1 and 2 continue to replay unchanged; schema 3 uses normalized references. No prices or feed identities are relabeled to masquerade as NVIDIA/Pyth.
- Provider interface: id, request(name), parse(capturedResponse, name). Approved adapters: Yahoo chart and Pyth Hermes. Both emit price, confidence, symbol/currency, publishedAt, observedAt, source/evidence identity, timestamp basis, delay and market-session information when available.
- Pyth activates automatically when PYTH_API_KEY is nonempty. Requests stay server-side at the fixed approved Hermes host. Each reference falls back independently on transport, credential, entitlement or parsing failure. A valid but stale Pyth response remains subject to the same gate; it is not silently refreshed or replaced with a fabricated value.
- The explicit --public-reference CLI flag disables private Pyth access even if an old key remains in local .env. This flag was used for the live run.
- Approval/provenance validation reconstructs the normalized object from captured raw bytes and checks the exact approved endpoint, hash, timestamps, request identity and synthetic/live classification. These are HTTPS/schema checks, not cryptographic oracle-signature verification.
- Every mandatory gate retains evidence sources, observation times, freshness and verification status. A verified source can still provide inadequate evidence: e.g. a correctly reconstructed price with UNKNOWN confidence cannot authorize a winner.
- Single-survivor selection remains enabled; missing optional rival data cannot poison an independently eligible representation. This live NO_WINNER is caused by mandatory reference failures affecting TSLAx itself.

## Evidence sources

- ondo-page: https://app.ondo.finance/assets/TSLAon (HTTP 200).
- quote-TSLAon: https://api.jup.ag/swap/v2/order?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=KeGv7bsfR4MheC1CkmnAVceoApjrkvBhHYjWb67ondo&amount=100000000&slippageBps=50 (HTTP 200).
- quote-TSLAx: https://api.jup.ag/swap/v2/order?inputMint=EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v&outputMint=XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB&amount=100000000&slippageBps=50 (HTTP 200).
- reference-yahoo-TSLA: https://query1.finance.yahoo.com/v8/finance/chart/TSLA?interval=1m&range=1d&includePrePost=true (HTTP 200).
- reference-yahoo-USDC: https://query1.finance.yahoo.com/v8/finance/chart/USDC-USD?interval=1m&range=1d&includePrePost=true (HTTP 200).
- solana-blocktime: solana-blocktime (HTTP 200).
- solana-mints: solana-mints (HTTP 200).
- xstocks-asset: https://api.xstocks.fi/api/v2/public/assets/TSLAx (HTTP 200).
- xstocks-multiplier: https://api.xstocks.fi/api/v2/public/assets/TSLAx/multiplier?network=Solana (HTTP 200).

## Validation

**97 tests passed, 0 failed.** All previous 73 tests remain byte-identical, including the original 52. All 7 saved bundle replays pass. The 14 pre-Tesla test/evidence files match their preserved hashes. Credential scanning found no configured API key in deliverables.

New tests cover public selection, future private-key activation, rejected credentials and entitlement fallbacks, partial provider availability, missing reference data, stale prices, unknown confidence, delayed labels, session/time/price tampering, unapproved sources, wrong feed/symbol/currency, single-survivor selection, and deterministic replay.

## Commands run

Commands below ran from the project directory unless prefixed with work/ (workspace root). No secret was passed in command arguments.

```text
npm test                                         # baseline after context refactor: 73 pass
node --use-system-ca work/tsla-probe.mjs           # public access, issuer and Yahoo diagnostics
node --use-system-ca work/demo-probe.mjs           # bounded documented shared-demo check
node work/refactor-tesla.mjs                      # context-preserving source edits
node --use-system-ca --env-file-if-exists=.env src/cli.mjs live --underlying TSLA --usdc 100 --public-reference --out evidence/tesla-live-2026-09-13.json > evidence/tesla-cli-result.json
node --test > evidence/tesla-tests.txt             # 97 pass
node work/finalize-tesla.mjs                      # old hash verification, all replays, secret scan, report
```

Additional read-only inspection used Get-Content, Get-ChildItem, Get-Item and bounded node -e public URL probes. One inline HTML-inspection command failed PowerShell quoting and was replaced by a file-based script. Workspace-root git status failed; git -C . status --short from the project succeeded and showed the existing untracked repository files. No commit, reset, merge or destructive command was run. An initial credential scan falsely treated a following configuration line as a key; using Node's dotenv parser corrected the scanner. The live CLI declares business exit code 2 for NO_WINNER (the Windows execution wrapper reported nonzero as 1).

Reproduce with the live command above using a **new output filename** to retain this capture; replay with:

```text
node src/cli.mjs replay --input evidence/tesla-live-2026-09-13.json
```

## Exact project files changed or added in this continuation

- .env.example
- README.md
- BUILD_LOG.md
- MILESTONE_1_1_TESLA.md
- package.json
- package-lock.json
- src/registry.mjs
- src/providers.mjs
- src/engine-v1.mjs
- src/engine-v2.mjs
- src/engine-v3.mjs
- src/engine.mjs
- src/provenance.mjs
- src/collect.mjs
- src/cli.mjs
- src/references.mjs
- fixtures/reference.mjs
- test/reference.test.mjs
- preservation/pre-tesla-sha256.json
- evidence/tesla-access-probes.json
- evidence/tesla-demo-probe.json
- evidence/tesla-live-2026-09-13.json
- evidence/tesla-cli-result.json
- evidence/tesla-tests.txt
- evidence/tesla-verification.json

Workspace diagnostic scripts: work/tsla-probe.mjs, work/demo-probe.mjs, work/refactor-tesla.mjs, work/finalize-tesla.mjs. Downloaded public inspection material stays in work/. No private .env contents were modified.

## Remaining blockers and next milestone

**Milestone 1 cannot yet be declared strictly complete.** The live-winner acceptance criterion has not been met: TSLA reference is stale during the closed market, USDC's captured price is over 120 seconds old, and the fallback supplies no confidence interval. A source reporting adequate, fresh price/uncertainty evidence is needed. Pyth Pro is optional, not a required purchase. Do not relax either gate to claim a pass.

Next: finish the reference-evidence gap and rerun the same $100 strict comparison when all mandatory reference evidence is available. TSLAon can stay excluded until its mandatory issuer facts are independently established. Only after a strict live survivor passes should execution integration be considered; no wallet/UI work is authorized by this continuation.
