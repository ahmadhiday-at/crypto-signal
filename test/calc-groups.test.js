// Calculation config groups added in 2.18.0: scoring, indicators, zones, market, divergence and
// evaluation. Defaults must reproduce the previous hardcoded behaviour; changed values must reach
// the calculation.
const test = require('node:test');
const assert = require('node:assert/strict');
const { createMarketEngine, enhanceMarketState } = require('../src/services/market.service');
const indicators = require('../src/services/indicator.service');
const { computeSignal, tradeFilters } = require('../src/services/signal');
const { detectDivergence } = require('../src/services/divergence');
const { evaluate } = require('../src/services/signal-log');
const { validate, defaultsOf, snapshotChanged } = require('../src/config/calculation');
const { parseKlines } = require('../src/services/candles');
const { rawKlines, fakeBinance, tempStorage, testConfig, silentLog } = require('./helpers');

// The CLI reads its default market from the config that applyEngine fills at startup.
require('../src/config/env').MARKETS = testConfig.MARKETS;

const MIDNIGHT = Date.UTC(2026, 9, 29) / 1000;
const closed = (count = 300) => parseKlines(rawKlines({ tf: '1h', nowSec: MIDNIGHT, count, includeForming: false }), '1h').candles;

test('defaults are valid and match the previous constants', () => {
    const d = defaultsOf();
    assert.deepEqual(validate({}, d).problems, []);
    assert.deepEqual(d.scoring, { near_zone: 2, momentum: 2, htf_zone: 3, divergence: 2, volume: 1, strong_score: 7, breakout_confirmed: 'medium' });
    assert.equal(d.indicators.ma_slow, 200);
    assert.equal(d.indicators.min_candles, 200);
    assert.equal(d.zones.cluster_percent, 0.5);
    assert.equal(d.market.volume_high, 1.5);
    assert.deepEqual(d.divergence, { lookback: 60, pivot_width: 3, max_age: 10 });
    assert.deepEqual(d.evaluation, { expiry_candles: 96, min_trades: 30 });
    const candles = closed();
    assert.deepEqual(indicators.calculateAll(candles, 'BTCUSDT', '1h', {}, { indicators: d.indicators, zones: d.zones }),
        indicators.calculateAll(candles, 'BTCUSDT', '1h'), 'explicit defaults = no params');
});

test('cross-key rules and candle limit', () => {
    const d = defaultsOf();
    const problems = (input, opts) => validate(input, d, opts).problems;
    assert.deepEqual(problems({ indicators: { ma_fast: 60 } }), ['indicators: ma_fast < ma_mid < ma_slow is required']);
    assert.deepEqual(problems({ indicators: { ma_slow: 300 } }), ['indicators.min_candles must be at least 300 (the longest indicator period)']);
    assert.deepEqual(problems({ engine: { candle_limit: 500 }, indicators: { min_candles: 600 } }), ['indicators.min_candles must be at most 499 (engine.candle_limit − 1)']);
    assert.deepEqual(problems({ market: { volume_low: 1.3 } }), ['market: volume_low < volume_increasing < volume_high is required']);
    assert.deepEqual(problems({ scoring: { near_zone: 1.5 } }), ['scoring.near_zone must be an integer 0–10']);
    assert.deepEqual(problems({ divergence: { pivot_width: 6, lookback: 12 } }), ['divergence: pivot_width × 2 < lookback is required']);
    assert.equal(snapshotChanged({ ...d, zones: { ...d.zones, width_atr: 1 } }, d), true);
    assert.equal(snapshotChanged({ ...d, market: { ...d.market, volume_high: 2 } }, d), false);
});

