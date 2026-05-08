# 📝 CHANGELOG

All notable changes to this project will be documented in this file.

The format used is [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.1.0] - 2026-05-08

### 🚀 Added
- **Market Dashboard (`market_view.html`)**: Introduced a premium UI using Tailwind CSS and glassmorphism.
- **Dynamic Metrics Pane**: Real-time updates for Global Bias, Market Energy, Pressure, Setup State, and Fakeout Risk.
- **Technical Summary Widget**: Integrated status display for MA200, RSI, and MACD (Signal/Histogram).
- **Probabilities Section**: Dynamic Breakout Score progress bar and S/R distance tracking.
- **Confluence Zones**: A dedicated list for Support/Resistance levels with one-click price copying.

### ⚠️ Changed
- **Chart Layout**: Updated dashboard proportions to Main (70%), Volume (10%), MACD (10%), and RSI (10%) for better price action focus.
- **OHLCV Relocation**: Moved data display from the top bar to a dedicated glass-styled pane directly above the chart area.
- **Viewport Behavior**: Standardized both views to automatically pin the viewport to the latest 100 candles on load and refresh.
- **Crosshair Synchronization**: Enhanced `market_view.html` to synchronize OHLCV, Technical Summary, and Breakout Score metrics with the crosshair's horizontal position.

### 🛠️ Fixed
- **Price Precision**: Ensured consistent locale-string formatting for price and volume across UI components.
- **WebSocket Stability**: Improved reconnection logic and subscription handling for both `index.html` and `market_view.html`.
- **Chart Scaling**: Fixed logical range synchronization between price, volume, and oscillator panes.

### 🚩 Known Issues
- **CSS Bug**: Setup Card border coloring in `market_view.html` incorrectly targets `borderColorLeftColor` instead of `borderLeftColor`.
- **Logic Sync**: Breakout Score in the dashboard is calculated client-side on hover, which may vary slightly from server-side snapshots.
- **Refactor Status**: Frontend components remain in monolithic `<script>` tags; migration to `public/js/core` is pending.

---

## [Unreleased]

### 🛠️ Fixed
- Removed unused empty directories (`routes`, `handlers`, `src/utils`).

### ⚠️ Changed
- Refactored the monolithic `server.js` into focused modules under `src/` (`config`, `api`, `services`, `websocket`, `jobs`, `data`).
- Extracted business logic (`enhanceMarketState`, snapshot updating) into `src/services/market.service.js`.
- Separated API routing and controller logic into `src/api/`.
- Moved WebSocket handling to a dedicated `ws.manager.js`.
- Isolated cron job scheduling to `src/jobs/cron.jobs.js`.


---

## [1.0.0] - 2026-05-04
### 🚀 Added
- Initial release of the **Market State Engine**.
- Multi-timeframe data reduction pipeline.
- Intelligence layer with Compression and Energy analysis.
- Basic REST API for market state access.
- Support/Resistance clustering logic.
- Local filesystem caching for market snapshots.
