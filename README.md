# 📈 Trading Chart App: Market State Engine

[![Version](https://img.shields.io/badge/version-1.0.0-blue.svg)](#)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](#)

A professional-grade real-time trading analysis system that transforms raw market data into high-probability trading signals. This is not just a charting tool; it is a **Market State Reducer** that aggregates multi-timeframe (MTF) data into a single, interpretable "State" for precise decision-making.

---

## 🎯 Project Philosophy: The Market State Reducer

Most traders fail because they suffer from "Analysis Paralysis"—looking at too many indicators across too many timeframes and seeing conflicting signals.

**Trading Chart App** solves this by implementing a **Top-Down Analysis** philosophy. Instead of presenting you with raw data, it *reduces* the noise. It asks: 
*"Across the 1D, 4H, 1H, and 15m timeframes, what is the aggregate 'truth' of the market right now?"*

### 🧠 The Intelligence Layer
The system converts technical indicators into strategic insights:
- **MTF Confluence:** Weights levels across timeframes. A support zone appearing on both 1D and 4H is significantly more powerful than one appearing only on 15m.
- **Compression Detection:** Detects "Squeezes" where price is trapped between converging support and resistance, signaling an imminent explosive move.
- **Energy Analysis:** Uses Volume and MACD to differentiate between a "exhausted move" and a "strong trend."
- **Probabilistic Scoring:** Calculates a `breakout_score` and `fakeout_risk` to prevent entering trades during low-probability environments.

---

## 🛠️ Technical Stack

- **Backend:** Node.js / Express
- **Data Source:** Binance API (REST & WebSockets)
- **Analysis:** `technicalindicators` (S/R Clustering, RSI, MACD, ATR)
- **Persistence:** Local JSON Filesystem (State Caching)
- **Communication:** REST API / WebSockets

---

## 📁 Project Structure

```text
trading-chart-app/
├── data/
│   ├── chart/          # Raw processed snapshots per symbol/TF
│   └── market/         # Final "Enhanced Market State" JSONs
├── src/
│   ├── binance.js      # API & WebSocket handlers
│   ├── indicators.js   # TA logic & S/R Clustering
│   └── storage.js      # Local file persistence layer
├── server.js           # Main entry, API routes & Intelligence Layer
├── package.json        # Dependencies & scripts
└── .env                # Configuration variables
```

---

## 🚀 Getting Started

### 📋 Prerequisites
- **Node.js** (v16 or higher)
- **npm** or **yarn**

### 🛠️ Installation

1. **Clone the repository:**
   ```bash
   git clone <your-repo-url>
   cd trading-chart-app
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Environment Setup:**
   Create a `.env` file in the root directory:
   ```env
   # Markets to track (comma separated)
   MARKET_LIST=BTCUSDT,BNBUSDT,SOLUSDT,ETHUSDT
   
   # Timeframes for analysis
   TIMEFRAME_LIST=1m,15m,1h,4h,1d
   
   # Role Definitions (Used by the Reducer)
   TF_HTF=1d
   TF_STRUCTURE=4h
   TF_MID=1h
   TF_ENTRY=15m
   
   # Weighting (Adjust based on your strategy)
   WEIGHT_1D=3.0
   WEIGHT_4H=2.0
   WEIGHT_1H=1.5
   WEIGHT_15M=1.0
   
   # Server Config
   PORT=3000
   ```

4. **Run the application:**
   ```bash
   node server.js
   ```

### 🔌 API Usage

The system provides a "Single Source of Truth" API:

| Endpoint | Method | Description |
| :--- | :--- | :--- |
| `/api/market/:symbol` | `GET` | Returns the fully reduced **Enhanced Market State**. |
| `/api/:symbol/:tf` | `GET` | Returns the raw technical snapshot for a specific TF. |
| `/api/config` | `GET` | Returns current system configuration. |
| `/api/reset` | `GET` | Clears cache and forces a full market re-scan. |

---

## 🗺️ Roadmap & Evolution

The project is evolving through 7 levels of intelligence:
1. **Market Engine (Current):** Structured state reduction.
2. **Scoring Engine:** Probabilistic weighted signals.
3. **Signal Enrichment:** Precision entry/exit/SL/TP.
4. **Dataset Generation:** Logging states for ML training.
5. **Backtest Engine:** Quantitative performance measurement.
6. **Pattern Mining:** Identifying "Golden Patterns."
7. **AI Signal:** ML-optimized weightings and pattern recognition.

Refer to [ROADMAP.md](./ROADMAP.md) for full details.

---

## 🤝 Contributing

Contributions are welcome! To contribute:
1. Fork the project.
2. Create your feature branch (`git checkout -b feature/AmazingFeature`).
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`).
4. Push to the branch (`git push origin feature/AmazingFeature`).
5. Open a Pull Request.

## 📜 License
Distributed under the MIT License. See `LICENSE` for more information.