test('indicator and zone params change the snapshot', () => {
    const candles = closed();
    const base = indicators.calculateAll(candles, 'BTCUSDT', '1h');
    const rsi7 = indicators.calculateAll(candles, 'BTCUSDT', '1h', {}, { indicators: { rsi_period: 7 } });
    assert.notDeepEqual(rsi7.indicators.rsi, base.indicators.rsi);
    // Zig-zag between 95 and 105: swing zones on both sides of price 100, half-width = width_atr × ATR.
    const zigzag = Array.from({ length: 60 }, (_, i) => {
        const mid = i % 10 === 5 ? 105 : i % 10 === 0 ? 95 : 100;
        return { time: i, open: mid, high: mid + 0.5, low: mid - 0.5, close: mid };
    });
    const { ZONE_DEFAULTS } = indicators;
    const half = (zp) => { const l = indicators.calculateSRLevels(zigzag, 100, 1, null, null, 60, zp).support[0]; return (l.high - l.low) / 2; };
    assert.equal(half(ZONE_DEFAULTS), 0.5);
    assert.equal(half({ ...ZONE_DEFAULTS, width_atr: 2, max_width_percent: 50 }), 2);
    assert.throws(() => indicators.calculateAll(candles, 'BTCUSDT', '1h', {}, { indicators: { min_candles: 400 } }), /need at least 400/);
});

test('score points, strong score and breakout confirmation level', () => {
    const state = {
        status: 'ok', context: 'near_support', momentum: 'bullish', volume_state: 'normal', volatility_ratio: 1, breakout_confirmation: 'none',
        price: 100, indicators: { atr: 1 }, distance_percent: { to_support: 0.4, to_resistance: 9 },
        levels: { support: [{ low: 98, high: 99.5, mid: 98.75, score: 10, tfs: ['1h'] }], resistance: [{ low: 109, high: 110, mid: 109.5, score: 10, tfs: ['15m'] }] },
    };
    assert.equal(computeSignal(state, '1d', { model: 'bounce' }).score, 4);
    const sig = computeSignal(state, '1d', { model: 'bounce', scoring: { near_zone: 3, momentum: 4, strong_score: 6 } });
    assert.deepEqual([sig.score, sig.strength, sig.action], [7, 'strong', 'BUY']);
    const intoRes = { context: 'near_resistance', breakout_confirmation: 'weak' };
    assert.deepEqual(tradeFilters(intoRes, 'BUY'), ['buy_into_resistance']);
    assert.deepEqual(tradeFilters(intoRes, 'BUY', { scoring: { breakout_confirmed: 'weak' } }), []);
});

test('market thresholds, divergence window and expiry', () => {
    const data = {
        price: 100, indicators: { volume: [...Array(19).fill(10), 13], macd: { histogram: 0.5 } }, timeframes: {},
        levels: { support: [{ low: 95, high: 96, mid: 95.5, score: 5 }], resistance: [{ low: 105, high: 106, mid: 105.5, score: 5 }] },
    };
    assert.equal(enhanceMarketState(data).volume_state, 'increasing');
    assert.equal(enhanceMarketState(data, { volume_increasing: 1.4, volume_high: 2 }).volume_state, 'normal');

    // A bullish divergence 20 bars back is too old by default (max_age 10).
    const n = 80;
    const candles = Array.from({ length: n }, (_, i) => ({ low: 100 - (i === 40 ? 10 : i === 59 ? 12 : 0), high: 110 }));
    const rsi = Array.from({ length: n }, (_, i) => (i === 40 ? 20 : i === 59 ? 30 : 50));
    assert.equal(detectDivergence(candles, rsi), 'none');
    assert.equal(detectDivergence(candles, rsi, { max_age: 25 }), 'bullish');

    const record = { signal: 'BUY', price: 100, sl: 90, tp1: 120, risk_reward: 2, candle_time: 0, candle_close_time: 60 };
    const flat = Array.from({ length: 10 }, (_, i) => ({ time: 60 * (i + 1), close_time: 60 * (i + 2), low: 99, high: 101, close: 101 }));
    assert.equal(evaluate(record, flat), null, 'open under the default 96 candles');
    assert.deepEqual(evaluate(record, flat, 5), { result: 'EXPIRED', rr: 0.1, closed_at: 360, bars: 5 });
});

