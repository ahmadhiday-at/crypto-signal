# 🧱 Level 2 — Scoring Signal Engine 🕒 (next)

Roadmap level: goals, milestones and success criteria. Overview: [README.md](./README.md).
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
