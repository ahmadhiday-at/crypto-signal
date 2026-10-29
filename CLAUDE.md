# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev     # nodemon; watches server.js + src/, ignores data/
npm start       # node server.js
docker compose up -d            # app behind gluetun WireGuard VPN (see DOCKER_README.md)
docker compose up -d --build    # needed only when package.json / package-lock.json change
```

There is no test suite, linter, or build step. Verify changes by running the server and hitting the endpoints (`/api/market/:symbol`, `/api/:symbol/:tf`, `/api/config`, `/api/reset`, `/view/market/:symbol`, `/view/:symbol/:tf`).

## Changelog, versioning & docs (required for every change)

Every change to code, config, or behavior must ship with three things in the same piece of work:

1. **Bump the version** in `package.json` (and `package-lock.json`) using SemVer:

   ```bash
   npm version patch --no-git-tag-version   # bug fix, refactor, tweak that changes no contract
   npm version minor --no-git-tag-version   # new feature, endpoint, field, timeframe, env var
   npm version major --no-git-tag-version   # breaking change (see below)
   ```

   Breaking = renaming/removing a field in the `enhanceMarketState` output or `/api/*` responses, changing WS message shapes (`price`, `update_ready`, `subscribe`), changing `data/` file paths/format, or renaming/removing an env var. Bump once per task, not once per file edited.
   A version-only change to `package.json` does not require `docker compose up --build` (source is mounted; dependencies are unchanged).

2. **Add a changelog file** at `.changelog/v<version>.md` matching the new `package.json` version exactly, following `.changelog/TEMPLATE.md`. Never edit a released changelog file to describe new work; create a new version instead. Mention any required action (new env var, `docker compose restart app`, `--build`, deleting `data/` snapshots).

3. **Update every affected `.md` file** so docs never lag behind the code:
   | Change touches | Update |
   |---|---|
   | Commands, architecture, data flow, config gotchas | `CLAUDE.md`, `ARCHITECTURE.md` |
   | Setup, env vars, endpoints | `README.md`, `.env.example` |
   | Docker / VPN / compose | `DOCKER_README.md` |
   | `enhanceMarketState` / `/api/market/:symbol` fields | `PROMPT_AI_*.md` (they consume those fields) |
   | Completing or changing a planned item | `ROADMAP.md`, `CRYPTO AI SIGNAL SYSTEM ROADMAP.md` |

   List the updated docs in the changelog's "Dokumentasi" section.

Not a change: diffs under `data/` produced by running the app — no version bump, no changelog.

## Architecture

Node.js/Express (CommonJS) "Market State Reducer": pulls Binance klines, computes indicators and S/R zones per timeframe, then merges a fixed set of timeframes into one enhanced market-state JSON per symbol. Plain HTML pages in `public/` consume the REST API and WebSocket.

Data flow, all orchestrated by `src/services/market.service.js`:

1. **Per-timeframe snapshot** — `updateMarketData(market, tf)`: `binance.service.getKlines` (REST, `CANDLE_LIMIT` candles) → `indicator.service.calculateAll` (SMA14/50/200, RSI, MACD, ATR, ATR-clustered S/R zones, `context`/`momentum`/`regime`) → `storage.writeSnapshot` → `data/chart/{MARKET}_{tf}.json`, then broadcasts `update_ready` over WS. `calculateAll` throws if fewer than 200 candles.
2. **MTF merge** — only when the updated tf equals `TF_ROLES.entry`, `updateMarketSnapshot(market)` reads the four role timeframes (`TF_HTF`/`TF_STRUCTURE`/`TF_MID`/`TF_ENTRY`), weights each level's score by `TF_WEIGHTS`, merges overlapping levels (a level whose `mid` falls inside an existing zone's `low..high`), keeps top 3 support/resistance, and passes it through `enhanceMarketState`. If any role snapshot is missing it aborts and returns `null`.
3. **Enhancement** — `enhanceMarketState` is pure heuristics producing `context`, `zone_state`, `market_pressure`, `market_energy`, `breakout_score`, `setup_state`, `fake_breakout_risk`, `regime_global`, etc. Output → `data/market/{MARKET}.json`. These field names are the contract consumed by `public/market_view.html` and by the LLM prompts in `PROMPT_AI_*.md`; keep them stable.

Triggers for updates:

- `server.js` startup → `initializeAllSnapshots()` refreshes any missing/stale snapshot (staleness via `TF_TO_SECONDS`) for every market × (`TIMEFRAMES` ∪ role TFs), then builds market snapshots.
- `src/jobs/cron.jobs.js` schedules `updateMarketData` per market × tf using `TF_TO_CRON`; timeframes not in that map are silently skipped.
- `binance.service.connectWebSocket` streams `@ticker` prices (relayed to clients via `ws.manager.broadcastPrice`) and also fires a `1m` update every minute on a 1s interval. It reconnects on close.

`src/data/storage.js` is the only persistence layer: JSON files written atomically (tmp + rename), reads return `null` on any error. `data/` is committed to git, so running the app produces diffs there; don't commit those unless asked.

`src/websocket/ws.manager.js` shares the HTTP server; clients send `{type:"subscribe", market, timeframe}` and receive `price` / `update_ready` messages. Each socket tracks one subscription key.

## Configuration gotchas

- All config is in `src/config/env.js` (dotenv). Lists are comma-separated env vars (`MARKET_LIST`, `TIMEFRAME_LIST`, `TIMEFRAME_LABELS`).
- The server port is `PORT` (default 11000). `docker-compose.yml` uses the same variable for both the host and container side of the port mapping, so they stay in sync.
- `MAPPING_CANDLE` (base S/R lookback per tf) and `BINANCE_REST_URL`/`BINANCE_WS_URL`/`CANDLE_LIMIT` are read directly from `process.env` inside services, not via `env.js`.
- `MAPPING_CANDLE` keys are matched case-sensitively against the timeframe code (e.g. `1h`), so uppercase keys like `1H`/`4H`/`1D`/`1W` in `.env.example` never match and those timeframes fall back to 200.
- Adding a new timeframe requires entries in `TF_TO_CRON`, `TF_TO_SECONDS`, and (if it should carry weight) `TF_WEIGHTS`.

## Docker / VPN

`docker-compose.yml` runs the app in the network namespace of a `gluetun` WireGuard container (`network_mode: "service:vpn"`), so ports are published on the VPN container. This exists to avoid Binance HTTP 451 geo-blocks — a 451 from Binance is a network/VPN issue, not a code bug. WireGuard config lives in `gluetun/wireguard/` (gitignored secrets). The container mounts the source and runs `npm run dev`, so `.js` edits hot-reload; `.env` changes need `docker compose restart app`. `DOCKER_README.md` (Indonesian) has the full troubleshooting runbook.

## Other docs

- `.changelog/` — one file per released version (`v<version>.md`), see "Changelog, versioning & docs" above.
- `DATA_CONTRACT.md` — field-by-field contract for the Market State (`/api/market/:symbol`). Update it first when changing `enhanceMarketState` output.
- `ARCHITECTURE.md` — design, plus the "Operating Model" section (candle finality, update ordering, concurrency, freshness, failure handling). Items marked **Proposed** there are agreed targets that are not implemented yet; the "Current" lines describe today's code.
- `ROADMAP.md`, `CRYPTO AI SIGNAL SYSTEM ROADMAP.md` — planned levels (scoring engine, backtesting, ML); aspirational.
- `PROMPT_AI_*.md` — LLM prompts (Indonesian) that take the `/api/market/:symbol` JSON as input.
