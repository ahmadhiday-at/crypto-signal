# 🧱 Level 7 — AI Signal

Roadmap level: goals, milestones and success criteria. Overview: [README.md](./README.md).
**Objective:** use machine learning to replace heuristics with patterns.

- [ ] **Weight optimizer (ML):** adjust scoring weights dynamically per regime.
- [ ] **Pattern recognition:** LSTM/Transformer for non-linear patterns (swing failure, fake breakouts, consolidation).
- [ ] **Probability predictor:** e.g. "based on 10,000 similar past states, this trade has a 68% win probability".
- [ ] **Adaptive strategy:** bounce strategy in ranges, breakout strategy in trends.

Final signal: `{ "signal": "BUY", "confidence": 0.74, "type": "support_bounce", "zone": [616, 620], "sl": 615, "tp": 627, "risk_reward": 2.3, "regime": "ranging" }`

**Success criteria:** AI signals outperform the heuristic signals of Level 2.
