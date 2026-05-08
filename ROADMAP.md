# 🗺️ DETAILED PROJECT ROADMAP: Trading Chart App

This roadmap outlines the evolution of the Trading Chart App from a **Data Reduction Tool** into a **Fully Autonomous AI Signal Engine**. Each level represents a shift in complexity and intelligence.

---

## 🧱 LEVEL 1 — MARKET ENGINE (CORE) ✅
**Objective:** Establish a deterministic pipeline to convert raw candles into a structured "Market State".

### 🛠️ Technical Milestones
- [x] **Multi-Timeframe Pipeline:** Implementation of parallel data fetching for 1m $\rightarrow$ 1d.
- [x] **S/R Clustering Logic:** Implementation of a clustering algorithm to find price zones instead of single lines.
- [x] **Regime Detection:** Logic to classify market as `trending_up`, `trending_down`, or `ranging`.
- [x] **The Reducer:** Logic to flatten MTF data into `data/market/{symbol}.json`.
- [x] **Intelligence Layer:** Implementation of `enhanceMarketState` (Compression, Energy, Pressure, Breakout Score).

**✅ Success Criteria:** The system can provide a JSON object that accurately describes the market state without requiring a human to look at a chart.

---

## 🧱 LEVEL 2 — SCORING SIGNAL ENGINE (PROBABILITIES) 🕒
**Objective:** Transition from "Yes/No" logic to a "Weighted Probability" system.

### 🛠️ Technical Milestones
- [/] **Weighted Point System:** 
    - [x] Create a `ScoringMatrix` based on timeframe weights (15m, 1h, 4h, 1d).
    - [x] Consolidate S/R scores across MTF with dynamic merging.
    - [ ] Total Score $\rightarrow$ Signal Strength (Weak, Medium, Strong).
- [x] **Confidence Calculation:** 
    - [x] Implemented `breakout_score` (0.0 - 1.0) based on proximity and volume.
- [ ] **Dynamic Reasoning Engine:** 
    - Instead of a state string, return an array of triggers: `["Strong HTF Support", "Bullish Divergence", "Volume Surge"]`.

**✅ Success Criteria:** The system can provide a confidence percentage (`breakout_score`) and explain the dominant side of the market.

---

## 🎨 LEVEL 2.5 — VISUAL STRATEGY LAYER (THE DASHBOARD) ✅
**Objective:** Provide a high-performance UI for real-time state monitoring.

### 🛠️ Technical Milestones
- [x] **Premium Glassmorphism UI:** Built with Tailwind CSS.
- [x] **Crosshair Synchronization:** Updates OHLCV, Technical Summary, and Breakout Score on hover.
- [x] **Confluence Monitoring:** Visual list of S/R zones with price-copying.
- [x] **Live WebSocket Integration:** Zero-latency price and state updates.

**✅ Success Criteria:** A dashboard that allows a trader to assess market state in under 5 seconds.

---

## 🧱 LEVEL 2.5 — TRADE FILTER (CAPITAL PROTECTION)
**Objective:** Implement a "Hard Filter" to eliminate low-probability setups.

### 🛠️ Technical Milestones
- [ ] **Risk/Reward (RR) Validator:** 
    - Calculate distance to next major resistance vs. distance to stop loss. 
    - Filter: $\text{RR} < 1.5 \rightarrow \text{DISCARD}$.
- [ ] **Volatility Guard:** 
    - Use ATR to detect "Extreme Volatility" (News events) or "Dead Market" (Low volume).
    - Filter: $\text{ATR} < \text{Threshold} \rightarrow \text{DISCARD}$.
- [ ] **The "No-Man's Land" Filter:** 
    - Filter out trades that occur in the middle of a range (too far from any significant S/R zone).

**✅ Success Criteria:** A significant reduction in "False Positive" signals.

---

## 🧱 LEVEL 3 — SIGNAL ENRICHMENT (ACTIONABILITY)
**Objective:** Turn a "Signal" into a "Trade Plan".

