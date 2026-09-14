# Milestone 2A — real wallet-bound validation completed

**Milestone 2A is complete under the unfunded-validation acceptance criteria.** The transaction was constructed, inspected and simulated without signing or broadcasting. Funded Milestone 2 execution remains unvalidated.

Wallet: DJMzc3nnV1eELWXRK1ZUzhUtEASuizaJe8FRMgGry76u

## Exact live result

- Input: **1 USDC**, 1000000 raw units; winning representation: **TSLAx**.
- Verified mint: **XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB**.
- Constructed at 2026-09-13T13:19:43.000Z; versioned Solana transaction with Jupiter **route_v2** and chain-loaded address lookup table.
- Input ATA: 3Aid25phdCbBoF5SRSfMoHBFYF893BRWhBMexBd4Vteb.
- Destination ATA: EZm9z2TiVExk49UhypBttQZrj194bdK4MPRfWKNTFuuY, owned by the supplied wallet and bound to the verified Token-2022 mint.
- Analyzed minimum: **273354 raw units**. Final protected minimum: **273628 raw units**, or **0.00273628 TSLAx**. These are quoted amounts, not received tokens.
- Material-change guard: **FINAL_REQUOTE_PASSED**; improvement **10.023632359 bps**, within the configured 50 bps degradation limit.
- Final quote age at simulation response: **2219 ms**; simulation slot **446712708**.
- Source USDC account: **absent**, so available source balance is **0 USDC**.
- SOL balance before and after: **5153833 lamports (0.005153833 SOL)**, unchanged. Quoted/simulated network fee: **19000 lamports**, not paid.
- Live blocker: **INSUFFICIENT_USDC**. Exact simulation result: **InstructionError [3, Custom 6025]**, Jupiter **InvalidTokenAccount**. The pinned IDL separately defines InsufficientFunds as 6024; we do not mislabel 6025 as that error. The source USDC account is missing, consistent with the unfunded input. Funding the configured USDC source account is required before a swap can execute.
- Simulation successfully reached Token-2022 associated-account initialization and Jupiter RouteV2. The swap itself did not complete.
- All transaction signature bytes remain zero. There was no wallet signing request and no sendTransaction RPC. Transaction signature and actual received amount are **null**.

Reason codes: FINAL_REQUOTE_PASSED, TRANSACTION_INSPECTED, TRANSACTION_SIMULATION_ATTEMPTED, TRANSACTION_SIMULATION_FAILED, INSUFFICIENT_USDC. Simulation failure is an expected unfunded-source blocker, not reported as an implementation failure.

## Inspection and compatibility

Inspection verified the wallet signing authority, canonical USDC input, exact Tesla output mint, derived wallet destination, input amount, encoded slippage, protected minimum, zero platform/positive-slippage fees, and allowed instruction/program structure. The output token program is TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb. Simulation logs show successful Token-2022 account sizing and initialization before the missing-source-account error. Setup in simulation did not create an actual account or debit the wallet.

The real build revealed a one-unit rounding defect in our validator. Jupiter's protected minimum uses ceiling division; the old validator used floor division and rejected the legitimate 273772 minimum for a 275147 expected output at 50 bps. The validator now uses exact BigInt ceiling division. A regression test accepts that exact minimum and rejects 273773, retaining the minimum-output protection. Jupiter's published aggregator audit documents checked_ceil_div: https://dev.jup.ag/assets/files/Jupiter-Aggregator-Apr-2024-0c8eea115e78830ed70ce748b47debfa.pdf . No M1 policy or representation gate changed.

## Evidence and tests

- **160 tests passed, zero failures**: all 123 M1 tests plus 37 execution tests.
- 7 new analysis/receipt captures replay deterministically, including rejected attempts.
- Authoritative receipt: [m2a-wallet-attempt4-2026-09-13.json](evidence/execution/m2a-wallet-attempt4-2026-09-13.json).
- Independent post-check: [m2a-wallet-verification-2026-09-13.json](evidence/execution/m2a-wallet-verification-2026-09-13.json).
- [Test output](validation/milestone-2a-wallet-tests.txt), [replay results](validation/milestone-2a-wallet-replays.json), [exact file hashes](validation/milestone-2a-wallet-files.json).

Earlier attempts are preserved: initial network denial, a future-timestamp issuer rejection, and the minimum-rounding rejection. The final attempt passed the existing strict comparison. Ondo's live API explicitly rejected its quote outside market hours; its mandatory issuer/corporate-action exclusions also remain intact. No stale capture was substituted for a fresh strict winner.

## Commands executed

The preparation command was run four times, preserving separate captures:

    node --use-system-ca --env-file-if-exists=.env src/execution/cli.mjs prepare --wallet DJMzc3nnV1eELWXRK1ZUzhUtEASuizaJe8FRMgGry76u --out evidence/execution/NAME.json

NAME values: m2a-wallet-live-2026-09-13, m2a-wallet-live-network-2026-09-13, m2a-wallet-attempt3-2026-09-13, m2a-wallet-attempt4-2026-09-13.

    node --test test/execution.test.mjs
    npm test > validation/milestone-2a-wallet-tests.txt

Additional inline Node checks decoded the pinned IDL error, replayed the receipt, verified zero signature bytes, enumerated RPC methods, and made a read-only getBalance post-check. Only read-only RPC methods and simulateTransaction appear in live evidence. No signing, funding, or broadcast command was run.

## Remaining funded validation

A future funded test needs a new strict analysis, fresh wallet-bound requote/transaction, successful simulation, explicit wallet approval, authorized broadcast, confirmation and actual token-balance verification. The saved transaction is expired and must not be reused. No funding is requested now. Previously documented moderate SDK dependency findings and lack of independent security audit remain; this run proves preparation/inspection and an attempted unfunded simulation, not a successful swap.

## Exact files changed in this continuation

- src/execution/transaction.mjs
- test/execution.test.mjs
- MILESTONE_2A.md
- MILESTONE_2A_WALLET.md
- BUILD_LOG.md
- evidence/execution/m2a-wallet-attempt3-2026-09-13.json
- evidence/execution/m2a-wallet-attempt3-2026-09-13.json.analysis.json
- evidence/execution/m2a-wallet-attempt4-2026-09-13.json
- evidence/execution/m2a-wallet-attempt4-2026-09-13.json.analysis.json
- evidence/execution/m2a-wallet-live-2026-09-13.json
- evidence/execution/m2a-wallet-live-2026-09-13.json.analysis.json
- evidence/execution/m2a-wallet-live-network-2026-09-13.json
- evidence/execution/m2a-wallet-live-network-2026-09-13.json.analysis.json
- evidence/execution/m2a-wallet-verification-2026-09-13.json
- validation/milestone-2a-wallet-tests.txt
- validation/milestone-2a-wallet-replays.json
- validation/milestone-2a-wallet-files.json
