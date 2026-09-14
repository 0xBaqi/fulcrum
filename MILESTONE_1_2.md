# Stocklana Milestone 1.2 — session-aware reference validation

**PASS: Milestone 1's core-engine live acceptance is complete for Tesla under the explicit session policy.** The fresh $100 comparison selected **TSLAx** as the single verified survivor. No signing, transaction submission or UI was implemented.

## Exact live result

- Captured at **2026-09-13T07:19:10.927Z**.
- Input: **100 USDC**, raw amount **100000000**.
- Status: **WINNER**; strict winner: **TSLAx**; ranking: **["TSLAx"]**.
- Execution semantics: **BEST_EXECUTION_CLOSED_MARKET**.
- Market state: **UNDERLYING_WEEKEND**; New York civil date: **2026-09-13**.
- Calendar: **NASDAQ-US-EQUITIES-2026-PRE-OVERNIGHT-v1**, SHA-256 **cce825f65ae5dff0fc67f3d263045c3b87267db568f30671a58a03109ff9f9fc**.
- Full capture: [session-live-2026-09-13.json](evidence/session-live-2026-09-13.json).
- Snapshot SHA-256: **1d54cf6f6697e526f59bc675e5710ded24a59a266a71bf3dda15bcc8614a6236**.

| Representation | Decision | Quote age from start | Age since receipt | Minimum equivalent shares | USDC per minimum share |
|---|---|---:|---:|---:|---:|
| TSLAx | WINNER / eligible | 1322 ms | 561 ms | 0.271403790000 | 368.454692545008 |
| TSLAon | Excluded | 1320 ms | 497 ms | 0.272392042000 | 367.117920427352 |

Both Jupiter order requests succeeded with HTTP 200 and started 2 ms apart. Quote ages are measured **at the captured decision time**, not at replay or report-reading time. TSLAon's nominally better minimum output does not qualify for ranking because its mandatory issuer facts remain unknown. Every mandatory TSLAx gate passed. Wallet-bound transaction construction and execution remain outside this milestone; executionReady is false.

## Reference classification

Provider: **yahoo-chart**. Tesla reference: **$365.44**, timestamp **2026-09-11T20:00:00.000Z**, age **127150927 ms** (35.319702 hours).

Classification: **LAST_MARKET_REFERENCE**. It is the latest reported regular-market closing observation for Friday, September 11. It qualifies against that completed session's closing window. It is **not current fair value**, and this classification does not assert it is the newest trade across every extended-hours venue. Its original old timestamp, unknown provider delay, and unavailable confidence are retained. The provider was freshly queried; retrieval time never replaces the price timestamp.

The anchor is used only for economic context and a USD-converted dislocation indicator. Closed-market dislocation is non-mandatory. In the capture, TSLAx's anchor dislocation was **79.440882 bps**; this is not an executable-versus-current-fair-value spread.

## Exact decision reason codes

- `ALL_MANDATORY_GATES_PASSED`
- `CLOSED_MARKET_REFERENCE`
- `LAST_MARKET_CONFIDENCE_UNAVAILABLE`
- `NOT_CURRENT_FAIR_VALUE`
- `REPRESENTATIONS_EXCLUDED`
- `SINGLE_VERIFIED_SURVIVOR`
- `USDC_CONVERSION_OLDER_THAN_LIVE_REFERENCE_LIMIT`

## Exact exclusions

### TSLAon

- `CORPORATE_ACTION_EVIDENCE_UNKNOWN`
- `CORPORATE_ACTION_STATUS_UNKNOWN`
- `ISSUER_STATUS_EVIDENCE_UNKNOWN`
- `ISSUER_STATUS_UNKNOWN`
- `METADATA_FRESHNESS_EVIDENCE_UNKNOWN`
- `METADATA_TIMESTAMP_UNVERIFIED`

Ondo's official public asset page still establishes identity and its displayed share multiplier only. It does not independently establish current issuer halt status, corporate-action status or mandatory metadata freshness. No exception was added for these representation-specific gates.

## Session policy and calendar authority

