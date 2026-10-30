# 🗺️ Roadmap

Evolution from a **Market State Reducer** into an **AI Signal Engine**. The execution bot is a separate system.

```
DATA → MARKET ENGINE → SCORING → FILTER → SIGNAL → LOGGING → DATASET → AI
```

**Principles**
- Don't start with AI; build the scoring system first.
- Logging is mandatory before any AI work.
- Keep signal generation and execution separate.

**Current position:** Level 1 done; Level 2 (Scoring Engine) is the next priority, followed by the Trade Filter (2.5B), Logging + Feature Store (4) and the Backtest Engine (5).

---

## 🧱 Level 1 — Market Engine (core) ✅
**Objective:** A deterministic pipeline that turns raw candles into a structured Market State.

- [x] **Multi-timeframe pipeline:** parallel fetching for 1m → 1d.
- [x] **S/R clustering:** price zones instead of single lines.
- [x] **Context detection:** `near_support`, `near_resistance`, `mid_range`.
- [x] **Momentum:** RSI, MACD.
- [x] **Regime detection:** `trending` or `ranging`. Not implemented: direction-aware regimes (`trending_up` / `trending_down`) and volatility regimes (high / low volatility).
- [x] **The Reducer:** flattens MTF data into `data/market/{symbol}.json`.
- [x] **Intelligence layer:** `enhanceMarketState` (compression, energy, pressure, breakout score).
- [x] **Closed-candle pipeline (v2.0.0):** signals use closed candles only; UTC boundary scheduling with one summary build per boundary.
- [x] **Data Contract v2 (v2.0.0):** `schema_version`, per-timeframe `inputs`, freshness `status` (`ok` / `degraded` / `stale`) and `errors`, validated before publishing. See [DATA_CONTRACT.md](./DATA_CONTRACT.md).
- [ ] **Freshness threshold review:** confirm the 2 × timeframe staleness threshold against real usage.

**Success criteria:** a JSON object that describes the market state without a human looking at a chart.

---

## 🧱 Level 2 — Scoring Signal Engine 🕒 (next)
**Objective:** move from rule-based yes/no logic to weighted scoring.

- [/] **Weighted point system**
  - [x] `ScoringMatrix` based on timeframe weights (15m, 1h, 4h, 1d).
  - [x] Consolidate S/R scores across MTF with dynamic merging.
  - [ ] Total score → signal strength (Weak, Medium, Strong).
- [x] **Heuristic breakout score:** `breakout_score` (0.0–1.0) from proximity and volume. Uncalibrated; it becomes a probability only after calibration in Level 5.
- [ ] **Dynamic reasoning engine:** return an array of triggers, e.g. `["Strong HTF Support", "Bullish Divergence", "Volume Surge"]`.

Scoring example (instead of `if near_support + bullish → BUY`):

```
+2 near_support   +2 bullish_momentum   +3 strong_HTF_support
-2 near_resistance  -1 weak_volume
score >= 5 → BUY · score <= -5 → SELL · otherwise WAIT
```

Output: `{ "signal": "BUY", "confidence": 7, "reason": ["support", "momentum"] }`

**Success criteria:** a heuristic breakout score and an explanation of the dominant side of the market.

---

## 🎨 Level 2.5A — Visual Strategy Layer (dashboard) ✅
**Objective:** a high-performance UI for real-time state monitoring.

- [x] **Glassmorphism UI:** Tailwind CSS.
- [x] **Crosshair synchronization:** OHLCV and technical summary on hover (the breakout score is always the server value).
- [x] **Freshness banner (v2.0.0):** `ok` / `degraded` / `stale`, data age and error codes; stale data dimmed, missing data blanked.
- [x] **Confluence monitoring:** S/R zone list with price copying.
- [x] **Live WebSocket integration:** live (display-only) prices and push notifications when snapshots or the Market State change.

**Success criteria:** assess the market state in under 5 seconds.

---

## 🧱 Level 2.5B — Trade Filter (capital protection)
**Objective:** a hard filter that discards low-quality setups.

