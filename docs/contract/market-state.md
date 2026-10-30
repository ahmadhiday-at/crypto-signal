# Market State contract

Field-by-field contract for the Market State JSON; this document is the single source of truth for the **Market State** object — the per-symbol summary served by `GET /api/market/:symbol` and stored in `data/market/{MARKET}.json`.

The dashboard (`public/market_view.html`) depends on it, and so do the AI prompts (`PROMPT_AI_*.md`), which the user maintains manually outside this workflow. Any change to a field name, type, unit, or allowed value must be made here first, and the dashboard must be updated in the same change.

The server validates every Market State against this contract (`src/services/contract.js`) before writing it. An object that fails validation is not published; the previous file stays in place and the failure is reported as `invalid_summary`.

---

## 1. Versioning

| Version | Status     | Notes |
| :------ | :--------- | :---- |
| `1`     | Superseded | No `schema_version` field. Built partly from the still-forming candle and carried no freshness metadata. No longer produced; stored v1 files are ignored and rebuilt. |
| `2`     | Current    | Adds `schema_version`, `generated_at`, `inputs`, `status`, `errors`. All signal fields come from **closed candles only**. |

**Change policy**

- **Additive** (new optional field, new metadata): minor change, no consumer update required.
- **Breaking** (rename, removal, type/unit change, change of meaning, new or removed enum value): bump `schema_version` and update the dashboard in the same change; note the change in the changelog so the prompts can be updated manually.

---

## 2. Conventions

- **Time:** Unix seconds, UTC. Candle boundaries are UTC; weekly candles open on Monday 00:00 UTC (Binance convention).
- **Candle close time:** the end of the candle interval, i.e. open time + timeframe length. A candle is **closed** once the current time has reached its close time.
- **Prices:** quote currency of the pair (USDT for `*USDT`).
- **Fractions vs percentages:** `distance.*` is a fraction (`0.0069` = 0.69%); `distance_percent.*` is the same value in percent.
- **Entry timeframe:** the timeframe assigned to the `TF_ENTRY` role (default `15m`). Fields marked *entry TF* are taken from it.
- **Role timeframes:** `TF_HTF`, `TF_STRUCTURE`, `TF_MID`, `TF_ENTRY` (default `1d`, `4h`, `1h`, `15m`). Only these feed the Market State. Other configured timeframes are used for charts only.
- **Closed candles only:** every field below is derived from closed candles. The forming candle and the live ticker price never enter the Market State.

---

## 3. Fields (version 2)

Consumers: **D** = dashboard, **P** = AI prompts.

