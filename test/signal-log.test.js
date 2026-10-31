const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { createSignalLog, evaluate, candidateDirection, toCsv, EXPIRY_CANDLES } = require('../src/services/signal-log');
const { createMarketEngine } = require('../src/services/market.service');
const { createApp } = require('../src/app');
const { fakeBinance, tempStorage, testConfig, silentLog } = require('./helpers');

const LEN = 900; // 15m
const T0 = 1_800_000_000 - (1_800_000_000 % LEN);

// Flat candles at 100 starting at T0; `moves` overrides high/low per index.
function candles(n, moves = {}) {
    return Array.from({ length: n }, (_, i) => ({
        time: T0 + i * LEN, close_time: T0 + (i + 1) * LEN,
        open: 100, high: 100.5, low: 99.5, close: 100, volume: 1,
        ...(moves[i] || {}),
    }));
}

function state({ score = 6, status = 'ok', filters = [], plan = {} } = {}) {
    return {
        generated_at: T0 + LEN + 5, status, price: 100, context: 'near_support', momentum: 'bullish',
        regime: 'ranging', volume_state: 'normal', divergence: 'none', volatility_ratio: 1.1,
        distance_percent: { to_support: 0.4, to_resistance: 3 }, indicators: { rsi: 41.237, atr: 1 },
        signal: {
            action: filters.length ? 'WAIT' : (score >= 5 ? 'BUY' : score <= -5 ? 'SELL' : 'WAIT'),
            score, strength: 'medium', reasons: [{ code: 'near_support', points: 2 }],
            filtered: filters.length > 0, filters,
            plan: { side: 'long', entry_zone: [98, 99], stop_loss: 97, take_profit_1: 104.5, take_profit_2: 110, risk_reward: 1.5, trailing_stop: 98.5, ...plan },
        },
    };
}

const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-signal-log-'));
const record = (over = {}) => ({ signal: 'BUY', price: 100, sl: 97, tp1: 104.5, risk_reward: 1.5, candle_time: T0, candle_close_time: T0 + LEN, ...over });

test('candidates: |score| >= 5 with ok status, filtered or not', () => {
    assert.equal(candidateDirection(state({ score: 6 })), 'BUY');
    assert.equal(candidateDirection(state({ score: -7, filters: ['low_rr'] })), 'SELL');
    assert.equal(candidateDirection(state({ score: 4 })), null);
    assert.equal(candidateDirection(state({ score: 6, status: 'degraded' })), null);
});

test('outcome: TP1 → WIN, SL → LOSS, both in one candle → LOSS, open while untouched', () => {
    assert.equal(evaluate(record(), candles(5)), null);
    assert.deepEqual(evaluate(record(), candles(5, { 3: { high: 105 } })), { result: 'WIN', rr: 1.5, closed_at: T0 + 4 * LEN, bars: 3 });
    assert.deepEqual(evaluate(record(), candles(5, { 2: { low: 96 } })), { result: 'LOSS', rr: -1, closed_at: T0 + 3 * LEN, bars: 2 });
    assert.equal(evaluate(record(), candles(5, { 1: { low: 96, high: 105 } })).result, 'LOSS');
    // SELL mirrors: SL above, TP below.
    const short = record({ signal: 'SELL', sl: 103, tp1: 95.5 });
    assert.equal(evaluate(short, candles(5, { 2: { low: 95 } })).result, 'WIN');
    assert.equal(evaluate(short, candles(5, { 2: { high: 103 } })).result, 'LOSS');
});

test('outcome: EXPIRED after the expiry window, UNKNOWN when the path is gone', () => {
    const c = candles(EXPIRY_CANDLES + 2, { [EXPIRY_CANDLES]: { close: 101.5 } });
    assert.deepEqual(evaluate(record(), c), { result: 'EXPIRED', rr: 0.5, closed_at: T0 + (EXPIRY_CANDLES + 1) * LEN, bars: EXPIRY_CANDLES });
    assert.equal(evaluate(record(), candles(10).slice(3)).result, 'UNKNOWN');
});

test('log: records a candidate once, closes it later and survives a restart', async () => {
    const dir = tempDir();
    const log = createSignalLog({ dir, entryTf: '15m', log: silentLog });
    await log.load(['BTCUSDT']);

    await log.onSummary('BTCUSDT', state({ filters: ['no_mans_land'] }), candles(1));
    await log.onSummary('BTCUSDT', state(), candles(2)); // same direction still open: not logged again
    let rows = await log.records('BTCUSDT');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, `BTCUSDT-${T0}-BUY`);
    assert.equal(rows[0].filtered, true);
    assert.deepEqual(rows[0].filters, ['no_mans_land']);
    assert.equal(rows[0].features.rsi, 41.24);
    assert.equal(rows[0].result, null);

    // After a restart the open record is still tracked and gets closed.
    const restarted = createSignalLog({ dir, entryTf: '15m', log: silentLog });
    await restarted.load(['BTCUSDT']);
    await restarted.onSummary('BTCUSDT', state({ score: 0 }), candles(4, { 3: { high: 105 } }));
    rows = await restarted.records('BTCUSDT');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].result, 'WIN');

    // A truncated line from a crash is skipped.
    fs.appendFileSync(path.join(dir, 'BTCUSDT.jsonl'), '{"type":"sig');
    assert.equal((await restarted.records('BTCUSDT')).length, 1);
});

