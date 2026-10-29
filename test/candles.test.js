const test = require('node:test');
const assert = require('node:assert/strict');
const c = require('../src/services/candles');

const T = Date.UTC(2026, 9, 29, 12, 7, 30) / 1000; // Thursday 2026-10-29 12:07:30 UTC

test('expectedLastClose aligns to UTC boundaries', () => {
    assert.equal(c.expectedLastClose(T, '1m'), Date.UTC(2026, 9, 29, 12, 7) / 1000);
    assert.equal(c.expectedLastClose(T, '15m'), Date.UTC(2026, 9, 29, 12, 0) / 1000);
    assert.equal(c.expectedLastClose(T, '4h'), Date.UTC(2026, 9, 29, 12, 0) / 1000);
    assert.equal(c.expectedLastClose(T, '1d'), Date.UTC(2026, 9, 29, 0, 0) / 1000);
    // Binance weeks start Monday 00:00 UTC; 2026-10-26 is a Monday.
    assert.equal(c.expectedLastClose(T, '1w'), Date.UTC(2026, 9, 26) / 1000);
});

test('isBoundary detects which timeframes close at an instant', () => {
    const midnight = Date.UTC(2026, 9, 29) / 1000;
    const due = ['1m', '15m', '30m', '1h', '4h', '1d', '1w'].filter(tf => c.isBoundary(midnight, tf));
    assert.deepEqual(due, ['1m', '15m', '30m', '1h', '4h', '1d']);
    const monday = Date.UTC(2026, 9, 26) / 1000;
    assert.ok(c.isBoundary(monday, '1w'));
    assert.deepEqual(['1m', '15m', '1h'].filter(tf => c.isBoundary(midnight + 15 * 60, tf)), ['1m', '15m']);
});

const row = (openSec, o, h, l, cl, v, tf = '15m') =>
    [openSec * 1000, String(o), String(h), String(l), String(cl), String(v), (openSec + c.tfSeconds(tf)) * 1000 - 1];

test('parseKline converts a valid row and computes close_time as open + tf length', () => {
    const k = c.parseKline(row(900, 10, 12, 9, 11, 5), '15m');
    assert.deepEqual(k, { time: 900, open: 10, high: 12, low: 9, close: 11, volume: 5, close_time: 1800 });
});

test('parseKline rejects malformed rows', () => {
    assert.equal(c.parseKline(null, '15m'), null);
    assert.equal(c.parseKline([1, 2, 3], '15m'), null);
    assert.equal(c.parseKline(row(900, 'x', 12, 9, 11, 5), '15m'), null, 'non-numeric');
    assert.equal(c.parseKline(row(900, 10, 8, 9, 11, 5), '15m'), null, 'high below low');
    assert.equal(c.parseKline(row(900, 10, 12, 9, 11, -1), '15m'), null, 'negative volume');
    assert.equal(c.parseKline(row(900, 10, 12, 9, 11, 5, '1h'), '15m'), null, 'interval mismatch');
    const r = c.parseKlines([row(900, 10, 12, 9, 11, 5), ['bad']], '15m');
    assert.equal(r.candles.length, 1);
    assert.equal(r.rejected, 1);
    assert.equal(c.parseKlines({ code: -1 }, '15m').valid, false);
});

test('normalizeCandles sorts and removes duplicates', () => {
    const a = c.parseKline(row(1800, 10, 12, 9, 11, 5), '15m');
    const b = c.parseKline(row(900, 10, 12, 9, 11, 5), '15m');
    const a2 = { ...a, close: 11.5 };
    const out = c.normalizeCandles([a, b, a2]);
    assert.deepEqual(out.map(x => x.time), [900, 1800]);
    assert.equal(out[1].close, 11.5, 'later duplicate wins');
});

test('splitClosed never treats the forming candle as closed', () => {
    const candles = [900, 1800, 2700].map(t => c.parseKline(row(t, 10, 12, 9, 11, 5), '15m'));
    const { closed, forming } = c.splitClosed(candles, 3000);
    assert.deepEqual(closed.map(x => x.time), [900, 1800]);
    assert.equal(forming.time, 2700);
    // Exactly at the close instant the candle counts as closed.
    assert.equal(c.splitClosed(candles, 3600).closed.length, 3);
});

test('countGaps counts missing candles', () => {
    const candles = [0, 900, 3600].map(t => c.parseKline(row(t, 10, 12, 9, 11, 5), '15m'));
    assert.equal(c.countGaps(candles, '15m'), 2);
});
