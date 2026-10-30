# Operating Model

When data is updated, which candles are used, how files are written, and failure handling. This document defines when data is updated, which candles are used, how files are written, and how the system behaves when data is old or unavailable. Everything below is implemented and covered by tests (`npm test`) unless marked **Open**.

## O1. Candle finality

- Every indicator, zone and derived field uses **closed candles only**. A candle is closed once the current time reaches its close time (open + timeframe length).
- Each fetch is validated (`src/services/candles.js`): malformed rows reject the whole response (`invalid_response`), duplicates are removed (the later row wins), rows are sorted, and gaps are counted (`gaps` in the per-timeframe snapshot) but not filled.
- Binance always returns its current candle last. The final row of a response is therefore treated as forming unless it closed more than 60 seconds ago, even if the host clock says it has closed. This keeps a partial candle out of the calculations when the host clock runs ahead or Binance is slow to open the next candle; the next minute tick fetches again.
- The forming candle is stored separately (`forming_candle` in the per-timeframe snapshot) for chart display only.
- The live ticker price is display-only and never enters a calculation.
- **Trade-off:** signals react up to one candle late (at most 15 minutes for the default entry timeframe). In exchange, the same closed candles always give the same Market State.

## O2. Update triggers and ordering

1. **Boundary tick** (`src/jobs/scheduler.js`): one UTC-aligned timer fires 5 seconds after every minute boundary. The delay gives Binance time to finalise the candle and assumes the host clock is NTP-synchronised.
2. **Due timeframes:** for each market, every configured timeframe whose candle closed at that boundary (for example `15m`, `30m`, `1h`, `4h` and `1d` together at 00:00 UTC; `1w` on Mondays), plus any timeframe that is **behind** — its stored candle is older than the latest closed candle (e.g. after a failure or restart).
3. All due timeframes are updated, then the Market State is **rebuilt once** if any role timeframe was due.
4. The Market State is validated and published only if valid (see [market-state.md](../contract/market-state.md)). Subscribers get `summary_ready`.
5. **Startup**, **stream reconnect** and **reset** use the same path: startup and reconnect update every timeframe that is behind; reset updates all of them.
6. An API read of a per-timeframe snapshot that does not exist triggers a one-off fetch through the same path (subject to the retry throttle in O3).

Boundaries are computed in UTC, so daily and 4-hourly candles align with Binance regardless of the host time zone.

## O3. Concurrency

- **At most one update in flight per (market, timeframe).** A trigger arriving while the same update runs joins it and gets the same result.
- **Market State builds are serialised per market**, so concurrent triggers cannot publish interleaved results.
- **Monotonic writes:** a fetched snapshot whose latest closed candle is older than the stored one is discarded; a summary whose entry candle is older than the stored summary's is not written.
- **Retry throttle:** after a **failed** fetch, a timeframe that is behind (but not at its own boundary) is retried at most once per min(timeframe, 5 minutes). After a successful fetch that is still behind (Binance had not finalised the candle), it is retried on the next minute tick.
- **Summary build queue:** at most one build runs and at most one waits per market; further requests share the waiting build.
- **Reset:** one at a time (409) and at most once per 60 seconds (429 with `Retry-After`).
- **Assumption:** a single Node.js process owns `data/`. Running two instances against the same `data/` directory is not supported.

## O4. Storage and writes

- Files are written to a unique temporary file, flushed with `fsync`, then renamed over the target, so readers never see a partial file. Leftover temporary files are removed at startup.
- File names are built only from validated symbols and timeframes; anything else is rejected before touching the filesystem.
- Every file read is validated. Corrupt JSON, legacy (pre-2.0.0) snapshots, files that fail validation and files whose candle close time is more than 60 seconds in the future (clock problem) are treated as missing and refetched; they are never served. A file that turns bad after startup is refetched on the next tick.
- A failed update leaves the previous file in place.
- The Market State records the input candle close time for each role timeframe (`inputs`), so a summary can be traced back to its inputs.
- **Scope:** `data/` is a cache of the latest state only, with no history. Reproducing past summaries requires the signal log planned in Roadmap Level 4.

## O5. Freshness and degraded state

- **Input status:** a role timeframe is `stale` when the age of its last closed candle is more than **2 × the timeframe length**, and `missing` when there is no valid snapshot or its close time lies more than 60 seconds in the future.
- **Summary status:** `stale` when the entry timeframe is stale or any role timeframe is missing; `degraded` when only non-entry role timeframes are stale; `ok` otherwise.
- **Recomputed on every read**, from the recorded candle close times, so an old file is reported as stale even when no updates are running.
- If no valid Market State exists and none can be built, the API returns HTTP 503 with a diagnostic body and no market fields ([rest.md](../contract/rest.md#unavailable-market-state-http-503)).
- The dashboard shows the status and data age prominently. AI analysis must return **WAIT** when status is not `ok` ([market-state.md §7](../contract/market-state.md#7-consumer-rules)).
- **Open:** the 2× threshold is a starting value and should be confirmed against how the system is actually used.

## O6. Failure handling

| Failure | Behaviour |
| :------ | :-------- |
| Timeout, network error, HTTP 5xx | Retry up to 3 times with backoff (1s, 2s, 4s), then keep the last good file and record `timeout` / `network` / `binance_http` |
| HTTP 429 (rate limit) | No retry. Pause all REST calls for `Retry-After` (default 60 s), record `binance_429` |
| HTTP 418 (IP banned) | No retry. Pause all REST calls for `Retry-After`, at least 120 s, record `binance_418` |
| HTTP 451 (restricted location) | No retry. Pause all REST calls for 15 minutes, record `binance_451`. The app never switches VPN exits or otherwise works around the restriction; see [DEPLOYMENT.md → Akses Binance](../DEPLOYMENT.md#akses-binance-dan-kebijakan-penggunaan) |
| Other HTTP 4xx | No retry, record `binance_http` |
| Malformed response | Nothing stored, record `invalid_response` |
| Fewer than 200 closed candles / non-finite indicator values | Nothing stored, record `insufficient_data` / `calculation_failed` |
| Disk / permission error | Previous file kept, record `storage_failed` |
| Stream disconnect | Reconnect with exponential backoff (5 s → 60 s; 15 minutes after a 451), then catch up every timeframe that is behind |

While a pause is active, requests fail immediately without contacting Binance. Every failure also shows up through the freshness status (O5).

`GET /api/health` reports, per market and timeframe, the stored candle close time, last attempt, last success and last error code, plus any active Binance pause and the ticker stream state. The VPN container being healthy does **not** mean Binance is reachable.

## O7. Expected operating conditions

These assumptions shape the design above. Revisit the design if they change.

- **Scale:** 3–5 symbols, up to 8 configured timeframes, of which 4 are role timeframes.
- **Users:** one user. Endpoints have no authentication. Docker Compose publishes the port on `127.0.0.1` only by default (`BIND_ADDR`); a local `npm start` listens on `HOST` (default all interfaces — set `HOST=127.0.0.1`).
- **Host allowlist:** HTTP and WebSocket requests are served only when the `Host` header names `localhost`, `127.0.0.1`, `[::1]` or a name listed in `ALLOWED_HOSTS` (403 `host_not_allowed` otherwise). This blocks DNS-rebinding pages. Add the LAN IP or host name to `ALLOWED_HOSTS` when exposing the app with `BIND_ADDR=0.0.0.0`.
- **Process:** one Node.js process, one machine, NTP-synchronised clock.
- **Data volume:** refetching the full candle window at every boundary fits within Binance limits at this scale. With many more symbols, switch to incremental candle updates and stagger the boundary ticks.
