# 🏗️ Architecture: Trading Chart App (Market State Engine)

This document provides a detailed technical overview of the **Trading Chart App**. The system is designed not as a simple chart viewer, but as a **Market State Reducer**—a system that compresses vast amounts of multi-timeframe market data into a single, actionable "State" object.

## 🗺️ High-Level System Overview

The application follows a linear pipeline architecture where data is progressively refined from raw numbers into strategic intelligence.

### 🔄 The Data Pipeline
`Market Data (Binance API/WS)` $\rightarrow$ `Indicator Service` $\rightarrow$ `Market Reducer (MTF)` $\rightarrow$ `Intelligence Layer` $\rightarrow$ `REST/WS API` $\rightarrow$ `Dynamic Dashboard (UI)`

---

## 🧩 Component Deep Dive

### 1. Data Acquisition Layer (`src/services/binance.service.js`)
Responsible for the interface between the system and the external market.
- **REST Client:** Fetches historical K-lines (candles) for all configured timeframes (15m, 1h, 4h, 1d).
- **WebSocket Subscriber:** Listens for real-time price updates to keep the "Live Price" state current.
- **Normalization:** Standardizes raw Binance data into the application's internal candle format.

### 2. Technical Analysis Layer (`src/services/indicator.service.js`)
Transforms raw price data into mathematical and structural insights.
- **S/R Clustering Engine:** Identifies "Zones" of support and resistance by clustering historical price pivots using dynamic ATR-based tolerances.
- **Indicator Suite:** Calculates MA14, MA50, MA200, RSI, and MACD.
- **Volatility Analysis:** Uses ATR to determine dynamic "zone width" and risk parameters.

### 3. Data Management (`src/data/`)
To avoid hitting API rate limits and to enable historical analysis, the system uses a local filesystem cache.
- **`data/chart/{symbol}/{tf}.json`**: Stores the processed indicators for a specific timeframe.
- **`data/market/{symbol}.json`**: Stores the final "Enhanced Market State".

### 4. Intelligence Layer (`src/services/market.service.js`)
This is the "brain" of the application. It takes snapshots from all timeframes and applies heuristics to determine the market environment.

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
Calculates a `breakout_score` (0.0 to 1.0) by analyzing:
- **Proximity:** Proximity to strong S/R zones.
- **Volume Profile:** Relative volume surge vs. 20-period moving average.
- **Regime Alignment:** Alignment between local momentum and global bias.

### 4. API & Communication Layer
- **REST API (`src/api/`):** Exposes endpoints for config, raw chart data, and the enhanced market state.
- **WebSocket Manager (`src/websocket/ws.manager.js`):** Handles real-time event broadcasting (price updates and `update_ready` signals).

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

## 💻 Frontend Layer

The system provides two distinct interfaces for interacting with the Market State:

### 1. Reference View (`public/index.html`)
A standard trading view focused on accurate technical display and historical data review.

### 2. Market Dashboard (`public/market_view.html`)
A high-performance "command center" designed for rapid state assessment.
- **Glassmorphism UI:** Built with Tailwind CSS for high readability.
- **Dynamic Synchronization:** Features a "Crosshair Observer" that synchronizes the OHLCV, Technical Summary (MAs/RSI/MACD), and Breakout Score panels with the user's cursor position.
- **Actionable Insights:** Direct display of confluence zones with integrated price-copying functionality.

## 📊 Data Schema (Market State)
The enhanced state object returned by `/api/market/:symbol`:

```json
{
  "market": "BTCUSDT",
  "price": 65432.10,
  "regime_global": "bullish_trending",
  "market_energy": "explosive",
  "market_pressure": "bullish_compression",
  "setup_state": "breakout_ready",
  "breakout_score": 0.85,
  "fake_breakout_risk": "low",
  "levels": {
    "support": [{ "mid": 64000, "score": 8, "tfs": ["1h", "4h"] }],
    "resistance": [{ "mid": 67000, "score": 5, "tfs": ["1h"] }]
  },
  "distance_percent": { "to_support": 2.19, "to_resistance": 2.40 }
}
```

## 🚀 Design Goals
1. **Determinism:** Given the same input data, the Market State must always be the same.
2. **Low Latency:** Data reduction occurs server-side to minimize client-side processing overhead.
3. **Responsive Intelligence:** The dashboard provides real-time, context-aware metrics that adapt as the user explores the chart.
