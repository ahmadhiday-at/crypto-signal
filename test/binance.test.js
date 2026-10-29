const test = require('node:test');
const assert = require('node:assert/strict');
const { BinanceClient } = require('../src/services/binance.service');
const { rawKlines } = require('./helpers');

const NOW_MS = Date.UTC(2026, 9, 29, 12, 0, 10);

function client(responses) {
    const sleeps = [];
    let calls = 0;
    const http = {
        async get() {
            const r = responses[Math.min(calls, responses.length - 1)];
            calls++;
            if (r instanceof Error) throw r;
            return { data: r };
        },
    };
    let now = NOW_MS;
    const c = new BinanceClient({ http, sleep: async (ms) => { sleeps.push(ms); }, now: () => now });
    return { c, sleeps, calls: () => calls, advance: (ms) => { now += ms; } };
}

const httpError = (status, headers = {}) => Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, headers } });
const timeoutError = () => Object.assign(new Error('timeout of 10000ms exceeded'), { code: 'ECONNABORTED' });
const okRows = () => rawKlines({ tf: '15m', nowSec: NOW_MS / 1000, count: 250 });

test('parses a valid response', async () => {
    const { c } = client([okRows()]);
    const candles = await c.getKlines('BTCUSDT', '15m');
    assert.equal(candles.length, 251);
    assert.ok(candles.every(k => Number.isFinite(k.close) && k.close_time - k.time === 900));
});

test('retries timeouts and 5xx with bounded backoff, then succeeds', async () => {
    const { c, sleeps, calls } = client([timeoutError(), httpError(503), okRows()]);
    const candles = await c.getKlines('BTCUSDT', '15m');
    assert.equal(candles.length, 251);
    assert.equal(calls(), 3);
    assert.deepEqual(sleeps, [1000, 2000]);
});

test('gives up after 3 retries', async () => {
    const { c, sleeps, calls } = client([timeoutError()]);
    await assert.rejects(c.getKlines('BTCUSDT', '15m'), { code: 'timeout' });
    assert.equal(calls(), 4);
    assert.deepEqual(sleeps, [1000, 2000, 4000]);
});

test('429 is not retried, honours Retry-After and pauses later requests', async () => {
    const { c, calls, advance } = client([httpError(429, { 'retry-after': '30' }), okRows()]);
    await assert.rejects(c.getKlines('BTCUSDT', '15m'), { code: 'binance_429' });
    assert.equal(calls(), 1);
    await assert.rejects(c.getKlines('BTCUSDT', '1h'), { code: 'binance_429' });
    assert.equal(calls(), 1, 'no request while cooling down');
    advance(31000);
    await c.getKlines('BTCUSDT', '15m');
    assert.equal(calls(), 2);
});

test('418 stops requests for at least the minimum ban period', async () => {
    const { c, calls, advance } = client([httpError(418), okRows()]);
    await assert.rejects(c.getKlines('BTCUSDT', '15m'), { code: 'binance_418' });
    advance(60000);
    await assert.rejects(c.getKlines('BTCUSDT', '15m'), { code: 'binance_418' });
    assert.equal(calls(), 1);
    advance(61000);
    await c.getKlines('BTCUSDT', '15m');
    assert.equal(calls(), 2);
});

test('451 is treated as an access restriction: no retry, requests paused', async () => {
    const { c, sleeps, calls } = client([httpError(451), okRows()]);
    await assert.rejects(c.getKlines('BTCUSDT', '15m'), { code: 'binance_451' });
    assert.deepEqual(sleeps, []);
    await assert.rejects(c.getKlines('BTCUSDT', '15m'), { code: 'binance_451' });
    assert.equal(calls(), 1);
    assert.equal(c.cooldownState().code, 'binance_451');
});

test('malformed responses are rejected, not repaired', async () => {
    const rows = okRows();
    rows[10] = ['garbage'];
    await assert.rejects(client([rows]).c.getKlines('BTCUSDT', '15m'), { code: 'invalid_response' });
    await assert.rejects(client([{ msg: 'error' }]).c.getKlines('BTCUSDT', '15m'), { code: 'invalid_response' });
});

test('a retry is abandoned when another request triggered a pause meanwhile', async () => {
    const { c, calls } = client([httpError(503), okRows()]);
    c.sleep = async () => { c._setCooldown('binance_429', 60); };
    await assert.rejects(c.getKlines('BTCUSDT', '15m'), { code: 'binance_429' });
    assert.equal(calls(), 1);
});

test('other 4xx responses are not retried', async () => {
    const { c, calls } = client([httpError(400)]);
    await assert.rejects(c.getKlines('BTCUSDT', '15m'), { code: 'binance_http' });
    assert.equal(calls(), 1);
});
