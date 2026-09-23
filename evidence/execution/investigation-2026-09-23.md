# Fulcrum mainnet execution investigation — 23 September 2026

Status: the complete guarded preparation path reached READY_FOR_SIGNATURE. No mainnet transaction has been signed or broadcast by this investigation. Confirmation and a verified received-token receipt remain outstanding.

## Checkpoint and scope

The existing repository was clean at b7ad109. Work continues on codex/tslax-execution-fix; main remains the rollback checkpoint. The original 209 tests passed before changes. Final verification: 222/222 tests passed in the complete serial suite; all 209 original tests remain included. The build and deterministic live receipt replay passed. Two parallel reruns encountered local HTTP connection resets; the original HTTP test passed in isolation, rejected-request handling was tightened, and the complete serial rerun passed without relaxing any test or trading guard.

## Findings

1. The historical transaction successfully created and initialized the canonical Token-2022 destination ATA before invoking Jupiter. The saved failure originates inside BinaryFi program B72M6nyCLFgWiJtAN4naUTminMiTmyGcEqQHXwVeRdht and propagates through Jupiter. It is not evidence that the ATA derivation was wrong. Jupiter's own error names must not be assigned to another program's numeric error without that program's error definition.
2. Controlled fresh simulations through BinaryFi succeeded both with and without the explicit destinationTokenAccount parameter. An alternate direct Orca Whirlpool route also simulated successfully. A permanent BinaryFi/TSLAx incompatibility was therefore not reproduced. The exact historical internal cause remains unproven; no authoritative BinaryFi error definition was found.
3. Fresh unrestricted Jupiter builds included intermediate USDT, SOL or USD1 account creation. Fulcrum's deliberately narrow inspector rejects these accounts. The request now specifies direct routes, matching the inspector's supported input/output-account scope rather than weakening its restrictions. Returned route mints and exclusions are checked explicitly.
4. After an actual route simulation failure, the application may make one fresh attempt excluding the failed route's venue labels. It repeats comparison, price protection, transaction inspection, funding, simulation and balance checks. Identity, funding, economic and inspection failures do not trigger this retry. The prior attempt is preserved inside the final receipt.
5. Some fresh Pyth timestamps were about three seconds ahead of local time. The wallet session and preparation CLI allow up to five seconds of actual waiting. Evidence timestamps and freshness rules remain unchanged; data still in the future or stale still fails.
6. The existing public operator surface had signing and broadcasting disabled. A separate loopback-only wallet page now connects the user's wallet to the existing signature-checking and confirmation pipeline. It requires explicit per-trade authorization, rejects changed transaction messages, re-simulates the signed transaction and blocks expired quotes. It never requests a private key or seed phrase. A submitted/uncertain transaction prevents another trade within that server session and can be reconciled read-only.

## Successful full-path simulation

- Wallet: DJMzc3nnV1eELWXRK1ZUzhUtEASuizaJe8FRMgGry76u
- Input: exactly 1,000,000 raw USDC units (1 USDC)
- Output mint: XsDoVfqeBukxuZHWhdvWHBhgEHjGNst4MLodqsJHzoB
- Destination: EZm9z2TiVExk49UhypBttQZrj194bdK4MPRfWKNTFuuY
- Route: BinaryFi through Jupiter
- Pre-simulation USDC: 2,700,000 raw units
- Post-simulation USDC: 1,700,000 raw units
- Simulated TSLAx received: 261,586 raw units (0.00261586 tokens)
- Protected minimum: 261,347 raw units (0.00261347 tokens)
- Network fee: 19,000 lamports
- Simulated total SOL cost including ATA creation: 1,578,560 lamports
- Pre-balance slot: 449750538
- Receipt status: READY_FOR_SIGNATURE
- Deterministic receipt replay: passed

This was a simulation, not a completed purchase. These quotes have expired and cannot be reused for signing.

## Route research

Jupiter's /build path uses Metis onchain routing and returns inspectable raw instructions. Its /order path additionally supports other routing engines, including RFQ; those transactions cannot simply replace the currently inspected Jupiter program path without implementing equivalent verification for their programs and signers.

Sources: [Jupiter build documentation](https://developers.jup.ag/docs/swap/build/index), [Jupiter order and execute](https://developers.jup.ag/docs/swap/order-and-execute), [Jupiter routing and program-label documentation index](https://developers.jup.ag/docs/llms.txt).

xStocks xChange supports Solana and Token-2022 atomic transactions, but requires a Backed API key and a registered wallet. Asset availability, minimum order size and trading status must be checked through that integration. It is not a verified public $1 fallback for the current wallet. No xChange account, API key or eligibility was assumed.

Source: [xChange integration guide](https://docs.xstocks.fi/developers/xchange-atomic-rfq).

## User-mediated completion

Run npm run execution:wallet in the existing repository and open http://127.0.0.1:4318 in the browser containing the wallet extension. Connect the intended account, prepare and simulate, review the fresh minimum and SOL cost, then explicitly authorize the transaction and approve it in the wallet. The 15-second quote freshness bound remains enforced even after signing; if expired, prepare again. Never retry an uncertain broadcast as a new trade: check confirmation first.

The server writes a deterministic receipt under evidence/execution/wallet-<timestamp>.json. A successful completion requires status SUCCEEDED, a confirmed signature, exactly 1 USDC deducted, and received TSLAx at least equal to the protected minimum. Restarting the server does not load an old session; preserve and inspect any previous receipt before starting another trade.
