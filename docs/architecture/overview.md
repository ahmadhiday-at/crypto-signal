# Architecture overview

Components, data schema, frontend, design goals and code map of the Market State Engine. This document provides a detailed technical overview of the **Trading Chart App**. The system is designed not as a simple chart viewer, but as a **Market State Reducer**—a system that compresses vast amounts of multi-timeframe market data into a single, actionable "State" object.

## 🗺️ High-Level System Overview

The application follows a linear pipeline architecture where data is progressively refined from raw numbers into strategic intelligence.

### 🔄 The Data Pipeline

`Market Data (Binance API/WS)` $\rightarrow$ `Indicator Service` $\rightarrow$ `Market Reducer (MTF)` $\rightarrow$ `Intelligence Layer` $\rightarrow$ `REST/WS API` $\rightarrow$ `Dynamic Dashboard (UI)`

---

## 🧩 Component Deep Dive

### 1. Data Acquisition Layer (`src/services/binance.service.js`)

Responsible for the interface between the system and the external market.

- **REST Client:** Fetches K-lines (candles) for all configured timeframes, with timeouts, bounded retries and provider-specific handling of 429/418/451 (see [O6](./operating-model.md#o6-failure-handling)).
- **Validation and normalization (`src/services/candles.js`):** Rejects malformed rows, sorts and de-duplicates candles, separates closed candles from the forming one, and counts gaps.
- **WebSocket Subscriber:** Streams live ticker prices for display only. They never feed a calculation.

### 2. Technical Analysis Layer (`src/services/indicator.service.js`)

Transforms raw price data into mathematical and structural insights.

- **S/R Clustering Engine:** Identifies "Zones" of support and resistance by clustering swing-high/low pivots that lie within 0.5% of each other. The lookback adapts to volatility (`MAPPING_CANDLE` base, ±20%).
- **Indicator Suite:** Calculates MA14, MA50, MA200, RSI, MACD and ATR.
- **Volatility Analysis:** Uses ATR to set the zone width (0.5 × ATR on each side of the zone centre).

### 3. Data Management (`src/data/`)

To avoid hitting API rate limits, the system keeps the latest state in a local filesystem cache. It holds no history.

- **`data/chart/{MARKET}_{tf}.json`**: Stores the processed indicators for a specific timeframe.
- **`data/market/{MARKET}.json`**: Stores the final Market State (contract: [market-state.md](../contract/market-state.md)).

Write and consistency rules are in [Operating Model → O4](./operating-model.md#o4-storage-and-writes).

### 4. Intelligence Layer (`src/services/market.service.js`)

This is the "brain" of the application. It takes snapshots from all timeframes and applies heuristics to determine the market environment. The same module holds the update engine: per-timeframe updates, summary builds, freshness and failure tracking (see [Operating Model](./operating-model.md)).

#### A. Multi-Timeframe (MTF) Confluence

The system assigns weights to different timeframes:

- **HTF (1D):** Global bias and major structural levels. (Highest Weight)
- **Structure (4H):** Intermediate trend and key swing points.
- **Mid (1H):** Local trend and area of value.
- **Entry (15M):** Precise timing and immediate liquidity zones. (Lowest Weight)

**Confluence Logic:** Each level's score is multiplied by its timeframe weight. A level whose centre falls inside an already-merged zone adds its weighted score to that zone and its timeframe to `tfs`. The top 3 zones per side are kept. Zones are not labelled by confluence; `tfs` shows which timeframes contributed.

#### B. Compression Detection

Compression (`zone_state = compression`) is flagged when the top-scored support zone and the top-scored resistance zone overlap and price lies inside the overlap. Trend direction is not part of the test.

- **Bullish / bearish / neutral compression:** decided by `dominant_side` — the side whose top level has the higher raw score, if the gap exceeds 20% of the larger score; otherwise neutral.

#### C. Energy State Analysis

Combines the volume state of the latest closed entry candle (vs the 20-candle average, which includes that candle) with the absolute MACD histogram. The histogram thresholds are absolute values, not scaled to price:

- **Explosive:** volume > 1.5× average and |histogram| > 0.1.
- **Building:** volume > 1.2× average and |histogram| > 0.05.
- **Cooling:** volume < 0.8× average, or |histogram| < 0.02.
- **Stable:** everything else.

#### D. Breakout Score & Risk (heuristic)

Calculates a `breakout_score` (0.0 to 1.0) from:

- **Proximity:** Distance from price to the top-scored S/R zones.
- **Volume Profile:** Relative volume surge vs. 20-period moving average.
- **Compression bonus:** A fixed addition when price is inside a compression zone.
- **Regime Alignment** (alignment between local momentum and global bias): intended, not yet part of the score.

`breakout_score` is a **heuristic ranking score, not a probability**. It has not been calibrated against trade outcomes; calibration is the job of the Backtest Engine (Roadmap Level 5). Documentation, the dashboard and AI prompts must not describe it as a probability or confidence percentage.

### 5. API & Communication Layer

- **REST API (`src/app.js`, `src/api/`):** Exposes config, per-timeframe chart data, the Market State, `GET /api/health` diagnostics, and `POST /api/reset` ([rest.md](../contract/rest.md)). Market and timeframe parameters are checked against the configured lists before they reach storage or Binance.
- **WebSocket Manager (`src/websocket/ws.manager.js`):** Same-origin connections only. Clients subscribe to one `{market, timeframe}` and receive `price` (live, display-only), `update_ready` (that timeframe's snapshot changed) and `summary_ready` (the market's Market State changed). Message shapes: [websocket.md](../contract/websocket.md).

---

## 📊 Data Schema

- **Market State** (`/api/market/:symbol`, `data/market/{MARKET}.json`): defined in [market-state.md](../contract/market-state.md), the single source of truth for field names, types, units and allowed values. The dashboard and AI prompts depend on it.
- **Per-timeframe snapshot** (`/api/:symbol/:tf`, `data/chart/{MARKET}_{tf}.json`): internal input to the Market State and to the chart views. It has no external contract yet.

## 💻 Frontend Layer

The system provides two distinct interfaces for interacting with the Market State:

Page routes (`src/api/routes/view.routes.js`, mounted at `/` after the static files and `/api`):

| URL | Page |
| :-- | :--- |
| `/:market` (e.g. `/BTCUSDT`) | Market Dashboard |
| `/:market/:timeframe` (e.g. `/BTCUSDT/1h`) | Reference View |
| `/` | Reference View via the static `public/index.html`, defaulting to `BTCUSDT` / `15m` |

The page routes accept any path segment; the pages read the market and timeframe from the URL and show an unavailable state when the API returns 404.

### 1. Reference View (`public/index.html`)

A standard trading view focused on accurate technical display and historical data review. Closed candles are drawn normally; the forming candle is drawn in grey and is the only bar that live prices update.

### 2. Market Dashboard (`public/market_view.html`)

A high-performance "command center" designed for rapid state assessment.

- **Glassmorphism UI:** Built with Tailwind CSS for high readability.
- **Freshness banner:** Shows `status` (`ok` / `degraded` / `stale`), the entry-candle close time and age, and any error codes. Anything not `ok` is dimmed; when no Market State exists, all values are blanked. The verdict is re-read from the server every minute.
- **Live vs closed:** The header shows the live ticker price, labelled as display-only. The banner shows the closed entry-candle price the analysis is based on.
- **Dynamic Synchronization:** A "Crosshair Observer" synchronizes OHLCV and Technical Summary (MAs/RSI/MACD) with the hovered candle. The breakout score and distances always come from the server and are not recalculated on hover.
- **Actionable Insights:** Direct display of confluence zones with integrated price-copying functionality.

## 🚀 Design Goals

1. **Determinism:** Given the same set of closed input candles, the Market State must always be the same (see [O1](./operating-model.md#o1-candle-finality)).
2. **Low Latency:** Data reduction occurs server-side to minimize client-side processing overhead.
3. **Responsive Intelligence:** The dashboard provides real-time, context-aware metrics that adapt as the user explores the chart.

## Code Map

Wiring is in `server.js`: `createMarketEngine` (`src/services/market.service.js`) gets storage, Binance client, indicator service, config and `notify` callbacks; `createApp` (`src/app.js`) builds Express around the engine; `createScheduler` (`src/jobs/scheduler.js`) drives it.

1. **Per-timeframe update** — `engine.updateTimeframe(market, tf)` (single-flight per market+tf): `binance.getKlines` (validated rows, retries, 429/418/451 cooldowns) → `candles.normalizeCandles` + `splitClosed` (forming candle kept aside) → `indicator.calculateAll` (throws `CalculationError` with a code) → `validateSnapshot` → monotonic check → atomic write to `data/chart/{MARKET}_{tf}.json` → `update_ready` over WS. Failures keep the old file and record `last_error` in the in-memory health map.
2. **Summary** — `engine.rebuildSummary(market)` (serialised per market) reads the role snapshots, `mergeSnapshots` (weighted level merge, top 3) → `enhanceMarketState` (heuristic formula, regression-tested in `test/enhance.test.js`) → adds `schema_version`, `generated_at`, `inputs`, `status`, `errors` → `validateMarketState` → write `data/market/{MARKET}.json` → `summary_ready` over WS.
3. **Serving** — `engine.getMarketState` recomputes `inputs` ages, `status` and `errors` at request time (`src/services/freshness.js`), or returns the 503 diagnostic body.

Triggers: `scheduler` → `engine.runBoundary(boundary)`; startup → `engine.initialize()`; ticker stream reconnect → `engine.refreshStale()`; `POST /api/reset` → `engine.reset()`.

Other modules: `src/data/storage.js` is the only persistence layer (strict name regexes, unique temp file + fsync + rename, reads return `{data, reason}`). `src/websocket/ws.manager.js` shares the HTTP server (same-origin, 4 KB max payload, validated subscriptions). Page routes (`src/api/routes/view.routes.js`) are mounted at `/` after static files and `/api`; pages parse the market/timeframe from the last one or two URL segments.
