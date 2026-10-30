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

- **REST Client:** Fetches K-lines (candles) for all configured timeframes, with timeouts, bounded retries and provider-specific handling of 429/418/451 (see [O6](#o6-failure-handling)).
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
- **`data/market/{MARKET}.json`**: Stores the final Market State (contract: [DATA_CONTRACT.md](./DATA_CONTRACT.md)).

Write and consistency rules are in [Operating Model → Storage and writes](#o4-storage-and-writes).

### 4. Intelligence Layer (`src/services/market.service.js`)

This is the "brain" of the application. It takes snapshots from all timeframes and applies heuristics to determine the market environment. The same module holds the update engine: per-timeframe updates, summary builds, freshness and failure tracking (see [Operating Model](#operating-model)).

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

- **REST API (`src/app.js`, `src/api/`):** Exposes config, per-timeframe chart data, the Market State, `GET /api/health` diagnostics, and `POST /api/reset`. Market and timeframe parameters are checked against the configured lists before they reach storage or Binance.
- **WebSocket Manager (`src/websocket/ws.manager.js`):** Same-origin connections only. Clients subscribe to one `{market, timeframe}` and receive `price` (live, display-only), `update_ready` (that timeframe's snapshot changed) and `summary_ready` (the market's Market State changed).

---

## 📊 Data Schema

- **Market State** (`/api/market/:symbol`, `data/market/{MARKET}.json`): defined in [DATA_CONTRACT.md](./DATA_CONTRACT.md), the single source of truth for field names, types, units and allowed values. The dashboard and AI prompts depend on it.
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

## Operating Model

This section defines when data is updated, which candles are used, how files are written, and how the system behaves when data is old or unavailable. Everything below is implemented and covered by tests (`npm test`) unless marked **Open**.

### O1. Candle finality

- Every indicator, zone and derived field uses **closed candles only**. A candle is closed once the current time reaches its close time (open + timeframe length).
- Each fetch is validated (`src/services/candles.js`): malformed rows reject the whole response (`invalid_response`), duplicates are removed (the later row wins), rows are sorted, and gaps are counted (`gaps` in the per-timeframe snapshot) but not filled.
- Binance always returns its current candle last. The final row of a response is therefore treated as forming unless it closed more than 60 seconds ago, even if the host clock says it has closed. This keeps a partial candle out of the calculations when the host clock runs ahead or Binance is slow to open the next candle; the next minute tick fetches again.
- The forming candle is stored separately (`forming_candle` in the per-timeframe snapshot) for chart display only.
- The live ticker price is display-only and never enters a calculation.
- **Trade-off:** signals react up to one candle late (at most 15 minutes for the default entry timeframe). In exchange, the same closed candles always give the same Market State.

### O2. Update triggers and ordering

1. **Boundary tick** (`src/jobs/scheduler.js`): one UTC-aligned timer fires 5 seconds after every minute boundary. The delay gives Binance time to finalise the candle and assumes the host clock is NTP-synchronised.
2. **Due timeframes:** for each market, every configured timeframe whose candle closed at that boundary (for example `15m`, `30m`, `1h`, `4h` and `1d` together at 00:00 UTC; `1w` on Mondays), plus any timeframe that is **behind** — its stored candle is older than the latest closed candle (e.g. after a failure or restart).
3. All due timeframes are updated, then the Market State is **rebuilt once** if any role timeframe was due.
4. The Market State is validated and published only if valid (see [DATA_CONTRACT.md](./DATA_CONTRACT.md)). Subscribers get `summary_ready`.
5. **Startup**, **stream reconnect** and **reset** use the same path: startup and reconnect update every timeframe that is behind; reset updates all of them.
6. An API read of a per-timeframe snapshot that does not exist triggers a one-off fetch through the same path (subject to the retry throttle in O3).

Boundaries are computed in UTC, so daily and 4-hourly candles align with Binance regardless of the host time zone.

### O3. Concurrency

- **At most one update in flight per (market, timeframe).** A trigger arriving while the same update runs joins it and gets the same result.
- **Market State builds are serialised per market**, so concurrent triggers cannot publish interleaved results.
- **Monotonic writes:** a fetched snapshot whose latest closed candle is older than the stored one is discarded; a summary whose entry candle is older than the stored summary's is not written.
- **Retry throttle:** after a **failed** fetch, a timeframe that is behind (but not at its own boundary) is retried at most once per min(timeframe, 5 minutes). After a successful fetch that is still behind (Binance had not finalised the candle), it is retried on the next minute tick.
- **Summary build queue:** at most one build runs and at most one waits per market; further requests share the waiting build.
- **Reset:** one at a time (409) and at most once per 60 seconds (429 with `Retry-After`).
- **Assumption:** a single Node.js process owns `data/`. Running two instances against the same `data/` directory is not supported.

### O4. Storage and writes

- Files are written to a unique temporary file, flushed with `fsync`, then renamed over the target, so readers never see a partial file. Leftover temporary files are removed at startup.
- File names are built only from validated symbols and timeframes; anything else is rejected before touching the filesystem.
- Every file read is validated. Corrupt JSON, legacy (pre-2.0.0) snapshots, files that fail validation and files whose candle close time is more than 60 seconds in the future (clock problem) are treated as missing and refetched; they are never served. A file that turns bad after startup is refetched on the next tick.
- A failed update leaves the previous file in place.
- The Market State records the input candle close time for each role timeframe (`inputs`), so a summary can be traced back to its inputs.
- **Scope:** `data/` is a cache of the latest state only, with no history. Reproducing past summaries requires the signal log planned in Roadmap Level 4.

### O5. Freshness and degraded state

- **Input status:** a role timeframe is `stale` when the age of its last closed candle is more than **2 × the timeframe length**, and `missing` when there is no valid snapshot or its close time lies more than 60 seconds in the future.
- **Summary status:** `stale` when the entry timeframe is stale or any role timeframe is missing; `degraded` when only non-entry role timeframes are stale; `ok` otherwise.
- **Recomputed on every read**, from the recorded candle close times, so an old file is reported as stale even when no updates are running.
- If no valid Market State exists and none can be built, the API returns HTTP 503 with a diagnostic body and no market fields ([DATA_CONTRACT.md §6.4](./DATA_CONTRACT.md#64-unavailable-response-http-503)).
- The dashboard shows the status and data age prominently. AI analysis must return **WAIT** when status is not `ok` ([DATA_CONTRACT.md §7](./DATA_CONTRACT.md#7-consumer-rules)).
- **Open:** the 2× threshold is a starting value and should be confirmed against how the system is actually used.

### O6. Failure handling

| Failure | Behaviour |
| :------ | :-------- |
| Timeout, network error, HTTP 5xx | Retry up to 3 times with backoff (1s, 2s, 4s), then keep the last good file and record `timeout` / `network` / `binance_http` |
| HTTP 429 (rate limit) | No retry. Pause all REST calls for `Retry-After` (default 60 s), record `binance_429` |
| HTTP 418 (IP banned) | No retry. Pause all REST calls for `Retry-After`, at least 120 s, record `binance_418` |
| HTTP 451 (restricted location) | No retry. Pause all REST calls for 15 minutes, record `binance_451`. The app never switches VPN exits or otherwise works around the restriction; see DOCKER_README → Akses Binance |
| Other HTTP 4xx | No retry, record `binance_http` |
| Malformed response | Nothing stored, record `invalid_response` |
| Fewer than 200 closed candles / non-finite indicator values | Nothing stored, record `insufficient_data` / `calculation_failed` |
| Disk / permission error | Previous file kept, record `storage_failed` |
| Stream disconnect | Reconnect with exponential backoff (5 s → 60 s; 15 minutes after a 451), then catch up every timeframe that is behind |

While a pause is active, requests fail immediately without contacting Binance. Every failure also shows up through the freshness status (O5).

`GET /api/health` reports, per market and timeframe, the stored candle close time, last attempt, last success and last error code, plus any active Binance pause and the ticker stream state. The VPN container being healthy does **not** mean Binance is reachable.

### O7. Expected operating conditions

These assumptions shape the design above. Revisit the design if they change.

- **Scale:** 3–5 symbols, up to 8 configured timeframes, of which 4 are role timeframes.
- **Users:** one user. Endpoints have no authentication. Docker Compose publishes the port on `127.0.0.1` only by default (`BIND_ADDR`); a local `npm start` listens on `HOST` (default all interfaces — set `HOST=127.0.0.1`).
- **Host allowlist:** HTTP and WebSocket requests are served only when the `Host` header names `localhost`, `127.0.0.1`, `[::1]` or a name listed in `ALLOWED_HOSTS` (403 `host_not_allowed` otherwise). This blocks DNS-rebinding pages. Add the LAN IP or host name to `ALLOWED_HOSTS` when exposing the app with `BIND_ADDR=0.0.0.0`.
- **Process:** one Node.js process, one machine, NTP-synchronised clock.
- **Data volume:** refetching the full candle window at every boundary fits within Binance limits at this scale. With many more symbols, switch to incremental candle updates and stagger the boundary ticks.

## 🚀 Design Goals

1. **Determinism:** Given the same set of closed input candles, the Market State must always be the same (see [O1](#o1-candle-finality)).
2. **Low Latency:** Data reduction occurs server-side to minimize client-side processing overhead.
3. **Responsive Intelligence:** The dashboard provides real-time, context-aware metrics that adapt as the user explores the chart.
