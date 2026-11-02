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
| `scoring` | `near_zone` / `momentum` / `htf_zone` / `divergence` / `volume` | 2 / 2 / 3 / 2 / 1 | integer 0–10 (volume 0–5) | Points per signal reason (since 2.18.0) |
| `scoring` | `strong_score` | 7 | integer 1–30 | \|score\| for strength `strong` |
| `scoring` | `breakout_confirmed` | `medium` | `weak` / `medium` / `strong` | Weakest breakout confirmation that lets BUY into resistance / SELL into support pass |
| `indicators` | `ma_fast` / `ma_mid` / `ma_slow` | 14 / 50 / 200 | integer, fast < mid < slow | SMA periods; the fields stay `ma14` / `ma50` / `ma200` |
| `indicators` | `rsi_period`, `atr_period` | 14, 14 | integer 2–100 | RSI and ATR periods |
| `indicators` | `macd_fast` / `macd_slow` / `macd_signal` | 12 / 26 / 9 | integer, fast < slow | MACD periods |
| `indicators` | `min_candles` | 200 | integer ≥ longest period, ≤ `CANDLE_LIMIT` − 1 | Closed candles needed per timeframe (else `insufficient_data`) |
| `indicators` | `rsi_bullish` / `rsi_bearish` | 60 / 40 | 50–100 / 0–50 | Momentum: RSI above / below with MACD histogram > 0 / < 0 |
| `indicators` | `regime_ma_percent` | 1 | 0–10 | Regime `ranging` when fast and mid SMA are within this % of price |
| `zones` | `cluster_percent` | 0.5 | 0–5 | Swings within this % form one zone |
| `zones` | `width_atr` | 0.5 | 0–5 | Zone half-width, × ATR |
| `zones` | `touch_points`, `recency_candles`, `distance_penalty` | 2, 50, 10 | 0–20, 0–500, 0–100 | Zone score: touches × points + max(0, recency − candles since last touch) − distance × penalty |
| `zones` | `ma_bonus`, `ma_proximity_percent` | 1, 1 | 0–20, 0–10 | Score bonus when the zone is within this % of the mid / slow SMA |
| `zones` | `fallback_candles` | 100 | integer 10–1000 | High/low window for the fallback level |
| `zones` | `lookback_volatility_band`, `lookback_scale` | 0.2, 0.2 | 0–1, 0–0.9 | `MAPPING_CANDLE` × (1 ± scale) when volatility is beyond its mean × (1 ± band) |
| `market` | `volume_candles` | 20 | integer 2–200 | Volume average window |
| `market` | `volume_low` / `volume_increasing` / `volume_high` | 0.8 / 1.2 / 1.5 | 0–10, increasing | Volume state vs the average |
| `market` | `energy_cooling` / `energy_building` / `energy_explosive` | 0.02 / 0.05 / 0.1 | ≥ 0, increasing | \|MACD histogram\| thresholds for `market_energy` (price units) |
| `market` | `breakout_distance_percent` | 1 | 0.01–10 | Breakout score distance factor = max(0, 1 − nearest zone % ÷ this) |
| `market` | `breakout_volume_high` / `_increasing` / `_normal` / `_low` | 1 / 0.8 / 0.5 / 0.3 | 0–1 | Breakout score volume factor |
| `market` | `compression_bonus` | 0.2 | 0–1 | Breakout score bonus in compression |
| `market` | `breakout_weak` / `breakout_strong` | 0.4 / 0.7 | 0–1, weak < strong | `breakout_confirmation` and `setup_state` thresholds |
| `market` | `dominant_percent` | 20 | 0–100 | `dominant_side` when the top zone scores differ by more than this % |
| `market` | `volatility_candles` | 100 | integer 2–1000 | ATR mean window of `volatility_ratio` |
| `divergence` | `lookback` / `pivot_width` / `max_age` | 60 / 3 / 10 | integers, pivot_width × 2 < lookback | RSI divergence search (entry TF) |
| `evaluation` | `expiry_candles` | 96 | integer 1–2000 | Entry candles before an open trade is `EXPIRED` (signal log and backtest) |
| `evaluation` | `min_trades` | 30 | integer 1–1000 | Minimum taken trades for the Edge verdict and the out-of-sample pick |
| `backtest` | `days` | 365 | integer 1–1500 | History length (CLI `--days` default) |
| `backtest` | `fee_pct` | 0.1 | 0–5 | Round-trip fee, % of price (CLI `--fee` default) |
| `backtest` | `split` | 0.7 | 0.5–0.9 | Out-of-sample split (CLI `--split` default) |

- **Loading:** at startup; a missing file is created with the defaults. Missing keys take the defaults. An unreadable, invalid-JSON or out-of-range file is rejected with a log line and the values in use stay.
- **Reload:** the server polls the file every 2 s (works on Docker bind mounts; nodemon does not watch `config/`, so no restart). A change to `indicators` or `zones` recalculates every stored timeframe snapshot from its own candles (no Binance request), then rebuilds the Market States; other changes rebuild the Market States; the signal values apply on the next read. Snapshots are also recalculated once at startup (the file may have changed while the app was down). The signal log uses the live `threshold` and `evaluation.expiry_candles`.
- **Cross-key rules:** SMA fast < mid < slow, MACD fast < slow, `rsi_bearish` < `rsi_bullish`, `min_candles` ≥ the longest indicator period and ≤ `CANDLE_LIMIT` − 1, volume / energy / breakout thresholds increasing, divergence `pivot_width` × 2 < `lookback`. A file or PUT breaking one is rejected.
- **Backtest:** `npm run backtest` and `/config` re-runs use the saved file. The [Edge](../contract/rest.md#edge) verdict reports `params_differ` until the report is re-run with the current values.
- Still in code (operational, not calculation): the freshness constants (stale after 2 × timeframe), request timeouts, scheduler delay, reset cooldown, the 3-levels-per-side limit (Market State contract) and the zero-ATR zone width fallback (0.2% of price).

## Notes

- All config is in `src/config/env.js` (dotenv). Lists are comma-separated (`MARKET_LIST`, `TIMEFRAME_LIST`, `TIMEFRAME_LABELS`).
- `PORT` (default 11000) is used by Node and by both sides of the Docker Compose port mapping.
- `MAPPING_CANDLE`, `BINANCE_REST_URL`, `BINANCE_WS_URL` and `CANDLE_LIMIT` are read from `process.env` inside services, not via `env.js`. `MAPPING_CANDLE` keys are case-sensitive (`1h`, not `1H`); non-matching timeframes fall back to 200.
- Supported timeframes are the keys of `TF_SECONDS` in `src/services/candles.js`. Unsupported `TIMEFRAME_LIST` entries are dropped with a warning; an unsupported role timeframe aborts startup. A new timeframe needs a `TF_SECONDS` entry and, to carry weight, a `TF_WEIGHTS` entry.
- `HOST` (default `0.0.0.0`) is the Node listen address; Compose forces `HOST=0.0.0.0` in the container and publishes on `BIND_ADDR` (default `127.0.0.1`). `ALLOWED_HOSTS` extends the Host allowlist (`localhost`, `127.0.0.1`, `[::1]`).
- The staleness threshold, retry delays, cooldowns and the 5 s boundary delay are constants in `freshness.js`, `binance.service.js` and `scheduler.js`, not env vars.
- `data/` is committed to git; running the app produces diffs there.
