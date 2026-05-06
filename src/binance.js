const axios = require('axios');
const WebSocket = require('ws');
require('dotenv').config();

class BinanceClient {
    constructor() {
        this.baseUrl = process.env.BINANCE_REST_URL || 'https://api.binance.com';
        this.wsUrl = process.env.BINANCE_WS_URL || 'wss://stream.binance.com:9443/ws';
    }

    async getKlines(symbol, interval) {
        try {
            const limit = parseInt(process.env.CANDLE_LIMIT) || 500;
            const response = await axios.get(`${this.baseUrl}/api/v3/klines`, {
                params: { symbol, interval, limit },
                timeout: 10000
            });
            return response.data.map(k => ({
                time: k[0] / 1000,
                open: parseFloat(k[1]),
                high: parseFloat(k[2]),
                low: parseFloat(k[3]),
                close: parseFloat(k[4]),
                volume: parseFloat(k[5])
            }));
        } catch (err) {
            console.error(`Binance REST Error [${symbol}/${interval}]:`, err.message);
            throw new Error('Failed to fetch data from Binance');
        }
    }

    connectWebSocket(onPrice, onCandleClose, markets = ['BTCUSDT']) {
        try {
            const streams = markets.map(m => `${m.toLowerCase()}@ticker`).join('/');
            const url = this.wsUrl.endsWith('/ws') 
                ? this.wsUrl.replace('/ws', '') + `/stream?streams=${streams}`
                : `${this.wsUrl}/stream?streams=${streams}`;
                
            const ws = new WebSocket(url);

            ws.on('message', (data) => {
                try {
                    const response = JSON.parse(data);
                    const msg = response.data;
                    const stream = response.stream;
                    
                    if (msg && msg.c) {
                        const symbol = stream.split('@')[0].toUpperCase();
                        onPrice(symbol, parseFloat(msg.c));
                    }
                } catch (e) {
                    console.error('WS Message Parse Error:', e);
                }
            });

            ws.on('error', (err) => {
                console.error('Binance WS Error:', err.message);
            });

            ws.on('close', () => {
                console.warn('Binance WS closed. Reconnecting in 5s...');
                setTimeout(() => this.connectWebSocket(onPrice, onCandleClose, markets), 5000);
            });

            setInterval(async () => {
                try {
                    const now = new Date();
                    markets.forEach(m => {
                        // Sync according to 1m timeframe as a baseline
                        if (now.getSeconds() === 0) {
                            onCandleClose(m, '1m');
                        }
                    });
                } catch (e) {
                    console.error('Candle Sync Error:', e);
                }
            }, 1000);
        } catch (err) {
            console.error('Binance WS Connection Error:', err);
            setTimeout(() => this.connectWebSocket(onPrice, onCandleClose, markets), 10000);
        }
    }
}

module.exports = new BinanceClient();
