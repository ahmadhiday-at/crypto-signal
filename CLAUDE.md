# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npm run dev     # nodemon; watches server.js + src/, ignores data/
npm start       # node server.js
docker compose up -d            # app behind gluetun WireGuard VPN (see DOCKER_README.md)
docker compose up -d --build    # needed when package.json, package-lock.json or the Dockerfile change
```

```bash
npm test                                   # all tests (node:test, no network, no Binance calls)
node --test test/engine.test.js            # one file
node --test --test-name-pattern="reset" "test/**/*.test.js"   # tests matching a name
```

There is no linter or build step. Tests use fakes from `test/helpers.js` (`fakeBinance`, `tempStorage`, `rawKlines`); never hit real Binance in tests. For an end-to-end check, point `BINANCE_REST_URL` at a local fake server and run `server.js` with `HOST=127.0.0.1` and a spare `PORT`.

The Docker app container bind-mounts this folder and runs nodemon, so **editing `server.js` or `src/` hot-reloads the user's running app**. For multi-step changes, work in a separate git worktree and apply the finished diff.

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
   | `enhanceMarketState` / `/api/market/:symbol` fields | `DATA_CONTRACT.md` |
   | Completing or changing a planned item | `ROADMAP.md`, `CRYPTO AI SIGNAL SYSTEM ROADMAP.md` |

   List the updated docs in the changelog's "Dokumentasi" section.

   **Skip `PROMPT_AI_*.md`:** never edit these files as part of this rule, even when a change affects the fields they reference. Only touch them when explicitly asked.

Not a change: diffs under `data/` produced by running the app — no version bump, no changelog.

## Architecture

Node.js/Express (CommonJS) "Market State Reducer": pulls Binance klines, computes indicators and S/R zones per timeframe from **closed candles only**, then merges the four role timeframes into one Market State per symbol (contract: `DATA_CONTRACT.md`, schema v2). Plain HTML pages in `public/` consume the REST API and WebSocket.

Wiring is in `server.js`: `createMarketEngine` (`src/services/market.service.js`) gets storage, Binance client, indicator service, config and `notify` callbacks; `createApp` (`src/app.js`) builds Express around the engine; `createScheduler` (`src/jobs/scheduler.js`) drives it.

Data flow:

1. **Per-timeframe update** — `engine.updateTimeframe(market, tf)` (single-flight per market+tf): `binance.getKlines` (validated rows, retries, 429/418/451 cooldowns) → `candles.normalizeCandles` + `splitClosed` (forming candle kept aside) → `indicator.calculateAll` (throws `CalculationError` with a code) → `validateSnapshot` → monotonic check → atomic write to `data/chart/{MARKET}_{tf}.json` → `update_ready` over WS. Failures keep the old file and record `last_error` in the in-memory health map.
2. **Summary** — `engine.rebuildSummary(market)` (serialised per market) reads the role snapshots, `mergeSnapshots` (weighted level merge, top 3) → `enhanceMarketState` (unchanged heuristic formula; regression-tested in `test/enhance.test.js`) → adds `schema_version`, `generated_at`, `inputs`, `status`, `errors` → `validateMarketState` → write `data/market/{MARKET}.json` → `summary_ready` over WS. Not published if any role snapshot is missing or validation fails.
3. **Serving** — `engine.getMarketState` recomputes `inputs` ages, `status` and `errors` at request time (`src/services/freshness.js`), or returns a 503 diagnostic body when no valid summary exists.

Triggers (all go through the same engine functions):

- `scheduler` fires 5 s after every UTC minute boundary → `engine.runBoundary(boundary)`: updates every timeframe closing at that boundary plus any that are behind (retry-throttled), then rebuilds the summary once.
- Startup → `engine.initialize()`: removes temp files, loads the index of stored candle close times (invalid/legacy files count as missing), refreshes whatever is behind.
- Binance ticker stream reconnect → `engine.refreshStale()`. Ticker prices are display-only (`price` WS message).
- `POST /api/reset` → `engine.reset()` (force refetch; 409 if running; 429 within 60 s of the previous reset; 502 if any timeframe failed).

Page routes (`src/api/routes/view.routes.js`) are mounted at `/` after static files and `/api`: `/:market` → dashboard, `/:market/:timeframe` → reference chart. They do not validate the market; the pages parse it from the URL (last one or two path segments).

`src/data/storage.js` is the only persistence layer: names validated against strict regexes, unique temp file + fsync + rename, reads return `{data, reason}`. `data/` is committed to git, so running the app produces diffs there; don't commit those unless asked.

`src/websocket/ws.manager.js` shares the HTTP server; same-origin only, 4 KB max payload, subscriptions validated against configured markets/timeframes.

## Configuration gotchas

- All config is in `src/config/env.js` (dotenv). Lists are comma-separated env vars (`MARKET_LIST`, `TIMEFRAME_LIST`, `TIMEFRAME_LABELS`).
- The server port is `PORT` (default 11000). `docker-compose.yml` uses the same variable for both the host and container side of the port mapping, so they stay in sync.
- `MAPPING_CANDLE` (base S/R lookback per tf) and `BINANCE_REST_URL`/`BINANCE_WS_URL`/`CANDLE_LIMIT` are read directly from `process.env` inside services, not via `env.js`.
- `MAPPING_CANDLE` keys are matched case-sensitively against the timeframe code (e.g. `1h`), so uppercase keys like `1H`/`4H`/`1D`/`1W` in `.env.example` never match and those timeframes fall back to 200.
- Supported timeframes are the keys of `TF_SECONDS` in `src/services/candles.js`; unsupported entries in `TIMEFRAME_LIST` are dropped with a warning, and an unsupported role timeframe aborts startup. A new timeframe needs a `TF_SECONDS` entry and, if it should carry weight, a `TF_WEIGHTS` entry.
- `HOST` (default `0.0.0.0`) is the Node listen address; Compose forces `HOST=0.0.0.0` in the container and publishes the port on `BIND_ADDR` (default `127.0.0.1`).
- Every HTTP/WS request must carry a `Host` of `localhost`, `127.0.0.1`, `[::1]` or a name in `ALLOWED_HOSTS` (DNS-rebinding guard in `src/app.js`); otherwise 403 `host_not_allowed`.
- The staleness threshold (2 × timeframe length), retry delays, cooldowns and the 5 s boundary delay are constants in `freshness.js`, `binance.service.js` and `scheduler.js`, not env vars.

## Docker / VPN

`docker-compose.yml` runs the app in the network namespace of a `gluetun` WireGuard container (`network_mode: "service:vpn"`), so ports are published on the VPN container. This routes Binance traffic through the VPN. A Binance HTTP 451 means an access restriction; whether VPN routing is acceptable under Binance's terms is an open, undecided policy question (DOCKER_README → "Akses Binance"), so never add automatic workarounds for it. The app pauses REST calls for 15 minutes after a 451. WireGuard config lives in `gluetun/wireguard/` (gitignored secrets). The container mounts the source and runs `npm run dev`, so `.js` edits hot-reload; `.env` changes need `docker compose restart app`. `DOCKER_README.md` (Indonesian) has the full troubleshooting runbook.

## Other docs

- `.changelog/` — one file per released version (`v<version>.md`), see "Changelog, versioning & docs" above. Root `CHANGELOG.md` holds history up to 1.1.0 only.
- `DATA_CONTRACT.md` — field-by-field contract for the Market State (`/api/market/:symbol`). Update it first when changing `enhanceMarketState` output.
- `ARCHITECTURE.md` — design, plus the "Operating Model" section (candle finality, update ordering, concurrency, storage, freshness, failure handling) describing the implemented behaviour; items marked **Open** are unresolved decisions.
- `ROADMAP.md`, `CRYPTO AI SIGNAL SYSTEM ROADMAP.md` — planned levels (scoring engine, backtesting, ML); aspirational.
- `PROMPT_AI_*.md` — LLM prompts (Indonesian) that take the `/api/market/:symbol` JSON as input. Excluded from the docs-update rule; edit only when explicitly asked.
