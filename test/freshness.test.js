const test = require('node:test');
const assert = require('node:assert/strict');
const { inputStatus, summaryStatus, computeInputs } = require('../src/services/freshness');

const roles = ['1d', '4h', '1h', '15m'];
const now = 1_800_000_000;

test('inputStatus is stale only beyond 2x the timeframe length', () => {
    assert.equal(inputStatus(now - 1800, '15m', now).status, 'ok', 'exactly 2x is still ok');
    assert.equal(inputStatus(now - 1801, '15m', now).status, 'stale');
    assert.equal(inputStatus(now - 100, '15m', now).age_seconds, 100);
});

test('missing or invalid close times are never fresh', () => {
    for (const v of [undefined, null, NaN, 'x']) {
        const r = inputStatus(v, '15m', now);
        assert.equal(r.status, 'missing');
        assert.equal(r.age_seconds, null);
    }
    assert.equal(inputStatus(now, 'bogus', now).status, 'missing');
});

const inputsWith = (statuses) => Object.fromEntries(roles.map(tf => [tf, { status: statuses[tf] || 'ok' }]));

test('summaryStatus precedence: stale > degraded > ok', () => {
    assert.equal(summaryStatus(inputsWith({}), roles, '15m'), 'ok');
    assert.equal(summaryStatus(inputsWith({ '1d': 'stale' }), roles, '15m'), 'degraded');
    assert.equal(summaryStatus(inputsWith({ '1d': 'stale', '4h': 'stale' }), roles, '15m'), 'degraded');
    assert.equal(summaryStatus(inputsWith({ '15m': 'stale' }), roles, '15m'), 'stale');
    assert.equal(summaryStatus(inputsWith({ '1h': 'missing' }), roles, '15m'), 'stale');
    assert.equal(summaryStatus(inputsWith({ '15m': 'missing' }), roles, '15m'), 'stale');
    assert.equal(summaryStatus(inputsWith({ '15m': 'stale', '1d': 'stale' }), roles, '15m'), 'stale');
    assert.equal(summaryStatus({}, roles, '15m'), 'stale', 'no inputs at all');
});

test('computeInputs covers every role timeframe', () => {
    const inputs = computeInputs({ '15m': now - 60, '1d': now - 3 * 86400 }, roles, now);
    assert.deepEqual(Object.keys(inputs), roles);
    assert.equal(inputs['15m'].status, 'ok');
    assert.equal(inputs['1d'].status, 'stale');
    assert.equal(inputs['4h'].status, 'missing');
});
