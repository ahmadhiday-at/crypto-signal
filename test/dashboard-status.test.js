const test = require('node:test');
const assert = require('node:assert/strict');
const { describeMarketState } = require('../public/js/market-status');

const state = (status, extra = {}) => ({
    schema_version: 2, status, errors: [],
    inputs: { '15m': { candle_close_time: 1793232000, age_seconds: 120, status: 'ok' }, '1d': { status: status === 'degraded' ? 'stale' : 'ok' } },
    ...extra,
});

test('ok state shows values with the entry close time', () => {
    const d = describeMarketState(state('ok'), 200, '15m');
    assert.equal(d.level, 'ok');
    assert.equal(d.showValues, true);
    assert.match(d.detail, /15m close 2026-10-29 00:00 UTC \(2m ago\)/);
});

test('degraded names the stale higher timeframes', () => {
    const d = describeMarketState(state('degraded'), 200, '15m');
    assert.equal(d.level, 'degraded');
    assert.match(d.detail, /1d/);
});

test('stale state is labelled as not current', () => {
    const d = describeMarketState(state('stale', { errors: ['binance_451'] }), 200, '15m');
    assert.equal(d.level, 'stale');
    assert.match(d.title, /NOT CURRENT/);
    assert.deepEqual(d.errors, ['binance_451']);
});

test('503 diagnostics and bad responses hide all values', () => {
    const missing = describeMarketState({ schema_version: 2, status: 'stale', error: 'market_state_unavailable', errors: ['missing_input'] }, 503, '15m');
    assert.equal(missing.showValues, false);
    assert.equal(missing.level, 'stale');
    assert.equal(describeMarketState(null, 0, '15m').showValues, false);
    assert.equal(describeMarketState({ error: 'internal_error' }, 500, '15m').level, 'unavailable');
    assert.equal(describeMarketState({ price: 1 }, 200, '15m').level, 'unavailable', 'v1 responses are not trusted');
    assert.equal(describeMarketState(state('weird'), 200, '15m').showValues, false);
});
