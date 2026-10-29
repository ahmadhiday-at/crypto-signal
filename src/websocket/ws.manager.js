const WebSocket = require('ws');

const MAX_PAYLOAD_BYTES = 4 * 1024;
const MAX_CLIENTS = 100;
const HEARTBEAT_MS = 30000;

// Browsers always send Origin; reject cross-site pages. Non-browser clients (no Origin) are allowed.
function isSameOrigin(req) {
    const origin = req.headers.origin;
    if (!origin) return true;
    try {
        return new URL(origin).host === req.headers.host;
    } catch (e) {
        return false;
    }
}

class WsManager {
    constructor() {
        this.wss = null;
        this.clients = new Map();
        this.isValidSubscription = () => true;
        this.isAllowedHost = () => true;
        this._heartbeat = null;
    }

    init(server, { isValidSubscription, isAllowedHost } = {}) {
        if (isValidSubscription) this.isValidSubscription = isValidSubscription;
        if (isAllowedHost) this.isAllowedHost = isAllowedHost;
        this.wss = new WebSocket.Server({
            server,
            maxPayload: MAX_PAYLOAD_BYTES,
            verifyClient: (info) => this.isAllowedHost(info.req.headers.host) && isSameOrigin(info.req)
                && this.wss.clients.size < MAX_CLIENTS,
        });

        this.wss.on('connection', (ws) => {
            ws.isAlive = true;
            ws.on('pong', () => { ws.isAlive = true; });

            ws.on('message', (message) => {
                let data;
                try {
                    data = JSON.parse(message);
                } catch (err) {
                    return this._send(ws, { type: 'error', message: 'Invalid JSON format' });
                }
                if (data?.type !== 'subscribe') return this._send(ws, { type: 'error', message: 'Unsupported message type' });
                if (!this.isValidSubscription(data.market, data.timeframe)) {
                    return this._send(ws, { type: 'error', message: 'Unknown market or timeframe' });
                }
                this._unsubscribe(ws);
                const key = `${data.market}_${data.timeframe}`;
                if (!this.clients.has(key)) this.clients.set(key, new Set());
                this.clients.get(key).add(ws);
                ws.currentKey = key;
            });

            ws.on('error', () => {});
            ws.on('close', () => this._unsubscribe(ws));
        });

        // Drop connections that stopped answering pings.
        this._heartbeat = setInterval(() => {
            this.wss.clients.forEach((ws) => {
                if (!ws.isAlive) return ws.terminate();
                ws.isAlive = false;
                ws.ping();
            });
        }, HEARTBEAT_MS);
        this.wss.on('close', () => clearInterval(this._heartbeat));
    }

    _send(ws, payload) {
        if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(payload));
    }

    _unsubscribe(ws) {
        if (!ws.currentKey) return;
        const set = this.clients.get(ws.currentKey);
        if (set) {
            set.delete(ws);
            if (set.size === 0) this.clients.delete(ws.currentKey);
        }
        ws.currentKey = null;
    }

    _broadcast(predicate, payload) {
        const json = JSON.stringify(payload);
        this.clients.forEach((set, key) => {
            if (!predicate(key)) return;
            set.forEach(client => {
                if (client.readyState === WebSocket.OPEN) client.send(json);
            });
        });
    }

    broadcastUpdate(market, timeframe) {
        this._broadcast(key => key === `${market}_${timeframe}`, { type: 'update_ready', market, timeframe });
    }

    // Sent to every subscriber of the market when its Market State is republished.
    broadcastSummary(market) {
        this._broadcast(key => key.startsWith(market + '_'), { type: 'summary_ready', market });
    }

    // Live ticker price: display-only, not derived from closed candles.
    broadcastPrice(market, price, eventTime = null) {
        this._broadcast(key => key.startsWith(market + '_'), { type: 'price', market, price, event_time: eventTime });
    }

    close() {
        if (this._heartbeat) clearInterval(this._heartbeat);
        if (this.wss) this.wss.close();
    }
}

module.exports = new WsManager();
module.exports.WsManager = WsManager;
module.exports.isSameOrigin = isSameOrigin;
