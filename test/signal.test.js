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
        risk_reward: 3.8, trailing_stop: 98.5, entry_distance_atr: 0.5,
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

test('threshold and minRiskReward overrides (backtest sweep)', () => {
    const state = base({ context: 'near_support', momentum: 'bullish' });
    assert.equal(computeSignal(state, '1d').action, 'WAIT', 'score 4 is below the default threshold');
    const low = computeSignal(state, '1d', { threshold: 4 });
    assert.equal(low.action, 'BUY');
    assert.equal(low.strength, 'medium');
    const strict = computeSignal(state, '1d', { threshold: 4, minRiskReward: 5 });
    assert.equal(strict.action, 'WAIT');
    assert.deepEqual(strict.filters, ['low_rr']);
});

test('plan overrides: SL buffer, tp2 target and fixed R target', () => {
    const { tradePlan } = require('../src/services/signal');
    const state = base({ levels: { support: [lv(98, 99.5, ['1h'])], resistance: [lv(109, 110, ['15m']), lv(119, 121, ['1d'])] } });
    const def = tradePlan(state, 'BUY', '1d');
    assert.equal(def.stop_loss, 97.5);
    assert.equal(def.take_profit_1, 109.5);
    assert.equal(tradePlan(state, 'BUY', '1d', { stopAtr: 1 }).stop_loss, 97);
    const tp2 = tradePlan(state, 'BUY', '1d', { target: 'tp2' });
    assert.equal(tp2.take_profit_1, 120);
    assert.equal(tp2.risk_reward, 8);
    const fixed = tradePlan(state, 'BUY', '1d', { target: 2 });
    assert.equal(fixed.take_profit_1, 105);
    assert.equal(fixed.risk_reward, 2);
    assert.equal(tradePlan(base(), 'BUY', '1d', { target: 'tp2' }).take_profit_1, null, 'no major HTF zone → no target');
});

test('HTF trend filter (Level 6.5 B1): off by default; vetoes a BUY in a down trend, a SELL in an up trend', () => {
    const { tradeFilters } = require('../src/services/signal');
    const trends = (d, h4) => ({ timeframes: { '1d': { trend: d }, '4h': { trend: h4 } } });
    const buy = (t, htfTrend) => computeSignal(strongBuy(trends(...t)), '1d', { htfTrend, structureTf: '4h' });
    assert.equal(buy(['down', 'down']).action, 'BUY', 'off by default');
    assert.deepEqual(buy(['down', 'up'], 'htf').filters, ['against_htf_trend']);
    assert.equal(buy(['ranging', 'down'], 'htf').action, 'BUY', 'htf mode ignores the structure timeframe');
    assert.deepEqual(buy(['ranging', 'down'], 'htf+structure').filters, ['against_htf_trend']);
    assert.equal(buy(['up', 'unknown'], 'htf+structure').action, 'BUY');
    assert.deepEqual(tradeFilters({ context: 'near_resistance', breakout_confirmation: 'strong', ...trends('up', 'ranging') }, 'SELL', { trendTfs: ['1d'] }), ['against_htf_trend']);
    assert.deepEqual(tradeFilters({ context: 'near_resistance', breakout_confirmation: 'strong', ...trends('down', 'ranging') }, 'SELL', { trendTfs: ['1d', '4h'] }), []);
    assert.deepEqual(tradeFilters({ context: 'near_support', breakout_confirmation: 'strong' }, 'BUY', { trendTfs: ['1d'] }), [], 'states without trend never reject');
});

test('timeframe trend: ranging regime, else MA14 vs MA50', () => {
    const { trendOf } = require('../src/services/market.service');
    const snap = (regime, ma14, ma50) => ({ regime, indicators: { ma14: [null, ma14], ma50: [null, ma50] } });
    assert.equal(trendOf(snap('trending', 110, 100)), 'up');
    assert.equal(trendOf(snap('trending', 90, 100)), 'down');
    assert.equal(trendOf(snap('ranging', 90, 100)), 'ranging');
    assert.equal(trendOf(snap('unknown', 90, 100)), 'unknown');
    assert.equal(trendOf({ regime: 'trending' }), 'unknown');
});

