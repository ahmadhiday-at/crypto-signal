# 📝 CHANGELOG

All notable changes to this project will be documented in this file.

The format used is [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### 🚀 Added
- Module-driven architecture for better scalability and maintainability.

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