test('engine: an indicator change recalculates stored snapshots without fetching', async () => {
    const params = { indicators: {}, zones: {} };
    const calc = {
        weights: () => ({ ...testConfig.TF_WEIGHTS }), signalOptions: () => ({}),
        snapshotParams: () => params, stateParams: () => ({}),
    };
    const now = () => (MIDNIGHT + 5) * 1000;
    const binance = fakeBinance({ now });
    const storage = tempStorage();
    const engine = createMarketEngine({ storage, binance, indicators, config: testConfig, calc, now, log: silentLog });
    await engine.runBoundary(MIDNIGHT);
    const calls = binance.calls.length;
    const before = await storage.readSnapshot('BTCUSDT', '1h');

    params.indicators = { rsi_period: 7 };
    const res = await engine.recalculateAll();
    assert.deepEqual([...res.BTCUSDT.recalculated].sort(), ['15m', '1d', '1h', '4h']);
    assert.equal(binance.calls.length, calls, 'no Binance request');
    const after = await storage.readSnapshot('BTCUSDT', '1h');
    assert.equal(after.candle_close_time, before.candle_close_time);
    assert.notDeepEqual(after.indicators.rsi, before.indicators.rsi);
    assert.equal((await engine.getMarketState('BTCUSDT')).httpStatus, 200);
});

test('trend group and model: defaults, channel field and backtest sweep key', () => {
    const d = defaultsOf();
    assert.equal(d.signal.model, 'trend_pullback');
    assert.equal(d.trend.stop_atr, 3);
    assert.equal(d.backtest.days, 1095);
    assert.equal(d.backtest.fee_pct, 0.2);
    assert.equal(d.trend.channel_candles, 20);
    assert.deepEqual(validate({ signal: { model: 'scalp' } }, d).problems, ['signal.model must be one of bounce, trend_pullback, breakout']);
    const { mergeSnapshots } = require('../src/services/market.service');
    const candles = Array.from({ length: 30 }, (_, i) => ({ high: 100 + i, low: 90 + i }));
    const snap = { price: 129, indicators: {}, candles, support: [], resistance: [] };
    const roles = { htf: '1d', structure: '1d', mid: '1d', entry: '1d' };
    assert.deepEqual(mergeSnapshots('BTCUSDT', { '1d': snap }, roles, { DEFAULT: 1 }, { trend: { channel_candles: 5 } }).raw.channel, { high: 128, low: 114, candles: 5 });
    const { parseArgs } = require('../scripts/backtest');
    assert.deepEqual(parseArgs(['--sweep', 'model=bounce,trend_pullback', '--sweep', 'trend.stop_atr=1.5,3'], ['1d']).variants.length, 4);
});

test('engine and lookback: defaults in the config, validated, applied at startup', () => {
    const d = defaultsOf();
    assert.deepEqual(d.engine, { markets: ['BTCUSDT', 'BNBUSDT', 'SOLUSDT'], timeframes: ['1w', '1d', '4h', '1h', '30m', '15m', '1m'], htf: '1w', structure: '1d', mid: '4h', entry: '1h', candle_limit: 1000 });
    assert.equal(d.lookback['15m'], 300);
    assert.equal(d.weights['1d'], 3);
    const problems = (input) => validate(input, d).problems;
    assert.deepEqual(problems({ engine: { entry: '4h', mid: '1h' } }), ['engine: htf ≥ structure ≥ mid ≥ entry timeframe is required']);
    assert.deepEqual(problems({ engine: { entry: '7m' } }), [`engine.entry must be one of ${Object.keys(require('../src/services/candles').TF_SECONDS).join(', ')}`]);
    assert.deepEqual(problems({ lookback: { '1h': 10 } }), ['lookback.1h must be an integer 20–1000']);
    assert.deepEqual(problems({ engine: { candle_limit: 201 } }), [], '200 closed candles fit');

    // Markets and timeframes: plain symbols and supported timeframes, no duplicates, never empty.
    assert.deepEqual(problems({ engine: { markets: ['BTCUSDT', 'ETHUSDT'], timeframes: ['1h', '15m'] } }), []);
    for (const markets of [[], 'BTCUSDT', ['btcusdt'], ['../etc'], ['BTC/USDT'], ['BTCUSDT', 'BTCUSDT'], [1], Array(21).fill(0).map((_, i) => `COIN${i}USDT`)]) {
        assert.equal(problems({ engine: { markets } }).length, 1, JSON.stringify(markets));
    }
    for (const timeframes of [[], '1h', ['7m'], ['1h', '1h']]) assert.equal(problems({ engine: { timeframes } }).length, 1, JSON.stringify(timeframes));
    // The shadow roles must be fetched, or the shadow log would pause.
    assert.deepEqual(problems({ engine: { timeframes: ['1h'] }, shadow: { entry: '15m' } }), ['shadow: 15m must be in engine.timeframes or the engine roles']);

    const { applyEngine, snapshotChanged, engineChanged } = require('../src/config/calculation');
    const config = { MARKETS: [], TIMEFRAMES: [], TF_ROLES: {} };
    let limit = null;
    const running = applyEngine(config, { setCandleLimit: (n) => { limit = n; } }, d);
    assert.deepEqual(config.MARKETS, d.engine.markets);
    assert.deepEqual(config.TIMEFRAMES, d.engine.timeframes);
    assert.deepEqual(config.TF_ROLES, { htf: '1w', structure: '1d', mid: '4h', entry: '1h' });
    assert.equal(limit, 1000);
    assert.equal(running.candle_limit, 1000);
    assert.equal(engineChanged({ ...d, engine: { ...d.engine, markets: ['BTCUSDT'] } }, d), true);
    assert.equal(snapshotChanged({ ...d, lookback: { '1h': 150 } }, d), true);
    assert.equal(engineChanged({ ...d, engine: { ...d.engine, entry: '15m' } }, d), true);

    // The lookback reaches the S/R calculation (scaled by the volatility band, so within ±20%).
    const seen = [];
    const original = indicators.calculateSRLevels;
    indicators.calculateSRLevels = function (...args) { seen.push(args[5]); return original.apply(this, args); };
    try {
        indicators.calculateAll(closed(), 'BTCUSDT', '1h', {}, { lookback: { '1h': 40 } });
        indicators.calculateAll(closed(), 'BTCUSDT', '1h');
    } finally {
        indicators.calculateSRLevels = original;
    }
    assert.ok(seen[0] >= 32 && seen[0] <= 48, `lookback 40 → ${seen[0]}`);
    assert.ok(seen[1] >= 160 && seen[1] <= 240, `default 200 → ${seen[1]}`);
});

