# Wallet authorization lifecycle

The browser previously applied the 15-second quote limit to the whole human signing interaction. Approval now has a 120-second upper bound from the reviewed quote. Solana can expire the transaction earlier: Fulcrum retains the confirmed RPC blockhash and lastValidBlockHeight actually used to compile the transaction, and checks both getBlockHeight and isBlockhashValid before accepting the signature and again at the send boundary.

After signing, Fulcrum fetches fresh market evidence and a new reference quote. The original 15-second freshness, winner, mechanics and 50-basis-point material-change guards remain. The unchanged signed minimum must also stay within 50 basis points of both fresh minima in both directions and beat eligible alternatives. Fresh quotes never replace signed instructions.

The exact signed bytes are simulated with signature verification and without blockhash replacement. Current funding, exact USDC debit, minimum TSLAx credit, fees and SOL cost are rechecked. Following evidence persistence, chain validity and economics are checked again immediately before sending; signed simulation must also be within 15 seconds. Expiry or material change requires preparation and a fresh signature. There is no automatic resigning or broadcasting.

A receipt can be submitted once. Uncertain sends retain their signature for reconciliation and lock the session against another trade. Confirmed output verification and deterministic receipt replay remain required.

Validation: all 233 tests passed, including the original 209-test baseline. Regressions cover a 45-second signing delay, stale quote/comparison, approval expiry, expired block height, invalid blockhash, expiry at send, material deterioration, an old signed floor after market improvement, persistence delay, duplicate submission, and rejection of an old signature after rebuilding. Production build passed and excluded secrets and test signing fixtures.

Mainnet preparation evidence: authorization-ready-1usdc-2026-09-23.json. Exactly 1,000,000 raw USDC, Riptide route, protected minimum 262,210 raw TSLAx (0.00262210 tokens), READY_FOR_SIGNATURE, successful simulation and balance verification. This is unsigned historical evidence, not a completed trade or reusable transaction. Prepare a fresh transaction in the wallet page.

The agent has not signed or broadcast a mainnet transaction. The previous user-generated QUOTE_EXPIRED receipt is preserved.

Sources: [Solana confirmation](https://solana.com/developers/cookbook/transactions/confirmation), [getLatestBlockhash](https://solana.com/docs/rpc/http/getlatestblockhash), [isBlockhashValid](https://solana.com/docs/rpc/http/isblockhashvalid), [Jupiter build](https://developers.jup.ag/docs/swap/build/index).
