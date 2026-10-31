const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { runBacktest, metrics, createReports } = require('../src/services/backtest');
const { createHistory } = require('../src/services/history');
const { evaluate, EXPIRY_CANDLES } = require('../src/services/signal-log');
const { parseKlines, tfSeconds } = require('../src/services/candles');
const { BinanceClient } = require('../src/services/binance.service');
const { createMarketEngine } = require('../src/services/market.service');
const { createApp } = require('../src/app');
const indicatorService = require('../src/services/indicator.service');
const { rawKlines, fakeBinance, tempStorage, testConfig, silentLog } = require('./helpers');

const NOW = 1_800_000_000;
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-signal-bt-'));

function history(days) {
    const c = {};
    for (const [tf, n] of [['15m', days * 96 + 520], ['1h', days * 24 + 520], ['4h', days * 6 + 520], ['1d', days + 520]]) {
        c[tf] = parseKlines(rawKlines({ tf, nowSec: NOW, count: n, includeForming: false }), tf).candles;
    }
    return c;
}

// The synthetic history never scores ±5 on its own; forcing a bullish setup on the entry
// timeframe makes the replay produce candidates through the real merge/signal code.
const bullish = {
    calculateAll(klines, market, tf) {
        const snap = indicatorService.calculateAll(klines, market, tf);
        return tf === '15m' ? { ...snap, context: 'near_support', momentum: 'bullish' } : snap;
    },
};

test('metrics: win rate, expectancy, profit factor and drawdown in close order', () => {
    const t = (result, net_r, closed_at) => ({ result, net_r, closed_at, signal: 'BUY' });
    const { summary, equity } = metrics([t('WIN', 2, 3), t('LOSS', -1, 1), t('LOSS', -1, 2), t('EXPIRED', 0.5, 4), t(null, null, null), t('UNKNOWN', null, 5)]);
    assert.equal(summary.trades, 4);
    assert.equal(summary.win_rate, 0.25);
    assert.equal(summary.expectancy_r, 0.125);
    assert.equal(summary.total_r, 0.5);
    assert.equal(summary.profit_factor, 1.25);
    assert.equal(summary.max_drawdown_r, 2, 'drawdown from 0 to −2 before the win');
    assert.equal(summary.open, 1);
    assert.equal(summary.unknown, 1);
    assert.deepEqual(equity.map(p => p.equity), [-1, -2, 0, 0.5]);
    assert.equal(metrics([]).summary.win_rate, null);
});

test('replay produces trades labelled exactly like the signal log, one open trade per direction', () => {
    const candles = history(20);
    const startSec = NOW - 20 * 86400;
    const report = runBacktest({ market: 'BTCUSDT', candlesByTf: candles, roles: testConfig.TF_ROLES, weights: testConfig.TF_WEIGHTS, indicators: bullish, startSec });
    assert.ok(report.steps >= 20 * 96 - 1);
    assert.equal(report.skipped_steps, 0);
    assert.ok(report.trades.length > 0, 'forced setup yields trades');

    const entry = candles['15m'];
    for (const tr of report.trades) {
        const i = entry.findIndex(c => c.close_time === tr.time);
        const record = { signal: tr.signal, price: tr.price, sl: tr.sl, tp1: tr.tp1, risk_reward: tr.risk_reward, candle_time: entry[i].time, candle_close_time: tr.time };
        const expected = evaluate(record, entry.slice(i, i + EXPIRY_CANDLES + 2));
        assert.equal(tr.result, expected ? expected.result : null);
        assert.ok(tr.time >= startSec);
    }
    for (const group of [false, true]) {
        for (const side of ['BUY', 'SELL']) {
            const list = report.trades.filter(t => t.filtered === group && t.signal === side);
            for (let k = 1; k < list.length; k++) assert.ok(list[k].time > list[k - 1].closed_at, 'no overlap within a group and side');
        }
    }
    const all = [...report.taken.equity, ...report.filtered.equity];
    assert.equal(all.length, report.taken.summary.trades + report.filtered.summary.trades);
});

