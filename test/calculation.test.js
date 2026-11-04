const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createCalcConfig, validate, defaultsOf, signalOptions } = require('../src/config/calculation');
const { computeSignal, tradeFilters, tradePlan } = require('../src/services/signal');
const { silentLog, testConfig } = require('./helpers');

const tempFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'calc-')), 'config', 'calculation.json');

test('a missing file is created with the defaults, env weights included', () => {
    const file = tempFile();
    const calc = createCalcConfig({ file, envWeights: { ...testConfig.TF_WEIGHTS, '4h': 2.5 }, log: silentLog });
    assert.deepEqual(calc.load(), { loaded: true, changed: false });
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    assert.equal(saved.signal.threshold, 5);
    assert.equal(saved.weights['4h'], 2.5);
    assert.equal(saved.weights.DEFAULT, undefined);
    assert.equal(calc.weights().DEFAULT, 1);
});

test('validate merges partial input and rejects unknown keys and out-of-range values', () => {
    const base = defaultsOf(testConfig.TF_WEIGHTS);
    const ok = validate({ signal: { threshold: 6 }, weights: { '30m': 1.2 } }, base);
    assert.deepEqual(ok.problems, []);
    assert.equal(ok.value.signal.threshold, 6);
    assert.equal(ok.value.signal.min_rr, 1.5);
    assert.equal(ok.value.weights['30m'], 1.2);

    const bad = validate({ signal: { threshold: 4.5, min_rr: '2' }, weights: { '7m': 1, '1h': 0 }, extra: {}, backtest: { split: 0.95 } }, base);
    assert.deepEqual(bad.problems, [
        'signal.threshold must be an integer 1–15',
        'signal.min_rr must be a number 0–10',
        'unknown key weights.7m',
        'weights.1h must be a number 0.1–20',
        'unknown group extra',
        'backtest.split must be a number 0.5–0.9',
    ]);
    assert.deepEqual(validate([], base).problems, ['config must be a JSON object']);
    assert.equal(base.filters.htf_trend, 'off');
    assert.deepEqual([base.signal.target, base.filters.entry_max_atr], ['tp1', 0]);
    assert.deepEqual(validate({ signal: { target: 'fixed' }, filters: { entry_max_atr: 11 } }, base).problems,
        ['signal.target must be one of tp1, rr_zone, tp2', 'filters.entry_max_atr must be a number 0–10']);
    assert.equal(validate({ filters: { htf_trend: 'htf+structure' } }, base).value.filters.htf_trend, 'htf+structure');
    assert.deepEqual(validate({ filters: { htf_trend: 'on' } }, base).problems, ['filters.htf_trend must be one of off, htf, htf+structure']);
});

test('update saves and notifies; invalid hand edits keep the values in use', () => {
    const file = tempFile();
    const calc = createCalcConfig({ file, envWeights: testConfig.TF_WEIGHTS, log: silentLog });
    calc.load();
    const seen = [];
    calc.onChange(cfg => seen.push(cfg.signal.threshold));

    assert.ok(calc.update({ signal: { threshold: 20 } }).problems);
    const res = calc.update({ signal: { threshold: 6 } });
    assert.equal(res.changed, true);
    assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).signal.threshold, 6);
    assert.deepEqual(seen, [6]);
    assert.equal(calc.update({ signal: { threshold: 6 } }).changed, false);
    // A partial update keeps the other values in use.
    calc.update({ filters: { volatility_dead: 0.4 } });
    assert.equal(calc.get().signal.threshold, 6);
    assert.deepEqual(seen, [6, 6]);

    fs.writeFileSync(file, '{ broken');
    assert.equal(calc.load().error, 'invalid_json');
    fs.writeFileSync(file, JSON.stringify({ signal: { threshold: 99 } }));
    assert.equal(calc.load().error, 'invalid_config');
    assert.equal(calc.get().signal.threshold, 6);

    fs.writeFileSync(file, JSON.stringify({ signal: { threshold: 7 } }));
    assert.deepEqual(calc.load(), { loaded: true, changed: true });
    assert.equal(calc.get().signal.threshold, 7);
    assert.equal(calc.get().signal.min_rr, 1.5);
    assert.deepEqual(seen, [6, 6, 7]);
});

test('signal options change the score threshold, filters and plan', () => {
    const cfg = defaultsOf(testConfig.TF_WEIGHTS);
    cfg.signal.model = 'bounce';
    const state = {
        status: 'ok', price: 100, context: 'near_support', momentum: 'bullish', volume_state: 'high', volatility_ratio: 2.5,
        distance_percent: { to_support: 0.5, to_resistance: 5 },
        indicators: { atr: 1 },
        levels: { support: [{ low: 98, high: 99, mid: 98.5, tfs: ['15m'] }], resistance: [{ low: 109, high: 111, mid: 110, tfs: ['1h'] }] },
    };
    // Score 2 + 2 + 1 = 5: a BUY at the default threshold, rejected by volatility_extreme (2.5 > 2).
    assert.deepEqual(computeSignal(state, '1d', signalOptions(cfg)).filters, ['volatility_extreme']);
    cfg.filters.volatility_extreme = 3;
    assert.equal(computeSignal(state, '1d', signalOptions(cfg)).action, 'BUY');
    cfg.signal.threshold = 6;
    assert.equal(computeSignal(state, '1d', signalOptions(cfg)).action, 'WAIT');

    assert.deepEqual(tradeFilters({ context: 'mid_range', distance_percent: { to_support: 2, to_resistance: 3 } }, 'BUY', { noMansLand: 2.5 }), []);
    const plan = tradePlan(state, 'BUY', '1d', { stopAtr: 1, trailingAtr: 3 });
    assert.equal(plan.stop_loss, 97);
    assert.equal(plan.trailing_stop, 97);
});
