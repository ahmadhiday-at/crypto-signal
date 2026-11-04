# 🧱 Level 2.5B — Trade Filter (capital protection) ✅

Roadmap level: goals, milestones and success criteria. Overview: [README.md](./README.md).
**Objective:** a hard filter that discards low-quality setups.

- [x] **Risk/reward validator (v2.5.0):** `signal.plan.risk_reward` to TP1 < 1.5 (or not computable) → `low_rr`.
- [x] **Volatility guard (v2.3.0):** `volatility_ratio` (ATR vs its 100-candle mean) > 2.0 → `volatility_extreme`, < 0.5 → `volatility_dead`.
- [x] **No-man's-land filter (v2.3.0):** `mid_range` and > 1% from the nearest zone → `no_mans_land`.
- [x] **Resistance filter (v2.3.0):** BUY near resistance (or SELL near support) without a `medium`/`strong` breakout confirmation → `buy_into_resistance` / `sell_into_support`.
- [ ] **Threshold review:** confirm 1%, 2.0, 0.5 and RR 1.5 against real usage.

Output: `signal.filtered` + `signal.filters[]` in the Market State ([market-state.md §4.1](../contract/market-state.md#41-signal-added-in-220)).

**Success criteria:** a significant reduction in false-positive signals.