| Field | Type | Values / unit | Source | Used by |
| :---- | :--- | :------------ | :----- | :------ |
| `schema_version` | number | `2` | — | D |
| `market` | string | e.g. `BTCUSDT` | — | D, P |
| `timeframe` | string | always `"multitimeframe"` | — | P |
| `timeframe_list` | string[] | role timeframes, e.g. `["1d","4h","1h","15m"]` | config | P |
| `price` | number | close price of the latest **closed** entry-TF candle. Not a live price. | entry TF | D, P |
| `timestamp` | number | open time of the latest **closed** entry-TF candle | entry TF | — |
| `context` | enum | see §4 | derived | P |
| `momentum` | enum | `bullish` \| `bearish` \| `neutral` | entry TF | P |
| `regime` | enum | `trending` \| `ranging` \| `unknown` | entry TF | P |
| `ohlcv` | object | `{time, open, high, low, close, volume}` of the latest closed entry-TF candle (`time` = open time) | entry TF | P |
| `indicators` | object | latest closed-candle values: `ma14`, `ma50`, `ma200`, `rsi`, `atr`, `volume`, `macd{MACD, signal, histogram}` | entry TF | D, P |
| `levels.support` | Level[] | 1–3 levels, sorted by `score` descending (see §3.1) | merged MTF | D, P |
| `levels.resistance` | Level[] | 1–3 levels, sorted by `score` descending | merged MTF | D, P |
| `timeframes` | object | `{ [tf]: {price, context, momentum, regime, timestamp} }` per role TF; `timestamp` = open time of that TF's latest closed candle. Per-TF `context` is `near_support` \| `near_resistance` \| `mid_range` \| `unknown` (no `compression_zone`). | each role TF | D |
| `position` | enum | `closer_to_support` \| `closer_to_resistance` \| `mid_range` | derived | P |
| `zone_state` | enum | `normal` \| `compression` | derived | — |
| `dominant_side` | enum | `support` \| `resistance` \| `equilibrium` — the side whose top level has the higher raw score, or `equilibrium` when the gap is at most 20% of the larger score | derived | P |
| `market_pressure` | enum | see §4 | derived | D, P |
| `market_energy` | enum | `explosive` \| `building` \| `cooling` \| `stable` | derived | D, P |
| `volume_state` | enum | `high` \| `increasing` \| `normal` \| `low` — latest closed volume vs the average of the last 20 closed candles (including that one) | entry TF | P |
| `breakout_score` | number | 0.0–1.0, **heuristic, uncalibrated** (see §5) | derived | D, P |
| `breakout_confirmation` | enum | `strong` \| `medium` \| `weak` \| `noise` \| `none` | derived | — |
| `setup_state` | enum | see §4 | derived | D, P |
| `fake_breakout_risk` | enum | `low` \| `medium` \| `high` | derived | D, P |
| `regime_global` | enum | see §4 | all role TFs | D, P |
| `distance.to_support` | number | fraction, distance from `price` to `levels.support[0].mid` | derived | P |
| `distance.to_resistance` | number | fraction, distance from `price` to `levels.resistance[0].mid` | derived | P |
| `distance_percent.*` | number | same as `distance.*`, in percent | derived | D, P |
| `generated_at` | number | when this object was built and written | — | D |
| `inputs` | object | `{ [tf]: {candle_close_time, age_seconds, status} }` for every role TF (see §6) | each role TF | D |
| `status` | enum | `ok` \| `degraded` \| `stale` (see §6) | derived | D |
| `errors` | string[] | unresolved error codes (see §6.3); empty when healthy | — | D |

### 3.1 Level object

| Field | Type | Meaning |
| :---- | :--- | :------ |
| `low`, `high` | number | zone bounds (zone width is ATR-based) |
| `mid` | number | zone centre |
| `touches` | number | number of swing pivots in the zone. **May be absent** on a fallback level (see §5). |
| `tfs` | string[] | role timeframes that contributed to this zone |
| `score_raw` | number | sum of timeframe-weighted scores. Comparable only within the same object. |
| `score` | number | `score_raw` normalised to 0–10 against the highest level **on the same side of the same object**. Not comparable across symbols or across time. |

---

## 4. Enumerations

| Field | Values | Meaning |
| :---- | :----- | :------ |
| `context` | `near_support`, `near_resistance`, `compression_zone`, `mid_range` | Where `price` sits relative to the top-scored zones. `compression_zone` = top support and top resistance overlap around price. |
| `market_pressure` | `bullish_compression`, `bearish_compression`, `neutral_compression`, `bullish_lean`, `bearish_lean`, `balanced` | `*_compression` only when `zone_state = compression`; otherwise a lean from `dominant_side` (`balanced` when it is `equilibrium`). |
| `setup_state` | `breakout_entry_ready`, `waiting_breakout`, `potential_bounce_entry`, `watching_support`, `potential_reject_entry`, `watching_resistance`, `no_trade` | An internal label, **not** a trade decision. |
| `regime_global` | `trending`, `ranging`, `unknown`, `weak_trend`, `mixed` | A single value when every role TF agrees. `weak_trend` when the TFs disagree and include both `trending` and `ranging`; otherwise `mixed`. |

Any value not listed here is a contract violation and is rejected before publishing.

---

## 5. Known semantics

