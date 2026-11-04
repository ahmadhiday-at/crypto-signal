const test = require('node:test');
const assert = require('node:assert/strict');
const SignalView = require('../public/js/signal-view');
const { REASON_CODES, FILTER_CODES } = require('../src/services/signal');
const Fmt = require('../public/js/format');

test('every reason and filter the server can send has a readable label', () => {
    for (const code of REASON_CODES) assert.notEqual(SignalView.reasonLabel(code), code, code);
    for (const code of FILTER_CODES) assert.notEqual(SignalView.filterLabel(code, {}), code, code);
});

test('every edge reason the server can send has a readable label', () => {
    for (const code of ['no_backtest', 'params_differ', 'too_few_trades', 'negative_expectancy', 'negative_out_of_sample', 'no_fees']) {
        assert.notEqual(SignalView.edgeReason(code), code, code);
    }
});

test('filter labels show the configured value, and read fine without it', () => {
    assert.match(SignalView.filterLabel('low_rr', { min_rr: 1.5 }), /1\.5/);
    assert.equal(SignalView.filterLabel('low_rr', {}), 'Risk/reward below the minimum');
});

test('actions read as sides', () => {
    assert.equal(SignalView.sideOfAction('BUY'), 'long');
    assert.equal(SignalView.sideOfAction('SELL'), 'short');
    assert.equal(SignalView.sideOfAction('WAIT'), null);
    assert.equal(SignalView.sideWord('long'), 'LONG');
    assert.equal(SignalView.sideWord(null), 'WAIT');
});

test('wait reason: stale data first, then filters, then the score', () => {
    const c = { threshold: 5, min_rr: 1.5 };
    assert.match(SignalView.waitReason({ score: 6 }, 'stale', c), /not current/);
    assert.match(SignalView.waitReason({ score: 6, filtered: true, filters: ['low_rr'], plan: { side: 'short' } }, 'ok', c), /^SHORT setup blocked: Risk\/reward/);
    assert.equal(SignalView.waitReason({ score: 3, filtered: false }, 'ok', c), 'Score +3, needs ±5 to act.');
});

test('plan numbers: distances from the entry, and what the costs take in R', () => {
    const n = SignalView.planNumbers({ stop_loss: 90, take_profit_1: 120, take_profit_2: 140 }, 100, 0.25);
    assert.equal(n.risk, 10);
    assert.equal(n.stop_pct, -10);
    assert.equal(n.tp1_pct, 20);
    assert.equal(n.tp2_r, 4);
    assert.equal(n.cost_r, 0.025);
    assert.equal(SignalView.planNumbers(null, 100, 0.25), null);
});

test('position size: hitting the stop loses the chosen risk, on either side', () => {
    const long = SignalView.positionSize(10000, 1, 100, 90);
    assert.equal(long.risk_amount, 100);
    assert.equal(long.quantity, 10);
    assert.equal(long.notional, 1000);
    assert.equal(long.leverage, 0.1);
    assert.equal(SignalView.positionSize(10000, 1, 100, 110).quantity, 10);
});

test('position size: unusable input gives no size', () => {
    assert.equal(SignalView.positionSize(0, 1, 100, 90), null);
    assert.equal(SignalView.positionSize(10000, 0, 100, 90), null);
    assert.equal(SignalView.positionSize(10000, 1, 100, 100), null);
    assert.equal(SignalView.positionSize(NaN, 1, 100, 90), null);
});

test('open R follows the side of the trade', () => {
    assert.equal(SignalView.openR({ side: 'long', entry: 100, stop_loss: 90 }, 115), 1.5);
    assert.equal(SignalView.openR({ side: 'short', entry: 100, stop_loss: 110 }, 115), -1.5);
    assert.equal(SignalView.openR({ side: 'long', entry: 100, stop_loss: 90 }, null), null);
});

test('plan text is ready to paste and skips what is missing', () => {
    const text = SignalView.planText('BTCUSDT', '1h', { side: 'long', entry_zone: [100, 100], stop_loss: 90, take_profit_1: 120, take_profit_2: null, risk_reward: 2 });
    assert.equal(text, 'BTCUSDT LONG (1h)\nEntry: 100\nStop: 90\nTP1: 120\nR:R: 2');
});

test('format: prices keep precision on small values, missing values read as a dash', () => {
    assert.match(Fmt.price(0.1234), /0.1234/);
    assert.equal(Fmt.price(null), '-');
    assert.equal(Fmt.r(null), '-');
    assert.equal(Fmt.utc(0), '1970-01-01 00:00');
    assert.equal(Fmt.esc('<a>'), '&lt;a&gt;');
    assert.equal(Fmt.tone(-1), 'neg');
});
