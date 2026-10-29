// Deterministic fixtures and fakes. No test talks to Binance.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { tfSeconds, expectedLastClose, parseKlines } = require('../src/services/candles');
const { StorageService } = require('../src/data/storage');

// Raw Binance kline rows ending at the last closed candle before `nowSec`, plus one forming row.
function rawKlines({ tf, nowSec, count = 300, base = 100, includeForming = true, lastVolume = null, shiftCandles = 0 }) {
    const len = tfSeconds(tf);
    const lastClose = expectedLastClose(nowSec, tf) - shiftCandles * len;
    const firstOpen = lastClose - count * len;
    const rows = [];
    let prev = base;
    const total = includeForming && shiftCandles === 0 ? count + 1 : count;
    for (let i = 0; i < total; i++) {
        const open = firstOpen + i * len;
        const close = +(base + 5 * Math.sin(i / 6) + 2 * Math.sin(i / 17)).toFixed(4);
        const o = prev;
        const high = +(Math.max(o, close) + 0.5).toFixed(4);
        const low = +(Math.min(o, close) - 0.5).toFixed(4);
        let volume = 10 + (i % 5);
        if (lastVolume !== null && i === count - 1) volume = lastVolume;
        rows.push([open * 1000, String(o), String(high), String(low), String(close), String(volume), (open + len) * 1000 - 1, '0', 0, '0', '0', '0']);
        prev = close;
    }
    return rows;
}

function fakeBinance({ now, overrides = {} } = {}) {
    const calls = [];
    const fake = {
        calls,
        failures: {},
        options: {},
        stream: { connected: true, last_message_at: null, last_error: null },
        cooldown: null,
        cooldownState() { return fake.cooldown; },
        async getKlines(market, tf) {
            calls.push(`${market}|${tf}`);
            if (fake.delayMs) await new Promise(r => setTimeout(r, fake.delayMs));
            const failure = fake.failures[tf];
            if (failure) throw failure;
            const opts = { tf, nowSec: Math.floor(now() / 1000), ...(fake.options[tf] || {}) };
            return parseKlines(rawKlines(opts), tf).candles;
        },
        ...overrides,
    };
    return fake;
}

function tempStorage() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-signal-test-'));
    const storage = new StorageService(dir);
    storage.dir = dir;
    return storage;
}

const testConfig = {
    MARKETS: ['BTCUSDT'],
    TIMEFRAMES: ['15m', '1h', '4h', '1d'],
    TIMEFRAME_LABELS: [],
    TF_ROLES: { htf: '1d', structure: '4h', mid: '1h', entry: '15m' },
    TF_WEIGHTS: { '1d': 3, '4h': 2, '1h': 1.5, '15m': 1, DEFAULT: 1 },
};

const silentLog = { log() {}, warn() {}, error() {} };

module.exports = { rawKlines, fakeBinance, tempStorage, testConfig, silentLog };
