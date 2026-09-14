# Stocklana — core engine (Milestone 1.2, session-aware Tesla validation)

Milestone 1.2 adds a versioned Nasdaq session calendar and separates common-USDC execution ranking from USD conversion. New captures use schema 4; schemas 1–3 retain their original replay behavior. All 97 previous tests and their evidence are preserved. See [MILESTONE_1_2.md](MILESTONE_1_2.md) for the strict live TSLAx winner, exact commands, files, quote ages and limitations. The Milestone 1.1 reports remain historical records.

Core only: issuer-backed resolution of TSLAx/TSLAon (and existing NVDAx/NVDAon), concurrent Jupiter Swap V2 route quotes, exact share-exposure normalization, deterministic gates, JSON CLI and offline replay. Node 24+, no runtime or development dependencies. No UI, wallet connection, signing, trading, or deployment.

## Run

From this repository directory:

```powershell
npm test
npm run demo
npm run live -- --usdc 100 --out evidence/my-live.json
npm run live -- --underlying TSLA --usdc 100 --public-reference --out evidence/my-tesla-live.json
npm run replay -- --input evidence/my-live.json
```

`demo` uses clearly labelled synthetic inputs and demonstrates a winner reversal after share normalization. `live` never substitutes fixtures for unavailable services. Exit codes: **0** winner/demo or successful replay; **2** valid live `NO_WINNER`; **1** invalid input/runtime failure. Replay evaluates at the saved time, not today's time, and does not imply an old quote remains executable.

Optional setup: copy `.env.example` to `.env` and fill keys locally. `PYTH_API_KEY` activates authenticated Hermes; without it, the Yahoo chart adapter supplies explicitly labeled references. `--public-reference` forces keyless reference selection even if an old Pyth key remains locally. Reference qualification follows the session policy below. `ONDO_API_KEY` enables issuer metadata/status requests. `JUPITER_API_KEY` is optional for prototyping; keyless access can return 429. Supply `SOLANA_RPC_URL` if the public RPC is unavailable. TLS verification stays enabled; `--use-system-ca` trusts the operating system certificate store on this workstation. No key is logged in request headers or URLs.

## Decision contract

One underlying per run (`TSLA`/`Tesla`, or existing `NVDA`/`NVIDIA`), one direction (USDC → stock), equal exact-in USDC amount for both candidates. Resolver pins issuer-confirmed addresses and checks issuer identities, Solana token program and decimals live. This is a narrow canonical-asset resolver with issuer confirmation.

```
raw output / 10^mintDecimals × active shares-per-token = underlying-equivalent shares
raw minimum output / 10^mintDecimals × active shares-per-token = minimum shares
USDC input / minimum shares = USDC per minimum underlying-equivalent share
```

Rank by **maximum minimum shares**, with ascending mint as the exact-tie rule. Schema 2 excludes candidates with failed or unknown mandatory evidence, then ranks only independently verified survivors. A single survivor wins with `SINGLE_VERIFIED_SURVIVOR`; excluded candidates and their reasons remain visible. Pair timing is checked between eligible survivors; a failed competing request cannot invalidate a healthy candidate. Shared reference-price failures still exclude all candidates. Optional descriptions and API-key availability for a rival are not gates. Legacy schema 1 retains its original both-candidates-required rule for historical replay only. Shares represent comparable economic exposure, not identical legal ownership, issuer risk, redemption rights or tax treatment. All scoring arithmetic is rational BigInt. Jupiter output already reflects route/platform fees; wallet-dependent SOL fees and rent remain excluded and disclosed.

Defaults are serialized in every snapshot: quote age ≤15 seconds from request start; start skew ≤250 ms; response skew ≤5 seconds; metadata age ≤5 minutes; open-market stock reference age ≤2 minutes; reference confidence ≤100 bps; open-market effective-price deviation ≤300 bps when USD conversion qualifies; absolute Jupiter price impact ≤100 bps; slippage ≤50 bps; corporate-action exclusion ±15 minutes. These are explicit prototype policy choices, not issuer guarantees.

## Session-aware reference policy

The pinned Nasdaq cash-equity calendar uses America/New_York civil time, including DST, holidays and regular-session early closes. It distinguishes `UNDERLYING_OPEN`, `UNDERLYING_EXTENDED`, `UNDERLYING_CLOSED`, `UNDERLYING_WEEKEND`, `UNDERLYING_HOLIDAY` and fail-closed `UNDERLYING_UNKNOWN`. It describes the published schedule, not real-time emergency halts. Its validity ends at the announced December 6, 2026 overnight-session change; early-close extended hours require a specific exchange notice.

- Regular and extended sessions retain the 120-second stock-price and confidence requirements. An extended-session comparison cannot pass with a regular-close observation.
- Closed/weekend/holiday runs require a source-verified `LAST_MARKET_REFERENCE` from the latest completed regular session's final two minutes, or a later qualified aggregate observation within that trading day's known extended session. The provider must have been observed within five minutes. An older trading-day observation, future timestamp or unverified source still fails.
- Missing confidence is permitted for that closed-market anchor with `LAST_MARKET_CONFIDENCE_UNAVAILABLE`. A reported excessive or invalid confidence still fails. The anchor is explicitly **not current fair value**. Its dislocation is informational and cannot reject a route just because the traditional market is closed.
- Equal USDC inputs rank directly by protected share exposure. USD conversion is separate and never assumes a $1 peg. A verified USDC observation up to 15 minutes old supplies a 100-bps depeg guard; a detected depeg fails the guard. Missing/outdated conversion is explicitly UNKNOWN and does not invalidate relative ranking. Tampered conversion evidence still fails.

