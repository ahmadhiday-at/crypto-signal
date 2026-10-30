# 📈 Crypto Signal: Market State Engine

[![Version](https://img.shields.io/badge/version-2.0.2-blue.svg)](#)
[![License](https://img.shields.io/badge/license-MIT-green.svg)](#)

A real-time analysis system that turns Binance market data into one structured, heuristic **Market State** per symbol. It reduces the 1D, 4H, 1H and 15m timeframes into a single top-down view:

- **MTF confluence:** support/resistance zones weighted across timeframes.
- **Compression, energy and pressure:** heuristic reading of squeezes, volume and MACD.
- **Heuristic scoring:** `breakout_score` and `fake_breakout_risk` are uncalibrated ranking heuristics, not probabilities.
- **Freshness:** every Market State carries `ok` / `degraded` / `stale`; all analysis uses closed candles only.
- **Dashboard:** `/BTCUSDT` (Market State, freshness banner, confluence zones); reference chart: `/BTCUSDT/1h`.

Stack: Node.js / Express, Binance REST & WebSocket, `technicalindicators`, local JSON storage, `node:test`.

## Install

Requires Node.js 22 or higher (the Docker image uses Node 24).

```bash
git clone <your-repo-url>
cd crypto-signal
npm install
cp .env.example .env    # then adjust MARKET_LIST, TIMEFRAME_LIST, PORT, HOST, ...
```

Every option is described in [.env.example](./.env.example). Default port: `11000`. For local runs set `HOST=127.0.0.1`.

## Run

```bash
npm start       # node server.js
npm run dev     # with nodemon
npm test        # tests; no network or Binance calls
```

With Docker behind the VPN: `docker compose up -d` (see [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md)).

## Documentation

| Document | Contents |
| :------- | :------- |
| [docs/DATA_CONTRACT.md](./docs/DATA_CONTRACT.md) | Endpoints and the Market State JSON contract |
| [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) | Architecture, Operating Model, code map, configuration notes |
| [docs/DEPLOYMENT.md](./docs/DEPLOYMENT.md) | Docker + VPN runbook (Indonesian) |
| [docs/ROADMAP.md](./docs/ROADMAP.md) | Roadmap levels 1–7 |
| [CHANGELOG.md](./CHANGELOG.md) | Release index; details in `docs/changelog/` |

## License

Distributed under the MIT License.
