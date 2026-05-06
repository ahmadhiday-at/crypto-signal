# 🏗️ Architecture: Trading Chart App (Market State Engine)

This document provides a detailed technical overview of the **Trading Chart App**. The system is designed not as a simple chart viewer, but as a **Market State Reducer**—a system that compresses vast amounts of multi-timeframe market data into a single, actionable "State" object.

## 🗺️ High-Level System Overview

The application follows a linear pipeline architecture where data is progressively refined from raw numbers into strategic intelligence.

### 🔄 The Data Pipeline
`Market Data (Binance)` $\rightarrow$ `Technical Analysis (Indicators)` $\rightarrow$ `Temporal Snapshots (Per TF)` $\rightarrow$ `MTF Consolidation (Reducer)` $\rightarrow$ `Strategic Interpretation (Intelligence Layer)` $\rightarrow$ `Market State API`

---

## 🧩 Component Deep Dive

### 1. Data Acquisition Layer (`src/binance.js`)
Responsible for the interface between the system and the external market.
- **REST API:** Used for fetching historical K-lines (candles) for multiple timeframes.
- **WebSocket:** Used for real-time price updates to ensure the "current price" in the state is accurate.
- **Normalization:** Converts Binance's raw API response into a standardized format used by the `IndicatorService`.

### 2. Technical Analysis Layer (`src/indicators.js`)
This layer transforms raw candles into mathematical indicators.
- **S/R Clustering:** Instead of a single line, it identifies "zones" of support and resistance by clustering price pivots.
- **Trend Indicators:** Calculation of Moving Averages (MA) to determine the primary trend direction.
- **Momentum & Volatility:**
    - **RSI:** To identify overbought/oversold conditions.
    - **MACD:** To analyze trend strength and momentum shifts.
    - **ATR (Average True Range):** To measure volatility, which is used to set dynamic boundaries for zones.

### 3. Storage & Persistence Layer (`src/storage.js`)
To avoid hitting API rate limits and to enable historical analysis, the system uses a local filesystem cache.
- **`data/chart/{symbol}/{tf}.json`**: Stores the processed indicators for a specific timeframe.
- **`data/market/{symbol}.json`**: Stores the final "Enhanced Market State".
- **TTL Logic:** Implements a caching mechanism where data is refreshed based on the timeframe (e.g., 15m data is refreshed more often than 1d data).

### 4. The Market State Reducer & Intelligence Layer (`server.js`)
This is the "brain" of the application. It takes the snapshots from all timeframes and applies a set of heuristics to determine the current market environment.

#### A. Multi-Timeframe (MTF) Confluence
The system assigns weights to different timeframes:
- **HTF (1D):** Global bias and major structural levels. (Highest Weight)
- **Structure (4H):** Intermediate trend and key swing points.
- **Mid (1H):** Local trend and area of value.
- **Entry (15M):** Precise timing and immediate liquidity zones. (Lowest Weight)

**Confluence Logic:** If a Support zone is identified on 1D, 4H, and 1H, it is marked as a "High-Confidence Floor."

#### B. Compression Detection
Identifies when the price is "squeezed" between a short-term resistance and a long-term support (or vice versa).
- **Bullish Compression:** Price is trending up but hitting a ceiling, while the floor is rising. This signals a potential explosive breakout upwards.
- **Bearish Compression:** Price is trending down but hitting a floor, while the ceiling is dropping.

#### C. Energy State Analysis
Combines volume and momentum to categorize the "energy" of the move:
- **Explosive:** High volume + Steep MACD slope.
- **Building:** Increasing volume + Flat price (Accumulation).
- **Cooling:** Decreasing volume + Slowing momentum.
- **Stable:** Low volume + Low volatility.

#### D. Breakout Probability & Risk
Calculates a score (0.0 to 1.0) based on:
- **Proximity:** Distance of current price to the nearest strong zone.
- **Volume Surge:** Relative volume compared to the average of the last 20 periods.
- **Fake-out Filter:** If the price breaks a zone but the "Energy State" is `cooling`, the system flags a `high_risk_fakeout`.

---

## 📊 Data Schema

### Raw Snapshot (Per TF)
```json
{
  "symbol": "BTCUSDT",
  "timeframe": "1h",
  "currentPrice": 65000,
  "zones": {
    "support": [{ "top": 64000, "bottom": 63500, "strength": 0.8 }],
    "resistance": [{ "top": 66000, "bottom": 65500, "strength": 0.7 }]
  },
  "indicators": {
    "rsi": 55,
    "macd": { "histogram": 120, "signal": 100 }
  }
}
```

### Enhanced Market State (The Final Output)
```json
{
  "symbol": "BTCUSDT",
  "timestamp": "2026-05-04T10:45:00Z",
  "global_bias": "bullish",
  "market_regime": "trending_up",
  "energy_state": "building",
  "pressure": "bullish_compression",
  "breakout_score": 0.75,
  "setup_state": "breakout_entry_ready",
  "confluence_zones": {
    "major_support": 63000,
    "major_resistance": 67000
  },
  "risk_factors": {
    "fakeout_risk": "low",
    "volatility_alert": false
  }
}
```

## 🚀 Design Goals
1. **Determinism:** Given the same input data, the Market State must always be the same.
2. **Low Latency:** By reducing data locally before sending it to the API, the frontend remains snappy.
3. **Scalability:** The logic is symbol-agnostic, allowing the system to track hundreds of pairs by simply adding them to the `.env` list.