The versioned definition was transcribed from [Nasdaq's 2026 calendar](https://www.nasdaqtrader.com/Trader.aspx?id=calendar) and [Nasdaq's session hours](https://www.nasdaq.com/market-activity/stock-market-holiday-schedule). All three official source pages were captured successfully in [session-calendar-sources.json](evidence/session-calendar-sources.json). America/New_York time includes DST; host time zone does not determine market state.

| State | Stock reference policy | Execution semantics |
|---|---|---|
| UNDERLYING_OPEN | Verified observation at most 120 seconds old; confidence requirement retained | BEST_EXECUTION_OPEN_MARKET |
| UNDERLYING_EXTENDED | Same freshness/uncertainty policy; regular-close prices cannot pass as extended observations | BEST_EXECUTION_EXTENDED_MARKET |
| UNDERLYING_CLOSED / WEEKEND / HOLIDAY | Qualified last-market observation; missing confidence allowed with explicit limitation | BEST_EXECUTION_CLOSED_MARKET |
| UNDERLYING_UNKNOWN | Fail closed until schedule is established | NO_VERIFIED_EXECUTION |

Closed-market qualification moves the existing 120-second observation tolerance to the **latest completed regular close**. For a regular-market last-trade reference, its timestamp must be within that final two-minute window. An aggregate reference may additionally fall within that day's known extended session. Older trading-day, future, unverified or invalid prices remain ineligible. The source response must have been observed within five minutes. Missing confidence may be disclosed for a qualified anchor; a reported excessive or invalid confidence still fails.

Current Jupiter quotes retain the **15-second** limit and all prior route, slippage, impact, identity, product, multiplier, chain and corporate-action gates. The reference exception never freshens an old executable quote.

Calendar limitations are explicit: the schedule is not a real-time emergency-halt feed. Early-close extended hours remain UNKNOWN until a specific exchange notice establishes them. The calendar expires on **December 6, 2026**, when [Nasdaq's announced overnight session](https://www.nasdaqtrader.com/TraderNews.aspx?id=ETA2026-46) changes the rules. A later version must be reviewed before those dates can authorize decisions. The calendar hash and policy version are stored in every new snapshot; unsupported or edited identities fail closed.

## USDC denomination and depeg handling

Ranking compares equal **USDC inputs** by exact slippage-protected share exposure. It never needs to assume that one USDC equals one USD. USD conversion is a separate reporting and guard concern.

Captured USDC/USD: **0.9996971**, timestamp **2026-09-13T07:17:04.000Z**, age **126927 ms**, deviation **3.029000 bps**. Guard: **WITHIN_THRESHOLD**.

The independently serialized prototype guard uses a **15-minute** maximum observation age and **100-bps** absolute peg-deviation threshold, plus a recently retrieved verified provider response. The longer horizon permits a slow conversion feed to inform a coarse depeg check without making it a high-frequency execution price. A recent verified deviation beyond that threshold blocks the guard. Missing or older conversion produces UNKNOWN, no fabricated price and explicit reporting limitations; it does not invalidate same-denomination relative execution. Tampered conversion evidence still fails. The quote's 120-second freshness status is retained separately, so the 126927 ms conversion does not silently become a fresh live stock reference. Yahoo's missing confidence remains disclosed; this is a point-price depeg check, not a confidence-bounded peg guarantee.

Open-market stock freshness and uncertainty checks remain mandatory even when USD conversion is unavailable. The USD-dependent deviation check is available only with qualified conversion. A missing cosmetic conversion never suppresses an otherwise eligible same-USDC winner.

## Validation and preservation

**123 tests passed; 0 failed.** The earlier **97 tests**, including the original 52 and subsequent additions, remain unchanged. The 20 pre-session test/evidence files match their saved hashes. All **8 saved bundles** replay under their original schema-specific policy.

The 26 new tests cover Friday regular trading, Friday extended and fully closed sessions, Saturday and Sunday, Labor Day, stale open-market prices, unknown live confidence, accepted last-market anchors, older-session rejection, stale executable quotes, missing/slightly older/expired USDC conversion, detected depeg, tampered conversion, single-survivor exclusion, non-mandatory closed-market dislocation, open-market deviation, DST transitions, early-close uncertainty, calendar expiry, edited policy identities, future/old observations and deterministic replay.

Validation records: [session-tests.txt](evidence/session-tests.txt), [session-verification.json](evidence/session-verification.json). All source response bodies, timestamps, route data and per-gate provenance are retained in the live capture. Hash/schema verification is not cryptographic source attestation; replay reproduces the captured decision, not present executability.

## Commands run

From the project directory:

```text
node --test > evidence/session-baseline-tests.txt          # 97 preserved tests pass
node --test > evidence/session-tests.txt                   # 123 tests pass
node --use-system-ca --env-file-if-exists=.env src/cli.mjs live --underlying TSLA --usdc 100 --public-reference --out evidence/session-live-2026-09-13.json > evidence/session-cli-result.json
git status --short
```

Workspace-root diagnostics and verification:

```text
node --use-system-ca work/capture-session-sources.mjs
node work/finalize-session.mjs
```

Read-only inspections used Get-Content, Get-Item, Get-ChildItem and node -e to inspect structured results. A node -e edit aligned package and lockfile versions with engine 0.2.0. The first source-capture attempt ran before its script was present and was retried successfully once the file existed. An earlier tool action was rejected by automatic approval review due to a usage-limit error; after the user resumed, all necessary work completed. No secret appeared in command arguments or deliverables. No commit, reset, merge, signing or submission was run.

Replay without contacting providers:

```text
node src/cli.mjs replay --input evidence/session-live-2026-09-13.json
```

## Exact files changed or added in Milestone 1.2

- .env.example
- README.md
- BUILD_LOG.md
- MILESTONE_1_2.md
- package.json
- package-lock.json
- data/nasdaq-calendar-2026-v1.json
- src/engine.mjs
- src/engine-v1.mjs
- src/engine-v2.mjs
- src/engine-v4.mjs
- src/collect.mjs
- src/market-session.mjs
- src/session-reference.mjs
- fixtures/session.mjs
- test/session.test.mjs
- preservation/pre-session-sha256.json
- evidence/session-baseline-tests.txt
- evidence/session-tests.txt
- evidence/session-calendar-sources.json
- evidence/session-live-2026-09-13.json
- evidence/session-cli-result.json
- evidence/session-verification.json

Workspace scripts: work/capture-session-sources.mjs and work/finalize-session.mjs. Old source/evidence archives were not overwritten. Private .env contents were not changed.

## Completion and remaining scope

**Milestone 1 can be declared complete for this captured Tesla core-engine validation.** The engine produced a reproducible strict live winner while transparently excluding a representation with unavailable mandatory issuer evidence, with correct closed-market semantics.

Remaining limitations: Ondo issuer evidence is still unavailable; Yahoo may be delayed and lacks confidence required for an open-market pass; the scheduled calendar has the explicit maintenance boundaries above; executionReady remains false. No wallet execution or UI work has started. The next milestone should be scoped separately from this validated core engine.
