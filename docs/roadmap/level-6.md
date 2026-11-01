# 🧱 Level 6 — Performance Analysis (optimization)

Roadmap level: goals, milestones and success criteria. Overview: [README.md](./README.md).
**Objective:** find the best-performing patterns through data mining.

- [x] **Pattern correlation tool (v2.9.0):** report `breakdown` per side, |score|, regime, context, momentum, volume, `market_energy`, breakout confirmation, `fake_breakout_risk`, divergence, UTC session and rejecting filter; shown on `/backtest/:symbol`.
- [x] **Parameter sweep tool (v2.9.0):** `npm run backtest -- SYMBOL --sweep threshold=4,5,6 --sweep min_rr=1,1.5 --sweep w_15m=1,2` replays every combination on the same history (A/B of weights, threshold, min RR).
- [x] **Out-of-sample validation tool (v2.10.0):** `--split 0.7` picks the best variant on the first 70% and reports it on the unseen 30%.
- [ ] **Pick and validate new parameters:** sweep → choose → confirm on another period/symbol and with fees before changing the live defaults (avoid in-sample overfitting).
- [ ] **False-breakout analysis:** why `fake_breakout_risk` was wrong in specific cases.

**Success criteria:** weight changes that raise the win rate by at least 5%.
