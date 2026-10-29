# 📈 Trading Chart App: Market State Engine

[![Version](https://img.shields.io/badge/version-2.0.0-blue.svg)](#)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](#)

A real-time trading analysis system that turns raw market data into a structured, heuristic market state. This is not just a charting tool; it is a **Market State Reducer** that aggregates multi-timeframe (MTF) data into a single, interpretable "State" for precise decision-making.

---

## 🎯 Project Philosophy: The Market State Reducer

Most traders fail because they suffer from "Analysis Paralysis"—looking at too many indicators across too many timeframes and seeing conflicting signals.

**Trading Chart App** solves this by implementing a **Top-Down Analysis** philosophy. Instead of presenting you with raw data, it _reduces_ the noise. It asks:
_"Across the 1D, 4H, 1H, and 15m timeframes, what is the aggregate 'truth' of the market right now?"_

### 🧠 The Intelligence Layer

The system converts technical indicators into strategic insights:

- **MTF Confluence:** Weights levels across timeframes. A support zone appearing on both 1D and 4H is significantly more powerful than one appearing only on 15m.
- **Compression Detection:** Flags "squeezes" where the strongest support and resistance zones overlap around price, a common precursor to a breakout attempt.
- **Energy Analysis:** Uses Volume and MACD to differentiate between a "exhausted move" and a "strong trend."
- **Heuristic Scoring:** Calculates a dynamic `breakout_score` and `fake_breakout_risk`. These are uncalibrated ranking heuristics, not probabilities (see [DATA_CONTRACT.md](./DATA_CONTRACT.md)).
- **Dynamic UX:** Real-time crosshair synchronization between charts and technical summary widgets.

---

## 💻 Core Interface: Market Dashboard

The system now features a premium **Market Dashboard** (`/view/market/:symbol`) that provides:

- **Glassmorphism UI:** High-contrast design for long-session trading.
- **Freshness Banner:** Shows whether the Market State is `ok`, `degraded` or `stale`, the closed-candle time it is based on, and any data errors. Stale data is dimmed; missing data is blanked.
- **Live vs Closed:** The live ticker price is shown separately and labelled display-only; all analysis uses closed candles.
- **Crosshair Observer:** Instant synchronization of OHLCV and Technical Summary (MA/RSI/MACD) on cursor hover.
- **Confluence Tracker:** Visual list of MTF Support/Resistance zones with one-click copying.

---

## 🛠️ Technical Stack

- **Backend:** Node.js / Express
- **Data Source:** Binance API (REST & WebSockets)
- **Analysis:** `technicalindicators` (S/R Clustering, RSI, MACD, ATR)
- **Persistence:** Local JSON Filesystem (latest-state cache, atomic writes)
- **Tests:** Node.js built-in test runner (`node:test`)
- **Communication:** REST API / WebSockets

---

## 📁 Project Structure

```text
trading-chart-app/
├── src/
│   ├── app.js          # Express app (security headers, host allowlist, routes)
│   ├── api/            # Routes and Controllers (REST/UI)
│   ├── services/       # Domain Logic (Binance, candles, indicators, Market State engine, contract, freshness)
│   ├── websocket/      # Real-time event management
│   ├── jobs/           # UTC boundary scheduler
│   ├── config/         # Environment and system constants
│   └── data/           # Filesystem persistence layer (atomic JSON writes)
├── public/             # Dashboard and Reference UI files (public/js: shared browser helpers)
├── test/               # node:test suites and fixtures (no network)
├── server.js           # Entry point: wires engine, app, WebSocket, scheduler
├── package.json        # Dependencies
└── .env                # App configuration
```

---

## 🚀 Getting Started

### 📋 Prerequisites

- **Node.js** (v22 or higher; the Docker image uses Node 24)
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
   PORT=11000
   HOST=127.0.0.1   # listen on localhost only (default: all interfaces)
   ```

   See [.env.example](./.env.example) for every option.

4. **Run the application:**
   ```bash
   node server.js
   ```

5. **Run the tests** (no network access or Binance calls needed):
   ```bash
   npm test
   ```

### 🔌 API & View Endpoints

| Category   | Endpoint               | Method | Description                                          |
| :--------- | :--------------------- | :----- | :--------------------------------------------------- |
| **Data**   | `/api/market/:symbol`  | `GET`  | Returns the **Market State** ([DATA_CONTRACT.md](./DATA_CONTRACT.md)) with freshness `status`. HTTP 503 with diagnostics when unavailable. |
| **Data**   | `/api/:symbol/:tf`     | `GET`  | Returns the closed-candle snapshot for a specific TF, with `status` and `age_seconds`. |
| **UI**     | `/view/market/:symbol` | `GET`  | Renders the premium **Market Dashboard**.            |
| **UI**     | `/view/:symbol/:tf`    | `GET`  | Renders the reference **Multi-Pane Chart**.          |
| **System** | `/api/config`          | `GET`  | Returns markets, timeframes and TF roles.            |
| **System** | `/api/health`          | `GET`  | Per-timeframe fetch diagnostics, Binance pauses and stream state. |
| **System** | `/api/reset`           | `POST` | Re-fetches every timeframe and rebuilds the Market State. Requires the header `X-Requested-With: crypto-signal` and a same-origin request (403 otherwise; `GET` returns 405). Returns 502 if any timeframe fails (existing data is kept), 409 if a reset is already running, 429 within 60 s of the previous reset. |

Unknown symbols, timeframes or `/api` paths return HTTP 404. `/api/:symbol/:tf` returns 503 `snapshot_unavailable` when no data could be fetched. Requests whose `Host` is not `localhost`, `127.0.0.1`, `[::1]` or listed in `ALLOWED_HOSTS` get 403. The endpoints have no authentication: keep the server on localhost (see `HOST`, and `BIND_ADDR` for Docker).

---

## 🗺️ Roadmap & Evolution

The project is evolving through 7 levels of intelligence:

1. **Market Engine (Current):** Structured state reduction from closed candles, with freshness status.
2. **Scoring Engine:** Weighted signals, calibrated into probabilities only after backtesting.
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
