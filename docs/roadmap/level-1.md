# 🧱 Level 1 — Market Engine (core) ✅

Roadmap level: goals, milestones and success criteria. Overview: [README.md](./README.md).
**Objective:** A deterministic pipeline that turns raw candles into a structured Market State.

- [x] **Multi-timeframe pipeline:** parallel fetching for 1m → 1d.
- [x] **S/R clustering:** price zones instead of single lines.
- [x] **Context detection:** `near_support`, `near_resistance`, `mid_range`.
- [x] **Momentum:** RSI, MACD.
- [x] **Regime detection:** `trending` or `ranging`. Not implemented: direction-aware regimes (`trending_up` / `trending_down`) and volatility regimes (high / low volatility).
- [x] **The Reducer:** flattens MTF data into `data/market/{symbol}.json`.
- [x] **Intelligence layer:** `enhanceMarketState` (compression, energy, pressure, breakout score).
- [x] **Closed-candle pipeline (v2.0.0):** signals use closed candles only; UTC boundary scheduling with one summary build per boundary.
- [x] **Data Contract v2 (v2.0.0):** `schema_version`, per-timeframe `inputs`, freshness `status` (`ok` / `degraded` / `stale`) and `errors`, validated before publishing. See [market-state.md](../contract/market-state.md).
- [ ] **Freshness threshold review:** confirm the 2 × timeframe staleness threshold against real usage.

**Success criteria:** a JSON object that describes the market state without a human looking at a chart.
