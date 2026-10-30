# REST endpoints

HTTP routes served by the app, their status codes, and the 503 body returned when no Market State exists.

## Endpoints

| Category | Endpoint | Method | Description |
| :------- | :------- | :----- | :---------- |
| Data | `/api/market/:symbol` | `GET` | Market State ([market-state.md](./market-state.md)) with freshness `status`. HTTP 503 with diagnostics when unavailable (see below). |
| Data | `/api/:symbol/:tf` | `GET` | Closed-candle snapshot for one timeframe, with `status` and `age_seconds`. 503 `snapshot_unavailable` when no data could be fetched. |
| UI | `/:symbol` | `GET` | Market Dashboard (e.g. `/BTCUSDT`). |
| UI | `/:symbol/:tf` | `GET` | Reference multi-pane chart (e.g. `/BTCUSDT/1h`). |
| System | `/api/config` | `GET` | Markets, timeframes and TF roles. |
| System | `/api/health` | `GET` | Per-timeframe fetch diagnostics, Binance pauses and stream state. |
| System | `/api/reset` | `POST` | Re-fetches every timeframe and rebuilds the Market State. Requires header `X-Requested-With: crypto-signal` and a same-origin request (403 otherwise; `GET` returns 405). 502 if any timeframe fails (existing data kept), 409 if a reset is running, 429 within 60 s of the previous reset. |

- Under `/api`, unknown symbols, timeframes or paths return 404.
- Page routes do not validate: any `/:symbol` or `/:symbol/:tf` returns the page (200), which shows "unavailable" if the API rejects it. `/` serves the reference chart (`public/index.html`), default `BTCUSDT` / `15m`.
- Requests whose `Host` is not `localhost`, `127.0.0.1`, `[::1]` or listed in `ALLOWED_HOSTS` get 403 `host_not_allowed`.
- No authentication: keep the server on localhost (`HOST`; `BIND_ADDR` for Docker).

## Unavailable Market State (HTTP 503)

When no valid summary exists and none can be built, `GET /api/market/:symbol` returns HTTP 503 with a diagnostic object instead of a Market State. It carries no market fields:

```json
{
  "schema_version": 2,
  "market": "BTCUSDT",
  "status": "stale",
  "generated_at": null,
  "inputs": { "1d": { "candle_close_time": null, "age_seconds": null, "status": "missing" } },
  "errors": ["binance_451", "missing_input"],
  "error": "market_state_unavailable"
}
```

Unknown symbols return HTTP 404 `{ "error": "unknown_market_or_timeframe" }`.
