const test = require('node:test');
const assert = require('node:assert/strict');
const { computeSignal } = require('../src/services/signal');

// Zone helper: [low, high] with mid, score and contributing timeframes.
const lv = (low, high, tfs, score = 10) => ({ low, high, mid: (low + high) / 2, score, tfs });

// Price 100, ATR 1. Default geometry gives a long plan with RR (109.5-100)/(100-97.5) = 3.8.
const base = (over = {}) => ({
    status: 'ok', context: 'mid_range', momentum: 'neutral', volume_state: 'normal', volatility_ratio: 1, breakout_confirmation: 'none',
    price: 100, indicators: { atr: 1 },
    levels: { support: [lv(98, 99.5, ['1h'])], resistance: [lv(109, 110, ['15m'])] },
    distance_percent: { to_support: 3, to_resistance: 3 },
    ...over,
});
const codes = (sig) => sig.reasons.map(r => r.code);

test('no triggers → WAIT with score 0', () => {
    assert.deepEqual(computeSignal(base(), '1d'), { action: 'WAIT', score: 0, strength: 'weak', reasons: [], filtered: false, filters: [], plan: null });
});

test('support + bullish momentum + strong HTF support near price → strong BUY', () => {
    const sig = computeSignal(base({
        context: 'near_support', momentum: 'bullish',
        levels: { support: [lv(98, 99.5, ['1d', '4h'])], resistance: [lv(109, 110, ['15m'])] },
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
        levels: { support: [lv(90, 91, ['15m'])], resistance: [lv(100.2, 100.8, ['1d'])] },
        distance_percent: { to_support: 3, to_resistance: 0.5 },
    }), '1d');
    assert.equal(sig.score, -7);
    assert.equal(sig.action, 'SELL');
});

