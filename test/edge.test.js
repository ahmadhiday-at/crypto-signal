const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { edgeSummary, liveParams, MIN_TRADES } = require('../src/services/edge');
const { createReports } = require('../src/services/backtest');
const { createMarketEngine } = require('../src/services/market.service');
const { createApp } = require('../src/app');
const { createCalcConfig } = require('../src/config/calculation');
const indicatorService = require('../src/services/indicator.service');
const { fakeBinance, tempStorage, testConfig, silentLog } = require('./helpers');

const live = liveParams(testConfig, null, 499);
const summary = (trades, expectancy_r) => ({ trades, wins: 1, win_rate: 0.3, expectancy_r, profit_factor: 1.1 });
const report = (over = {}) => ({
    generated_at: 1_800_000_000,
    period: { start: 1, end: 2 },
    params: { threshold: 5, min_rr: 1.5, stop_atr: 0.5, target: 'tp1', side: 'both', skip_energy: [], weights: { ...testConfig.TF_WEIGHTS }, window: 499, fee_pct: 0.1 },
    taken: { summary: summary(40, 0.12) },
    validation: null,
    ...over,
});

test('verdict: positive, negative, unproven with reasons', () => {
    assert.equal(edgeSummary('BTCUSDT', report(), null, live).verdict, 'positive');

    const neg = edgeSummary('BTCUSDT', report({ taken: { summary: summary(71, -0.24) } }), null, live);
    assert.equal(neg.verdict, 'negative');
    assert.deepEqual(neg.reasons, ['negative_expectancy']);

    const oos = report({ validation: { split_at: 9, rows: [{ base: true, out_of_sample: summary(20, -0.3) }] } });
    const negOos = edgeSummary('BTCUSDT', oos, null, live);
    assert.equal(negOos.verdict, 'negative');
    assert.deepEqual(negOos.reasons, ['negative_out_of_sample']);
    assert.equal(negOos.backtest.out_of_sample.expectancy_r, -0.3);

    assert.deepEqual(edgeSummary('BTCUSDT', null, null, live), { market: 'BTCUSDT', verdict: 'unproven', reasons: ['no_backtest'], min_trades: MIN_TRADES, backtest: null, live_log: null });

    const few = edgeSummary('BTCUSDT', report({ taken: { summary: summary(MIN_TRADES - 1, 0.5) } }), null, live);
    assert.deepEqual([few.verdict, few.reasons], ['unproven', ['too_few_trades']]);

    const other = edgeSummary('BTCUSDT', report({ params: { ...report().params, threshold: 6 } }), null, live);
    assert.deepEqual([other.verdict, other.reasons, other.backtest.params_match], ['unproven', ['params_differ'], false]);
    assert.equal(edgeSummary('BTCUSDT', report({ params: { ...report().params, window: 999 } }), null, live).verdict, 'unproven', 'other CANDLE_LIMIT');
    const target = edgeSummary('BTCUSDT', report({ params: { ...report().params, target: 2 } }), null, live);
    assert.equal(target.verdict, 'unproven');

    const free = edgeSummary('BTCUSDT', report({ params: { ...report().params, fee_pct: 0 } }), null, live);
    assert.deepEqual([free.verdict, free.reasons], ['positive', ['no_fees']]);

    // Reports from before 2.11.0 have no setup fields: treated as the live defaults.
    const old = report({ params: { threshold: 5, min_rr: 1.5, weights: { ...testConfig.TF_WEIGHTS }, fee_pct: 0.1 } });
    assert.equal(edgeSummary('BTCUSDT', old, null, live).backtest.params_match, true);
});

test('live log: taken records only, closed ones in R', () => {
    const rec = (result, rr, filtered = false) => ({ result, rr, filtered, closed_at: result ? 10 : null, signal: 'BUY' });
    const log = { stats: {}, records: [rec('WIN', 2), rec('LOSS', -1), rec('EXPIRED', 0.5), rec(null, null), rec('WIN', 3, true), rec('UNKNOWN', null)] };
    const e = edgeSummary('BTCUSDT', null, log, live);
    assert.deepEqual(e.live_log, { open: 1, trades: 3, win_rate: 0.3333, expectancy_r: 0.5, profit_factor: 2.5 });
});

