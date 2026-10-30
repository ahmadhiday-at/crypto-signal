# 🧱 Level 3 — Signal Enrichment (actionability)

Roadmap level: goals, milestones and success criteria. Overview: [README.md](./README.md).
**Objective:** turn a signal into a trade plan.

- [ ] **Precision entry zones:** a `buy_zone` (e.g. 64,200–64,500) instead of a single price.
- [ ] **Automatic invalidation (stop loss):** bottom of the current support zone + 0.5 × ATR.
- [ ] **Target projection:** TP1 = next minor resistance; TP2 = major HTF resistance.
- [ ] **Dynamic trailing:** trailing stop based on the entry timeframe (15m).

Output example: `{ "signal": "BUY", "confidence": 7, "type": "support_bounce", "strength": "medium", "zone": [616, 620], "invalid_if": 615, "regime": "ranging" }`

**Success criteria:** the API returns Entry, Stop Loss, Take Profit 1 and Take Profit 2.
