# Milestone 1 build log

Date: 2026-09-12. Scope: NVIDIA representation-aware core engine only.

## Implementation

- Initialized an isolated repository under `outputs/stocklana-engine`, branch `codex/stocklana-milestone-1`. No existing source files were overwritten. No remote configured, publication or transaction sent.
- Used the user's explicit implementation request and cached strategy preview. No callable `read_thread` tool was available after tool discovery; did not invent missing strategy details.
- Selected dependency-free Node 24 ES modules with the built-in test runner. No UI/framework or unrelated product features.
- Implemented issuer-backed canonical registry, onchain mint validation, concurrent Swap V2 quotes, precise economic normalization, deterministic conservative gates, reproducible ranking and snapshot replay.
- Preserved raw response bodies and request timings. Secrets remain environment-only and request headers are never saved. Custom RPC/reference URLs are omitted from evidence.

## Integration findings

1. Public xStocks API requires `network=Solana` (capital S). Initial lowercase probe returned validation error. Live issuer address and multiplier were retrieved and matched onchain.
2. Jupiter V1 returned `NO_ROUTES_FOUND` for NVDAon. Swap V2 returned both NVDAx via Metis and NVDAon via JupiterZ RFQ. Keyless requests worked; one reconnaissance Ultra request returned 429. Engine does not serialize retries that would hide quote skew.
3. Public Ondo API requests returned 403. Public issuer page supplied NVDAon address, 9 decimals and share factor. This fallback is explicitly blocked for freshness/status completeness. Authenticated adapter is based on documented contracts and fixture-tested, not live-credential-tested.
4. Both mint accounts use Token-2022 Scaled UI. NVDAon issuer factor `1.0017152487959898` versus chain factor `1.0017152487959897`: use the chain factor once, with a bounded discrepancy check. Initial implementation rejected this extension; live contract tests now cover it.
5. Pyth feed discovery was public, but latest-price updates returned 401. Current Pyth documentation confirms API-key requirement and the upgraded Hermes endpoint. No price was fabricated and USDC was not assumed to equal USD.
6. Sandbox networking initially returned EACCES; an approved outside-sandbox retry exposed certificate-chain errors. `node --use-system-ca` resolved certificate trust while retaining TLS validation.
7. The Tokens.xyz reconnaissance URL returned 404; the implementation uses verified issuer-backed canonical resolution and does not claim a Tokens.xyz adapter.

## Commands run

Workspace discovery (read-only): `Get-Location`; `rg --files -g AGENTS.md -g package.json -g README.md -g '*lock*'`; `Get-ChildItem -Force`; `node --version`; `npm --version`; `git --version`; reads for ancestor `AGENTS.md`; `git rev-parse --show-toplevel`. No applicable AGENTS.md found. The parent Git probe failed; an isolated repository was then initialized.

Reconnaissance: `node -e` public HTTP probes, followed by `node --use-system-ca -e` retries; `node --use-system-ca work/probe.mjs`. The probe source and full saved issuer/public-page responses remain in the workspace's `work/` directory. Source documentation was verified with web lookups. A supplemental xStocks price-data probe timed out and was not used as a reference-price fallback.

Repository commands (working directory: this repository):

```powershell
git -C . init -b codex/stocklana-milestone-1
npm test
node --use-system-ca src/cli.mjs live --usdc 100 --out evidence/live-2026-09-12.json
```

An early `npm test` ran while test files were still being written and reported zero tests; this is not counted as validation. The next run executed and passed 49 tests. Final commands and final test results are recorded below after validation.

## Initial live observation

`evidence/live-2026-09-12.json` preserves the first collector run, including the deliberately rejected Ondo scaled-UI case prior to adapter correction. Both quotes were received, and the provisional minimum-share ranking was NVDAon then NVDAx. It returned `NO_WINNER`. This original artifact is also used for offline tests of actual issuer/RPC response shapes; it is not relabelled synthetic or silently edited.

## Blockers and next milestone

- `PYTH_API_KEY`: required to validate fresh NVIDIA/USD and USDC/USD prices. Ordinary equity feeds can still be stale outside their session; an API key alone does not solve weekend reference freshness.
- `ONDO_API_KEY`: required for documented multiplier timestamps and event/status coverage. Page retrieval time is not issuer data freshness. Validating the authenticated contract with live credentials remains outstanding.
- Wallet-bound executable transactions and all-in fees are outside this core-only milestone. Current quotes have `taker: null`, `transaction: null`; no trade was executed. Issuer-wide market closures, regional/user restrictions and balances need evaluation in the wallet milestone.
- First unblock and demonstrate a strict live winner without weakening gates. Then add only wallet-bound requote → gate → build → simulate → user sign → receipt reconciliation. Preserve raw/shares distinction throughout.

## Final verification

**52 tests passed, 0 failed, 0 skipped.** Coverage includes economic winner reversal, exact ties and precision boundaries, freshness/confidence/identity gates, USDC reference requirement, corporate-action activation, malformed quotes, slippage bounds, rate-limit isolation, concurrent request dispatch, replay tampering, real issuer payload parsing, chain multiplier agreement and unsupported token extensions.

Final commands executed:

