const axios = require('axios');
const WebSocket = require('ws');
const { parseKlines } = require('./candles');
require('dotenv').config();

const REQUEST_TIMEOUT_MS = 10000;
const RETRY_DELAYS_MS = [1000, 2000, 4000];
const DEFAULT_429_COOLDOWN_S = 60;
const MIN_418_COOLDOWN_S = 120;
// 451 is an access restriction, not a transient fault: pause REST calls instead of retrying.
const COOLDOWN_451_S = 900;
const STREAM_BACKOFF_MIN_MS = 5000;
const STREAM_BACKOFF_MAX_MS = 60000;
const STREAM_BACKOFF_451_MS = COOLDOWN_451_S * 1000;

class BinanceError extends Error {
    constructor(code, message, { status = null, retryable = false } = {}) {
        super(message);
        this.name = 'BinanceError';
        this.code = code;
        this.status = status;
        this.retryable = retryable;
    }
}

function parseRetryAfter(headers) {
    const raw = headers && (headers['retry-after'] ?? headers['Retry-After']);
    const s = parseInt(raw, 10);
    return Number.isFinite(s) && s > 0 ? s : null;
}

// Maps an axios error to a BinanceError with a stable code.
function classifyError(err) {
    if (err instanceof BinanceError) return err;
    const status = err.response?.status;
    if (status === 429) return new BinanceError('binance_429', 'Binance rate limit (HTTP 429)', { status });
    if (status === 418) return new BinanceError('binance_418', 'Binance IP ban (HTTP 418)', { status });
    if (status === 451) return new BinanceError('binance_451', 'Binance access restricted (HTTP 451)', { status });
    if (status >= 500) return new BinanceError('binance_http', `Binance server error (HTTP ${status})`, { status, retryable: true });
    if (status) return new BinanceError('binance_http', `Binance request rejected (HTTP ${status})`, { status });
    if (err.code === 'ECONNABORTED' || err.code === 'ETIMEDOUT' || /timeout/i.test(err.message || '')) {
        return new BinanceError('timeout', 'Binance request timed out', { retryable: true });
    }
    return new BinanceError('network', `Network error: ${err.code || 'unknown'}`, { retryable: true });
}

class BinanceClient {
    constructor({ http = axios, sleep, now } = {}) {
        this.baseUrl = process.env.BINANCE_REST_URL || 'https://api.binance.com';
        this.wsUrl = process.env.BINANCE_WS_URL || 'wss://stream.binance.com:9443/ws';
        this.http = http;
        this.sleep = sleep || ((ms) => new Promise(r => setTimeout(r, ms)));
        this.now = now || (() => Date.now());
        this.cooldown = null; // { code, until (ms) }
        this.stream = { connected: false, last_message_at: null, last_error: null };
        this._ws = null;
        this._reconnectTimer = null;
        this._stopped = false;
    }

    nowSec() {
        return Math.floor(this.now() / 1000);
    }

    candleLimit() {
        const limit = parseInt(process.env.CANDLE_LIMIT, 10);
        // Binance caps klines at 1000; at least 201 rows are needed for 200 closed candles.
        if (Number.isFinite(limit) && limit >= 201 && limit <= 1000) return limit;
        return 500;
    }

    cooldownState() {
        if (this.cooldown && this.cooldown.until > this.now()) return this.cooldown;
        this.cooldown = null;
        return null;
    }

    _setCooldown(code, seconds) {
        const until = this.now() + seconds * 1000;
        if (!this.cooldown || this.cooldown.until < until) this.cooldown = { code, until };
    }

    // Fetches klines and returns parsed candles (closed and forming, sorted, deduplicated by caller).
    getKlines(symbol, interval) {
        return this._klines({ symbol, interval, limit: this.candleLimit() });
    }

    // Up to 1000 candles opening at or after `startTimeMs`, for history downloads (backtest).
    getKlinesFrom(symbol, interval, startTimeMs) {
        return this._klines({ symbol, interval, startTime: startTimeMs, limit: 1000 });
    }