- [ ] **Risk/reward validator:** distance to the next major resistance vs distance to the stop loss; RR < 1.5 → discard.
- [ ] **Volatility guard:** ATR detects extreme volatility (news) or a dead market (low volume); ATR < threshold → discard.
- [ ] **No-man's-land filter:** discard setups in the middle of a range (`mid_range`, far from any significant zone).
- [ ] **Resistance filter:** discard longs near resistance without a confirmed breakout.

Output: `{ "filtered": true, "reason": "low_rr" }`

**Success criteria:** a significant reduction in false-positive signals.

---

## 🧱 Level 3 — Signal Enrichment (actionability)
**Objective:** turn a signal into a trade plan.

- [ ] **Precision entry zones:** a `buy_zone` (e.g. 64,200–64,500) instead of a single price.
- [ ] **Automatic invalidation (stop loss):** bottom of the current support zone + 0.5 × ATR.
- [ ] **Target projection:** TP1 = next minor resistance; TP2 = major HTF resistance.
- [ ] **Dynamic trailing:** trailing stop based on the entry timeframe (15m).

Output example: `{ "signal": "BUY", "confidence": 7, "type": "support_bounce", "strength": "medium", "zone": [616, 620], "invalid_if": 615, "regime": "ranging" }`

**Success criteria:** the API returns Entry, Stop Loss, Take Profit 1 and Take Profit 2.

---

## 🧱 Level 4 — Signal Logging & Dataset (foundation)
**Objective:** a historical dataset of State → Outcome.

- [ ] **State snapshotting:** save the full `enhanceMarketState` object whenever a signal is generated (MongoDB/PostgreSQL planned).
- [ ] **Outcome tracker:** a background worker marks `WIN` when TP is hit, `LOSS` when SL is hit.
- [ ] **Feature store:** flatten state variables (context, momentum, regime, distances, score) to CSV/Parquet for ML training.

Log record: `{ "timestamp", "signal", "confidence", "price", "sl", "tp", "features": {...}, "result": null }`, later completed with `{ "result": "WIN", "rr": 2.1 }`.

**Success criteria:** at least 1,000 labeled trades (state + outcome).

---

## 🧱 Level 5 — Backtest Engine (quantification)
**Objective:** prove the system's edge mathematically.

- [ ] **Historical simulation:** run the scoring engine over 1 year of 15m/1h data.
- [ ] **Performance metrics:** win rate, risk/reward, profit factor (gross win / gross loss), maximum drawdown, expectancy per trade.

**Success criteria:** a documented equity curve with positive expectancy.

---

## 🧱 Level 6 — Performance Analysis (optimization)
**Objective:** find the best-performing patterns through data mining.

- [ ] **Pattern correlation:** which `market_energy` + regime combinations have the highest win rate (e.g. range markets favour bounces, trending markets favour breakouts).
- [ ] **Weight optimization:** A/B test `WEIGHT_1D` vs `WEIGHT_15M` settings.
- [ ] **False-breakout analysis:** why `fake_breakout_risk` was wrong in specific cases.

**Success criteria:** weight changes that raise the win rate by at least 5%.

---

## 🧱 Level 7 — AI Signal
**Objective:** use machine learning to replace heuristics with patterns.

- [ ] **Weight optimizer (ML):** adjust scoring weights dynamically per regime.
- [ ] **Pattern recognition:** LSTM/Transformer for non-linear patterns (swing failure, fake breakouts, consolidation).
- [ ] **Probability predictor:** e.g. "based on 10,000 similar past states, this trade has a 68% win probability".
- [ ] **Adaptive strategy:** bounce strategy in ranges, breakout strategy in trends.

Final signal: `{ "signal": "BUY", "confidence": 0.74, "type": "support_bounce", "zone": [616, 620], "sl": 615, "tp": 627, "risk_reward": 2.3, "regime": "ranging" }`

**Success criteria:** AI signals outperform the heuristic signals of Level 2.

---

## 🔌 Auto Trading Bot (separate execution system)
Consumes the signal engine's output.

- **API integration:** Binance / Bybit / OKX execution.
- **Risk management:** position size from % of account balance and SL distance.
- **Execution:** limit orders at entry zones; set SL/TP and manage the trade.