```powershell
npm test
node --use-system-ca src/cli.mjs live --usdc 100 --out evidence/live-final-2026-09-12.json
npm run demo -- --out evidence/demo.json
npm run replay -- --input evidence/demo.json
npm run replay -- --input evidence/live-2026-09-12.json
npm install --package-lock-only --ignore-scripts --offline
git status --short
rg --files --hidden -g '!.git/**'
node src/cli.mjs replay --input evidence/live-final-2026-09-12.json
```

Demo and all three evidence replays verified successfully. Dependency lock creation completed offline with one package (the project itself), no installed dependencies and zero reported vulnerabilities. The test suite is offline; no paid services or wallet credentials are required to run it.

Final live capture: **2026-09-12 18:59:05.190 UTC / 19:59:05.190 Lagos**. Request starts were **3 ms apart**; responses were **1 ms apart**. Both chain verifications passed. Both Jupiter responses were HTTP 200 and included real route/request data.

| $100 USDC exact-in | NVDAx | NVDAon |
|---|---:|---:|
| Router | Metis | JupiterZ RFQ |
| Active onchain share factor | 1.001701196801074 | 1.0017152487959897 |
| Expected share exposure | 0.455978672064 | 0.454949982202 |
| Minimum share exposure | 0.453698770090 | 0.454949982202 |
| USDC per minimum share | 220.410560028980 | 219.804382705671 |

The provisional minimum-exposure ranking is NVDAon → NVDAx, despite NVDAx having greater expected exposure. **Strict result: `NO_WINNER`**, because Pyth updates are inaccessible and Ondo page metadata does not prove freshness or action/halt coverage. These are observed incomplete acceptance conditions, not fabricated successful live execution. The synthetic fixture produces `WINNER: NVDAon` and verifies the deterministic success path.

Final live snapshot SHA-256: `7fe228eb5586e78f4f3689becfe0068862de7f3e301e14dd6e5eca7d3f58d3fa`.

## Exact project files added

No pre-existing project files were modified or removed. All paths below are relative to this repository:

```text
.env.example
.gitignore
BUILD_LOG.md
README.md
package.json
package-lock.json
src/registry.mjs
src/math.mjs
src/providers.mjs
src/collect.mjs
src/engine.mjs
src/cli.mjs
fixtures/synthetic.mjs
test/engine.test.mjs
test/providers.test.mjs
test/live-contracts.test.mjs
evidence/demo.json
evidence/live-2026-09-12.json
evidence/live-final-2026-09-12.json
```

Git initialization also created the standard `.git/` repository metadata. Intermediate workspace files (outside the deliverable repository): `work/probe.mjs` and `work/probe-0.txt` through `work/probe-8.txt`; these contain endpoint reconnaissance, not runtime dependencies. A source/evidence ZIP is supplied alongside the repository and excludes `.git` and secrets.


## 2026-09-13 — Tesla provider abstraction and keyless validation

Preserved all 73 prior tests and captures. Added approved Yahoo/Pyth provider adapters and Tesla issuer identities through context parameters in the existing evaluator. Fresh public-reference $100 run: NO_WINNER; TSLAx passed non-reference gates but both references were stale with unknown confidence. TSLAon additionally lacks mandatory issuer evidence. 97 tests pass; 7 saved bundles replay. Full commands, files, results, sources and blockers: [MILESTONE_1_1_TESLA.md](MILESTONE_1_1_TESLA.md).


## 2026-09-13 — Milestone 1.2 session-aware live winner

Added the versioned Nasdaq calendar, strict open/extended policy, qualified closed-market anchors and separate USDC depeg/conversion reporting. Preserved every representation-specific gate and schema 1–3 replay. At 2026-09-13T07:19:10.927Z, a fresh $100 Tesla run selected TSLAx as BEST_EXECUTION_CLOSED_MARKET; TSLAon remained excluded for unknown issuer/corporate-action facts. 123 tests pass; 8 bundles replay. Exact commands, files, results and limitations: [MILESTONE_1_2.md](MILESTONE_1_2.md). No wallet/UI work.


## 2026-09-13 — Milestone 2A wallet-bound execution pipeline

Preserved the 123-test M1 baseline and added 36 execution tests. Implemented final comparison/build guards, pinned-IDL transaction inspection, wallet-only signing, simulation, authorized submission, confirmation, token-balance verification, read-only recovery and deterministic receipts. Fresh 1 USDC analysis selected TSLAx; live preparation stopped at WALLET_PUBLIC_KEY_REQUIRED. No transaction was signed or broadcast. 2A live acceptance remains pending the public wallet address. Exact files, commands, evidence and risks: [MILESTONE_2A.md](MILESTONE_2A.md).


## 2026-09-13 — Milestone 2A unfunded wallet validation complete

Used the user-supplied public wallet to construct and inspect a real Jupiter route_v2 transaction for 1 USDC to TSLAx. Corrected ceiling rounding of the protected minimum and added a regression test. 160 tests pass. Simulation completed Token-2022 setup, then returned Jupiter 6025 InvalidTokenAccount: the required USDC source account is absent. Engine blocker INSUFFICIENT_USDC; wallet SOL unchanged at 5153833 lamports; no signing or broadcast. Receipt replay verified. Full details and exact files: [MILESTONE_2A_WALLET.md](MILESTONE_2A_WALLET.md).
