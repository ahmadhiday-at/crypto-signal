# REST endpoints

HTTP routes served by the app, their status codes, and the 503 body returned when no Market State exists.

## Endpoints

| Category | Endpoint | Method | Description |
| :------- | :------- | :----- | :---------- |
| Data | `/api/market/:symbol` | `GET` | Market State ([market-state.md](./market-state.md)) with freshness `status`. HTTP 503 with diagnostics when unavailable (see below). |
| Data | `/api/:symbol/:tf` | `GET` | Closed-candle snapshot for one timeframe, with `status` and `age_seconds`. 503 `snapshot_unavailable` when no data could be fetched. |
| Data | `/api/signals/:symbol` | `GET` | Signal log (since 2.7.0): `{market, stats, records}`; `?format=csv` returns the flattened dataset. See [Signal log](#signal-log). |
| Data | `/api/backtest/:symbol` | `GET` | Latest backtest report (since 2.8.0), written by `npm run backtest`. 404 `backtest_not_found` until one exists. See [Backtest report](#backtest-report). |
| UI | `/:symbol` | `GET` | Market Dashboard (e.g. `/BTCUSDT`). |
| UI | `/backtest/:symbol` | `GET` | Backtest report page: metrics, equity curve, trades. |
| UI | `/:symbol/:tf` | `GET` | Reference multi-pane chart (e.g. `/BTCUSDT/1h`). |
| System | `/api/config` | `GET` | Markets, timeframes, TF roles and `version` (app version from `package.json`, since 2.6.0). |
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

## Signal log

`GET /api/signals/:symbol` (Roadmap Level 4). Source: `data/signals/{MARKET}.jsonl` (gitignored, append-only).

- **When a record is created:** after a published summary with `status: "ok"`, `|signal.score| ≥ 5` and a plan with `stop_loss` and `take_profit_1`. Filtered candidates are logged too (`filtered: true`, `filters`). At most one open record per market and direction.
- **Record:** `id`, `timestamp` (summary `generated_at`), `market`, `timeframe` (entry), `candle_time`, `candle_close_time`, `signal` (`BUY`/`SELL`, direction before filters), `filtered`, `filters`, `strength`, `price` (entry = closed entry-candle close), `entry_zone`, `sl`, `tp1`, `tp2`, `risk_reward`, `features` (`context`, `momentum`, `regime`, `volume_state`, `breakout_confirmation`, `divergence`, `volatility_ratio`, `distance_to_support`, `distance_to_resistance`, `rsi`, `atr`, `score`, `strength`, `reasons`), then `result`, `rr`, `closed_at`, `bars` (`null` while open).
- **Outcome** (checked on each later closed entry candle): SL touched → `LOSS`, `rr` −1; TP1 touched → `WIN`, `rr` = `risk_reward`; both in one candle → `LOSS`; neither within 96 candles → `EXPIRED`, `rr` = (close − price) / risk (sign by side); the candle after the signal no longer in history → `UNKNOWN`.
- **`stats`:** `total`, `open`, `WIN`, `LOSS`, `EXPIRED`, `UNKNOWN`.
- **CSV:** one row per record, features flattened; lists joined with `|`.

## Backtest report

`GET /api/backtest/:symbol` returns `data/backtest/{MARKET}.json` (gitignored), written by `npm run backtest -- SYMBOL [--days 365] [--fee 0]`.

- **Replay:** on every closed entry candle in the period, each role timeframe gets a snapshot from its last `CANDLE_LIMIT − 1` closed candles, then the live merge, `enhanceMarketState` and `computeSignal` run with `status: "ok"`. Candidates and outcomes follow the [Signal log](#signal-log) rules. Taken and filtered trades are tracked separately, each with at most one open trade per direction.
- **Fields:** `market`, `entry_tf`, `roles`, `period` `{start, end}`, `params` `{threshold, expiry_candles, window, fee_pct}`, `steps`, `skipped_steps`, `generated_at`, `taken` and `filtered` (`summary`, `equity` `[{time, equity}]`, `by_side` `{BUY, SELL}`), and `trades` (`id`, `time`, `signal`, `filtered`, `filters`, `strength`, `score`, `price`, `sl`, `tp1`, `risk_reward`, `result`, `rr`, `net_r`, `closed_at`, `bars`).
- **`summary`:** `trades` (closed as WIN/LOSS/EXPIRED), `wins`, `losses`, `expired`, `win_rate`, `avg_win_r`, `avg_loss_r`, `expectancy_r`, `total_r`, `profit_factor` (gross win R / gross loss R), `max_drawdown_r` (on cumulative R), `open`, `unknown`.
- **Fees:** `net_r` = `rr` − `fee_pct`/100 × price / risk. Results are hypothetical: entry at the signal candle close, no order execution.