Winners are labeled `BEST_EXECUTION_OPEN_MARKET`, `BEST_EXECUTION_EXTENDED_MARKET` or `BEST_EXECUTION_CLOSED_MARKET`. `executionReady` remains false. Every representation-specific mandatory gate must pass, including corporate-action evidence; a closed market does not excuse missing Ondo issuer facts.

Current wallet-free `/order` responses contain route plans, request IDs and RFQ identifiers, but `transaction: null`. They are live execution-path quotes, **not wallet-bound executable transactions**. `executionReady` is always false for M1. A later wallet-bound quote, eligibility checks, transaction construction and simulation are required. No old RFQ request is promised executable; no inferred expiry is fabricated.

## Sources and adapters

| Component | Source and behavior |
|---|---|
| Canonical NVDAx | [xStocks public asset endpoint](https://api.xstocks.fi/api/v2/public/assets/NVDAx), underlying ticker/ISIN and Solana deployment; decimals checked onchain |
| xStocks exposure | [Multiplier documentation](https://docs.xstocks.fi/developers/multipliers); current/pending multiplier and activation, cross-checked with Token-2022 Scaled UI extension |
| Canonical NVDAon | [Issuer asset page](https://app.ondo.finance/assets/NVDAon), with documented [addresses endpoint](https://docs.ondo.finance/api-reference/assets/get-contract-addresses-for-an-asset) when authenticated |
| Ondo exposure/status | [Market metadata](https://docs.ondo.finance/api-reference/assets/get-market-data-for-an-asset) supplies `sharesMultiplier`; [asset statuses](https://docs.ondo.finance/api-reference/status/get-asset-statuses) supplies event intervals. Issuer display prices are not used as execution prices. |
| Quotes | [Jupiter Swap V2](https://developers.jup.ag/docs/llms.txt), `/swap/v2/order`; preserves complete response including routes, request/quote IDs and fees. V1 omitted the observed NVDAon RFQ route. |
| Reference | [Pyth Hermes](https://docs.pyth.network/price-feeds/core/fetch-price-updates), pinned ordinary NVDA/USD and USDC/USD feeds, exact prices, publish timestamps and confidence. API key required since the August 2026 upgrade. |

Ondo public-page fallback parses JSON data records without evaluating page scripts. It verifies identity and exposes the issuer share factor, but lacks a trustworthy observation timestamp and corporate-action completeness, so it cannot pass those gates. Onchain NVDAon has a Scaled UI extension: its factor replaces, rather than multiplies, the page's share factor after agreement within absolute `1e-12` (a documented float64 representation tolerance). The issuer and chain factors are both retained. Unsupported active transfer hooks, transfer fees, non-transferable tokens, frozen default account state and onchain pause are rejected or gated.

## Structure

```
src/registry.mjs       Narrow canonical resolver, pinned mints and feeds
src/math.mjs           Exact rational arithmetic and amount parsing
src/providers.mjs      HTTP evidence and provider response parsers
src/collect.mjs        Live orchestration and concurrent quotes
src/engine.mjs         Pure deterministic gates and ranking
src/engine-v1.mjs      Existing arithmetic/gates; original behavior is the default context
src/engine-v2.mjs      Strict survivor ranking using existing M1 arithmetic/gates
src/engine-v3.mjs      Explicit underlying and normalized-reference context
src/engine-v4.mjs      Session-aware reference gates and execution classification
src/market-session.mjs Versioned Nasdaq calendar with New York DST handling
src/session-reference.mjs Last-market qualification and separate USDC depeg policy
data/                 Pinned authoritative calendar definition and source links
src/references.mjs     Approved Yahoo/Pyth adapters, provenance reconstruction and fallback
src/provenance.mjs     Source, timestamp, freshness and verification per gate
src/pyth.mjs           Server-only current Hermes credentials and error handling
src/cli.mjs            Live/demo/replay interface
fixtures/synthetic.mjs Explicit synthetic reversal example
test/                 Engine, adapters and captured-live contract tests
evidence/             Raw responses, normalized snapshots and decisions
BUILD_LOG.md          Changes, commands, verification and remaining work
```

Evidence bundles include raw HTTP bodies, source IDs, request/receive times, selected response headers, body SHA-256, normalized metadata, full quotes, policy and evaluation time. Schema-2 gate records reparse the recorded bodies and bind normalized values to allowed official sources; they report `PASS`, `FAIL` or `UNKNOWN`, separate freshness and verification states, observation times, source timestamps and timestamp basis. Pyth publish time and Solana context-slot block time are explicit. HTTP Date minus Age establishes current-state response observation freshness, not an issuer event publication time. Ondo public-page metadata never establishes corporate-action state or data freshness.

`VERIFIED` means source identity, body consistency, parser/schema checks and the stated verification basis passed. Stable hashes are **not** provider signatures, attestations or a tamper-proof ledger. Pyth cryptographic signatures are preserved when supplied but not cryptographically verified. Do not accept caller-authored evidence bundles as authenticated trading authorization. Keys are environment-only, never in URLs or snapshots; echoed credentials are redacted and redacted responses cannot serve as strict evidence. The Pyth endpoint is pinned to the current official Hermes host to prevent sending credentials to arbitrary URLs.

## Acceptance status

The session-aware $100 Tesla live validation passed: TSLAx won as the single verified survivor under `BEST_EXECUTION_CLOSED_MARKET`. TSLAon retained its explicit unknown issuer/corporate-action exclusions. All 123 tests pass. The earlier NO_WINNER captures remain unchanged and replay under their historical policies. See [MILESTONE_1_2.md](MILESTONE_1_2.md) for exact results and remaining limitations.

Milestone 1's core-engine acceptance is complete for the captured Tesla validation. No wallet execution or UI has been started. The next product milestone requires separate scope; calendar maintenance and independently verified Ondo issuer evidence remain explicit limitations.
