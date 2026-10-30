# 🎨 Level 2.5A — Visual Strategy Layer (dashboard) ✅

Roadmap level: goals, milestones and success criteria. Overview: [README.md](./README.md).
**Objective:** a high-performance UI for real-time state monitoring.

- [x] **Glassmorphism UI:** Tailwind CSS.
- [x] **Crosshair synchronization:** crosshair and visible range synced across all panes; Binance-style legends (OHLC, change, range, MA, volume, MACD, RSI) follow the hovered candle (the breakout score is always the server value).
- [x] **Viewport layout (v2.1.0):** dashboard fits the screen without page scroll; panes resize with the window.
- [x] **Freshness banner (v2.0.0):** `ok` / `degraded` / `stale`, data age and error codes; stale data dimmed, missing data blanked.
- [x] **Confluence monitoring:** S/R zone list with price copying.
- [x] **Live WebSocket integration:** live (display-only) prices and push notifications when snapshots or the Market State change.

**Success criteria:** assess the market state in under 5 seconds.
