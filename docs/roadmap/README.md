# 🗺️ Roadmap

Index of roadmap levels, principles and current position. Evolution from a **Market State Reducer** into an **AI Signal Engine**. The execution bot is a separate system.

```
DATA → MARKET ENGINE → SCORING → FILTER → SIGNAL → LOGGING → DATASET → AI
```

**Principles**
- Don't start with AI; build the scoring system first.
- Logging is mandatory before any AI work.
- Keep signal generation and execution separate.

**Current position:** Levels 1, 2, 2.5A, 2.5B and 3 done (thresholds still to be reviewed with real usage). Level 4 logging is live (v2.7.0) and collecting toward 1,000 labeled trades. Level 5 backtest tool ready (v2.8.0); next: run it on 1 year of real data and judge the expectancy, then Level 6.

## Levels

- [🧱 Level 1 — Market Engine (core) ✅](./level-1.md)
- [🧱 Level 2 — Scoring Signal Engine ✅](./level-2.md)
- [🎨 Level 2.5A — Visual Strategy Layer (dashboard) ✅](./level-2.5a.md)
- [🧱 Level 2.5B — Trade Filter (capital protection) ✅](./level-2.5b.md)
- [🧱 Level 3 — Signal Enrichment (actionability) ✅](./level-3.md)
- [🧱 Level 4 — Signal Logging & Dataset (foundation) — collecting](./level-4.md)
- [🧱 Level 5 — Backtest Engine (quantification) — tool ready](./level-5.md)
- [🧱 Level 6 — Performance Analysis (optimization)](./level-6.md)
- [🧱 Level 7 — AI Signal](./level-7.md)

## 🔌 Auto Trading Bot (separate execution system)
Consumes the signal engine's output.

- **API integration:** Binance / Bybit / OKX execution.
- **Risk management:** position size from % of account balance and SL distance.
- **Execution:** limit orders at entry zones; set SL/TP and manage the trade.
