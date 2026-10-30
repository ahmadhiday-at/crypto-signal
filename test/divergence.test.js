const test = require('node:test');
const assert = require('node:assert/strict');
const { detectDivergence } = require('../src/services/divergence');

const flat = (n, v) => Array(n).fill(v);

// Two swing lows: index 20 (price 90, RSI 30) and index 40 (price p2, RSI r2), followed by `tail` bars.
function twoLows(p2, r2, tail = 5) {
    const lows = flat(41 + tail, 100);
    const rsi = flat(lows.length, 50);
    lows[20] = 90; rsi[20] = 30;
    lows[40] = p2; rsi[40] = r2;
    return { candles: lows.map(l => ({ low: l, high: l + 1 })), rsi };
}

test('bullish: lower low in price, higher low in RSI', () => {
    const { candles, rsi } = twoLows(85, 35);
    assert.equal(detectDivergence(candles, rsi), 'bullish');
});

test('no divergence when RSI confirms the lower low', () => {
    const { candles, rsi } = twoLows(85, 25);
    assert.equal(detectDivergence(candles, rsi), 'none');
});

test('bearish: higher high in price, lower high in RSI', () => {
    const highs = flat(46, 100);
    const rsi = flat(46, 50);
    highs[20] = 110; rsi[20] = 70;
    highs[40] = 115; rsi[40] = 65;
    const candles = highs.map(h => ({ low: h - 1, high: h }));
    assert.equal(detectDivergence(candles, rsi), 'bearish');
});

test('an old swing is ignored', () => {
    const { candles, rsi } = twoLows(85, 35, 20);
    assert.equal(detectDivergence(candles, rsi), 'none', 'latest swing is more than 10 bars old');
});

test('missing or misaligned data returns none', () => {
    assert.equal(detectDivergence(null, []), 'none');
    assert.equal(detectDivergence([{ low: 1, high: 2 }], []), 'none');
    const { candles, rsi } = twoLows(85, 35);
    rsi[40] = null;
    assert.equal(detectDivergence(candles, rsi), 'none', 'swing without RSI value is skipped');
});