1. **`distance.*` is measured to the highest-scored level, not the nearest one.** The nearest zone may not appear in `levels` at all if it is outside the top 3.
2. **`breakout_score` is a heuristic.** It combines distance to the top levels with volume state, plus a fixed bonus for compression. It has not been calibrated against outcomes and **must not be presented or interpreted as a probability**.
3. **Fallback levels.** When a timeframe has no pivot-based zone on one side, a zero-width level at the 100-candle high/low with `score: 1` and no `touches` is used.
4. **`price` lags the market by up to one entry candle.** It is the last closed close, by design. The live ticker price is available separately (WebSocket `price` messages) and is display-only.
5. **Volume comparison (changed in 2.0.0).** `volume_state`, `market_energy`, `breakout_score` and `fake_breakout_risk` now compare the latest closed volume with the average of the last 20 closed candles, as documented. Before 2.0.0 the volume history was not passed through, so `volume_state` was always `normal`.

---

## 6. Freshness and status

### 6.1 Inputs

For each role timeframe:

- `candle_close_time` — close time of the last closed candle used for this summary.
- `age_seconds` — `now − candle_close_time`.
- `status` — `stale` when `age_seconds > 2 × timeframe length`, `missing` when no valid snapshot exists or its close time is more than 60 seconds in the future (clock problem), otherwise `ok`.

`age_seconds`, `inputs[tf].status`, `status` and `errors` are **recomputed every time the object is served**, so a stored summary turns `stale` on its own once its inputs age, even if no update runs. The stored file keeps the values from when it was built.

The 2× threshold is the documented starting value ([operating-model.md → O5](../architecture/operating-model.md#o5-freshness-and-degraded-state)), not a market-data guarantee.

### 6.2 Overall `status`

Precedence: `stale` > `degraded` > `ok`.

| Status | When |
| :----- | :--- |
| `stale` | the entry TF input is `stale` or `missing`, **or** any role TF input is `missing` |
| `degraded` | the entry TF is `ok`, and one or more non-entry role TFs are `stale` |
| `ok` | every role TF input is `ok` |

A summary is only built when every role TF has a valid snapshot, so a served summary never has a `missing` input; `missing` only appears in the unavailable response ([rest.md](./rest.md#unavailable-market-state-http-503)).

### 6.3 Error codes

`errors` lists unresolved failures: the latest failure of a role TF that has not been followed by a success, a summary build failure, or an active Binance request pause.

| Code | Meaning |
| :--- | :------ |
| `binance_429` | rate limited; requests paused for `Retry-After` (default 60 s) |
| `binance_418` | IP banned; requests paused for `Retry-After` (at least 120 s) |
| `binance_451` | access restricted for legal/jurisdictional reasons; requests paused for 15 minutes, never retried in a loop |
| `binance_http` | other HTTP error from Binance; 5xx responses are retried 3 times first, 4xx are not retried |
| `timeout`, `network` | request timed out or could not connect (after 3 retries) |
| `invalid_response` | Binance returned malformed data; nothing was stored |
| `insufficient_data` | fewer than 200 closed candles |
| `calculation_failed` | indicator or summary calculation failed or produced non-finite values |
| `storage_failed` | a file could not be written |
| `missing_input` | a role TF has no valid snapshot, so no summary can be built |
| `invalid_summary` | the built summary failed contract validation and was not published |


---

## 7. Consumer rules

These apply to every consumer, including AI prompts and anyone pasting the JSON into an LLM.

1. **Check freshness before interpreting.** If `status` is not `ok`, show it prominently. AI analysis must return **WAIT** and state that the data is not current. An object with `error: "market_state_unavailable"` contains no market data at all ([rest.md](./rest.md#unavailable-market-state-http-503)).
2. **Never infer missing fields.** An absent field means "unknown", not a default.
3. **Treat `breakout_score` as a ranking heuristic**, not a probability or confidence percentage.
4. **Treat `setup_state` as a label**, not a trade instruction.
5. **Do not trust objects without `schema_version: 2`.** They are not produced by the current server.

> The AI prompt files (`PROMPT_AI_*.md`) do not yet include rule 1. Updating them is a separate, explicitly requested step.
