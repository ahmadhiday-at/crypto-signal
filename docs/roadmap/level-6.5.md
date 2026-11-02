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
- [x] **B1. HTF trend filter (v2.16.0):** per-TF `trend` (`up`/`down`/`ranging`, MA14 vs MA50) in the Market State; filter `against_htf_trend` rejects a BUY when a checked TF trends down and a SELL when one trends up. Config `filters.htf_trend` = `off` (default) / `htf` / `htf+structure`; sweep key `htf_trend`. SELL is not limited to down trends (the roadmap draft): SELL into an up trend was break-even or better on BTC/BNB.
  - **Result (2026-11-02, 1 year, fee 0.1%, split 0.7, defaults otherwise), taken exp R off / htf / htf+structure:** BTC −0.244 (71) / −0.204 (34) / −0.152 (19); SOL −0.284 (50) / −0.551 (26) / −0.915 (7); BNB −0.212 (67) / −0.221 (34) / −0.332 (19). Out-of-sample: BTC worse with the filter (−0.48 R, 8 trades), BNB better (+0.17 R, 7 trades), SOL worse; samples too small.
  - **Verdict:** halves the trades and losses on BTC, but no edge and not consistent across pairs → stays `off`. The clearest pattern is BUY with 1d and 4h both down: −0.53 R (BTC, 14), −0.53 R (SOL, 14), −0.69 R (BNB, 4); to be rechecked on 2–3 years (B4) before a BUY-only veto is considered. The main loss source remains the win rate (13–20%): next B2.
- [x] **B2. Target and entry location (v2.17.0):** config `signal.target` = `tp1` (nearest zone, default) / `rr_zone` (first zone ahead with RR ≥ `min_rr`) / `tp2`; `plan.entry_distance_atr` and filter `far_from_entry` with config `filters.entry_max_atr` (0 = off, default); sweep keys `target=rr_zone`, `entry_max_atr`.
  - **Result (2026-11-02, 1 year, fee 0.1%, split 0.7, defaults otherwise), taken exp R tp1 → rr_zone:** BTC −0.244 (71) → −0.041 (336); SOL −0.284 (50) → −0.034 (261); BNB −0.212 (67) → −0.072 (339). Out-of-sample rr_zone: BTC −0.024 (112), SOL +0.054 (90), BNB −0.197 (105).
  - **Why it looks better:** with rr_zone 60–64% of trades EXPIRE (96 entry candles) before TP1 or SL; TP1 win rate is only 5–7%. Losses shrink because trades time out near entry, not because the target is reached → no edge yet, defaults unchanged.
  - **`entry_max_atr` 1–2 changes almost nothing:** taken trades are already in or next to the entry zone (`no_mans_land` and the score's `near_support`/`near_resistance` points).
  - **Open:** the 96-candle expiry is fixed in code; a target farther away needs a longer holding time (or a trailing exit) to be judged. Recheck on 2–3 years (B4).
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