test('strong HTF zone only counts within 1% of price', () => {
    const far = computeSignal(base({ levels: { support: [lv(96, 97, ['1d'])], resistance: [lv(103, 104, ['1d'])] } }), '1d');
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

// ---- Level 2.5B trade filter ----
const strongBuy = (over = {}) => base({
    context: 'near_support', momentum: 'bullish',
    levels: { support: [lv(98, 99.5, ['1d'])], resistance: [lv(109, 110, ['15m'])] },
    distance_percent: { to_support: 0.4, to_resistance: 3 }, ...over,
});

test('a clean BUY passes the filter', () => {
    const sig = computeSignal(strongBuy(), '1d');
    assert.equal(sig.action, 'BUY');
    assert.equal(sig.filtered, false);
    assert.deepEqual(sig.filters, []);
});

test('extreme or dead volatility turns BUY into a filtered WAIT', () => {
    for (const [vr, code] of [[2.5, 'volatility_extreme'], [0.3, 'volatility_dead']]) {
        const sig = computeSignal(strongBuy({ volatility_ratio: vr }), '1d');
        assert.equal(sig.action, 'WAIT');
        assert.equal(sig.filtered, true);
        assert.deepEqual(sig.filters, [code]);
        assert.equal(sig.score, 7, 'score is kept');
    }
    assert.equal(computeSignal(strongBuy({ volatility_ratio: null }), '1d').action, 'BUY', 'unknown ratio does not filter');
});

test('no-man\'s land: mid_range far from every zone', () => {
    const { tradeFilters } = require('../src/services/signal');
    assert.deepEqual(tradeFilters(base({ distance_percent: { to_support: 2, to_resistance: 3 } }), 'BUY'), ['no_mans_land']);
    assert.deepEqual(tradeFilters(base({ distance_percent: { to_support: 0.8, to_resistance: 3 } }), 'BUY'), []);
});

test('buying into resistance needs a confirmed breakout', () => {
    const { tradeFilters } = require('../src/services/signal');
    const atRes = base({ context: 'near_resistance', distance_percent: { to_support: 3, to_resistance: 0.2 } });
    assert.deepEqual(tradeFilters(atRes, 'BUY'), ['buy_into_resistance']);
    assert.deepEqual(tradeFilters({ ...atRes, breakout_confirmation: 'medium' }, 'BUY'), []);
    assert.deepEqual(tradeFilters(atRes, 'SELL'), []);
    const atSup = base({ context: 'near_support', distance_percent: { to_support: 0.2, to_resistance: 3 } });
    assert.deepEqual(tradeFilters(atSup, 'SELL'), ['sell_into_support']);
});

test('filters are not evaluated for a WAIT score', () => {
    const sig = computeSignal(base({ volatility_ratio: 5 }), '1d');
    assert.equal(sig.filtered, false);
    assert.deepEqual(sig.filters, []);
});

test('RSI divergence adds +/-2', () => {
    assert.deepEqual(computeSignal(base({ divergence: 'bullish' }), '1d').reasons, [{ code: 'bullish_divergence', points: 2 }]);
    assert.equal(computeSignal(base({ divergence: 'bearish' }), '1d').score, -2);
    const sig = computeSignal(base({ context: 'near_support', momentum: 'bullish', divergence: 'bullish', distance_percent: { to_support: 0.8, to_resistance: 3 } }), '1d');
    assert.equal(sig.score, 6);
    assert.equal(sig.action, 'BUY');
});

// ---- Level 3 trade plan + Level 2.5B RR validator ----
test('long plan: zone, stop below zone, nearest target, HTF target, RR, trailing', () => {
    const sig = computeSignal(strongBuy({
        levels: { support: [lv(98, 99.5, ['1d'])], resistance: [lv(109, 110, ['15m'], 4), lv(114, 116, ['1d', '4h'], 9), lv(120, 121, ['1d'], 6)] },
    }), '1d');
    assert.equal(sig.action, 'BUY');
    assert.deepEqual(sig.plan, {
        side: 'long', entry_zone: [98, 99.5], stop_loss: 97.5, take_profit_1: 109.5, take_profit_2: 115,
        risk_reward: 3.8, trailing_stop: 98.5,
    });
});

test('short plan mirrors the long plan', () => {
    const sig = computeSignal(base({
        context: 'near_resistance', momentum: 'bearish',
        levels: { support: [lv(90, 91, ['15m'])], resistance: [lv(100.2, 100.8, ['1d'])] },
        distance_percent: { to_support: 3, to_resistance: 0.5 },
    }), '1d');
    assert.equal(sig.action, 'SELL');
    assert.equal(sig.plan.side, 'short');
    assert.equal(sig.plan.stop_loss, 101.3);
    assert.equal(sig.plan.take_profit_1, 90.5);
    assert.equal(sig.plan.take_profit_2, null, 'no HTF level beyond TP1');
    assert.equal(sig.plan.trailing_stop, 101.5);
    assert.equal(sig.plan.risk_reward, 7.31);
});

test('RR below 1.5 filters the setup as low_rr but keeps the plan', () => {
    const sig = computeSignal(strongBuy({ levels: { support: [lv(98, 99.5, ['1d'])], resistance: [lv(102, 103, ['15m'])] } }), '1d');
    assert.equal(sig.action, 'WAIT');
    assert.deepEqual(sig.filters, ['low_rr']);
    assert.equal(sig.plan.risk_reward, 1);
});

test('no target or no ATR → no RR → low_rr', () => {
    const noTarget = computeSignal(strongBuy({ levels: { support: [lv(98, 99.5, ['1d'])], resistance: [lv(95, 96, ['15m'])] } }), '1d');
    assert.equal(noTarget.plan.take_profit_1, null);
    assert.equal(noTarget.plan.risk_reward, null);
    assert.deepEqual(noTarget.filters, ['low_rr']);
    const noAtr = computeSignal(strongBuy({ indicators: {} }), '1d');
    assert.equal(noAtr.plan, null);
    assert.deepEqual(noAtr.filters, ['low_rr']);
});

test('WAIT by score has no plan', () => {
    assert.equal(computeSignal(base({ momentum: 'bullish' }), '1d').plan, null);
});
