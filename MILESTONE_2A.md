# Latest status: Milestone 2A complete

The real wallet-bound transaction has now been constructed, inspected and simulated. Its live blocker is the missing USDC source account. No funds were spent. See [wallet validation report](MILESTONE_2A_WALLET.md) for the current 160-test result and evidence.

---

The following preserves the historical pre-wallet implementation report.

# Milestone 2A — implementation and validation handoff

Status: execution pipeline implemented; **live acceptance remains incomplete**. The required real wallet-bound construction and simulation need the user's public wallet address, which has not been supplied. No funding is requested. No signing request, broadcast, transaction signature or received amount exists in live evidence.

## Exact live point reached

At 2026-09-13T08:02:30.641Z, a fresh **1 USDC** Tesla analysis selected **TSLAx**. TSLAx's protected quote minimum was **271217 raw units (0.00271217 TSLAx)**, not a received amount. Quote age measured from request start: TSLAx 1042 ms; TSLAon attempted request age 1040 ms, but its quote failed with HTTP_ERROR.

Analysis passed the existing closed-market policy with ALL_MANDATORY_GATES_PASSED, CLOSED_MARKET_REFERENCE, LAST_MARKET_CONFIDENCE_UNAVAILABLE, NOT_CURRENT_FAIR_VALUE, REPRESENTATIONS_EXCLUDED and SINGLE_VERIFIED_SURVIVOR. TSLAon remained excluded for unknown corporate actions, issuer status and metadata freshness, plus unavailable executable-quote evidence. The complete reason set is in the analysis capture.

Execution stopped at **WALLET_PUBLIC_KEY_REQUIRED**, before wallet-bound requoting, transaction construction, inspection or simulation. INSUFFICIENT_USDC is covered by automated tests, but is **not** claimed as an observed live balance: no wallet was queried. Material-change result, transaction signature and actual received amount are all null.

## Execution architecture

- The original engine, session policy, reason codes and replay captures remain byte-for-byte intact. A preservation test verifies the pre-execution manifest.
- A trusted server-owned strict analysis supplies the allowlisted Tesla mint and exact original USDC amount. Frontend mint input is never authoritative. Production rejects synthetic analysis; test injection is explicitly marked synthetic.
- Preparation obtains a fresh full comparison, then Jupiter Swap V2 /build for the reviewed winning mint and wallet. The final protected output must not degrade by more than **50 bps** against either the reviewed quote or fresh comparison. A changed strict winner or multiplier blocks execution. The built quote is also compared against any eligible rival.
- Quotes must remain within **15 seconds**, analysis within **5 minutes**, slippage at most **50 bps**, price impact at most **100 bps**. Thresholds live in policy.mjs. All mandatory M1 evidence is reevaluated at current time before signing.
- The pinned, program-owned Jupiter IDL decodes exact-in instructions. Inspection verifies signer, USDC source, verified output mint, wallet destination ATA, Token-2022 program, encoded amounts and minimum protection, and zero platform/positive-slippage fees. Unexpected instructions, tips, cleanup or setup operations fail closed. Only expected ATA creation is accepted. Compute budget comes from configuration.
- Address lookup tables are loaded from Solana and owner-checked; provider-supplied address expansions are not trusted. The pipeline constructs a real versioned transaction with a fresh blockhash.
- Preparation reads wallet balances and the network fee, then attempts unsigned RPC simulation. Missing USDC is explicit. A successful simulation must also prove the expected token deltas and a bounded SOL cost. Simulation failure prevents signing/broadcast.
- The browser-only wallet bridge connects the user-selected adapter and calls its signTransaction method. It holds no key or server credential. The server verifies the Ed25519 signature and exact reviewed message, then rechecks freshness and signed simulation.
- Broadcasting requires both server enablement and explicit per-call authorization. It is disabled by default and unavailable in the preparation CLI. Prepared state is bound in memory and cannot be altered or reused.
- Confirmation uses confirmed Solana transaction data. The returned message/signature, token mint/program/owner and actual raw pre/post balances are verified. Below-minimum output is reported with the actual amount, never success. Timeout or uncertain broadcast preserves the known signature; reconcile performs read-only recovery without resubmission.
- Receipts store analysis/comparison, quote timestamps and minima, exact degradation calculation, public wallet, inspected transaction, simulation, confirmation, balances, reason codes, event hashes and raw provider evidence. Default persistence is atomic file replacement. Replay recomputes the guard and confirmed received amount. No private keys are stored.

## Callable interface

Use executionPipeline().prepare(serverOwnedAnalysisBundle, walletPublicKey) on the server. The production default is allowBroadcast:false. Pass only src/execution/wallet.mjs to a browser integration, together with its wallet adapter and VersionedTransaction implementation; do not bundle the server pipeline.

For eventual funded execution, a trusted application enables broadcasting and calls submit(preparedReceipt, {signTransaction, authorizeBroadcast:true}) after user review. The signing callback must communicate with the user's wallet. A restarted application must prepare/review again; it may use reconcile(savedReceipt) to check an already-signed transaction.