test('fees lower net R by fee% × price / risk', () => {
    const args = { market: 'BTCUSDT', candlesByTf: history(10), roles: testConfig.TF_ROLES, weights: testConfig.TF_WEIGHTS, indicators: bullish, startSec: NOW - 10 * 86400 };
    const free = runBacktest(args);
    const paid = runBacktest({ ...args, feePct: 0.2 });
    const a = free.trades.find(t => t.net_r !== null);
    const b = paid.trades.find(t => t.id === a.id);
    const feeR = 0.002 * a.price / Math.abs(a.price - a.sl);
    assert.ok(Math.abs((a.net_r - b.net_r) - feeR) < 1e-3);
    assert.equal(paid.params.fee_pct, 0.2);
});

test('history: downloads in pages, then only the missing tail', async () => {
    const dir = tempDir();
    let nowMs = NOW * 1000;
    const len = tfSeconds('1h');
    const all = parseKlines(rawKlines({ tf: '1h', nowSec: NOW + 10 * len, count: 2600, includeForming: false }), '1h').candles;
    const requests = [];
    const binance = {
        async getKlinesFrom(market, tf, startMs) {
            requests.push(startMs / 1000);
            return all.filter(c => c.time >= startMs / 1000).slice(0, 1000);
        },
    };
    const h = createHistory({ dir, binance, now: () => nowMs, sleep: async () => {}, log: silentLog });
    const from = NOW - 2400 * len;
    const first = await h.sync('BTCUSDT', '1h', from);
    assert.equal(requests.length, 3);
    assert.equal(first[0].time, from);
    assert.ok(first.every(c => c.close_time <= NOW), 'only closed candles');
    assert.equal(first.length, 2400);

    requests.length = 0;
    nowMs += 5 * len * 1000;
    const second = await h.sync('BTCUSDT', '1h', from);
    assert.equal(requests.length, 1, 'only the new tail is requested');
    assert.equal(second.length, 2405);
    assert.ok(fs.existsSync(path.join(dir, 'BTCUSDT_1h.json')));
});

test('Binance client: getKlinesFrom sends startTime and limit 1000', async () => {
    let params;
    const c = new BinanceClient({ http: { async get(url, opts) { params = opts.params; return { data: rawKlines({ tf: '1h', nowSec: NOW, count: 5 }) }; } } });
    await c.getKlinesFrom('BTCUSDT', '1h', 123000);
    assert.deepEqual(params, { symbol: 'BTCUSDT', interval: '1h', startTime: 123000, limit: 1000 });
});

test('GET /api/backtest/:market and the /backtest/:market page', async (t) => {
    const reports = createReports({ dir: tempDir() });
    const engine = createMarketEngine({
        storage: tempStorage(), binance: fakeBinance({ now: () => Date.now() }), indicators: indicatorService, config: testConfig, log: silentLog,
    });
    const server = http.createServer(createApp({ engine, config: { ...testConfig, ALLOWED_HOSTS: ['127.0.0.1'] }, reports, log: silentLog }));
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    t.after(() => new Promise(r => server.close(r)));
    const base = `http://127.0.0.1:${server.address().port}`;

    assert.equal((await fetch(`${base}/api/backtest/BTCUSDT`)).status, 404);
    await reports.write('BTCUSDT', { market: 'BTCUSDT', steps: 1 });
    assert.deepEqual(await fetch(`${base}/api/backtest/BTCUSDT`).then(r => r.json()), { market: 'BTCUSDT', steps: 1 });
    assert.equal((await fetch(`${base}/api/backtest/ETHUSDT`)).status, 404);

    const page = await fetch(`${base}/backtest/BTCUSDT`).then(r => r.text());
    assert.match(page, /<title>Backtest Report<\/title>/);
});