test('shadow log: a second model on its own roles, logged apart from the live signal', async () => {
    const d = defaultsOf();
    assert.deepEqual(d.shadow, { enabled: 'on', model: 'bounce', htf: '1d', structure: '4h', mid: '1h', entry: '15m', stop_atr: 3, target_r: 2 });
    assert.deepEqual(validate({ shadow: { entry: '1d', mid: '4h' } }, d).problems, ['shadow: htf ≥ structure ≥ mid ≥ entry timeframe is required']);

    const { shadowOptions } = require('../src/config/calculation');
    const shadowCfg = { ...d, shadow: { ...d.shadow, htf: '1d', structure: '4h', mid: '1h', entry: '1h', model: 'breakout' } };
    const so = shadowOptions(shadowCfg);
    assert.deepEqual(so.roles, { htf: '1d', structure: '4h', mid: '1h', entry: '1h' });
    assert.deepEqual([so.signal.model, so.signal.trend.stop_atr, so.signal.entryTf], ['breakout', 3, '1h']);
    assert.equal(shadowOptions({ ...d, shadow: { ...d.shadow, enabled: 'off' } }), null);

    const calls = [];
    const shadowLog = { load: async () => {}, onSummary: async (m, state, candles) => calls.push({ m, state, candles }), records: async () => [] };
    const calc = {
        weights: () => ({ ...testConfig.TF_WEIGHTS }), signalOptions: () => ({}), snapshotParams: () => ({}), stateParams: () => ({}),
        shadowOptions: () => so,
    };
    const now = () => (MIDNIGHT + 5) * 1000;
    const engine = createMarketEngine({ storage: tempStorage(), binance: fakeBinance({ now }), indicators, config: testConfig, calc, shadowLog, now, log: silentLog });
    await engine.runBoundary(MIDNIGHT);
    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0].state.timeframe_list.sort(), ['1d', '1h', '4h']);
    assert.equal(calls[0].state.signal.reasons.every(r => r.code !== 'near_support'), true, 'breakout model, not bounce');
    const body = await engine.signalRecords('BTCUSDT', 'shadow');
    assert.deepEqual([body.source, body.model, body.latest.roles.entry], ['shadow', 'breakout', '1h']);
    assert.equal((await engine.getMarketState('BTCUSDT')).body.timeframe_list.includes('15m'), true, 'live state keeps its roles');
});
