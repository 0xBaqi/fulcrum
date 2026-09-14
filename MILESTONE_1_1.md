# Stocklana Milestone 1.1 — strict live validation

## Scope and preservation

Extended the existing engine; no rebuild, UI, wallet signing, transaction submission, new equities or unrelated features. Original 52 tests and three original captures remain byte-for-byte unchanged, checked against `preservation/milestone-1-sha256.json`. `src/engine-v1.mjs` freezes the original evaluation behavior for historical replay. New live captures use schema 2 and engine version 0.1.1.

## Behavior changes

- Evaluate mandatory evidence independently for each representation. Exclude missing/unknown/failed candidates, then rank survivors. One fully verified survivor is a valid strict winner; an excluded competitor's quote timing or optional data cannot block it. Missing shared NVDA/USD or USDC/USD references still block all candidates.
- Keep existing exact arithmetic and local gates. Do not weaken age, confidence, deviation, slippage or corporate-action thresholds.
- Every gate records source, observation time, source timestamp and its basis, freshness state, verification state, outcome and reason codes. Raw body hashes and reparsed provider values bind decisions to saved observations.
- Pyth uses server-side `PYTH_API_KEY` as Bearer authentication to `https://pyth.dourolabs.app/hermes/v2/updates/price/latest`. Missing credentials and rejected credentials have distinct codes. No key enters captures or logs; the key is never sent to arbitrary endpoint overrides. NVDA/USD and USDC/USD publish times and confidence remain mandatory.
- Official public Ondo page establishes token identity, address, decimals and displayed share factor. It does not establish current corporate-action/halt coverage or share-factor freshness. Those claims remain `UNKNOWN`. The onchain mint confirms token/extension state, but is not treated as a complete offchain corporate-action schedule.
- RPC context-slot block time supports freshness of the mint observation and must match the captured `getMultipleAccounts` context. Pyth timestamp is the feed publish time. HTTP Date/Age is explicitly labelled a current-state response observation, not an issuer event timestamp.

## Verification meaning and boundaries

`VERIFIED` means the recorded source is allowed, the saved body hash matches, normalized values agree with reparsing, and stated source/time checks pass. This is not cryptographic Pyth signature verification, issuer attestation or tamper-proof evidence. Metadata API status coverage is scoped to what that endpoint states; neither token lists nor empty optional descriptions establish absence of corporate actions. No wallet-bound transaction is promised executable.

## Official sources

