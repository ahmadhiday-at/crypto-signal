# Configuration

Environment variables the code reads, their defaults, and configuration behaviour worth knowing. Example values: `.env.example`.

## Environment variables

| Variable | Default | Read in | Notes |
| :------- | :------ | :------ | :---- |
| `PORT` | `11000` | `env.js`, `docker-compose.yml` | Both sides of the Compose port mapping |
| `HOST` | `0.0.0.0` | `env.js` | Listen address; Compose forces `0.0.0.0` in the container |
| `BIND_ADDR` | `127.0.0.1` | `docker-compose.yml` | Host interface the port is published on |
| `ALLOWED_HOSTS` | empty | `env.js` | Extra Host names besides `localhost`, `127.0.0.1`, `[::1]` |
| `MARKET_LIST` | `BTCUSDT` | `env.js` | Comma-separated; invalid symbols dropped |
| `TIMEFRAME_LIST` | `15m` | `env.js` | Comma-separated; unsupported entries dropped |
| `TIMEFRAME_LABELS` | timeframe codes | `env.js` | Same order as `TIMEFRAME_LIST` |
| `TF_HTF`, `TF_STRUCTURE`, `TF_MID`, `TF_ENTRY` | `1d`, `4h`, `1h`, `15m` | `env.js` | Role timeframes; unsupported value aborts startup |
| `WEIGHT_1D`, `WEIGHT_4H`, `WEIGHT_1H`, `WEIGHT_15M`, `WEIGHT_1W`, `WEIGHT_1M` | `3.0`, `2.0`, `1.5`, `1.0`, `1.0`, `1.0` | `env.js` | Since 2.14.0 only the defaults of `weights` in the calculation config (used when the file lacks a key or is created) |
| `MAPPING_CANDLE` | base 200 | `indicator.service.js` | `tf:candles` pairs; keys case-sensitive |
| `CANDLE_LIMIT` | `500` | `binance.service.js` | Must be 201–1000, otherwise 500 |
| `BINANCE_REST_URL` | `https://api.binance.com` | `binance.service.js` | |
| `BINANCE_WS_URL` | `wss://stream.binance.com:9443/ws` | `binance.service.js` | |

`DEFAULT_MARKET`, `DEFAULT_TIMEFRAME` and `LOG_LEVEL` appear in `.env.example` but are not read by the code.

## Calculation config

Since 2.14.0 the values of the calculation live in `config/calculation.json` (committed), not in `.env`. Read by `src/config/calculation.js`; edited by hand or from `/config` (`PUT /api/calc-config`, [rest.md](../contract/rest.md#calculation-config)).

| Group | Key | Default | Range | Meaning |
| :---- | :-- | :------ | :---- | :------ |
| `signal` | `threshold` | 5 | integer 1–15 | Minimum \|score\| for BUY/SELL |
| `signal` | `min_rr` | 1.5 | 0–10 | Minimum plan risk/reward (else filter `low_rr`) |
| `signal` | `stop_atr` | 0.5 | 0–3 | Stop loss buffer beyond the entry zone, × ATR |
| `signal` | `trailing_atr` | 1.5 | 0–10 | Trailing stop distance, × ATR |
| `signal` | `htf_proximity_percent` | 1 | 0–10 | Max distance (%) to an HTF zone for ±3 points |
| `signal` | `target` | `tp1` | `tp1` / `rr_zone` / `tp2` | TP1 choice (since 2.17.0): nearest zone, first zone with RR ≥ `min_rr`, or the major HTF zone |
| `filters` | `no_mans_land_percent` | 1 | 0–10 | `mid_range` farther than this from any zone → `no_mans_land` |
| `filters` | `volatility_extreme` | 2.0 | 0–10 | `volatility_ratio` above → `volatility_extreme` |
| `filters` | `volatility_dead` | 0.5 | 0–10 | `volatility_ratio` below → `volatility_dead` |
| `filters` | `htf_trend` | `off` | `off` / `htf` / `htf+structure` | HTF trend filter (since 2.16.0): BUY rejected when a checked timeframe trends `down`, SELL when `up` → `against_htf_trend` |
| `filters` | `entry_max_atr` | 0 | 0–10 | Entry location (since 2.17.0): price farther than this × ATR from the entry zone → `far_from_entry`; 0 = off |
| `weights` | `<tf>` | `WEIGHT_*` env | 0.1–20 | Zone weight in the merge; unlisted timeframes weigh 1.0 |
| `backtest` | `days` | 365 | integer 1–1500 | History length (CLI `--days` default) |
| `backtest` | `fee_pct` | 0.1 | 0–5 | Round-trip fee, % of price (CLI `--fee` default) |
| `backtest` | `split` | 0.7 | 0.5–0.9 | Out-of-sample split (CLI `--split` default) |

- **Loading:** at startup; a missing file is created with the defaults. Missing keys take the defaults. An unreadable, invalid-JSON or out-of-range file is rejected with a log line and the values in use stay.
- **Reload:** the server polls the file every 2 s (works on Docker bind mounts; nodemon does not watch `config/`, so no restart). A change rebuilds every Market State (new weights); the signal values apply on the next read. The signal log uses the live `threshold`.
- **Backtest:** `npm run backtest` and `/config` re-runs use the saved file. The [Edge](../contract/rest.md#edge) verdict reports `params_differ` until the report is re-run with the current values.
- Still in code: score points per reason, `CONFIRMED_BREAKOUT`, the signal-log expiry (96 candles) and the freshness constants.

## Notes

- All config is in `src/config/env.js` (dotenv). Lists are comma-separated (`MARKET_LIST`, `TIMEFRAME_LIST`, `TIMEFRAME_LABELS`).
- `PORT` (default 11000) is used by Node and by both sides of the Docker Compose port mapping.
- `MAPPING_CANDLE`, `BINANCE_REST_URL`, `BINANCE_WS_URL` and `CANDLE_LIMIT` are read from `process.env` inside services, not via `env.js`. `MAPPING_CANDLE` keys are case-sensitive (`1h`, not `1H`); non-matching timeframes fall back to 200.
- Supported timeframes are the keys of `TF_SECONDS` in `src/services/candles.js`. Unsupported `TIMEFRAME_LIST` entries are dropped with a warning; an unsupported role timeframe aborts startup. A new timeframe needs a `TF_SECONDS` entry and, to carry weight, a `TF_WEIGHTS` entry.
- `HOST` (default `0.0.0.0`) is the Node listen address; Compose forces `HOST=0.0.0.0` in the container and publishes on `BIND_ADDR` (default `127.0.0.1`). `ALLOWED_HOSTS` extends the Host allowlist (`localhost`, `127.0.0.1`, `[::1]`).
- The staleness threshold, retry delays, cooldowns and the 5 s boundary delay are constants in `freshness.js`, `binance.service.js` and `scheduler.js`, not env vars.
- `data/` is committed to git; running the app produces diffs there.
