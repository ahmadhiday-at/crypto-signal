# REST endpoints

HTTP routes served by the app, their status codes, and the 503 body returned when no Market State exists.

## Endpoints

| Category | Endpoint | Method | Description |
| :------- | :------- | :----- | :---------- |
| Data | `/api/market/:symbol` | `GET` | Market State ([market-state.md](./market-state.md)) with freshness `status`. HTTP 503 with diagnostics when unavailable (see below). |
| Data | `/api/:symbol/:tf` | `GET` | Closed-candle snapshot for one timeframe, with `status` and `age_seconds`. 503 `snapshot_unavailable` when no data could be fetched. |
| Data | `/api/signals/:symbol` | `GET` | Signal log (since 2.7.0): `{market, entry_tf, stats, records}`; `?format=csv` returns the flattened dataset; `?source=shadow` (since 2.22.0) reads the shadow log. See [Signal log](#signal-log). |
| Data | `/api/backtest/:symbol` | `GET` | Latest backtest report (since 2.8.0), written by `npm run backtest`. 404 `backtest_not_found` until one exists. See [Backtest report](#backtest-report). |
| Data | `/api/edge/:symbol` | `GET` | How proven the signal is (since 2.12.0): verdict from the latest backtest and the live signal log. See [Edge](#edge). |
| Data | `/api/calc-config` | `GET` / `PUT` | Calculation config (since 2.14.0). See [Calculation config](#calculation-config). |
| Data | `/api/backtest-runs` | `GET` / `POST` | Re-run the backtest from the server (since 2.14.0). See [Backtest runs](#backtest-runs). |
| UI | `/` | `GET` | 302 to `/{first MARKET_LIST market}` (since 2.13.0). |
| UI | `/:symbol` | `GET` | Market Dashboard (e.g. `/BTCUSDT`), the main view. Links to Chart, Backtest and the signal log CSV. |
| UI | `/backtest/:symbol` | `GET` | Backtest report page: metrics, equity curve, trades. |
| UI | `/config` | `GET` | Calculation config editor and backtest re-run (since 2.14.0). |
| UI | `/:symbol/:tf` | `GET` | Reference multi-pane chart (e.g. `/BTCUSDT/1h`). |
| System | `/api/config` | `GET` | Markets, timeframes (`TIMEFRAME_LIST` plus the role timeframes, since 2.25.2), TF roles and `version` (app version from `package.json`, since 2.6.0). |
| System | `/api/health` | `GET` | Per-timeframe fetch diagnostics, Binance pauses and stream state. |
| System | `/api/reset` | `POST` | Re-fetches every timeframe and rebuilds the Market State. Requires the admin token ([Admin token](#admin-token)), header `X-Requested-With: crypto-signal` and a same-origin request (403 otherwise; `GET` returns 405). 502 if any timeframe fails (existing data kept), 409 if a reset is running, 429 within 60 s of the previous reset. |

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

**Shadow log (since 2.22.0):** `?source=shadow` reads `data/signals-shadow/{MARKET}.jsonl` (gitignored), written after each published Market State by the model of the calculation config `shadow` group on its own role timeframes (default since 2.24.0: `bounce` on 15m / 1h / 4h / 1d, stop 3 ATR, target 2R; other values from the live config). The live signal and log are unchanged. Response `{market, source: "shadow", enabled, model, roles, latest, stats, records}`; `latest` = `{model, roles, generated_at, status, price, signal: {action, score, filters, plan}}` of the last build or `null`. A shadow role timeframe outside the fetched ones (TIMEFRAME_LIST + roles) pauses the shadow log with one warning.

- **When a record is created:** after a published summary with `status: "ok"`, `|signal.score| ≥ 5` and a plan with `stop_loss` and `take_profit_1`. Filtered candidates are logged too (`filtered: true`, `filters`). At most one open record per market and direction.
- **Record:** `id`, `timestamp` (summary `generated_at`), `market`, `timeframe` (entry), `candle_time`, `candle_close_time`, `signal` (`BUY`/`SELL`, direction before filters), `filtered`, `filters`, `strength`, `price` (entry = closed entry-candle close), `entry_zone`, `sl`, `tp1`, `tp2`, `risk_reward`, `features` (`context`, `momentum`, `regime`, `volume_state`, `breakout_confirmation`, `divergence`, `volatility_ratio`, `distance_to_support`, `distance_to_resistance`, `rsi`, `atr`, `score`, `strength`, `reasons`), then `result`, `rr`, `closed_at`, `bars` (`null` while open).
- **Outcome** (checked on each later closed entry candle): SL touched → `LOSS`, `rr` −1; TP1 touched → `WIN`, `rr` = `risk_reward`; both in one candle → `LOSS`; neither within 96 candles → `EXPIRED`, `rr` = (close − price) / risk (sign by side); the candle after the signal no longer in history → `UNKNOWN`.
- **`stats`:** `total`, `open`, `WIN`, `LOSS`, `EXPIRED`, `UNKNOWN`. Since 2.24.0 they and the Edge log cover only records of the current entry timeframe (`entry_tf`); `records` and the CSV keep the whole dataset. A record still open from another entry timeframe closes as `UNKNOWN`.
- **CSV:** one row per record, features flattened; lists joined with `|`.

## Backtest report

`GET /api/backtest/:symbol` returns `data/backtest/{MARKET}.json` (gitignored), written by `npm run backtest -- SYMBOL [--days N] [--fee PCT] [--sweep key=v1,v2 ...] [--split R|none]` or by [Backtest runs](#backtest-runs). Since 2.14.0 the base parameters and the `--days`/`--fee`/`--split` defaults come from `config/calculation.json` (default 365 days, fee 0.1, split 0.7; before: fee 0, no split).

- **Replay:** on every closed entry candle in the period, each role timeframe gets a snapshot from its last `CANDLE_LIMIT − 1` closed candles, then the live merge, `enhanceMarketState` and `computeSignal` run with `status: "ok"`. Candidates and outcomes follow the [Signal log](#signal-log) rules. Taken and filtered trades are tracked separately, each with at most one open trade per direction.
- **Fields:** `market`, `entry_tf`, `roles`, `period` `{start, end}`, `params` `{model, threshold, min_rr, stop_atr, target, htf_trend, entry_max_atr, side, skip_energy, weights, expiry_candles, window, fee_pct}` (`min_rr`, `weights` since 2.9.0; `stop_atr`, `target`, `side`, `skip_energy` since 2.11.0; `htf_trend` since 2.16.0, absent = `off`; `entry_max_atr` since 2.17.0, absent = 0; `model` since 2.20.0, absent = `bounce`; `calc` since 2.18.0: the config groups `scoring`, `indicators`, `zones`, `market`, `divergence`, `evaluation` used, absent = defaults; `expiry_candles` = `evaluation.expiry_candles`; `trailing_atr`, `htf_proximity_percent`, `no_mans_land_percent`, `volatility_extreme`, `volatility_dead` since 2.14.0, fixed for every sweep variant), `steps`, `skipped_steps`, `generated_at`, `taken` and `filtered` (`summary`, `equity` `[{time, equity}]`, `by_side` `{BUY, SELL}`, `breakdown`), `sweep`, `validation`, and `trades` (`id`, `time`, `signal`, `filtered`, `filters`, `strength`, `score`, `features`, `price`, `sl`, `tp1`, `risk_reward`, `result`, `rr`, `net_r`, `closed_at`, `bars`).
- **`features`** (since 2.9.0): state at the signal candle: `htf_trend` (trend of the HTF and structure timeframes joined with `/`, e.g. `down/ranging`; since 2.16.0), `regime` (entry TF), `context`, `momentum`, `volume_state`, `market_energy`, `breakout_confirmation`, `fake_breakout_risk`, `divergence`, `session_utc` (4-hour UTC block, e.g. `08-12`).
- **`breakdown`** (since 2.9.0): per dimension (`side`, `score` = \|score\|, each `features` key, and `filter` for filtered trades, counted once per filter code), a list of `{value, ...summary}`, most trades first.
- **`sweep`** (since 2.9.0): `null` without `--sweep`. Otherwise one entry per parameter set: `{base, params, taken: summary, filtered: summary}` (`params` as above without the run-wide fields); `base: true` is the live configuration, which is also the main report. Keys: `threshold` (integer 1–15), `min_rr` (0–10), `stop_atr` (SL buffer beyond the zone in ATR, 0–3; live 0.5), `target` (`tp1` nearest opposite zone, `rr_zone` first zone ahead with RR ≥ `min_rr` (since 2.17.0), `tp2` major HTF zone, or a fixed multiple of risk 0.5–10; sets `tp1`/`risk_reward` of the trade; base = config `signal.target`), `entry_max_atr` (0–10, 0 = off; since 2.17.0), `<group>.<key>` (since 2.19.0) for any key of the calculation config groups `scoring`, `trend` (since 2.20.0), `indicators`, `zones`, `market`, `divergence`, `evaluation` except `evaluation.min_trades`, with that key's range, e.g. `scoring.near_zone=1,2,3`, `evaluation.expiry_candles=96,192`; each variant must pass the config's cross-key rules and its `params.calc` holds the values used (an `indicators`/`zones` value recalculates the snapshots per value, so it costs more time), `model` (`bounce`/`trend_pullback`/`breakout`, since 2.20.0), `htf_trend` (`off`/`htf`/`htf+structure`: HTF trend filter, since 2.16.0), `side` (`both`/`buy`/`sell`), `skip_energy` (`none` or `market_energy` values joined with `+`; with `side`, dropped candidates are neither taken nor filtered), `w_<tf>` (zone weight of a role timeframe, 0–20). Several `--sweep` options combine into every combination (max 144); a variant equal to the base is not repeated.
- **`validation`** (since 2.10.0): `null` without `--split`. `--split R` (0.5–0.9) sets `split_at` = start + R × (end − start). `{split_at, min_trades (config `evaluation.min_trades`, default 30), selected, rows}`; each row `{base, params, in_sample, out_of_sample}` holds the taken-trade `summary` of signals before / from `split_at`. `selected` is the row index with the best in-sample `expectancy_r` among rows with at least `min_trades` in-sample trades (`null` if none).
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

- **`verdict`:** `unproven` when there is no backtest (`no_backtest`), its parameters differ from the live ones (`params_differ`: threshold, min RR, SL buffer, target `tp1`, both sides, no energy skip, role-timeframe weights, window = `CANDLE_LIMIT` − 1, and since 2.18.0 the calculation groups `scoring`, `indicators`, `zones`, `market`, `divergence`, `evaluation` stored in report `params.calc`; older reports count as defaults) or it has fewer than `min_trades` taken trades (`too_few_trades`); `negative` when taken `expectancy_r` ≤ 0 (`negative_expectancy`) or the live-parameter out-of-sample `expectancy_r` ≤ 0 (`negative_out_of_sample`); otherwise `positive`. `no_fees` is added when the backtest used `fee_pct` 0.
- **`backtest`:** `null` without a report. `taken` = report `taken.summary` subset; `out_of_sample` = the base row of `validation` (`null` without `--split`).
- **`shadow`** (since 2.22.0): `null` when the shadow log is off; else `{model, roles, latest: {action, score, status} | null, open, trades, win_rate, expectancy_r, profit_factor}` over the shadow log's taken records, like `live_log`.
- **`live_log`:** `null` when the signal log is disabled. Taken (not filtered) records only; `trades`/`win_rate`/`expectancy_r`/`profit_factor` over WIN/LOSS/EXPIRED in R (`rr`, no fees); `open` = records without an outcome.

## Calculation config

Since 2.14.0. Values in `config/calculation.json` ([config.md](../architecture/config.md#calculation-config)).

- `GET /api/calc-config` → `{file, config, defaults, limits, role_timeframes, running_engine}`. `config` and `defaults` have the groups listed in [config.md](../architecture/config.md#calculation-config) (`engine` and `lookback` since 2.21.0); `running_engine` is the `engine` in use since startup (a saved `engine` that differs waits for a restart); `limits` gives `[min, max, integer]` per numeric key and `{values}` for a choice (`filters.htf_trend` since 2.16.0, `signal.target` since 2.17.0) (`weights`, `lookback`: one triple for every timeframe).
- `PUT /api/calc-config` with a JSON body (full or partial config; missing keys keep the values in use). Requires the admin token, header `X-Requested-With: crypto-signal` and a same-origin request (403 otherwise). 400 `invalid_config` with `problems` (list of messages) or 400 `invalid_json`; 200 `{config, changed}`. The file is written atomically and the values apply at once: weights rebuild every Market State, the signal values apply on the next read.
- A report made with other values gets `params_differ` in [Edge](#edge).

## Backtest runs

Since 2.14.0. Runs `scripts/backtest.js SYMBOL` (the saved calculation config, no sweep) in a child process, one batch at a time, markets one after another. Stopped after 60 minutes.

- `POST /api/backtest-runs` with `{"market": "BTCUSDT"}` or `{"market": "all"}` (every `MARKET_LIST` market). Same admin token, header and same-origin rules as `PUT /api/calc-config`. 202 `{jobs}`, 404 for an unknown market, 409 `backtest_running`.
- `GET /api/backtest-runs` → `{running, jobs}`; `jobs` holds the latest job per market: `{market, state (queued/running/done/failed), queued_at, started_at, finished_at, progress (last output line), error, output (last 15 lines)}`. In memory only: lost on restart.
- Binance HTTP 451 fails the run (`error` holds the CLI message); no workaround.

## Admin token

Since 2.25.0 `PUT /api/calc-config`, `POST /api/backtest-runs` and `POST /api/reset` need header `X-Admin-Token` with the value of env var `ADMIN_TOKEN`. Reads stay open.

- 401 `admin_token_invalid`: header missing or wrong.
- 403 `admin_token_not_configured`: the server has no valid `ADMIN_TOKEN`; every action is refused.
- `GET /api/config` has `admin_configured` (boolean); the token is never served.
- The token travels in plain text over HTTP: on a network use TLS or keep `BIND_ADDR=127.0.0.1`.

