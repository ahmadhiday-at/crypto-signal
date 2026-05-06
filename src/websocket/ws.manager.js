const WebSocket = require('ws');

class WsManager {
    constructor() {
        this.wss = null;
        this.clients = new Map();
    }

    init(server) {
        this.wss = new WebSocket.Server({ server });
        
        this.wss.on('connection', (ws) => {
            ws.on('message', (message) => {
                try {
                    const data = JSON.parse(message);
                    if (data.type === 'subscribe') {
                        const key = `${data.market}_${data.timeframe}`;
                        if (!this.clients.has(key)) this.clients.set(key, new Set());
                        this.clients.get(key).add(ws);
                        ws.currentKey = key;
                    }
                } catch (err) {
                    console.error('WS Message Parse Error:', err);
                    ws.send(JSON.stringify({ type: 'error', message: 'Invalid JSON format' }));
                }
            });

            ws.on('close', () => {
                try {
                    if (ws.currentKey && this.clients.has(ws.currentKey)) {
                        this.clients.get(ws.currentKey).delete(ws);
                    }
                } catch (err) {
                    console.error('WS Close Error:', err);
                }
            });
        });
    }

    broadcastUpdate(market, timeframe) {
        const key = `${market}_${timeframe}`;
        if (this.clients.has(key)) {
            const payload = JSON.stringify({ type: 'update_ready', market, timeframe });
            this.clients.get(key).forEach(client => {
                if (client.readyState === WebSocket.OPEN) client.send(payload);
            });
        }
    }

    broadcastPrice(market, price) {
        this.clients.forEach((set, key) => {
            if (key.startsWith(market + '_')) {
                const payload = JSON.stringify({ type: 'price', price });
                set.forEach(client => {
                    if (client.readyState === WebSocket.OPEN) client.send(payload);
                });
            }
        });
    }
}

module.exports = new WsManager();
