# 📜 Data Contract: Market State

This document is the single source of truth for the **Market State** object — the per-symbol summary served by `GET /api/market/:symbol` and stored in `data/market/{MARKET}.json`.

The dashboard (`public/market_view.html`) and the AI prompts (`PROMPT_AI_*.md`) both depend on it. Any change to a field name, type, unit, or allowed value must be made here first, and the consumers must be updated in the same change.

> **Status legend**
> - **Current** — emitted by the system today.
> - **Planned** — agreed target, not emitted yet. Consumers must tolerate its absence.

---

## 1. Versioning

| Version | Status  | Notes |
| :------ | :------ | :---- |
| `1`     | Current | Implicit. The object has no `schema_version` field; its absence means version 1. |
| `2`     | Planned | Adds `schema_version`, freshness metadata and `status` (see §6). Purely additive. |

**Change policy**

- **Additive** (new optional field, new metadata): minor change, no consumer update required.
- **Breaking** (rename, removal, type/unit change, new or removed enum value): bump `schema_version` and update the dashboard and the prompts in the same change.

---

## 2. Conventions

- **Time:** Unix seconds, UTC.
- **Prices:** quote currency of the pair (USDT for `*USDT`).
- **Fractions vs percentages:** `distance.*` is a fraction (`0.0069` = 0.69%); `distance_percent.*` is the same value in percent.
- **Entry timeframe:** the timeframe assigned to the `TF_ENTRY` role (default `15m`). Fields marked *entry TF* are taken from it.
- **Role timeframes:** `TF_HTF`, `TF_STRUCTURE`, `TF_MID`, `TF_ENTRY` (default `1d`, `4h`, `1h`, `15m`). Only these feed the Market State. Other configured timeframes are used for charts only.

---

## 3. Fields (version 1, current)

Consumers: **D** = dashboard, **P** = AI prompts.

| Field | Type | Values / unit | Source | Used by |
| :---- | :--- | :------------ | :----- | :------ |
| `market` | string | e.g. `BTCUSDT` | — | D, P |
| `timeframe` | string | always `"multitimeframe"` | — | P |
| `timeframe_list` | string[] | role timeframes, e.g. `["1d","4h","1h","15m"]` | config | P |
| `price` | number | last close price of the entry TF at fetch time | entry TF | D, P |
| `timestamp` | number | open time of the latest entry-TF candle (see §5) | entry TF | — |
| `context` | enum | see §4 | derived | P |
| `momentum` | enum | `bullish` \| `bearish` \| `neutral` | entry TF | P |
| `regime` | enum | `trending` \| `ranging` \| `unknown` | entry TF | P |
| `ohlcv` | object | `{time, open, high, low, close, volume}` of the latest entry-TF candle | entry TF | P |
| `indicators` | object | latest values: `ma14`, `ma50`, `ma200`, `rsi`, `atr`, `volume`, `macd{MACD, signal, histogram}` | entry TF | D, P |
| `levels.support` | Level[] | up to 3, sorted by `score` descending (see §3.1) | merged MTF | D, P |
| `levels.resistance` | Level[] | up to 3, sorted by `score` descending | merged MTF | D, P |
| `timeframes` | object | `{ [tf]: {price, context, momentum, regime, timestamp} }` per role TF | each role TF | D |
| `position` | enum | `closer_to_support` \| `closer_to_resistance` \| `mid_range` | derived | P |
| `zone_state` | enum | `normal` \| `compression` | derived | — |
| `dominant_side` | enum | `support` \| `resistance` \| `equilibrium` | derived | P |
| `market_pressure` | enum | see §4 | derived | D, P |
| `market_energy` | enum | `explosive` \| `building` \| `cooling` \| `stable` | derived | D, P |
| `volume_state` | enum | `high` \| `increasing` \| `normal` \| `low` | entry TF | P |
| `breakout_score` | number | 0.0–1.0, **heuristic, uncalibrated** (see §5) | derived | D, P |
| `breakout_confirmation` | enum | `strong` \| `medium` \| `weak` \| `noise` \| `none` | derived | — |
| `setup_state` | enum | see §4 | derived | D, P |
| `fake_breakout_risk` | enum | `low` \| `medium` \| `high` | derived | D, P |
| `regime_global` | enum | see §4 | all role TFs | D, P |
| `distance.to_support` | number | fraction, distance from `price` to `levels.support[0].mid` | derived | P |
| `distance.to_resistance` | number | fraction, distance from `price` to `levels.resistance[0].mid` | derived | P |
| `distance_percent.*` | number | same as `distance.*`, in percent | derived | D, P |

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
| `market_pressure` | `bullish_compression`, `bearish_compression`, `neutral_compression`, `bullish_lean`, `bearish_lean`, `balanced` | `*_compression` only when `zone_state = compression`; otherwise a lean, decided by which side's top level has the higher raw score. |
| `setup_state` | `breakout_entry_ready`, `waiting_breakout`, `potential_bounce_entry`, `watching_support`, `potential_reject_entry`, `watching_resistance`, `no_trade` | An internal label, **not** a trade decision. |
| `regime_global` | `trending`, `ranging`, `unknown`, `weak_trend`, `mixed` | A single value when every role TF agrees. `weak_trend` when the TFs disagree and include both `trending` and `ranging`; otherwise `mixed`. |

