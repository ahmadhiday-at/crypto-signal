const test = require('node:test');
const assert = require('node:assert/strict');
const { validateMarketState, validateSnapshot, SCHEMA_VERSION } = require('../src/services/contract');

const lvl = { low: 1, high: 2, mid: 1.5, touches: 2, score: 10, score_raw: 5, tfs: ['1h'] };
const valid = () => ({
    schema_version: 2, market: 'BTCUSDT', timeframe: 'multitimeframe', timeframe_list: ['1d', '4h', '1h', '15m'],
    price: 100, context: 'mid_range', momentum: 'neutral', regime: 'ranging',
    ohlcv: { time: 1, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3 },
    indicators: { ma14: 1, ma50: 1, ma200: 1, rsi: 50, atr: 1, volume: 3, macd: { MACD: 0, signal: 0, histogram: 0 } },
    levels: { support: [lvl], resistance: [lvl] },
    timestamp: 1, timeframes: { '15m': { price: 100, context: 'mid_range', momentum: 'neutral', regime: 'ranging', timestamp: 1 } },
    position: 'mid_range', zone_state: 'normal', dominant_side: 'equilibrium', market_pressure: 'balanced', market_energy: 'stable',
    breakout_score: 0.5, breakout_confirmation: 'none', volume_state: 'normal', setup_state: 'no_trade', fake_breakout_risk: 'low',
    regime_global: 'ranging', distance: { to_support: 0.01, to_resistance: 0.02 }, distance_percent: { to_support: 1, to_resistance: 2 },
    generated_at: 10,
    inputs: Object.fromEntries(['1d', '4h', '1h', '15m'].map(tf => [tf, { candle_close_time: 1, age_seconds: 9, status: 'ok' }])),
    status: 'ok', errors: [],
    volatility_ratio: 1.1,
    divergence: 'none',
    signal: { action: 'WAIT', score: 2, strength: 'weak', reasons: [{ code: 'near_support', points: 2 }], filtered: false, filters: [], plan: null },
});

test('a complete v2 market state is valid', () => {
    assert.equal(SCHEMA_VERSION, 2);
    assert.deepEqual(validateMarketState(valid()), []);
});

test('rejects missing fields, wrong versions, invalid enums and non-finite numbers', () => {
    const mutate = (fn) => { const s = valid(); fn(s); return validateMarketState(s); };
    assert.ok(mutate(s => { delete s.schema_version; }).length > 0, 'v1 objects are not v2');
    assert.ok(mutate(s => { s.setup_state = 'breakout_ready'; }).some(e => e.includes('setup_state')));
    assert.ok(mutate(s => { s.status = 'fine'; }).some(e => e.includes('status')));
    assert.ok(mutate(s => { s.price = NaN; }).some(e => e.includes('price')));
    assert.ok(mutate(s => { s.breakout_score = 1.5; }).some(e => e.includes('breakout_score')));
    assert.ok(mutate(s => { s.indicators.rsi = null; }).some(e => e.includes('rsi')));
    assert.ok(mutate(s => { s.levels.support = []; }).some(e => e.includes('levels.support')));
    assert.ok(mutate(s => { delete s.inputs['1h']; }).some(e => e.includes('inputs.1h')));
    assert.ok(mutate(s => { s.errors = [1]; }).some(e => e.includes('errors')));
    assert.ok(mutate(s => { delete s.signal; }).some(e => e.includes('signal')));
    assert.ok(mutate(s => { s.signal.action = 'HOLD'; }).some(e => e.includes('signal.action')));
    assert.ok(mutate(s => { s.signal.reasons = [{ code: 'gut_feeling', points: 1 }]; }).some(e => e.includes('signal.reasons')));
    assert.ok(mutate(s => { s.signal.filters = ['vibes']; s.signal.filtered = true; }).some(e => e.includes('signal.filters')));
    assert.ok(mutate(s => { s.signal.filtered = true; }).some(e => e.includes('signal.filtered')));
    assert.ok(mutate(s => { delete s.volatility_ratio; }).some(e => e.includes('volatility_ratio')));
    assert.deepEqual(mutate(s => { s.volatility_ratio = null; }), [], 'null ratio is allowed');
    assert.ok(mutate(s => { s.divergence = 'hidden'; }).some(e => e.includes('divergence')));
    const plan = { side: 'long', entry_zone: [1, 2], stop_loss: 0.5, take_profit_1: 3, take_profit_2: null, risk_reward: 2, trailing_stop: 1 };
    assert.deepEqual(mutate(s => { s.signal.plan = plan; }), [], 'valid plan');
    assert.ok(mutate(s => { s.signal.plan = { ...plan, entry_zone: [2, 1] }; }).some(e => e.includes('entry_zone')));
    assert.ok(mutate(s => { s.signal.plan = { ...plan, side: 'up' }; }).some(e => e.includes('plan')));
    assert.ok(mutate(s => { delete s.signal.plan; }).some(e => e.includes('plan')), 'plan must be present (null allowed)');
    assert.deepEqual(validateMarketState(null), ['market state is not an object']);
});

test('fallback levels without touches are allowed', () => {
    const s = valid();
    s.levels.support = [{ ...lvl, touches: undefined }];
    delete s.levels.support[0].touches;
    assert.deepEqual(validateMarketState(s), []);
});

test('validateSnapshot checks identity and candle close time', () => {
    const snap = {
        market: 'BTCUSDT', timeframe: '15m', candle_close_time: 900, price: 1, context: 'mid_range', momentum: 'neutral', regime: 'ranging',
        candles: [{ time: 0, close_time: 900 }], indicators: {}, support: [], resistance: [],
    };
    assert.deepEqual(validateSnapshot(snap, 'BTCUSDT', '15m'), []);
    assert.ok(validateSnapshot(snap, 'ETHUSDT', '15m').length > 0);
    assert.ok(validateSnapshot({ ...snap, candle_close_time: 1800 }, 'BTCUSDT', '15m').length > 0);
    assert.ok(validateSnapshot({ ...snap, candle_close_time: undefined }, 'BTCUSDT', '15m').length > 0, 'legacy snapshot');
});
