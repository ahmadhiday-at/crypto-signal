# 🧱 Level 2.5B — Trade Filter (capital protection)

Roadmap level: goals, milestones and success criteria. Overview: [README.md](./README.md).
**Objective:** a hard filter that discards low-quality setups.

- [ ] **Risk/reward validator:** distance to the next major resistance vs distance to the stop loss; RR < 1.5 → discard.
- [ ] **Volatility guard:** ATR detects extreme volatility (news) or a dead market (low volume); ATR < threshold → discard.
- [ ] **No-man's-land filter:** discard setups in the middle of a range (`mid_range`, far from any significant zone).
- [ ] **Resistance filter:** discard longs near resistance without a confirmed breakout.

Output: `{ "filtered": true, "reason": "low_rr" }`

**Success criteria:** a significant reduction in false-positive signals.