Any value not listed here is a contract violation. Consumers should show it as-is and must not guess its meaning.

---

## 5. Known semantics (version 1)

These are properties of the current output that consumers must account for. Each one is addressed by a decision in [ARCHITECTURE.md → Operating Model](./ARCHITECTURE.md#operating-model).

1. **`timestamp` is not a freshness indicator.** It is the open time of the latest entry-TF candle, which may still be forming. The object does not record when it was generated or how old each role TF's input is (`timeframes[tf].timestamp` is that TF's latest candle open time).
2. **The latest candle may be forming.** `ohlcv`, `indicators.volume`, `volume_state`, `market_energy` and `breakout_score` can be based on an incomplete candle.
3. **`distance.*` is measured to the highest-scored level, not the nearest one.** The nearest zone may not appear in `levels` at all if it is outside the top 3.
4. **`breakout_score` is a heuristic.** It combines distance to the top levels with volume state, plus a fixed bonus for compression. It has not been calibrated against outcomes and **must not be presented or interpreted as a probability**.
5. **Fallback levels.** When a timeframe has no pivot-based zone on one side, a zero-width level at the 100-candle high/low with `score: 1` and no `touches` is used.
6. **The dashboard recalculates `breakout_score` client-side on hover**, so its displayed value can differ from this object.

---

## 6. Planned additions (version 2)

Not emitted yet. Field names below are the agreed target; implementation must follow them.

| Field | Type | Meaning |
| :---- | :--- | :------ |
| `schema_version` | number | `2` |
| `generated_at` | number | Unix seconds when this object was written |
| `inputs` | object | `{ [tf]: { candle_close_time, age_seconds, status } }` for each role TF. `candle_close_time` is the close time of the last **closed** candle used. |
| `inputs[tf].status` | enum | `ok` \| `stale` \| `missing` |
| `status` | enum | `ok` \| `degraded` \| `stale` (rules in ARCHITECTURE.md → Freshness) |
| `errors` | string[] | short codes for the most recent failures (e.g. `binance_451`, `binance_429`, `timeout`). Empty when healthy. |

---

## 7. Consumer rules

These apply to every consumer, including AI prompts and anyone pasting the JSON into an LLM.

1. **Check freshness before interpreting.**
   - Version 2: if `status` is not `ok`, show it prominently, and AI analysis must return **WAIT** and state that the data is not current.
   - Version 1 (no `status`): treat the object as stale if `now - timestamp` is greater than twice the entry-TF length (for example, more than 30 minutes for `15m`).
2. **Never infer missing fields.** An absent field means "unknown", not a default.
3. **Treat `breakout_score` as a ranking heuristic**, not a probability or confidence percentage.
4. **Treat `setup_state` as a label**, not a trade instruction.
5. **Unknown enum values:** display them as-is and do not act on them.

> The current AI prompt files do not yet include rule 1. Updating them is a separate step.
