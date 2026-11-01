# REST endpoints

HTTP routes served by the app, their status codes, and the 503 body returned when no Market State exists.

## Endpoints

| Category | Endpoint | Method | Description |
| :------- | :------- | :----- | :---------- |
| Data | `/api/market/:symbol` | `GET` | Market State ([market-state.md](./market-state.md)) with freshness `status`. HTTP 503 with diagnostics when unavailable (see below). |
| Data | `/api/:symbol/:tf` | `GET` | Closed-candle snapshot for one timeframe, with `status` and `age_seconds`. 503 `snapshot_unavailable` when no data could be fetched. |
| Data | `/api/signals/:symbol` | `GET` | Signal log (since 2.7.0): `{market, stats, records}`; `?format=csv` returns the flattened dataset. See [Signal log](#signal-log). |
| Data | `/api/backtest/:symbol` | `GET` | Latest backtest report (since 2.8.0), written by `npm run backtest`. 404 `backtest_not_found` until one exists. See [Backtest report](#backtest-report). |
| Data | `/api/edge/:symbol` | `GET` | How proven the signal is (since 2.12.0): verdict from the latest backtest and the live signal log. See [Edge](#edge). |
| UI | `/` | `GET` | 302 to `/{first MARKET_LIST market}` (since 2.13.0). |
| UI | `/:symbol` | `GET` | Market Dashboard (e.g. `/BTCUSDT`), the main view. Links to Chart, Backtest and the signal log CSV. |
| UI | `/backtest/:symbol` | `GET` | Backtest report page: metrics, equity curve, trades. |
| UI | `/:symbol/:tf` | `GET` | Reference multi-pane chart (e.g. `/BTCUSDT/1h`). |
| System | `/api/config` | `GET` | Markets, timeframes, TF roles and `version` (app version from `package.json`, since 2.6.0). |
| System | `/api/health` | `GET` | Per-timeframe fetch diagnostics, Binance pauses and stream state. |
| System | `/api/reset` | `POST` | Re-fetches every timeframe and rebuilds the Market State. Requires header `X-Requested-With: crypto-signal` and a same-origin request (403 otherwise; `GET` returns 405). 502 if any timeframe fails (existing data kept), 409 if a reset is running, 429 within 60 s of the previous reset. |

- Under `/api`, unknown symbols, timeframes or paths return 404.
- Page routes do not validate: any `/:symbol` or `/:symbol/:tf` returns the page (200). Since 2.10.1 the pages compare the symbol (and timeframe) with `/api/config` and, if it is not configured, show "not in the market list (MARKET_LIST)" with the available markets instead of loading data. `/` redirects (302) to the Market Dashboard of the first `MARKET_LIST` market (since 2.13.0; before: reference chart).
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

`GET /api/backtest/:symbol` returns `data/backtest/{MARKET}.json` (gitignored), written by `npm run backtest -- SYMBOL [--days 365] [--fee 0] [--sweep key=v1,v2 ...] [--split 0.7]`.

- **Replay:** on every closed entry candle in the period, each role timeframe gets a snapshot from its last `CANDLE_LIMIT − 1` closed candles, then the live merge, `enhanceMarketState` and `computeSignal` run with `status: "ok"`. Candidates and outcomes follow the [Signal log](#signal-log) rules. Taken and filtered trades are tracked separately, each with at most one open trade per direction.
- **Fields:** `market`, `entry_tf`, `roles`, `period` `{start, end}`, `params` `{threshold, min_rr, stop_atr, target, side, skip_energy, weights, expiry_candles, window, fee_pct}` (`min_rr`, `weights` since 2.9.0; `stop_atr`, `target`, `side`, `skip_energy` since 2.11.0), `steps`, `skipped_steps`, `generated_at`, `taken` and `filtered` (`summary`, `equity` `[{time, equity}]`, `by_side` `{BUY, SELL}`, `breakdown`), `sweep`, `validation`, and `trades` (`id`, `time`, `signal`, `filtered`, `filters`, `strength`, `score`, `features`, `price`, `sl`, `tp1`, `risk_reward`, `result`, `rr`, `net_r`, `closed_at`, `bars`).
- **`features`** (since 2.9.0): state at the signal candle: `regime` (entry TF), `context`, `momentum`, `volume_state`, `market_energy`, `breakout_confirmation`, `fake_breakout_risk`, `divergence`, `session_utc` (4-hour UTC block, e.g. `08-12`).
- **`breakdown`** (since 2.9.0): per dimension (`side`, `score` = \|score\|, each `features` key, and `filter` for filtered trades, counted once per filter code), a list of `{value, ...summary}`, most trades first.
- **`sweep`** (since 2.9.0): `null` without `--sweep`. Otherwise one entry per parameter set: `{base, params, taken: summary, filtered: summary}` (`params` as above without the run-wide fields); `base: true` is the live configuration, which is also the main report. Keys: `threshold` (integer 1–15), `min_rr` (0–10), `stop_atr` (SL buffer beyond the zone in ATR, 0–3; live 0.5), `target` (`tp1` nearest opposite zone = live, `tp2` major HTF zone, or a fixed multiple of risk 0.5–10; sets `tp1`/`risk_reward` of the trade), `side` (`both`/`buy`/`sell`), `skip_energy` (`none` or `market_energy` values joined with `+`; with `side`, dropped candidates are neither taken nor filtered), `w_<tf>` (zone weight of a role timeframe, 0–20). Several `--sweep` options combine into every combination (max 144); a variant equal to the base is not repeated.
- **`validation`** (since 2.10.0): `null` without `--split`. `--split R` (0.5–0.9) sets `split_at` = start + R × (end − start). `{split_at, min_trades (30), selected, rows}`; each row `{base, params, in_sample, out_of_sample}` holds the taken-trade `summary` of signals before / from `split_at`. `selected` is the row index with the best in-sample `expectancy_r` among rows with at least `min_trades` in-sample trades (`null` if none).
- **`summary`:** `trades` (closed as WIN/LOSS/EXPIRED), `wins`, `losses`, `expired`, `win_rate`, `avg_win_r`, `avg_loss_r`, `expectancy_r`, `total_r`, `profit_factor` (gross win R / gross loss R), `max_drawdown_r` (on cumulative R), `open`, `unknown`.
- **Fees:** `net_r` = `rr` − `fee_pct`/100 × price / risk. Results are hypothetical: entry at the signal candle close, no order execution.

## Edge

`GET /api/edge/:symbol` (Roadmap Level 6.5 A). Built on each request from `data/backtest/{MARKET}.json` and the signal log; shown in the dashboard Signal card.

```json
{
  "market": "BTCUSDT",
  "verdict": "negative",
  "reasons": ["negative_expectancy"],
  "min_trades": 30,
  "backtest": {
    "generated_at": 1793499327, "period": { "start": 1761963300, "end": 1793498400 }, "fee_pct": 0.1, "params_match": true,
    "taken": { "trades": 71, "win_rate": 0.1549, "expectancy_r": -0.2441, "profit_factor": 0.64 },
    "out_of_sample": { "split_at": 1784038460, "trades": 20, "win_rate": 0.1, "expectancy_r": -0.3118, "profit_factor": 0.58 }
  },
  "live_log": { "open": 0, "trades": 0, "win_rate": null, "expectancy_r": null, "profit_factor": null }
}
```

- **`verdict`:** `unproven` when there is no backtest (`no_backtest`), its parameters differ from the live ones (`params_differ`: threshold, min RR, SL buffer, target `tp1`, both sides, no energy skip, role-timeframe weights, window = `CANDLE_LIMIT` − 1) or it has fewer than `min_trades` taken trades (`too_few_trades`); `negative` when taken `expectancy_r` ≤ 0 (`negative_expectancy`) or the live-parameter out-of-sample `expectancy_r` ≤ 0 (`negative_out_of_sample`); otherwise `positive`. `no_fees` is added when the backtest used `fee_pct` 0.
- **`backtest`:** `null` without a report. `taken` = report `taken.summary` subset; `out_of_sample` = the base row of `validation` (`null` without `--split`).
- **`live_log`:** `null` when the signal log is disabled. Taken (not filtered) records only; `trades`/`win_rate`/`expectancy_r`/`profit_factor` over WIN/LOSS/EXPIRED in R (`rr`, no fees); `open` = records without an outcome.
