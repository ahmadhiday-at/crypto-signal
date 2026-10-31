# 🧱 Level 5 — Backtest Engine (quantification)

Roadmap level: goals, milestones and success criteria. Overview: [README.md](./README.md).
**Objective:** prove the system's edge mathematically.

- [x] **Historical simulation (v2.8.0):** `npm run backtest -- SYMBOL --days 365` replays the live pipeline on every closed entry candle; history cached in `data/history/`.
- [x] **Performance metrics (v2.8.0):** win rate, avg win/loss R, profit factor, max drawdown, expectancy, equity curve; taken vs filtered; per side. Page `/backtest/:symbol`.
- [x] **Run on real data and document the result (2026-10-31):** BTCUSDT, 1 year (35,040 × 15m), fee 0, `CANDLE_LIMIT` 1000. Live parameters (threshold 5, min RR 1.5): **taken 71 trades, win 15.5%, expectancy −0.146 R, PF 0.76, max DD 11.7 R**; filtered 595 trades, +0.016 R (avg win 0.32 R: TP1 too close). Threshold × min RR sweep (before fees, in-sample): threshold 6 / min RR 2 → 24 trades, +0.228 R, PF 1.46 (small sample); threshold 6 / min RR 1 → 108 trades, +0.038 R. Results depend on `CANDLE_LIMIT` (window). **Success criterion not met** with the live parameters; parameter search continues in [Level 6](./level-6.md).

Contract: [rest.md → Backtest report](../contract/rest.md#backtest-report).

**Success criteria:** a documented equity curve with positive expectancy.