test('log: no record without a usable plan or with stale data', async () => {
    const log = createSignalLog({ dir: tempDir(), entryTf: '15m', log: silentLog });
    await log.load(['BTCUSDT']);
    await log.onSummary('BTCUSDT', state({ plan: { take_profit_1: null } }), candles(1));
    await log.onSummary('BTCUSDT', state({ status: 'stale' }), candles(1));
    assert.deepEqual(await log.records('BTCUSDT'), []);
});

test('csv flattens features and quotes values', () => {
    const csv = toCsv([{ id: 'X', signal: 'BUY', filters: ['a', 'b'], result: null, features: { context: 'near_support', reasons: ['r1', 'r2'], score: 6 } }]);
    const [header, row] = csv.trim().split('\n');
    const cols = header.split(',');
    const cells = row.split(',');
    assert.equal(cells[cols.indexOf('filters')], 'a|b');
    assert.equal(cells[cols.indexOf('context')], 'near_support');
    assert.equal(cells[cols.indexOf('reasons')], 'r1|r2');
    assert.equal(cells[cols.indexOf('result')], '');
    assert.equal(toCsv([{ id: 'a,"b"', features: {} }]).split('\n')[1].split(',"')[0], '"a');
});

test('engine passes each published summary and entry candles to the log; log errors do not block', async () => {
    const MIDNIGHT = Date.UTC(2026, 9, 29) / 1000;
    const clock = { ms: (MIDNIGHT + 5) * 1000 };
    const calls = [];
    const signalLog = {
        async load(markets) { calls.push(['load', markets]); },
        async onSummary(market, s, c) { calls.push(['summary', market, s.status, c.length]); throw new Error('disk full'); },
        async records() { return []; },
    };
    const engine = createMarketEngine({
        storage: tempStorage(), binance: fakeBinance({ now: () => clock.ms }), indicators: require('../src/services/indicator.service'),
        config: testConfig, signalLog, now: () => clock.ms, log: silentLog,
    });
    const results = await engine.initialize();
    assert.equal(results.BTCUSDT.summary, 'ok', 'publishing succeeds even though logging threw');
    assert.deepEqual(calls[0], ['load', ['BTCUSDT']]);
    assert.equal(calls[1][0], 'summary');
    assert.equal(calls[1][2], 'ok');
    assert.ok(calls[1][3] >= 200, 'closed entry candles are passed');
    assert.deepEqual(await engine.signalRecords('BTCUSDT'), { market: 'BTCUSDT', stats: { total: 0, open: 0, WIN: 0, LOSS: 0, EXPIRED: 0, UNKNOWN: 0 }, records: [] });
});

test('GET /api/signals/:market serves JSON and CSV', async (t) => {
    const dir = tempDir();
    const log = createSignalLog({ dir, entryTf: '15m', log: silentLog });
    await log.onSummary('BTCUSDT', state(), candles(1));
    await log.onSummary('BTCUSDT', state({ score: 0 }), candles(3, { 2: { low: 96 } }));
    const engine = createMarketEngine({
        storage: tempStorage(), binance: fakeBinance({ now: () => Date.now() }), indicators: require('../src/services/indicator.service'),
        config: testConfig, signalLog: log, log: silentLog,
    });
    const server = http.createServer(createApp({ engine, config: { ...testConfig, ALLOWED_HOSTS: ['127.0.0.1'] }, log: silentLog }));
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    t.after(() => new Promise(r => server.close(r)));
    const base = `http://127.0.0.1:${server.address().port}/api/signals`;

    const json = await fetch(`${base}/BTCUSDT`).then(r => r.json());
    assert.equal(json.stats.total, 1);
    assert.equal(json.stats.LOSS, 1);
    assert.equal(json.records[0].rr, -1);

    const csv = await fetch(`${base}/BTCUSDT?format=csv`);
    assert.match(csv.headers.get('content-type'), /text\/csv/);
    assert.equal((await csv.text()).trim().split('\n').length, 2);

    assert.equal((await fetch(`${base}/ETHUSDT`)).status, 404);
});
