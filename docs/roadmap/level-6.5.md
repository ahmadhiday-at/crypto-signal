# 🧱 Level 6.5 — Signal Quality (proven edge)

Roadmap level: goals, milestones and success criteria. Overview: [README.md](./README.md).
**Objective:** turn the signal into one that measurably helps: fix the weaknesses Level 5–6 found, validate every change out-of-sample, and show honestly how good the signal is. Gate for Level 7.

**Diagnosis (backtest BTC/SOL/BNB, 1 year, see [level-6.md](./level-6.md)):**
1. **Counter-trend signals:** the score ignores the 1d/4h trend, so BUYs fire in a downtrend (BUY is always the worst side; SOL 35 of 50 taken trades were BUY in a falling year).
2. **Targets too close:** TP1 = nearest opposite zone; ±90% of candidates are rejected by `low_rr` (median plan RR 0.34).
3. **Score 5 is too easy:** support + momentum alone reach it; |score| 5 → −0.35 R, ≥ 6 ≈ break-even.
4. **Tight 15m stops vs costs:** median risk 1–1.9% of price, so a 0.1% fee costs ±0.1 R per trade.
5. **Wrong direction, not noise:** median LOSS after 18–20 entry candles; only ±15% hit SL within 1 hour.
6. **The dashboard shows BUY/SELL as if usable** while the measured expectancy is negative.

## Milestones (in order)

**A. Honest output**
- [x] **Edge indicator on the dashboard (v2.12.0):** `GET /api/edge/:symbol`; next to the signal, the latest backtest result for the symbol (taken expectancy, win rate, trades, fee, date) and live Signal Log stats (Level 4); label the signal "unproven" / "negative edge" when expectancy ≤ 0 or the sample is too small.

**B. Signal logic** (each change is a sweepable backtest option first; live defaults change only after step B4)
- [ ] **B1. HTF trend filter:** BUY only when the 1d/4h trend is up or ranging, SELL only when down; new filter code `against_htf_trend`. Replaces the fixed-side result (SELL-only worked only because the year fell).
- [ ] **B2. Target and entry location:** TP = first zone that gives RR ≥ the minimum (not just the nearest); signal only near the entry zone, not mid-range.
- [ ] **B3. Score calibration:** reason weights from the breakdown (which reasons raise win rate / expectancy), review the threshold.
- [ ] **B4. Robust validation:** 2–3 years of history (up and down phases), BTC/SOL/BNB, fee 0.1%, `--split 0.7`; adopt a change only when it holds on every pair.

**C. Deferred reviews** (decided with the B4 data)
- [ ] **Level 1:** freshness threshold (2 × timeframe).
- [ ] **Level 2.5B:** no-man's-land 1%, volatility 2.0 / 0.5, min RR 1.5.
- [ ] **Level 3:** SL buffer 0.5 × ATR, trailing 1.5 × ATR.
- [ ] **Level 6:** false-breakout analysis (when `fake_breakout_risk` was wrong; keep, change or drop it).
- [ ] **Level 4:** Signal Log card on the dashboard; dataset keeps growing toward 1,000 labeled trades.

## Success criteria

- Taken expectancy **> 0 R after a 0.1% fee on the out-of-sample 30%** for BTC, SOL and BNB, each with at least ±30 out-of-sample trades, using one shared parameter set.
- Until then the dashboard labels the signal as unproven.
- Level 7 (AI) starts only after this criterion is met.
