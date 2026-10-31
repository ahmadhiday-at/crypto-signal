# 🧱 Level 4 — Signal Logging & Dataset (foundation)

Roadmap level: goals, milestones and success criteria. Overview: [README.md](./README.md).
**Objective:** a historical dataset of State → Outcome.

- [x] **State snapshotting (v2.7.0):** every BUY/SELL candidate, filtered or not, is appended with its plan and flat features to `data/signals/{MARKET}.jsonl` (JSONL instead of a database).
- [x] **Outcome tracker (v2.7.0):** on each closed entry candle: TP1 → `WIN`, SL → `LOSS` (both in one candle → `LOSS`), 96 candles → `EXPIRED`.
- [x] **Feature store (v2.7.0):** `GET /api/signals/:symbol?format=csv`.
- [ ] **Dataset size:** collecting; check `stats` on `/api/signals/:symbol`.

Contract: [rest.md → Signal log](../contract/rest.md#signal-log). Original sketch: `{ "timestamp", "signal", "confidence", "price", "sl", "tp", "features": {...}, "result": null }`, later completed with `{ "result": "WIN", "rr": 2.1 }`.

**Success criteria:** at least 1,000 labeled trades (state + outcome).