test('B2 target rr_zone: the first zone ahead that reaches the minimum RR', () => {
    // Long from 100, stop 97.5 (risk 2.5): zones at 102 (RR 0.8), 104.5 (RR 1.8), 115 (RR 6).
    const levels = { support: [lv(98, 99.5, ['1d'])], resistance: [lv(101.5, 102.5, ['15m'], 4), lv(104, 105, ['1h'], 9), lv(114, 116, ['1d'], 6)] };
    const nearest = computeSignal(strongBuy({ levels }), '1d');
    assert.deepEqual([nearest.plan.take_profit_1, nearest.plan.risk_reward, nearest.filters], [102, 0.8, ['low_rr']]);
    const rrZone = computeSignal(strongBuy({ levels }), '1d', { target: 'rr_zone' });
    assert.deepEqual([rrZone.action, rrZone.plan.take_profit_1, rrZone.plan.risk_reward, rrZone.plan.take_profit_2], ['BUY', 104.5, 1.8, 115]);
    const strict = computeSignal(strongBuy({ levels }), '1d', { target: 'rr_zone', minRiskReward: 7 });
    assert.deepEqual([strict.plan.take_profit_1, strict.filters], [102, ['low_rr']], 'no zone reaches RR 7: nearest, filtered');
});

test('B2 entry location: far_from_entry when price is more than entryMaxAtr × ATR from the entry zone', () => {
    const far = (entryMaxAtr) => computeSignal(strongBuy({ price: 101.5, levels: { support: [lv(98, 99.5, ['1d'])], resistance: [lv(114, 116, ['15m'])] } }), '1d', { entryMaxAtr });
    assert.equal(far(0).plan.entry_distance_atr, 2);
    assert.equal(far(0).action, 'BUY', '0 = off');
    assert.deepEqual(far(1.5).filters, ['far_from_entry']);
    assert.equal(far(2).action, 'BUY');
});

test('trend models: pullback to the MA50 and channel breakout in the HTF trend, ATR stop and R target', () => {
    const up = { '1d': { trend: 'up' }, '4h': { trend: 'up' }, '15m': { trend: 'up' } };
    const state = (over = {}) => base({
        price: 100, indicators: { atr: 1, ma50: 99.4, macd: { histogram: 0.2 } }, timeframes: up,
        channel: { high: 101, low: 95, candles: 20 }, ...over,
    });
    const opts = { model: 'trend_pullback', structureTf: '4h', entryTf: '15m' };
    const pull = computeSignal(state(), '1d', opts);
    assert.deepEqual(codes(pull), ['htf_trend_up', 'structure_trend_up', 'entry_trend_up', 'pullback_to_ma', 'bullish_momentum']);
    assert.deepEqual([pull.action, pull.score], ['BUY', 9]);
    assert.deepEqual(pull.plan, { side: 'long', entry_zone: [100, 100], stop_loss: 98.5, take_profit_1: 103, take_profit_2: null, risk_reward: 2, trailing_stop: 98.5, entry_distance_atr: 0 });
    assert.ok(!codes(computeSignal(state({ indicators: { atr: 1, ma50: 97, macd: { histogram: 0.2 } } }), '1d', opts)).includes('pullback_to_ma'), 'too far from the MA50');

    const down = { '1d': { trend: 'down' }, '4h': { trend: 'down' }, '15m': { trend: 'ranging' } };
    const brk = computeSignal(state({ price: 94, timeframes: down, indicators: { atr: 1, ma50: 99, macd: { histogram: -0.1 } } }), '1d', { ...opts, model: 'breakout' });
    assert.deepEqual([brk.action, brk.score], ['SELL', -9]);
    assert.ok(codes(brk).includes('channel_breakout_down'));
    assert.equal(brk.plan.stop_loss, 95.5);
    // A breakout against the higher timeframes is not taken.
    assert.ok(!codes(computeSignal(state({ price: 102, timeframes: down }), '1d', { ...opts, model: 'breakout' })).includes('channel_breakout_up'));
    // The bounce model ignores the new fields.
    assert.equal(computeSignal(state(), '1d', { structureTf: '4h', entryTf: '15m' }).score, 0);
});