### 🛠️ Technical Milestones
- [ ] **Precision Entry Zones:** Define a `buy_zone` (e.g., $64,200 - $64,500) rather than a single price.
- [ ] **Automatic Invalidation (Stop Loss):** 
    - Calculate SL based on the bottom of the current support zone + $0.5 \times \text{ATR}$.
- [ ] **Target Projection (Take Profit):** 
    - TP1: Next nearest minor resistance.
    - TP2: Major HTF resistance.
- [ ] **Dynamic Trailing Logic:** Suggest a trailing stop based on the `Entry` timeframe (15m).

**✅ Success Criteria:** The API output provides a complete trade setup: `Entry`, `Stop Loss`, `Take Profit 1`, and `Take Profit 2`.

---

## 🧱 LEVEL 4 — SIGNAL LOGGING & DATASET (THE FOUNDATION)
**Objective:** Build a historical database of "State $\rightarrow$ Outcome".

### 🛠️ Technical Milestones
- [ ] **State Snapshotting:** Every time a signal is generated, save the entire `enhanceMarketState` object to a database (MongoDB/PostgreSQL).
- [ ] **Outcome Tracker:** 
    - Implement a background worker that monitors the price after a signal.
    - Mark as `WIN` if TP is hit, `LOSS` if SL is hit.
- [ ] **Feature Store:** Flatten all state variables into a CSV/Parquet format for ML training.

**✅ Success Criteria:** A dataset of $\ge 1,000$ labeled trades (State + Outcome).

---

## 🧱 LEVEL 5 — BACKTEST ENGINE (QUANTIFICATION)
**Objective:** Mathematically prove the system's edge.

### 🛠️ Technical Milestones
- [ ] **Historical Simulation:** Run the Scoring Engine over 1 year of historical 15m/1h data.
- [ ] **Performance Dashboard:** Calculate:
    - Win Rate %
    - Profit Factor (Gross Win / Gross Loss)
    - Maximum Drawdown (MDD)
    - Expectancy per Trade.

**✅ Success Criteria:** A documented "Equity Curve" proving a positive mathematical expectancy.

---

## 🧱 LEVEL 6 — PERFORMANCE ANALYSIS (OPTIMIZATION)
**Objective:** Find the "Golden Patterns" through data mining.

### 🛠️ Technical Milestones
- [ ] **Pattern Correlation:** Analyze which `energy_state` + `market_regime` combinations have the highest win rate.
- [ ] **Weight Optimization:** A/B test different `WEIGHT_1D` vs `WEIGHT_15M` settings to find the optimal confluence mix.
- [ ] **False-out Analysis:** Analyze why `fakeout_risk` was wrong in specific cases.

**✅ Success Criteria:** Optimization of weights that increases Win Rate by $\ge 5\%$.

---

## 🧱 LEVEL 7 — AI SIGNAL (AUTONOMOUS Intelligence)
**Objective:** Use Machine Learning to replace heuristics with patterns.

### 🛠️ Technical Milestones
- [ ] **Weight Optimizer (ML):** Train a model to adjust the scoring weights dynamically based on the current `market_regime`.
- [ ] **Complex Pattern Recognition:** Use an LSTM or Transformer model to detect non-linear patterns (e.g., "SFP - Swing Failure Pattern").
- [ ] **Probability Predictor:** A model that outputs: *"Based on 10,000 similar states in the past, this trade has a 68% probability of winning."*

**✅ Success Criteria:** AI-generated signals outperform the heuristic-based signals of Level 2.

---

## 🔌 AUTO TRADING BOT (EXECUTION LAYER)
*This is a separate system that consumes the output of the Signal Engine.*
- **API Integration:** Connect to Binance/Bybit/OKX for execution.
- **Risk Management:** Auto-calculate position size based on $\%$ of account balance and SL distance.
- **Execution Logic:** Limit orders at `Entry Zones` to minimize slippage.
