# 🧱 Level 4 — Signal Logging & Dataset (foundation)

Roadmap level: goals, milestones and success criteria. Overview: [README.md](./README.md).
**Objective:** a historical dataset of State → Outcome.

- [ ] **State snapshotting:** save the full `enhanceMarketState` object whenever a signal is generated (MongoDB/PostgreSQL planned).
- [ ] **Outcome tracker:** a background worker marks `WIN` when TP is hit, `LOSS` when SL is hit.
- [ ] **Feature store:** flatten state variables (context, momentum, regime, distances, score) to CSV/Parquet for ML training.

Log record: `{ "timestamp", "signal", "confidence", "price", "sl", "tp", "features": {...}, "result": null }`, later completed with `{ "result": "WIN", "rr": 2.1 }`.

**Success criteria:** at least 1,000 labeled trades (state + outcome).
