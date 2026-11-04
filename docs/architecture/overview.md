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

- **S/R Clustering Engine:** Identifies "Zones" of support and resistance by clustering swing-high/low pivots that lie within 0.5% of each other. The lookback adapts to volatility (`lookback` base, ±20%).
- **Indicator Suite:** Calculates MA14, MA50, MA200, RSI, MACD and ATR.
- **Volatility Analysis:** Uses ATR to set the zone width (0.5 × ATR on each side of the zone centre).

### 3. Data Management (`src/data/`)

To avoid hitting API rate limits, the system keeps the latest state in a local filesystem cache. Apart from the signal log it holds no history.

- **`data/chart/{MARKET}_{tf}.json`**: Stores the processed indicators for a specific timeframe.
- **`data/market/{MARKET}.json`**: Stores the final Market State (contract: [market-state.md](../contract/market-state.md)).

- **`data/history/{MARKET}/{tf}/{YYYY}.json`** (committed, since 4.0.0): closed candles per UTC year, one row per line; `meta.json` holds what Binance does not have. `src/jobs/history-sync.js` fills only what is missing for every market and the live and shadow role timeframes: 60 s after start and daily at 00:01 UTC.
- **`data/backtest/{MARKET}.json`** (gitignored): latest backtest report (Roadmap Level 5).
- **`data/signals/{MARKET}.jsonl`** (gitignored): append-only signal log with outcomes (Roadmap Level 4; [rest.md → Signal log](../contract/rest.md#signal-log)).

Write and consistency rules are in [Operating Model → O4](./operating-model.md#o4-storage-and-writes).

### 4. Intelligence Layer (`src/services/market.service.js`)

This is the "brain" of the application. It takes snapshots from all timeframes and applies heuristics to determine the market environment. The same module holds the update engine: per-timeframe updates, summary builds, freshness and failure tracking (see [Operating Model](./operating-model.md)).

#### A. Multi-Timeframe (MTF) Confluence

The system assigns weights to different timeframes:

The role timeframes come from `engine` in the calculation config (default 1W, 1D, 4H, 1H) and the zone weights from `weights`:

- **HTF:** Long-term trend and major structural levels.
- **Structure:** Intermediate trend and key swing points.
- **Mid:** Local trend and area of value.
- **Entry:** The timeframe signals and plans are made on.

**Confluence Logic:** Each level's score is multiplied by its timeframe weight. A level whose centre falls inside an already-merged zone adds its weighted score to that zone and its timeframe to `tfs`. The top 3 zones per side are kept. Zones are not labelled by confluence; `tfs` shows which timeframes contributed.

#### B. Compression Detection

Compression (`zone_state = compression`) is flagged when the top-scored support zone and the top-scored resistance zone overlap and price lies inside the overlap. Trend direction is not part of the test.

- **Bullish / bearish / neutral compression:** decided by `dominant_side` — the side whose top level has the higher raw score, if the gap exceeds 20% of the larger score; otherwise neutral.

#### C. Energy State Analysis

Combines the volume state of the latest closed entry candle (vs the 20-candle average, which includes that candle) with |MACD histogram| / ATR, so the thresholds hold on any price (values in `market`):

- **Explosive:** high volume and a ratio above `energy_explosive`.
- **Building:** increasing volume and a ratio above `energy_building`.
- **Cooling:** low volume, or a ratio below `energy_cooling`.
- **Stable:** everything else.

#### D. Breakout Score & Risk (heuristic)

Calculates a `breakout_score` (0.0 to 1.0) from:

- **Proximity:** Distance from price to the top-scored S/R zones.
- **Volume Profile:** Relative volume surge vs. 20-period moving average.
- **Compression bonus:** A fixed addition when price is inside a compression zone.
- **Regime Alignment** (alignment between local momentum and global bias): intended, not yet part of the score.

`breakout_score` is a **heuristic ranking score, not a probability**. It has not been calibrated against trade outcomes; calibration is the job of the Backtest Engine (Roadmap Level 5). Documentation, the dashboard and AI prompts must not describe it as a probability or confidence percentage.

### 5. API & Communication Layer

- **REST API (`src/app.js`, `src/api/`):** Exposes config, per-timeframe chart data, the Market State, `GET /api/health` diagnostics, `POST /api/reset`, the calculation config (`/api/calc-config`) and backtest re-runs (`/api/backtest-runs`) ([rest.md](../contract/rest.md)). Market and timeframe parameters are checked against the configured lists before they reach storage or Binance.
- **WebSocket Manager (`src/websocket/ws.manager.js`):** Same-origin connections only. Clients subscribe to one `{market, timeframe}` and receive `price` (live, display-only), `update_ready` (that timeframe's snapshot changed) and `summary_ready` (the market's Market State changed). Message shapes: [websocket.md](../contract/websocket.md).

---

## 📊 Data Schema

- **Market State** (`/api/market/:symbol`, `data/market/{MARKET}.json`): defined in [market-state.md](../contract/market-state.md), the single source of truth for field names, types, units and allowed values. The dashboard and AI prompts depend on it.
- **Per-timeframe snapshot** (`/api/:symbol/:tf`, `data/chart/{MARKET}_{tf}.json`): internal input to the Market State and to the chart views. It has no external contract yet.

## 💻 Frontend Layer

Plain HTML, CSS and scripts with no build step and no framework. The only external scripts are lightweight-charts (pinned, from unpkg) and the fonts. Since 4.2.0 Tailwind, jQuery, select2 and lucide are gone.

| URL | Page | Script (`public/js/pages/`) | Holds |
| :-- | :--- | :-- | :-- |
| `/` | 302 to `/signals` | | |
| `/signals` | `public/signals.html` | `signals.js` | Every market: long, short or wait with plan, trends, verdict and freshness; open trades; recent results; optional browser alert |
| `/:market` | `public/market_view.html` | `market.js` | One market: signal, trade plan, position size, open trades, reasons, context, levels, track record; chart with the plan drawn |
| `/:market/:timeframe` | `public/index.html` | `chart.js` | Full chart of one timeframe |
| `/backtest/:market` | `public/backtest.html` | `backtest.js` | Verdict, then tabs Summary, Robustness, Breakdown, Trades |
| `/config` | `public/config.html` | `config.js` | Tabs per subject; backtest runs under Backtest; data refetch and health under Operations |

Page routes are in `src/api/routes/view.routes.js`, mounted after the static files and `/api`. They accept any path segment; the pages read the market and timeframe from the URL and, when one is not in `/api/config`, show a "not configured" notice listing what is available.

**Shared modules (`public/js/`):**

- `format.js` (`Fmt`): one number and time format. Times are UTC, like the candles.
- `signal-view.js` (`SignalView`): words and arithmetic of a signal: `BUY`/`SELL` read as LONG/SHORT, labels of every reason, filter and verdict, plan distances, position size, open R. The API keeps `BUY`/`SELL`. Tested in `test/signal-view.test.js`.
- `market-status.js` (`MarketStatus`): freshness verdict of a Market State response.
- `app-header.js` (`AppHeader`): top bar, toast, clipboard, admin requests (`adminFetch`), live stream (`live`).
- `pane-chart.js` (`PaneChart`): candles, volume, MACD and RSI in four synced panes, with zones and the plan. Used by the Market and Chart pages.

**Display rules:**

- The server decides the signal; pages only display it. Live prices are display-only and only move the forming candle.
- Anything not `ok` is marked: the freshness banner and data column show it, and on the Market page the side panel dims. With no Market State, values are blanked.
- A signal is never shown without its backtest verdict. A filtered setup reads as WAIT with its reason, and its plan as not active.
- A setup that persists over several candles is one open trade in the log, so the Market page says the trade is already open instead of asking for a new entry.
- Position size is computed in the browser; account size and risk stay in `localStorage`.
- Below 1100 px the Market page stacks signal and plan, then the chart, then the rest. No page scrolls sideways; wide tables scroll inside their card.

**UI type scale (`public/css/app.css`):** Inter for text, JetBrains Mono for numbers and data. Sizes by kind of information:

| Class | Size | Used for |
| :-- | :-- | :-- |
| `t-display` | 28px | the signal itself: LONG, SHORT, WAIT |
| `t-title` | 18px | page identity, stat values |
| `t-headline` | 16px | the number to read first: live price |
| `t-value` | 14px | card and metric values |
| `t-body` | 13px | prose: notes, explanations, empty states |
| `t-data` | 12px | tables, lists, controls |
| `t-meta` | 11px | timestamps, hints, version, chart legends and axes |
| `t-label` | 10px | uppercase captions above a value or section |

## 🚀 Design Goals

1. **Determinism:** Given the same set of closed input candles, the Market State must always be the same (see [O1](./operating-model.md#o1-candle-finality)).
2. **Low Latency:** Data reduction occurs server-side to minimize client-side processing overhead.
3. **Responsive Intelligence:** The dashboard provides real-time, context-aware metrics that adapt as the user explores the chart.

## Code Map

Wiring is in `server.js`: `createCalcConfig` (`src/config/calculation.js`) loads and watches `config/calculation.json`; `createMarketEngine` (`src/services/market.service.js`) gets storage, Binance client, indicator service, config, `calc` and `notify` callbacks (a `calc` change calls `rebuildSummary` for every market); `createApp` (`src/app.js`) builds Express around the engine; `createScheduler` (`src/jobs/scheduler.js`) drives it.

1. **Per-timeframe update** — `engine.updateTimeframe(market, tf)` (single-flight per market+tf): `binance.getKlines` (validated rows, retries, 429/418/451 cooldowns) → `candles.normalizeCandles` + `splitClosed` (forming candle kept aside) → `indicator.calculateAll` (throws `CalculationError` with a code) → `validateSnapshot` → monotonic check → atomic write to `data/chart/{MARKET}_{tf}.json` → `update_ready` over WS. Failures keep the old file and record `last_error` in the in-memory health map.
2. **Summary** — `engine.rebuildSummary(market)` (serialised per market) reads the role snapshots, `mergeSnapshots` (weighted level merge, top 3) → `enhanceMarketState` (heuristic formula, regression-tested in `test/enhance.test.js`) → adds `schema_version`, `generated_at`, `inputs`, `status`, `errors` → `validateMarketState` → write `data/market/{MARKET}.json` → `summary_ready` over WS.
3. **Serving** — `engine.getMarketState` recomputes `inputs` ages, `status` and `errors` at request time (`src/services/freshness.js`), or returns the 503 diagnostic body.

Signal: `src/services/signal.js` `computeSignal(state, htfTf, opts)` (pure; `opts` = `calc.signalOptions()`) runs in `buildSummary` and again in `getMarketState` after the status is recomputed. `src/services/divergence.js` `detectDivergence(candles, rsi)` feeds the `divergence` field in `mergeSnapshots`.

Signal board: `src/services/signal-board.js` (pure) builds `GET /api/signals` from the Market State, signal log and Edge of each market.

Signal log: `src/services/signal-log.js` `createSignalLog` is passed to the engine as `signalLog`. After each published summary, `onSummary(market, summary, entryCandles)` first closes open records (WIN/LOSS/EXPIRED/UNKNOWN), then appends a new candidate. Errors are logged and never block publishing. `engine.initialize()` reloads open records; `engine.signalRecords(market)` serves `GET /api/signals/:symbol`.

Backtest: `scripts/backtest.js` (CLI, outside the server) → `src/services/history.js` `createHistory().sync` (paginated `binance.getKlinesFrom`, cache in `data/history/`) → `src/services/backtest.js` `runBacktest` (shares `composeMarketState` from `market.service.js`, `computeSignal`, and `recordFrom`/`evaluate` from `signal-log.js` with the live path; `--sweep` variants reuse each step's snapshots and only re-merge when the weights differ; `breakdown` groups trades per feature) → `createReports().write`. The server reads reports (`createApp({ reports })` → `GET /api/backtest/:symbol`; `src/services/edge.js` `edgeSummary` → `GET /api/edge/:symbol`) and starts the CLI as a child process through `src/services/backtest-runner.js` (`POST /api/backtest-runs`).

Triggers: `historySync` → `history.sync` (startup and 00:01 UTC); `scheduler` → `engine.runBoundary(boundary)`; startup → `engine.initialize()`; ticker stream reconnect → `engine.refreshStale()`; `POST /api/reset` → `engine.reset()`.

Other modules: `src/data/storage.js` is the only persistence layer (strict name regexes, unique temp file + fsync + rename, reads return `{data, reason}`). `src/websocket/ws.manager.js` shares the HTTP server (same-origin, 4 KB max payload, validated subscriptions). Page routes (`src/api/routes/view.routes.js`) are mounted at `/` after static files and `/api`; pages parse the market/timeframe from the last one or two URL segments.
