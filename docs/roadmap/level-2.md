# 🧱 Level 2 — Scoring Signal Engine ✅

Roadmap level: goals, milestones and success criteria. Overview: [README.md](./README.md).
**Objective:** move from rule-based yes/no logic to weighted scoring.

- [x] **Weighted point system**
  - [x] `ScoringMatrix` based on timeframe weights (15m, 1h, 4h, 1d).
  - [x] Consolidate S/R scores across MTF with dynamic merging.
  - [x] Total score → signal strength (Weak, Medium, Strong) — `signal` in the Market State (v2.2.0).
  - [x] Bullish/bearish RSI divergence trigger (v2.4.0): `divergence` field, ±2 in the signal.
- [x] **Heuristic breakout score:** `breakout_score` (0.0–1.0) from proximity and volume. Uncalibrated; it becomes a probability only after calibration in Level 5.
- [x] **Dynamic reasoning engine (v2.2.0):** `signal.reasons` lists the triggers with their points (support/resistance, momentum, strong HTF zone, volume). Rules: [market-state.md §4.1](../contract/market-state.md#41-signal-added-in-220).

Scoring example (instead of `if near_support + bullish → BUY`):

```
+2 near_support   +2 bullish_momentum   +3 strong_HTF_support
-2 near_resistance  -1 weak_volume
score >= 5 → BUY · score <= -5 → SELL · otherwise WAIT
```

Output: `{ "signal": "BUY", "confidence": 7, "reason": ["support", "momentum"] }`

**Success criteria:** a heuristic breakout score and an explanation of the dominant side of the market.