No polished UI or public HTTP server was added. The current public-reference CLI fixes the test input at 1 USDC and cannot broadcast. The general production pipeline honors the configured reference provider, including optional Pyth credentials.

## Commands run

From the repository directory:

```powershell
npm install --save-exact --ignore-scripts --cache ../../work/npm-cache @solana/web3.js@1.99.0 @solana/spl-token@0.4.15
npm uninstall @solana/spl-token --ignore-scripts --cache ../../work/npm-cache
node --use-system-ca --env-file-if-exists=.env scripts/capture-jupiter-idl.mjs
npm test
node --test test/execution.test.mjs
node --test test/execution.test.mjs test/execution-safety.test.mjs
node --use-system-ca --env-file-if-exists=.env src/execution/cli.mjs prepare --out evidence/execution/m2a-live-2026-09-13.json
node src/execution/cli.mjs replay evidence/execution/m2a-live-2026-09-13.json
$env:NODE_OPTIONS='--use-system-ca'
npm audit --json --cache ../../work/npm-cache
```

The initial npm cache location was denied; installation succeeded with the workspace cache above. An audit invocation without system CA support failed certificate verification; retrying with NODE_OPTIONS succeeded. No insecure TLS bypass was used. Temporary research/edit scripts and command logs are under ../../work and are not runtime dependencies.

## Validation

**159 tests pass: 123 existing + 36 execution tests.** Coverage includes final-quote degradation/improvement, changed winner, expired signing, wrong mint/destination/signer, Token-2022 instructions, malformed instruction data, simulation failure and balance protections, unfunded wallet, wallet rejection, broadcast uncertainty, confirmation failure/timeout/reconciliation, actual received amount and deterministic receipt replay. Fixed signing keys exist only in fixtures/execution.mjs and are labeled test-only; those transactions are not live evidence.

See validation/milestone-2a-tests.txt and validation/milestone-2a-replays.json. Original captures are unchanged; the new live analysis and blocked receipt replay deterministically.

## Evidence sources

- Jupiter current build API: https://developers.jup.ag/docs/api-reference/swap/build
- Current migration path: https://developers.jup.ag/docs/swap/migration/metis-to-build
- On-chain, finalized Jupiter program-owned Anchor IDL: program JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4; IDL account C88XWfp26heEmDkmfSzeXP7Fd7GQJ2j9dDTUsyiZbUTa; slot 446649378; observed 2026-09-13T07:46:56.041Z; SHA-256 3f0edbf2d65ec7be16b655348bcf63af70f3e64d19c68d9535048808167cc460. Raw RPC evidence and the pinned interface are in data/execution.
- Live issuer, reference and quote sources retain their original URLs, response bodies, observation times and hashes in the analysis capture. RPC URLs are redacted by the evidence transport; API keys are not serialized.

## Remaining blockers and risks

1. Public wallet address is missing. It is required to exercise actual wallet-bound Jupiter construction and simulation. This is the current 2A acceptance blocker; do not declare 2A complete yet.
2. Actual funds, wallet approval, broadcast, confirmation and received-amount verification remain for the eventual funded mainnet test. No funds are needed for the next public-address preparation attempt.
3. Real route compatibility is not yet proven for this wallet. Unsupported instruction variants/setup paths deliberately block and need reviewed support if encountered. RPC/Jupiter failures or quote changes may also block preparation.
4. npm audit reports four moderate affected packages in the web3.js dependency tree, with no high/critical findings after removal of SPL-token. These remain unresolved; the old-version downgrade suggested by npm audit was not applied. Full audit is saved. This implementation has not had an independent security audit.
5. Confirmation is at Solana's confirmed commitment, not finality. An RPC outage can leave an unresolved signed transaction; reconcile before considering another trade. Receipt hashes provide reproducibility and tamper detection, not an independent cryptographic attestation of HTTP issuer claims.

## Exact files added or changed

- package.json
- package-lock.json
- BUILD_LOG.md
- MILESTONE_2A.md
- preservation/pre-execution-sha256.json
- src/execution/cli.mjs
- src/execution/guard.mjs
- src/execution/pipeline.mjs
- src/execution/policy.mjs
- src/execution/receipt.mjs
- src/execution/rpc.mjs
- src/execution/store.mjs
- src/execution/transaction.mjs
- src/execution/wallet.mjs
- fixtures/execution.mjs
- test/execution.test.mjs
- test/execution-safety.test.mjs
- scripts/capture-jupiter-idl.mjs
- data/execution/jupiter-current-idl.json
- data/execution/jupiter-idl-evidence.json
- data/execution/jupiter-idl-source.json
- evidence/execution/m2a-live-2026-09-13.json
- evidence/execution/m2a-live-2026-09-13.json.analysis.json
- validation/milestone-2a-tests.txt
- validation/milestone-2a-npm-audit.json
- validation/milestone-2a-replays.json
- validation/milestone-2a-files.json
