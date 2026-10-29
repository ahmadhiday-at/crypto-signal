// Regression tests: the scoring formula in enhanceMarketState must stay unchanged. Expected values
// were produced by the original (pre-2.0.0) implementation for the same inputs.
const test = require('node:test');
const assert = require('node:assert/strict');
const { enhanceMarketState, mergeSnapshots } = require('../src/services/market.service');

const lvl = (low, high, score, tfs) => ({ low, high, mid: (low + high) / 2, touches: 3, score, tfs });

const cases = {
    compression: {
        input: { price: 100, levels: { support: [lvl(98, 101, 40, ['1d', '4h']), lvl(90, 92, 10, ['1h'])], resistance: [lvl(99.5, 102, 20, ['15m'])] }, indicators: { volume: [...Array(19).fill(10), 30], macd: { histogram: 0.5 } }, timeframes: { '1d': { regime: 'trending' }, '4h': { regime: 'ranging' } } },
        expected: { context: 'compression_zone', position: 'closer_to_support', zone_state: 'compression', dominant_side: 'support', market_pressure: 'bullish_compression', market_energy: 'explosive', breakout_score: 0.7, breakout_confirmation: 'noise', volume_state: 'high', setup_state: 'waiting_breakout', fake_breakout_risk: 'low', regime_global: 'weak_trend', distance_percent: { to_support: 0.5, to_resistance: 0.75 } },
    },
    nearSupport: {
        input: { price: 100, levels: { support: [lvl(99, 100.5, 30, ['1d'])], resistance: [lvl(105, 106, 10, ['4h'])] }, indicators: { volume: [...Array(20).fill(10)], macd: { histogram: 0.01 } }, timeframes: { '1d': { regime: 'ranging' }, '15m': { regime: 'ranging' } } },
        expected: { context: 'near_support', position: 'closer_to_support', zone_state: 'normal', dominant_side: 'support', market_pressure: 'bullish_lean', market_energy: 'cooling', breakout_score: 0.38, breakout_confirmation: 'none', volume_state: 'normal', setup_state: 'watching_support', fake_breakout_risk: 'medium', regime_global: 'ranging', distance_percent: { to_support: 0.25, to_resistance: 5.5 } },
    },
    midRange: {
        input: { price: 100, levels: { support: [lvl(95, 96, 10, ['1h'])], resistance: [lvl(104, 105, 11, ['1h'])] }, indicators: { volume: [...Array(19).fill(10), 13], macd: { histogram: 0.07 } }, timeframes: {} },
        expected: { context: 'mid_range', position: 'mid_range', zone_state: 'normal', dominant_side: 'equilibrium', market_pressure: 'balanced', market_energy: 'building', breakout_score: 0, breakout_confirmation: 'none', volume_state: 'increasing', setup_state: 'no_trade', fake_breakout_risk: 'low', regime_global: 'mixed', distance_percent: { to_support: 4.5, to_resistance: 4.5 } },
    },
};

for (const [name, { input, expected }] of Object.entries(cases)) {
    test(`enhanceMarketState regression: ${name}`, () => {
        const out = enhanceMarketState(structuredClone(input));
        for (const [k, v] of Object.entries(expected)) assert.deepEqual(out[k], v, k);
    });
}

test('mergeSnapshots passes the last 20 closed volumes to the volume comparison', () => {
    const volumes = [...Array(30).fill(10), 40];
    const snap = (tf) => ({
        price: 100, context: 'mid_range', momentum: 'neutral', regime: 'ranging', timestamp: 0,
        support: [lvl(95, 96, 10, undefined)], resistance: [lvl(104, 105, 10, undefined)],
        indicators: { volume: volumes, ma14: [1], macd: [{ MACD: 1, signal: 1, histogram: 0.5 }] },
        candles: [{ time: 0, open: 1, high: 2, low: 0.5, close: 1.5, volume: 40, close_time: 900 }],
    });
    const roles = { htf: '1d', structure: '4h', mid: '1h', entry: '15m' };
    const snaps = { '1d': snap('1d'), '4h': snap('4h'), '1h': snap('1h'), '15m': snap('15m') };
    const { raw, volumeHistory } = mergeSnapshots('BTCUSDT', snaps, roles, { DEFAULT: 1 });
    assert.equal(volumeHistory.length, 20);
    assert.equal(raw.indicators.volume, 40, 'contract keeps the latest volume as a number');
    const out = enhanceMarketState({ ...raw, indicators: { ...raw.indicators, volume: volumeHistory } });
    assert.equal(out.volume_state, 'high');
    assert.deepEqual(Object.keys(raw.ohlcv), ['time', 'open', 'high', 'low', 'close', 'volume']);
});
