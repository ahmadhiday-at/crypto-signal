const test = require('node:test');
const assert = require('node:assert/strict');
const { computeSignal } = require('../src/services/signal');

const base = (over = {}) => ({
    status: 'ok', context: 'mid_range', momentum: 'neutral', volume_state: 'normal',
    levels: { support: [{ tfs: ['1h'] }], resistance: [{ tfs: ['15m'] }] },
    distance_percent: { to_support: 3, to_resistance: 3 },
    ...over,
});
const codes = (sig) => sig.reasons.map(r => r.code);

test('no triggers → WAIT with score 0', () => {
    assert.deepEqual(computeSignal(base(), '1d'), { action: 'WAIT', score: 0, strength: 'weak', reasons: [] });
});

test('support + bullish momentum + strong HTF support near price → strong BUY', () => {
    const sig = computeSignal(base({
        context: 'near_support', momentum: 'bullish',
        levels: { support: [{ tfs: ['1d', '4h'] }], resistance: [{ tfs: ['15m'] }] },
        distance_percent: { to_support: 0.4, to_resistance: 3 },
    }), '1d');
    assert.equal(sig.score, 7);
    assert.equal(sig.action, 'BUY');
    assert.equal(sig.strength, 'strong');
    assert.deepEqual(codes(sig), ['near_support', 'bullish_momentum', 'strong_htf_support']);
});

test('mirror rules give SELL', () => {
    const sig = computeSignal(base({
        context: 'near_resistance', momentum: 'bearish',
        levels: { support: [{ tfs: ['15m'] }], resistance: [{ tfs: ['1d'] }] },
        distance_percent: { to_support: 3, to_resistance: 0.5 },
    }), '1d');
    assert.equal(sig.score, -7);
    assert.equal(sig.action, 'SELL');
});

test('strong HTF zone only counts within 1% of price', () => {
    const far = computeSignal(base({ levels: { support: [{ tfs: ['1d'] }], resistance: [{ tfs: ['1d'] }] } }), '1d');
    assert.equal(far.score, 0);
});

test('volume changes conviction, not direction', () => {
    const up = { context: 'near_support', momentum: 'bullish' };
    assert.equal(computeSignal(base({ ...up, volume_state: 'high' }), '1d').score, 5);
    assert.equal(computeSignal(base({ ...up, volume_state: 'high' }), '1d').action, 'BUY');
    assert.equal(computeSignal(base({ ...up, volume_state: 'low' }), '1d').score, 3);
    const down = { context: 'near_resistance', momentum: 'bearish', volume_state: 'low' };
    assert.equal(computeSignal(base(down), '1d').score, -3);
    assert.deepEqual(computeSignal(base({ volume_state: 'high' }), '1d').reasons, [], 'no direction → volume ignored');
});

test('any status other than ok forces WAIT but keeps the score', () => {
    const strongBuy = { context: 'near_support', momentum: 'bullish', volume_state: 'high' };
    for (const status of ['degraded', 'stale']) {
        const sig = computeSignal(base({ ...strongBuy, status }), '1d');
        assert.equal(sig.action, 'WAIT');
        assert.equal(sig.score, 5);
        assert.ok(codes(sig).includes('data_not_current'));
    }
});
