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
| `WEIGHT_1D`, `WEIGHT_4H`, `WEIGHT_1H`, `WEIGHT_15M`, `WEIGHT_1W`, `WEIGHT_1M` | `3.0`, `2.0`, `1.5`, `1.0`, `1.0`, `1.0` | `env.js` | Other timeframes weigh 1.0 |
| `MAPPING_CANDLE` | base 200 | `indicator.service.js` | `tf:candles` pairs; keys case-sensitive |
| `CANDLE_LIMIT` | `500` | `binance.service.js` | Must be 201–1000, otherwise 500 |
| `BINANCE_REST_URL` | `https://api.binance.com` | `binance.service.js` | |
| `BINANCE_WS_URL` | `wss://stream.binance.com:9443/ws` | `binance.service.js` | |

`DEFAULT_MARKET`, `DEFAULT_TIMEFRAME` and `LOG_LEVEL` appear in `.env.example` but are not read by the code.

## Notes

- All config is in `src/config/env.js` (dotenv). Lists are comma-separated (`MARKET_LIST`, `TIMEFRAME_LIST`, `TIMEFRAME_LABELS`).
- `PORT` (default 11000) is used by Node and by both sides of the Docker Compose port mapping.
- `MAPPING_CANDLE`, `BINANCE_REST_URL`, `BINANCE_WS_URL` and `CANDLE_LIMIT` are read from `process.env` inside services, not via `env.js`. `MAPPING_CANDLE` keys are case-sensitive (`1h`, not `1H`); non-matching timeframes fall back to 200.
- Supported timeframes are the keys of `TF_SECONDS` in `src/services/candles.js`. Unsupported `TIMEFRAME_LIST` entries are dropped with a warning; an unsupported role timeframe aborts startup. A new timeframe needs a `TF_SECONDS` entry and, to carry weight, a `TF_WEIGHTS` entry.
- `HOST` (default `0.0.0.0`) is the Node listen address; Compose forces `HOST=0.0.0.0` in the container and publishes on `BIND_ADDR` (default `127.0.0.1`). `ALLOWED_HOSTS` extends the Host allowlist (`localhost`, `127.0.0.1`, `[::1]`).
- The staleness threshold, retry delays, cooldowns and the 5 s boundary delay are constants in `freshness.js`, `binance.service.js` and `scheduler.js`, not env vars.
- `data/` is committed to git; running the app produces diffs there.