test('GET /api/edge/:market', async (t) => {
    const reports = createReports({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-signal-edge-')) });
    const engine = createMarketEngine({
        storage: tempStorage(), binance: fakeBinance({ now: () => Date.now() }), indicators: indicatorService, config: testConfig, log: silentLog,
    });
    const server = http.createServer(createApp({ engine, config: { ...testConfig, ALLOWED_HOSTS: ['127.0.0.1'] }, reports, log: silentLog }));
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    t.after(() => new Promise(r => server.close(r)));
    const base = `http://127.0.0.1:${server.address().port}`;

    const empty = await fetch(`${base}/api/edge/BTCUSDT`).then(r => r.json());
    assert.deepEqual([empty.verdict, empty.reasons, empty.live_log], ['unproven', ['no_backtest'], null]);
    // The endpoint compares with the active CANDLE_LIMIT (from .env when present).
    const window = require('../src/services/binance.service').candleLimit() - 1;
    await reports.write('BTCUSDT', report({ taken: { summary: summary(71, -0.24) }, params: { ...report().params, window } }));
    const neg = await fetch(`${base}/api/edge/BTCUSDT`).then(r => r.json());
    assert.equal(neg.verdict, 'negative');
    assert.equal(neg.backtest.taken.expectancy_r, -0.24);
    assert.equal((await fetch(`${base}/api/edge/ETHUSDT`)).status, 404);
});

test('calculation config API, edge params_differ and backtest re-run', async (t) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-signal-calc-'));
    const reports = createReports({ dir: path.join(dir, 'backtest') });
    const calc = createCalcConfig({ file: path.join(dir, 'calculation.json'), envWeights: testConfig.TF_WEIGHTS, log: silentLog });
    calc.load();
    const started = [];
    const runner = {
        start: (markets) => (started.length ? { error: 'backtest_running' } : (started.push(...markets), { jobs: markets.map(market => ({ market, state: 'queued' })) })),
        status: () => ({ running: started.length > 0, jobs: {} }),
    };
    const engine = createMarketEngine({
        storage: tempStorage(), binance: fakeBinance({ now: () => Date.now() }), indicators: indicatorService, config: testConfig, calc, log: silentLog,
    });
    const server = http.createServer(createApp({ engine, config: { ...testConfig, ALLOWED_HOSTS: ['127.0.0.1'] }, reports, calc, runner, log: silentLog }));
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    t.after(() => new Promise(r => server.close(r)));
    const base = `http://127.0.0.1:${server.address().port}`;
    const action = { 'Content-Type': 'application/json', 'X-Requested-With': 'crypto-signal' };
    const put = (body, headers = action) => fetch(`${base}/api/calc-config`, { method: 'PUT', headers, body });

    const got = await fetch(`${base}/api/calc-config`).then(r => r.json());
    assert.equal(got.config.signal.threshold, 5);
    assert.deepEqual(got.limits.signal.threshold, [1, 15, true]);

    const window = require('../src/services/binance.service').candleLimit() - 1;
    await reports.write('BTCUSDT', report({ params: { ...report().params, window } }));
    assert.equal((await fetch(`${base}/api/edge/BTCUSDT`).then(r => r.json())).backtest.params_match, true);

    assert.equal((await put(JSON.stringify({ signal: { threshold: 6 } }), { 'Content-Type': 'application/json' })).status, 403);
    const bad = await put(JSON.stringify({ signal: { threshold: 0 } }));
    assert.equal(bad.status, 400);
    assert.deepEqual((await bad.json()).problems, ['signal.threshold must be an integer 1–15']);
    assert.equal((await put('{ nope')).status, 400);
    const ok = await put(JSON.stringify({ signal: { threshold: 6 }, filters: { volatility_dead: 0.4 } }));
    assert.equal(ok.status, 200);
    assert.equal((await ok.json()).config.signal.threshold, 6);
    assert.equal(JSON.parse(fs.readFileSync(path.join(dir, 'calculation.json'), 'utf8')).filters.volatility_dead, 0.4);
    // The report ran with threshold 5: it no longer describes the live signal.
    const edge = await fetch(`${base}/api/edge/BTCUSDT`).then(r => r.json());
    assert.deepEqual([edge.verdict, edge.reasons[0]], ['unproven', 'params_differ']);

    const run = (body) => fetch(`${base}/api/backtest-runs`, { method: 'POST', headers: action, body: JSON.stringify(body) });
    assert.equal((await run({ market: 'ETHUSDT' })).status, 404);
    assert.equal((await run({ market: 'all' })).status, 202);
    assert.deepEqual(started, testConfig.MARKETS);
    assert.equal((await run({ market: 'BTCUSDT' })).status, 409);
    assert.equal((await fetch(`${base}/api/backtest-runs`).then(r => r.json())).running, true);
    assert.equal((await fetch(`${base}/config`)).status, 200);
});
