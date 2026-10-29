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

- **`data/chart/{MARKET}_{tf}.json`**: Stores the processed indicators for a specific timeframe.
- **`data/market/{MARKET}.json`**: Stores the final Market State (contract: [DATA_CONTRACT.md](./DATA_CONTRACT.md)).

Write and consistency rules are in [Operating Model → Storage and writes](#o4-storage-and-writes).

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

#### D. Breakout Score & Risk (heuristic)

Calculates a `breakout_score` (0.0 to 1.0) from:

- **Proximity:** Distance from price to the top-scored S/R zones.
- **Volume Profile:** Relative volume surge vs. 20-period moving average.
- **Compression bonus:** A fixed addition when price is inside a compression zone.
- **Regime Alignment** (alignment between local momentum and global bias): intended, not yet part of the score.

`breakout_score` is a **heuristic ranking score, not a probability**. It has not been calibrated against trade outcomes; calibration is the job of the Backtest Engine (Roadmap Level 5). Documentation, the dashboard and AI prompts must not describe it as a probability or confidence percentage.

### 5. API & Communication Layer

- **REST API (`src/api/`):** Exposes endpoints for config, raw chart data, and the enhanced market state.
- **WebSocket Manager (`src/websocket/ws.manager.js`):** Handles real-time event broadcasting (price updates and `update_ready` signals).

---

## 📊 Data Schema

- **Market State** (`/api/market/:symbol`, `data/market/{MARKET}.json`): defined in [DATA_CONTRACT.md](./DATA_CONTRACT.md), the single source of truth for field names, types, units and allowed values. The dashboard and AI prompts depend on it.
- **Per-timeframe snapshot** (`/api/:symbol/:tf`, `data/chart/{MARKET}_{tf}.json`): internal input to the Market State and to the chart views. It has no external contract yet.

## 💻 Frontend Layer

The system provides two distinct interfaces for interacting with the Market State:

### 1. Reference View (`public/index.html`)

A standard trading view focused on accurate technical display and historical data review.

### 2. Market Dashboard (`public/market_view.html`)

A high-performance "command center" designed for rapid state assessment.

- **Glassmorphism UI:** Built with Tailwind CSS for high readability.
- **Dynamic Synchronization:** Features a "Crosshair Observer" that synchronizes the OHLCV, Technical Summary (MAs/RSI/MACD), and Breakout Score panels with the user's cursor position.
- **Actionable Insights:** Direct display of confluence zones with integrated price-copying functionality.

## Operating Model

This section defines when data is updated, which candles are used, how files are written, and how the system behaves when data is old or unavailable. Each subsection lists the **Current** behaviour and the **Decision** to implement.

> **Status:** decisions marked **Proposed** need sign-off from the project owner before implementation. None of the Proposed items is implemented yet.

### O1. Candle finality

- **Current:** each timeframe fetch includes the latest candle, which is usually still forming. Volume-based fields (`volume_state`, `market_energy`, `breakout_score`, `fake_breakout_risk`) can therefore be computed from a partial candle, and they drift during the candle.
- **Decision (Proposed):** every indicator, zone and derived field uses **closed candles only**. The live price from the Binance ticker stream is display-only and labelled as live. The forming candle may be drawn on charts but never feeds the Market State.
- **Trade-off:** signals react up to one candle late (at most 15 minutes for the default entry timeframe). In exchange, the same closed candles always give the same Market State.

### O2. Update triggers and ordering

- **Current:** updates are started by:
  1. **Startup:** every missing or stale timeframe is refreshed, then each symbol's Market State is built.
  2. **Scheduled jobs:** one cron job per symbol and timeframe, firing at the timeframe boundary.
  3. **A 1-minute timer** in the Binance stream client that refreshes `1m` for every symbol.
  4. **API reads** that find no stored file and fetch it on demand.
  5. **`/api/reset`**, which deletes all files and runs the startup refresh.

  The Market State is rebuilt after every entry-timeframe update.
- **Decision (Proposed):**
  1. Use **one boundary tick per symbol**, a few seconds after each candle close, so Binance has finalised the candle.
  2. At each tick, find **every timeframe closing at that boundary**. At 00:00 UTC, for example, that is `15m`, `30m`, `1h`, `4h` and `1d` together.
  3. Update all of those timeframes, then **rebuild the Market State once** from the results.
  4. Startup, API on-demand fetches and reset use the same path, with "all stale timeframes" as the set to update.
- **Why:** if the Market State is rebuilt after the `15m` update but before the `1d` update at the same boundary, it mixes new and old inputs.

### O3. Concurrency

- **Current:** nothing stops two triggers from updating the same symbol and timeframe at the same time. For example, the cron job and the 1-minute timer both refresh `1m`. The result is duplicate Binance calls and a last-writer-wins file.
- **Decision (Proposed):** allow **at most one update in flight per (symbol, timeframe)**. A second request while one is running waits for the running update and uses its result. Market State rebuilds are likewise serialised per symbol.
- **Assumption:** a single Node.js process owns `data/`. Running two instances against the same `data/` directory is not supported.

### O4. Storage and writes

- **Current:** each file is written to a temporary file and then renamed, so readers never see a partially written file. A failed update leaves the previous file in place.
- **Decision (Proposed):**
  - Keep all-or-nothing writes as a documented guarantee.
  - The Market State records which input candle it used for each role timeframe (`inputs`, contract version 2), so a summary can be traced back to its inputs.
- **Scope:** `data/` is a cache of the latest state only, with no history. Reproducing past summaries requires the signal log planned in Roadmap Level 4.

### O5. Freshness and degraded state

- **Current:** the Market State carries no generation time or input ages, and no consumer checks freshness. When updates stop, the last summary keeps being served as if current.
- **Decision (Proposed):**
  - **Input status:** an input timeframe is `stale` when the age of its last closed candle is more than **2 × the timeframe length**, and `missing` when there is no usable snapshot.
  - **Summary status:**
    - `stale` when the entry timeframe is stale or any role timeframe is missing;
    - `degraded` when only non-entry role timeframes are stale;
    - `ok` otherwise.
  - **Recalculation:** status is recalculated each time the Market State is **served**, not only when it is written, so an old file shows up as stale even when no updates are running.
  - **Consumers:** the dashboard shows the status and data age prominently. AI analysis must return **WAIT** when status is not `ok` (see [DATA_CONTRACT.md §7](./DATA_CONTRACT.md#7-consumer-rules)).
- **Open:** the 2× threshold is a starting value and should be confirmed against how the system is actually used.

### O6. Failure handling

- **Current:** REST calls time out after 10 seconds and are not retried. The Binance stream reconnects 5 seconds after it closes. Errors are logged to the console only.
- **Decision (Proposed):**

  | Failure | Behaviour |
  | :------ | :-------- |
  | Timeout, network error, HTTP 5xx | Retry up to 3 times with backoff (1s, 2s, 4s), then keep the last good file and record the error |
  | HTTP 429 (rate limit) | Wait for `Retry-After`, reduce request rate, record `binance_429` |
  | HTTP 418 (IP banned) | Stop all REST calls until the ban expires, record `binance_418` |
  | HTTP 451 (restricted location) | Do not retry, record `binance_451`, see DOCKER_README → Binance access |
  | Stream disconnect | Reconnect with backoff; after reconnecting, run the startup path for stale timeframes to catch up missed boundaries |

  Every failure eventually shows up through the freshness status (O5). An app-level health endpoint should report, per symbol and timeframe, the last successful fetch, the last error, and the stream connection state. The VPN container being healthy does **not** mean Binance is reachable.

### O7. Expected operating conditions

These assumptions shape the design above. Revisit the design if they change.

- **Scale:** 3–5 symbols, up to 8 configured timeframes, of which 4 are role timeframes.
- **Users:** one user, on `localhost`. Endpoints have no authentication and must not be exposed publicly.
- **Process:** one Node.js process, one machine.
- **Data volume:** refetching the full candle window at every boundary fits within Binance limits at this scale. With many more symbols, switch to incremental candle updates and stagger the boundary ticks.

## 🚀 Design Goals

1. **Determinism:** Given the same set of closed input candles, the Market State must always be the same (see [O1](#o1-candle-finality)).
2. **Low Latency:** Data reduction occurs server-side to minimize client-side processing overhead.
3. **Responsive Intelligence:** The dashboard provides real-time, context-aware metrics that adapt as the user explores the chart.
