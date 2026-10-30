# WebSocket messages

Message shapes and limits of the WebSocket server (`src/websocket/ws.manager.js`), which shares the HTTP server and port.

## Connection

- Same-origin only: the `Origin` header (when present) must match `Host`, and `Host` must be `localhost`, `127.0.0.1`, `[::1]` or listed in `ALLOWED_HOSTS`. Other connections are rejected during the handshake.
- Maximum payload 4 KB per message; at most 100 clients; a ping every 30 s drops connections that stop answering.
- Each connection holds one subscription; a new `subscribe` replaces the previous one.

## Client → server

| Message | Meaning |
| :------ | :------ |
| `{ "type": "subscribe", "market": "BTCUSDT", "timeframe": "15m" }` | Subscribe to one configured market and timeframe. |

Errors are sent back as `{ "type": "error", "message": "..." }` with one of: `Invalid JSON format`, `Unsupported message type`, `Unknown market or timeframe`.

## Server → client

| Message | Sent to | Meaning |
| :------ | :------ | :------ |
| `{ "type": "price", "market", "price", "event_time" }` | every subscriber of `market` | Live ticker price. **Display only**; never used in calculations. `event_time` is Unix seconds or `null`. |
| `{ "type": "update_ready", "market", "timeframe" }` | subscribers of that market + timeframe | The per-timeframe snapshot changed; re-fetch `GET /api/:symbol/:tf`. |
| `{ "type": "summary_ready", "market" }` | every subscriber of `market` | The Market State was republished; re-fetch `GET /api/market/:symbol`. |

`price` gained `market` and `event_time` in 2.0.0 (additive); `summary_ready` was added in 2.0.0.
