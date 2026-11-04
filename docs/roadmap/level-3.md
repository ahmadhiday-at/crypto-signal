# 🧱 Level 3 — Signal Enrichment (actionability) ✅

Roadmap level: goals, milestones and success criteria. Overview: [README.md](./README.md).
**Objective:** turn a signal into a trade plan.

- [x] **Precision entry zones (v2.5.0):** `signal.plan.entry_zone` = `[low, high]` of the top support (long) / resistance (short) zone.
- [x] **Automatic invalidation (v2.5.0):** `stop_loss` = zone low − 0.5 × ATR (long) / zone high + 0.5 × ATR (short).
- [x] **Target projection (v2.5.0):** TP1 = nearest level beyond price; TP2 = highest-scored HTF level beyond TP1.
- [x] **Dynamic trailing (v2.5.0):** `trailing_stop` = price ∓ 1.5 × ATR of the entry timeframe.
- [ ] **Parameter review:** confirm 0.5 × / 1.5 × ATR against real usage.

Rules: [market-state.md §4.1](../contract/market-state.md#41-signal-added-in-220).

Output example: `{ "signal": "BUY", "confidence": 7, "type": "support_bounce", "strength": "medium", "zone": [616, 620], "invalid_if": 615, "regime": "ranging" }`

**Success criteria:** the API returns Entry, Stop Loss, Take Profit 1 and Take Profit 2.