- [Pyth current Hermes and August-26 upgrade](https://docs.pyth.network/price-feeds/core/fetch-price-updates): Bearer credentials, latest-price endpoint and publish-time fields.
- [xStocks multiplier documentation](https://docs.xstocks.fi/developers/multipliers): current/pending factors and activation window; [public NVIDIA asset](https://api.xstocks.fi/api/v2/public/assets/NVDAx) supplies issuer identity and halt flag.
- [Official Ondo NVIDIA page](https://app.ondo.finance/assets/NVDAon): identity and displayed factor only. [Ondo status endpoint contract](https://docs.ondo.finance/api-reference/status/get-asset-statuses) documents explicit event/status coverage when authenticated; it is not inferred from the public page.
- Solana mainnet RPC: `getMultipleAccounts` for the two pinned mints and `getBlockTime` for that response's context slot.
- Jupiter `https://api.jup.ag/swap/v2/order`: contemporaneous $100 USDC exact-in routes and raw execution-compatible response data.

## Commands

From the existing repository directory:

```powershell
npm test
node --env-file-if-exists=.env -e "console.log(JSON.stringify({pythKeyAvailable:!!process.env.PYTH_API_KEY,ondoKeyAvailable:!!process.env.ONDO_API_KEY,jupiterKeyAvailable:!!process.env.JUPITER_API_KEY}))"
```

Read existing sources and Git status; copied the original evaluator and recorded original tests/evidence SHA-256 values before editing. Applied the update without changing those preserved files. Further live/test/replay commands and exact result are recorded below after final validation.

## Final result

**Implementation and regression checks pass; strict live acceptance remains blocked. Milestone 1 cannot yet be declared complete.**

Captured at **2026-09-12T23:47:48.643Z** (13 September, 00:47:48.643 Lagos). Exact input: 100 USDC / 100000000 raw units. Result: **`NO_WINNER`**, winner: `null`, strict ranking: `[]`, decision reason: `NO_VERIFIED_REPRESENTATION`.

| Captured quote | NVDAx | NVDAon |
|---|---:|---:|
| Router | dflow | jupiterz |
| Expected NVIDIA-equivalent shares | 0.456871919073 | 0.456179927251 |
| Minimum NVIDIA-equivalent shares | 0.454587549510 | 0.456179927251 |
| USDC / minimum share | 219.979627923359 | 219.211749632212 |

Quote request starts were **8 ms apart**; responses were **1 ms apart**. Both routes and both onchain mint checks succeeded. NVDAx passed all ten non-reference gates. Neither quote is a wallet-bound executable transaction.

**Pyth blocker:** HTTP 403, `PYTH_FEED_NOT_ENTITLED`, for NVDA feed `b1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593`. Pyth's response explicitly says no grant accepts this equity/spot feed. A separate diagnostic with the SAME key returned HTTP 200 for USDC/USD, with publish time 2026-09-12T23:46:52.000Z. This distinguishes missing NVIDIA entitlement from an invalid key. The joint reference request returned no price payload, so neither reference is inserted into that comparison; the separate USDC diagnostic is not retroactively spliced into it. No fresh NVIDIA price could be obtained. No last-close value or synthetic reference was substituted.

**Ondo exclusion:** `CORPORATE_ACTION_STATUS_UNKNOWN`, `ISSUER_STATUS_UNKNOWN`, `METADATA_TIMESTAMP_UNVERIFIED`, with corresponding gate-level `*_EVIDENCE_UNKNOWN` codes. These are independent of Pyth. Once NVDAx has fresh authorized references, these Ondo exclusions do not prevent NVDAx winning alone.

All NVDAx reason codes in the live result:

```text
PYTH_FEED_NOT_ENTITLED
REFERENCE_DEVIATION_EVIDENCE_UNKNOWN
REFERENCE_IDENTITY_MISMATCH
REFERENCE_NVDA_EVIDENCE_UNKNOWN
REFERENCE_NVDA_INVALID
REFERENCE_USDC_EVIDENCE_UNKNOWN
REFERENCE_USDC_INVALID
```

All NVDAon reason codes in the live result:

```text
CORPORATE_ACTION_EVIDENCE_UNKNOWN
CORPORATE_ACTION_STATUS_UNKNOWN
ISSUER_STATUS_EVIDENCE_UNKNOWN
ISSUER_STATUS_UNKNOWN
METADATA_FRESHNESS_EVIDENCE_UNKNOWN
METADATA_TIMESTAMP_UNVERIFIED
PYTH_FEED_NOT_ENTITLED
REFERENCE_DEVIATION_EVIDENCE_UNKNOWN
REFERENCE_IDENTITY_MISMATCH
REFERENCE_NVDA_EVIDENCE_UNKNOWN
REFERENCE_NVDA_INVALID
REFERENCE_USDC_EVIDENCE_UNKNOWN
REFERENCE_USDC_INVALID
```

Final snapshot SHA-256: `b6b57defd1cfd8b6d5275d5ce885885f80728694532aa83af07fb8ead46a030c`.

## Tests and replay

**73 tests passed, 0 failed**: all original 52 preserved, plus 21 new tests. Original test and capture bytes match the preservation manifest. All **6** snapshot bundles replayed deterministically, including the new synthetic single-survivor winner and the live exclusions. Results are saved in `evidence/milestone-1.1-tests-final.txt` and `evidence/milestone-1.1-verification.json`. The test runner uses no network. Synthetic evidence is explicitly marked and cannot be relabelled as a live winner.

## Final commands run

```powershell
npm version 0.1.1 --no-git-tag-version --ignore-scripts --offline
node --test > evidence/milestone-1.1-tests-final.txt
node --use-system-ca --env-file-if-exists=.env src/cli.mjs live --usdc 100 --out evidence/milestone-1.1-live-2026-09-13.json > evidence/milestone-1.1-cli-result-2026-09-13.json
node --env-file-if-exists=.env ../../work/finalize-m11.mjs
```

Additional diagnostic: a server-side request using the existing HTTP client to the official Hermes latest-price endpoint with only the pinned USDC feed; its unmodified response (excluding credentials) is saved in `evidence/pyth-usdc-access-2026-09-13.json`. New network permission was granted for this validation. Previous live attempt and CLI output remain in the 2026-09-12 files. That older capture used the broad `PYTH_CREDENTIAL_REJECTED` code; its raw response was the same entitlement denial. It remains unchanged for replay; the new adapter distinguishes entitlement failures explicitly.

The initial user-created `.env` was a folder containing an empty text file. It was preserved as ignored `.env.setup-backup`, and a proper ignored `.env` file was created from the example. The user supplied the key locally. No key is present in deliverables; configuration and backup directories are excluded from packaging.

## Files changed

Modified existing project files:

```text
.env.example
README.md
package.json
package-lock.json
src/engine.mjs
src/collect.mjs
src/providers.mjs
```

Added project files:

```text
MILESTONE_1_1.md
src/engine-v1.mjs
src/engine-v2.mjs
src/provenance.mjs
src/pyth.mjs
fixtures/strict.mjs
test/strict.test.mjs
preservation/milestone-1-sha256.json
evidence/milestone-1.1-cli-result.json
evidence/milestone-1.1-cli-result-2026-09-13.json
evidence/milestone-1.1-live-2026-09-12.json
evidence/milestone-1.1-live-2026-09-13.json
evidence/milestone-1.1-synthetic-survivor.json
evidence/milestone-1.1-tests.txt
evidence/milestone-1.1-tests-final.txt
evidence/milestone-1.1-verification.json
evidence/pyth-usdc-access-2026-09-13.json
```

Local-only configuration: `.env` and `.env.setup-backup/` (ignored, not packaged). Intermediate verification script: workspace `work/finalize-m11.mjs`. The original build log, original tests, original fixtures and original three captures remain untouched.

## Remaining action

Enable NVIDIA equity/spot entitlement on the Pyth key, or replace it locally with a key that has that entitlement; rerun the saved live command. The key's ability to fetch USDC does not grant access to NVIDIA. Freshness remains mandatory after access is enabled; ordinary equity prices may be stale outside their market session. Do not declare completion merely because credentials are accepted. No Ondo key is necessary for a single-survivor NVDAx outcome. No signing, submission or UI work was started.

