# 🧱 Level 6 — Performance Analysis (optimization)

Roadmap level: goals, milestones and success criteria. Overview: [README.md](./README.md).
**Objective:** find the best-performing patterns through data mining.

- [x] **Pattern correlation tool (v2.9.0):** report `breakdown` per side, |score|, regime, context, momentum, volume, `market_energy`, breakout confirmation, `fake_breakout_risk`, divergence, UTC session and rejecting filter; shown on `/backtest/:symbol`.
- [x] **Parameter sweep tool (v2.9.0):** `npm run backtest -- SYMBOL --sweep threshold=4,5,6 --sweep min_rr=1,1.5 --sweep w_15m=1,2` replays every combination on the same history (A/B of weights, threshold, min RR).
- [x] **Out-of-sample validation tool (v2.10.0):** `--split 0.7` picks the best variant on the first 70% and reports it on the unseen 30%.
- **Validation run (2026-11-01):** BTC/SOL/BNB, 1 year, fee 0.1%, split 0.7, threshold 4–7 × min RR 1/1.5/2. Live parameters: taken −0.24 / −0.28 / −0.21 R. No variant with ≥ 30 in-sample trades is positive in-sample on any pair; picks out-of-sample: BTC −0.070 R (threshold 4, RR 1), SOL +0.054 R (threshold 4, RR 1, 80 trades), BNB −0.013 R (threshold 6, RR 1). **Conclusion:** threshold/min RR tuning alone gives no robust edge; live parameters unchanged. Next: change the setup itself (SL/TP placement, breakdown findings such as BUY vs SELL, |score| 5, market energy), then re-validate.
- [ ] **Pick and validate new parameters:** sweep → choose → confirm on another period/symbol and with fees before changing the live defaults (avoid in-sample overfitting).
- [ ] **False-breakout analysis:** why `fake_breakout_risk` was wrong in specific cases.

**Success criteria:** weight changes that raise the win rate by at least 5%.