    async _klines(params) {
        const { interval } = params;
        const active = this.cooldownState();
        if (active) {
            throw new BinanceError(active.code, `Binance requests paused until ${new Date(active.until).toISOString()}`);
        }

        let attempt = 0;
        for (;;) {
            try {
                const response = await this.http.get(`${this.baseUrl}/api/v3/klines`, {
                    params,
                    timeout: REQUEST_TIMEOUT_MS,
                });
                const parsed = parseKlines(response.data, interval);
                if (!parsed.valid) throw new BinanceError('invalid_response', 'Binance klines response is not an array');
                if (parsed.rejected > 0) {
                    throw new BinanceError('invalid_response', `Binance klines response has ${parsed.rejected} malformed rows`);
                }
                return parsed.candles;
            } catch (raw) {
                const err = classifyError(raw);
                const retryAfter = parseRetryAfter(raw.response?.headers);
                if (err.code === 'binance_429') this._setCooldown(err.code, retryAfter || DEFAULT_429_COOLDOWN_S);
                if (err.code === 'binance_418') this._setCooldown(err.code, Math.max(retryAfter || 0, MIN_418_COOLDOWN_S));
                if (err.code === 'binance_451') this._setCooldown(err.code, COOLDOWN_451_S);

                if (!err.retryable || attempt >= RETRY_DELAYS_MS.length) throw err;
                await this.sleep(RETRY_DELAYS_MS[attempt]);
                attempt++;
                // Another request may have hit a 429/418/451 while this one was waiting.
                const paused = this.cooldownState();
                if (paused) throw new BinanceError(paused.code, `Binance requests paused until ${new Date(paused.until).toISOString()}`);
            }
        }
    }

    streamUrl(markets) {
        const streams = markets.map(m => `${m.toLowerCase()}@ticker`).join('/');
        const base = this.wsUrl.endsWith('/ws') ? this.wsUrl.slice(0, -3) : this.wsUrl;
        return `${base}/stream?streams=${streams}`;
    }

    // Streams live ticker prices. Prices are display-only and never feed signal calculations.
    connectWebSocket(onPrice, markets = ['BTCUSDT'], { onReconnect } = {}) {
        this._stopped = false;
        const allowed = new Set(markets);
        let backoff = STREAM_BACKOFF_MIN_MS;
        let connectedBefore = false;

        const connect = () => {
            if (this._stopped) return;
            let ws;
            try {
                ws = new WebSocket(this.streamUrl(markets), { maxPayload: 1024 * 1024 });
            } catch (err) {
                this.stream.last_error = { code: 'network', at: this.nowSec() };
                return scheduleReconnect(STREAM_BACKOFF_MAX_MS);
            }
            this._ws = ws;

            ws.on('open', () => {
                backoff = STREAM_BACKOFF_MIN_MS;
                this.stream.connected = true;
                this.stream.last_error = null;
                if (connectedBefore && onReconnect) {
                    Promise.resolve().then(onReconnect).catch(e => console.error('[Stream] Reconnect catch-up failed:', e.message));
                }
                connectedBefore = true;
            });

            ws.on('message', (data) => {
                try {
                    const response = JSON.parse(data);
                    const msg = response?.data;
                    const symbol = typeof response?.stream === 'string' ? response.stream.split('@')[0].toUpperCase() : null;
                    const price = parseFloat(msg?.c);
                    if (!symbol || !allowed.has(symbol) || !Number.isFinite(price) || price <= 0) return;
                    this.stream.last_message_at = this.nowSec();
                    const eventTime = Number.isFinite(msg.E) ? Math.floor(msg.E / 1000) : null;
                    onPrice(symbol, price, eventTime);
                } catch (e) {
                    // Ignore malformed frames; they are not actionable.
                }
            });

            ws.on('error', (err) => {
                const status = /Unexpected server response: (\d+)/.exec(err.message || '');
                const code = status ? (status[1] === '451' ? 'binance_451' : status[1] === '418' ? 'binance_418' : status[1] === '429' ? 'binance_429' : 'binance_http') : 'network';
                this.stream.last_error = { code, at: this.nowSec() };
                console.error(`[Stream] Binance WS error: ${code}`);
            });

            ws.on('close', () => {
                this.stream.connected = false;
                if (this._ws === ws) this._ws = null;
                const restricted = this.stream.last_error?.code === 'binance_451';
                scheduleReconnect(restricted ? STREAM_BACKOFF_451_MS : backoff);
                backoff = Math.min(backoff * 2, STREAM_BACKOFF_MAX_MS);
            });
        };

        const scheduleReconnect = (delay) => {
            if (this._stopped || this._reconnectTimer) return;
            console.warn(`[Stream] Binance WS closed. Reconnecting in ${Math.round(delay / 1000)}s...`);
            this._reconnectTimer = setTimeout(() => {
                this._reconnectTimer = null;
                connect();
            }, delay);
        };

        connect();
    }

    stopWebSocket() {
        this._stopped = true;
        if (this._reconnectTimer) clearTimeout(this._reconnectTimer);
        this._reconnectTimer = null;
        if (this._ws) this._ws.terminate();
        this._ws = null;
    }
}

module.exports = new BinanceClient();
module.exports.BinanceClient = BinanceClient;
module.exports.BinanceError = BinanceError;
module.exports.classifyError = classifyError;
