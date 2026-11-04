const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const { runBacktest, metrics, breakdown, createReports, expectancyInterval, walkForward, evaluateTrailing, VALIDATION_MIN_TRADES } = require('../src/services/backtest');
const { parseArgs } = require('../scripts/backtest');
const { createHistory } = require('../src/services/history');
const { evaluate, EXPIRY_CANDLES } = require('../src/services/signal-log');
const { parseKlines, tfSeconds } = require('../src/services/candles');
const { BinanceClient } = require('../src/services/binance.service');
const { createMarketEngine } = require('../src/services/market.service');
const { createApp } = require('../src/app');
const indicatorService = require('../src/services/indicator.service');
const { rawKlines, fakeBinance, tempStorage, testConfig, silentLog } = require('./helpers');

// The CLI reads its default market from the config that applyEngine fills at startup.
require('../src/config/env').MARKETS = testConfig.MARKETS;

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
    calculateAll(klines, market, tf, meta, params) {
        const snap = indicatorService.calculateAll(klines, market, tf, meta, params);
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

test('sweep of calculation values: a variant equals a run with that config', () => {
    const args = { market: 'BTCUSDT', candlesByTf: history(10), roles: testConfig.TF_ROLES, weights: testConfig.TF_WEIGHTS, indicators: bullish, startSec: NOW - 10 * 86400 };
    const variants = [
        { calc: { scoring: { momentum: 4 } } },
        { calc: { indicators: { rsi_period: 7 } } },
        { calc: { evaluation: { expiry_candles: 8 } } },
    ];
    const swept = runBacktest({ ...args, variants });
    assert.equal(swept.sweep.length, 4);
    variants.forEach((v, k) => {
        const alone = runBacktest({ ...args, calcParams: v.calc });
        assert.deepEqual(swept.sweep[k + 1].taken, alone.taken.summary, JSON.stringify(v.calc));
        assert.deepEqual(swept.sweep[k + 1].filtered, alone.filtered.summary);
    });
    assert.equal(swept.params.calc.scoring.momentum, 2, 'main report keeps the base values');
    assert.equal(swept.sweep[3].params.calc.evaluation.expiry_candles, 8);
});

test('sweep: each variant equals a separate run with those parameters; the base is not replayed twice', () => {
    const args = { market: 'BTCUSDT', candlesByTf: history(10), roles: testConfig.TF_ROLES, weights: testConfig.TF_WEIGHTS, indicators: bullish, startSec: NOW - 10 * 86400 };
    const plain = runBacktest(args);
    assert.equal(plain.sweep, null);
    const swept = runBacktest({ ...args, variants: [{ threshold: 5 }, { threshold: 6 }, { min_rr: 0 }, { weights: { '15m': 4 } }] });
    assert.equal(swept.sweep.length, 4, 'threshold 5 equals the base');
    assert.equal(swept.sweep[0].base, true);
    assert.deepEqual(swept.taken, plain.taken, 'main report unchanged by the sweep');

    const cases = [[1, { threshold: 6 }], [2, { minRiskReward: 0 }], [3, { weights: { ...testConfig.TF_WEIGHTS, '15m': 4 } }]];
    for (const [idx, over] of cases) {
        const alone = runBacktest({ ...args, ...over });
        assert.deepEqual(swept.sweep[idx].taken, alone.taken.summary);
        assert.deepEqual(swept.sweep[idx].filtered, alone.filtered.summary);
    }
    assert.equal(swept.sweep[2].params.min_rr, 0);
    assert.equal(swept.sweep[3].params.weights['15m'], 4);
});

test('breakdown: every dimension splits the trades; filtered trades count once per filter', () => {
    const report = runBacktest({ market: 'BTCUSDT', candlesByTf: history(10), roles: testConfig.TF_ROLES, weights: testConfig.TF_WEIGHTS, indicators: bullish, startSec: NOW - 10 * 86400 });
    for (const group of ['taken', 'filtered']) {
        const b = report[group].breakdown;
        const total = report[group].summary.trades;
        for (const dim of ['side', 'score', 'regime', 'context', 'market_energy', 'fake_breakout_risk', 'session_utc']) {
            if (!total) continue;
            assert.equal(b[dim].reduce((a, r) => a + r.trades, 0), total, `${group}/${dim}`);
        }
    }
    const t = (filters, result, net_r) => ({ signal: 'BUY', score: 5, filtered: true, filters, result, net_r, closed_at: 1, features: {} });
    const f = breakdown([t(['low_rr'], 'WIN', 1), t(['low_rr', 'no_mans_land'], 'LOSS', -1)]).filter;
    assert.deepEqual(f.map(r => [r.value, r.trades]), [['low_rr', 2], ['no_mans_land', 1]]);
    assert.equal(breakdown([{ ...t([], 'WIN', 1), filtered: false }]).filter, undefined);
});

test('setup variants: fixed target, SL buffer, side and energy skips', () => {
    const args = { market: 'BTCUSDT', candlesByTf: history(10), roles: testConfig.TF_ROLES, weights: testConfig.TF_WEIGHTS, indicators: bullish, startSec: NOW - 10 * 86400, model: 'bounce' };
    const report = runBacktest({ ...args, variants: [{ target: 2, min_rr: 0 }, { side: 'sell' }, { skip_energy: ['explosive', 'building', 'stable', 'cooling'] }, { stop_atr: 1 }] });
    const [base, fixed, sell, noEnergy, wide] = report.sweep;
    assert.equal(base.params.target, 'tp1');
    assert.equal(base.params.side, 'both');
    assert.ok(base.taken.trades + base.filtered.trades > 0);
    assert.equal(sell.taken.trades + sell.filtered.trades, 0, 'forced setup is bullish: no SELL candidates');
    assert.equal(noEnergy.taken.trades + noEnergy.filtered.trades, 0, 'every energy skipped');
    assert.ok(fixed.taken.trades > 0);
    assert.equal(wide.params.stop_atr, 1);

    const alone = runBacktest({ ...args, threshold: 5 });
    const fixedRun = runBacktest({ ...args, variants: [{ target: 2, min_rr: 0 }] });
    assert.deepEqual(fixedRun.sweep[1].taken, fixed.taken);
    assert.deepEqual(alone.taken.summary, base.taken);
});

test('validation: taken trades split at splitSec; pick = best in-sample expectancy with enough trades', () => {
    const args = { market: 'BTCUSDT', candlesByTf: history(10), roles: testConfig.TF_ROLES, weights: testConfig.TF_WEIGHTS, indicators: bullish, startSec: NOW - 10 * 86400 };
    assert.equal(runBacktest(args).validation, null);
    const splitSec = NOW - 4 * 86400;
    const report = runBacktest({ ...args, variants: [{ threshold: 6 }, { min_rr: 0 }], splitSec });
    const v = report.validation;
    assert.equal(v.split_at, splitSec);
    assert.equal(v.rows.length, 3);
    assert.equal(v.rows[0].base, true);
    const taken = report.trades.filter(t => !t.filtered);
    assert.deepEqual(v.rows[0].in_sample, metrics(taken.filter(t => t.time < splitSec)).summary);
    assert.deepEqual(v.rows[0].out_of_sample, metrics(taken.filter(t => t.time >= splitSec)).summary);
    const eligible = v.rows.map((r, i) => [r, i]).filter(([r]) => r.in_sample.trades >= VALIDATION_MIN_TRADES && r.in_sample.expectancy_r !== null);
    const best = eligible.sort((a, b) => b[0].in_sample.expectancy_r - a[0].in_sample.expectancy_r)[0];
    assert.equal(v.selected, best ? best[1] : null);
});

test('CLI --sweep: combinations, validation and limits', () => {
    const tfs = ['1d', '4h', '1h', '15m'];
    const a = parseArgs(['btcusdt', '--sweep', 'threshold=4,5', '--sweep', 'w_15m=1,2'], tfs);
    assert.equal(a.market, 'BTCUSDT');
    assert.deepEqual(a.variants, [
        { threshold: 4, weights: { '15m': 1 } }, { threshold: 4, weights: { '15m': 2 } },
        { threshold: 5, weights: { '15m': 1 } }, { threshold: 5, weights: { '15m': 2 } },
    ]);
    assert.deepEqual(parseArgs([], tfs).variants, []);
    assert.deepEqual(parseArgs(['--sweep', 'htf_trend=off,htf+structure'], tfs).variants, [{ weights: {}, htf_trend: 'off' }, { weights: {}, htf_trend: 'htf+structure' }]);
    assert.throws(() => parseArgs(['--sweep', 'htf_trend=on'], tfs), /htf\+structure/);
    assert.throws(() => parseArgs(['--sweep', 'w_5m=1'], tfs), /w_<tf>/);
    assert.throws(() => parseArgs(['--sweep', 'threshold=4.5'], tfs), /integers/);
    assert.throws(() => parseArgs(['--sweep', 'threshold=4', '--sweep', 'threshold=5'], tfs), /once/);
    assert.equal(parseArgs(['--split', '0.7'], tfs).split, 0.7);
    assert.equal(parseArgs([], tfs).split, null);
    assert.throws(() => parseArgs(['--split', '0.95'], tfs), /0.5 and 0.9/);
    // Defaults come from the calculation config's backtest group; --split none turns validation off.
    const fromCfg = parseArgs([], tfs, { days: 200, fee_pct: 0.1, split: 0.7 });
    assert.deepEqual([fromCfg.days, fromCfg.fee, fromCfg.split], [200, 0.1, 0.7]);
    assert.equal(parseArgs(['--split', 'none'], tfs, { days: 200, fee_pct: 0.1, split: 0.7 }).split, null);
    assert.equal(parseArgs(['--fee', '0'], tfs, { days: 200, fee_pct: 0.1, split: 0.7 }).fee, 0);
    const many = Array.from({ length: 13 }, (_, i) => i + 1).join(',');
    const rrs = Array.from({ length: 13 }, (_, i) => i * 0.5).join(',');
    assert.throws(() => parseArgs(['--sweep', `threshold=${many}`, '--sweep', `min_rr=${rrs}`], tfs), /max 144/);
    const setup = parseArgs(['--sweep', 'target=tp1,tp2,1.5', '--sweep', 'side=sell', '--sweep', 'skip_energy=none,explosive+building', '--sweep', 'stop_atr=1'], tfs);
    assert.deepEqual(setup.variants[0], { target: 'tp1', side: 'sell', skip_energy: [], stop_atr: 1, weights: {} });
    assert.deepEqual(setup.variants[1].skip_energy, ['building', 'explosive']);
    assert.equal(setup.variants.length, 6);
    assert.throws(() => parseArgs(['--sweep', 'target=tp3'], tfs), /tp1, rr_zone, tp2/);
    assert.deepEqual(parseArgs(['--sweep', 'target=tp1,rr_zone'], tfs).variants.map(v => v.target), ['tp1', 'rr_zone']);
    assert.deepEqual(parseArgs(['--sweep', 'scoring.near_zone=1,3', '--sweep', 'evaluation.expiry_candles=192'], tfs).variants, [
        { weights: {}, calc: { scoring: { near_zone: 1 }, evaluation: { expiry_candles: 192 } } },
        { weights: {}, calc: { scoring: { near_zone: 3 }, evaluation: { expiry_candles: 192 } } },
    ]);
    assert.deepEqual(parseArgs(['--sweep', 'scoring.breakout_confirmed=weak'], tfs).variants[0].calc, { scoring: { breakout_confirmed: 'weak' } });
    assert.throws(() => parseArgs(['--sweep', 'scoring.near_zone=1.5'], tfs), /integers 0–10/);
    assert.throws(() => parseArgs(['--sweep', 'evaluation.min_trades=10'], tfs), /<group>.<key>/);
    assert.throws(() => parseArgs(['--sweep', 'signal.threshold=4'], tfs), /<group>.<key>/);
    assert.throws(() => parseArgs(['--sweep', 'side=long'], tfs), /both, buy or sell/);
    assert.throws(() => parseArgs(['--sweep', 'skip_energy=hot'], tfs), /none or/);
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
    assert.ok(fs.readdirSync(path.join(dir, 'BTCUSDT', '1h')).length > 0);
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

test('CLI --roles: entry, mid, structure, htf for one run', () => {
    const { rolesOption } = require('../scripts/backtest');
    assert.deepEqual(rolesOption(['BTCUSDT', '--roles', '1h,4h,1d,1w', '--days', '30']), {
        roles: { entry: '1h', mid: '4h', structure: '1d', htf: '1w' }, rest: ['BTCUSDT', '--days', '30'],
    });
    assert.deepEqual(rolesOption(['BTCUSDT']).roles, null);
    assert.throws(() => rolesOption(['--roles', '1h,4h']), /ENTRY,MID,STRUCTURE,HTF/);
});

test('next_open entry fills at the next open and measures the risk from there', () => {
    const candles = history(10);
    const args = { market: 'BTCUSDT', candlesByTf: candles, roles: testConfig.TF_ROLES, weights: testConfig.TF_WEIGHTS, indicators: bullish, startSec: NOW - 10 * 86400, model: 'bounce' };
    const report = runBacktest({ ...args, entryMode: 'next_open', target: 2, minRiskReward: 0 });
    const entry = candles['15m'];
    assert.equal(report.params.entry, 'next_open');
    assert.ok(report.trades.length > 0);
    for (const tr of report.trades) {
        const i = entry.findIndex(c => c.close_time === tr.time);
        assert.equal(tr.price, entry[i + 1].open);
        assert.equal(tr.risk_reward, +(Math.abs(tr.tp1 - tr.price) / Math.abs(tr.price - tr.sl)).toFixed(2));
    }
});

test('slippage is a cost on top of the fee', () => {
    const args = { market: 'BTCUSDT', candlesByTf: history(10), roles: testConfig.TF_ROLES, weights: testConfig.TF_WEIGHTS, indicators: bullish, startSec: NOW - 10 * 86400, model: 'bounce' };
    const both = runBacktest({ ...args, feePct: 0.2, slippagePct: 0.05 });
    const fee = runBacktest({ ...args, feePct: 0.25 });
    assert.deepEqual(both.trades.map(t => t.net_r), fee.trades.map(t => t.net_r));
    assert.equal(both.params.slippage_pct, 0.05);
});

test('a candle that opens beyond the stop fills at its open and costs more than 1 R', () => {
    const buy = { signal: 'BUY', price: 100, sl: 90, tp1: 120, risk_reward: 2, candle_time: 0, candle_close_time: 900 };
    const candle = { time: 900, close_time: 1800, close: 80 };
    assert.equal(evaluate(buy, [{ ...candle, open: 80, high: 85, low: 75 }]).rr, -2);
    assert.equal(evaluate(buy, [{ ...candle, open: 95, high: 96, low: 85 }]).rr, -1);
    assert.equal(evaluate({ ...buy, signal: 'SELL', sl: 110, tp1: 80 }, [{ ...candle, open: 120, high: 125, low: 115 }]).rr, -2);
});

test('the trailing stop follows the best price, never moves back and is not set by its own candle', () => {
    const buy = { signal: 'BUY', price: 100, sl: 90, tp1: 120, candle_time: 0, candle_close_time: 900 };
    const c = (i, open, high, low, close) => ({ time: 900 * (i + 1), close_time: 900 * (i + 2), open, high, low, close });
    // High 120 lifts the stop to 110 for the next candle; 108 then hits it at 110.
    assert.deepEqual(evaluateTrailing(buy, [c(0, 100, 120, 99, 118), c(1, 118, 119, 108, 109)], 96, 10), { result: 'WIN', rr: 1, closed_at: 2700, bars: 2 });
    // A candle touching 120 and 95 in one bar: the stop in force is still 90, so it survives.
    assert.equal(evaluateTrailing(buy, [c(0, 100, 120, 95, 118)], 96, 10), null);
    // The stop never moves back after the price falls.
    const held = evaluateTrailing(buy, [c(0, 100, 130, 99, 125), c(1, 125, 126, 121, 122), c(2, 122, 123, 119, 120)], 96, 10);
    assert.deepEqual([held.result, held.rr, held.bars], ['WIN', 2, 3]);
    // Below the entry it is a loss; at expiry the close decides.
    assert.equal(evaluateTrailing(buy, [c(0, 100, 101, 89, 90)], 96, 10).result, 'LOSS');
    assert.deepEqual(evaluateTrailing(buy, [c(0, 100, 105, 99, 104)], 1, 10), { result: 'EXPIRED', rr: 0.4, closed_at: 1800, bars: 1 });
    // The mirror for a short.
    const sell = { signal: 'SELL', price: 100, sl: 110, tp1: 80, candle_time: 0, candle_close_time: 900 };
    assert.deepEqual(evaluateTrailing(sell, [c(0, 100, 101, 80, 82), c(1, 82, 92, 81, 91)], 96, 10), { result: 'WIN', rr: 1, closed_at: 2700, bars: 2 });
});

test('walk-forward picks each period from the earlier ones only', () => {
    const trade = (time, net_r) => ({ time, net_r, closed_at: time + 1, result: net_r > 0 ? 'WIN' : 'LOSS', filtered: false });
    // Variant A wins early and loses late, B the opposite. B has the better last period, but A still
    // leads on everything before it, so A is picked and its loss in that period counts.
    const span = 400;
    const a = []; const b = [];
    for (let t = 0; t < span; t++) { a.push(trade(t, t < 200 ? 1 : -1)); b.push(trade(t, t < 200 ? -1 : 1)); }
    const wf = walkForward([{ trades: a }, { trades: b }], 0, span, 3, 30);
    assert.deepEqual(wf.rows.map(r => r.selected), [0, 0, 0]);
    assert.deepEqual(wf.rows.map(r => r.test.expectancy_r), [1, -1, -1]);
    assert.equal(wf.rows.length, 3);
    assert.equal(wf.judged_folds, 3);
    assert.equal(wf.test.trades, 300);
    // Too few earlier trades: the period is left out instead of guessed.
    const thin = walkForward([{ trades: a.slice(0, 5) }], 0, span, 3, 30);
    assert.deepEqual([thin.rows[0].selected, thin.judged_folds, thin.ci95], [null, 0, null]);
});

test('the expectancy interval is repeatable and contains the mean', () => {
    const rs = Array.from({ length: 200 }, (_, i) => (i % 3 ? -1 : 2.2));
    const [low, high] = expectancyInterval(rs);
    assert.deepEqual(expectancyInterval(rs), [low, high]);
    const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
    assert.ok(low < mean && mean < high);
    assert.equal(expectancyInterval([1]), null);
});

test('each written report leaves a summary line for later comparison', async () => {
    const reports = createReports({ dir: fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-signal-runs-')) });
    assert.deepEqual(await reports.history('BTCUSDT'), []);
    const report = (hash, generated_at) => ({ generated_at, config_hash: hash, roles: {}, period: {}, params: { model: 'trend_pullback', fee_pct: 0.2, slippage_pct: 0.05, exit: 'fixed' }, taken: { summary: { trades: 3 }, ci95: [-1, 1] }, sweep: null, validation: null, walk_forward: null });
    await reports.write('BTCUSDT', report('aaa', 1));
    await reports.write('BTCUSDT', report('bbb', 2));
    const runs = await reports.history('BTCUSDT');
    assert.deepEqual(runs.map(r => r.config_hash), ['bbb', 'aaa']);
    assert.deepEqual([runs[0].fee_pct, runs[0].slippage_pct, runs[0].ci95], [0.2, 0.05, [-1, 1]]);
    assert.equal((await reports.read('BTCUSDT')).config_hash, 'bbb', 'the latest report is unchanged');
});

test('CLI options: slippage, entry, folds and offline', () => {
    const tfs = testConfig.TIMEFRAMES;
    const cfg = { days: 200, fee_pct: 0.2, slippage_pct: 0.05, entry: 'next_open', split: 0.7, folds: 6 };
    const a = parseArgs([], tfs, cfg);
    assert.deepEqual([a.slippage, a.entry, a.folds, a.offline], [0.05, 'next_open', 6, false]);
    const b = parseArgs(['--slippage', '0.1', '--entry', 'close', '--folds', 'none', '--offline'], tfs, cfg);
    assert.deepEqual([b.slippage, b.entry, b.folds, b.offline], [0.1, 'close', null, true]);
    assert.throws(() => parseArgs(['--entry', 'mid'], tfs, cfg), /close or next_open/);
    assert.throws(() => parseArgs(['--folds', '1'], tfs, cfg), /2–12/);
    assert.deepEqual(parseArgs(['--sweep', 'exit=fixed,trailing', '--sweep', 'trail_atr=2,4'], tfs, cfg).variants.length, 4);
});

