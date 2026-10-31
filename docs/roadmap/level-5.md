# 🧱 Level 5 — Backtest Engine (quantification)

Roadmap level: goals, milestones and success criteria. Overview: [README.md](./README.md).
**Objective:** prove the system's edge mathematically.

- [x] **Historical simulation (v2.8.0):** `npm run backtest -- SYMBOL --days 365` replays the live pipeline on every closed entry candle; history cached in `data/history/`.
- [x] **Performance metrics (v2.8.0):** win rate, avg win/loss R, profit factor, max drawdown, expectancy, equity curve; taken vs filtered; per side. Page `/backtest/:symbol`.
- [ ] **Run on real data and document the result:** pending (needs Binance access through the VPN).

Contract: [rest.md → Backtest report](../contract/rest.md#backtest-report).

**Success criteria:** a documented equity curve with positive expectancy.
