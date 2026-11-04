const test = require('node:test');
const assert = require('node:assert/strict');
const { boardRow, buildBoard } = require('../src/services/signal-board');

const roles = { htf: '1w', structure: '1d', mid: '4h', entry: '1h' };
const plan = { side: 'long', entry_zone: [100, 100], stop_loss: 90, take_profit_1: 120, take_profit_2: null, risk_reward: 2 };
const state = (signal, extra = {}) => ({ status: 'ok', errors: [], price: 100, generated_at: 1000, signal, timeframes: { '1w': { trend: 'up' }, '1d': { trend: 'down' } }, ...extra });
const record = (over = {}) => ({
    id: 'BTCUSDT-1-BUY', market: 'BTCUSDT', timeframe: '1h', signal: 'BUY', filtered: false, filters: [], strength: 'medium', price: 100, sl: 90, tp1: 120, tp2: null,
    risk_reward: 2, candle_close_time: 3600, result: null, rr: null, closed_at: null, bars: null, features: { score: 6 }, model: 'trend_pullback', ...over,
});
const log = (records) => ({ entry_tf: '1h', model: 'trend_pullback', records });
const row = (args) => boardRow({ market: 'BTCUSDT', state: null, log: null, edge: null, roles, expiryCandles: 96, ...args });

test('board row: BUY reads as long, SELL as short, WAIT has no direction', () => {
    assert.equal(row({ state: state({ action: 'BUY', score: 6, plan }) }).signal.direction, 'long');
    assert.equal(row({ state: state({ action: 'SELL', score: -6, plan: { ...plan, side: 'short' } }) }).signal.direction, 'short');
    assert.equal(row({ state: state({ action: 'WAIT', score: 3, plan: null }) }).signal.direction, null);
});

test('board row: a filtered signal keeps the way it points, without a direction', () => {
    const r = row({ state: state({ action: 'WAIT', score: 6, filtered: true, filters: ['volatility_extreme'], plan }) });
    assert.equal(r.signal.direction, null);
    assert.equal(r.signal.setup, 'long');
    assert.deepEqual(r.signal.filters, ['volatility_extreme']);
});

test('board row: trends follow the role timeframes, missing ones are null', () => {
    assert.deepEqual(row({ state: state({ action: 'WAIT', score: 0, plan: null }) }).trends, {
        htf: { timeframe: '1w', trend: 'up' }, structure: { timeframe: '1d', trend: 'down' },
        mid: { timeframe: '4h', trend: null }, entry: { timeframe: '1h', trend: null },
    });
});

test('board row: an unavailable market is a row without a signal', () => {
    const r = row({});
    assert.equal(r.status, 'unavailable');
    assert.equal(r.signal, null);
    assert.deepEqual(r.open, []);
});

test('board row: open lists taken records of the current model only, with the expiry time', () => {
    const r = row({ log: log([
        record(),
        record({ id: 'filtered', filtered: true }),
        record({ id: 'old-tf', timeframe: '15m' }),
        record({ id: 'old-model', model: 'bounce' }),
    ]) });
    assert.deepEqual(r.open.map(t => t.id), ['BTCUSDT-1-BUY']);
    assert.equal(r.open[0].side, 'long');
    assert.equal(r.open[0].expires_at, 3600 + 96 * 3600);
    assert.equal(r.older_records, 2);
});

test('board: totals count directions and open trades; recent is newest first', () => {
    const a = row({ state: state({ action: 'BUY', score: 6, plan }), log: log([record(), record({ id: 'w', result: 'WIN', rr: 2, closed_at: 50 })]) });
    const b = row({ market: 'SOLUSDT', state: state({ action: 'SELL', score: -6, plan }), log: log([record({ id: 'l', result: 'LOSS', rr: -1, closed_at: 90 })]) });
    const c = row({ market: 'BNBUSDT', state: state({ action: 'WAIT', score: 1, plan: null }) });
    const board = buildBoard({ rows: [a, b, c], model: 'trend_pullback', roles, now: 1 });
    assert.deepEqual(board.totals, { long: 1, short: 1, wait: 1, open: 1 });
    assert.deepEqual(board.recent.map(t => t.id), ['l', 'w']);
    assert.equal(board.markets[0].closed, undefined);
});
