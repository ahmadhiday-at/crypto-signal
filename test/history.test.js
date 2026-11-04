const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createHistory } = require('../src/services/history');
const { createHistorySync, nextRunMs } = require('../src/jobs/history-sync');
const { silentLog } = require('./helpers');

const DAY = 86400;
const utc = (y, m, d) => Date.UTC(y, m - 1, d) / 1000;
const candle = (time, len) => ({ time, open: 1, high: 2, low: 0.5, close: 1.5, volume: 3, close_time: time + len });
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'crypto-signal-history-'));

// A fake exchange with daily candles from `first` to `last`, minus `missing`.
function exchange(first, last, missing = []) {
    const requests = [];
    const all = [];
    for (let t = first; t <= last; t += DAY) if (!missing.includes(t)) all.push(candle(t, DAY));
    return {
        requests,
        failAfter: null,
        async getKlinesFrom(market, tf, startMs) {
            if (this.failAfter !== null && requests.length >= this.failAfter) throw Object.assign(new Error('blocked'), { code: 'binance_451' });
            requests.push(startMs / 1000);
            return all.filter(c => c.time >= startMs / 1000).slice(0, 1000);
        },
    };
}
const make = (dir, binance, nowSec) => createHistory({ dir, binance, now: () => nowSec * 1000, sleep: async () => {}, log: silentLog });
const yearFile = (dir, year, tf = '1d') => path.join(dir, 'BTCUSDT', tf, `${year}.json`);

test('candles go to one file per year, by open time in UTC, one row per line', async () => {
    const dir = tempDir();
    const now = utc(2026, 1, 3);
    const h = make(dir, exchange(utc(2025, 12, 30), now), now);
    const got = await h.sync('BTCUSDT', '1d', utc(2025, 12, 30));
    assert.equal(got.length, 4);
    assert.deepEqual(fs.readdirSync(path.join(dir, 'BTCUSDT', '1d')).sort(), ['2025.json', '2026.json']);
    assert.equal(JSON.parse(fs.readFileSync(yearFile(dir, 2025))).length, 2);
    assert.equal(JSON.parse(fs.readFileSync(yearFile(dir, 2026))).length, 2);
    assert.equal(fs.readFileSync(yearFile(dir, 2026), 'utf8').split('\n').length, 5, '[, two rows, ], end of file');
    assert.deepEqual((await h.read('BTCUSDT', '1d')).map(c => c.time), got.map(c => c.time));
});

test('new candles change the current year only; a finished year stays byte for byte', async () => {
    const dir = tempDir();
    const binance = exchange(utc(2025, 12, 30), utc(2026, 1, 20));
    await make(dir, binance, utc(2026, 1, 3)).sync('BTCUSDT', '1d', utc(2025, 12, 30));
    const past = path.join(yearFile(dir, 2025));
    const old = new Date('2020-01-01');
    fs.utimesSync(past, old, old);
    const before = fs.readFileSync(past, 'utf8');
    binance.requests.length = 0;
    const got = await make(dir, binance, utc(2026, 1, 5)).sync('BTCUSDT', '1d', null);
    assert.deepEqual(binance.requests, [utc(2026, 1, 3)], 'only what is missing');
    assert.equal(got.length, 6);
    assert.equal(fs.readFileSync(past, 'utf8'), before);
    assert.equal(fs.statSync(past).mtimeMs, old.getTime(), 'the file was not written');
});

test('asking further back fetches only the older part', async () => {
    const dir = tempDir();
    const binance = exchange(utc(2024, 1, 1), utc(2026, 1, 3));
    await make(dir, binance, utc(2026, 1, 3)).sync('BTCUSDT', '1d', utc(2025, 12, 1));
    binance.requests.length = 0;
    const got = await make(dir, binance, utc(2026, 1, 3)).sync('BTCUSDT', '1d', utc(2025, 11, 1));
    assert.equal(got[0].time, utc(2025, 11, 1));
    assert.deepEqual(binance.requests, [utc(2025, 11, 1)], 'the older part, not everything; no candle has closed since');
});

test('a start before the market existed is asked once, then remembered', async () => {
    const dir = tempDir();
    const listed = utc(2025, 12, 1);
    const binance = exchange(listed, utc(2026, 1, 3));
    const now = utc(2026, 1, 3);
    const long = utc(2004, 1, 1);
    await make(dir, binance, now).sync('BTCUSDT', '1d', long);
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'BTCUSDT', '1d', 'meta.json'))), { earliest: listed });
    binance.requests.length = 0;
    const got = await make(dir, binance, now).sync('BTCUSDT', '1d', long);
    assert.equal(got[0].time, listed);
    assert.deepEqual(binance.requests, [], 'no second trip before the listing date');
});

test('a hole is filled; one Binance does not have is remembered and not asked again', async () => {
    const dir = tempDir();
    const now = utc(2026, 1, 10);
    const outage = utc(2026, 1, 5);
    const binance = exchange(utc(2026, 1, 1), now, [outage]);
    const h = make(dir, binance, now);
    await h.sync('BTCUSDT', '1d', utc(2026, 1, 1));
    assert.deepEqual(JSON.parse(fs.readFileSync(path.join(dir, 'BTCUSDT', '1d', 'meta.json'))).gaps, [outage]);
    binance.requests.length = 0;
    await h.sync('BTCUSDT', '1d', null);
    assert.deepEqual(binance.requests, [], 'the known hole is not asked again');

    // A hole Binance can fill is filled.
    const lost = tempDir();
    const full = exchange(utc(2026, 1, 1), now);
    await make(lost, full, now).sync('BTCUSDT', '1d', utc(2026, 1, 1));
    const file = yearFile(lost, 2026);
    const rows = JSON.parse(fs.readFileSync(file)).filter(r => r[0] !== utc(2026, 1, 4));
    fs.writeFileSync(file, JSON.stringify(rows));
    const got = await make(lost, full, now).sync('BTCUSDT', '1d', null);
    assert.ok(got.some(c => c.time === utc(2026, 1, 4)));
});

test('candles found before a failure are kept, and the error reaches the caller', async () => {
    const dir = tempDir();
    const now = utc(2026, 1, 3);
    const binance = exchange(utc(2020, 1, 1), now);
    binance.failAfter = 1;
    const h = make(dir, binance, now);
    await assert.rejects(h.sync('BTCUSDT', '1d', utc(2020, 1, 1)), /blocked/);
    assert.equal((await h.read('BTCUSDT', '1d')).length, 1000);
});

test('the old single-file cache is split once and then removed; nothing is lost', async () => {
    const dir = tempDir();
    const rows = [utc(2025, 12, 31), utc(2026, 1, 1), utc(2026, 1, 2)].map(t => [t, 1, 2, 0.5, 1.5, 3]);
    const flat = path.join(dir, 'BTCUSDT_1d.json');
    fs.writeFileSync(flat, JSON.stringify(rows));
    const h = make(dir, exchange(0, 0), utc(2026, 1, 3));
    assert.deepEqual((await h.read('BTCUSDT', '1d')).map(c => c.time), rows.map(r => r[0]));
    assert.equal(fs.existsSync(flat), false);
    assert.equal(JSON.parse(fs.readFileSync(yearFile(dir, 2025))).length, 1);
    assert.equal(JSON.parse(fs.readFileSync(yearFile(dir, 2026))).length, 2);

    fs.writeFileSync(path.join(dir, 'BTCUSDT_4h.json'), '{broken');
    assert.deepEqual(await h.read('BTCUSDT', '4h'), []);
    assert.ok(fs.existsSync(path.join(dir, 'BTCUSDT_4h.json')), 'an unreadable old file stays');
});

test('names become paths, so only plain symbols and timeframes are accepted', async () => {
    const h = make(tempDir(), exchange(0, 0), 0);
    await assert.rejects(h.read('../evil', '1d'), /Invalid/);
    await assert.rejects(h.read('BTCUSDT', '../1d'), /Invalid/);
});

test('the daily run is at 00:01 UTC', () => {
    assert.equal(nextRunMs(Date.UTC(2026, 0, 5, 0, 0, 30)), Date.UTC(2026, 0, 5, 0, 1));
    assert.equal(nextRunMs(Date.UTC(2026, 0, 5, 0, 1)), Date.UTC(2026, 0, 6, 0, 1));
    assert.equal(nextRunMs(Date.UTC(2026, 11, 31, 23, 0)), Date.UTC(2027, 0, 1, 0, 1));
});

test('the job syncs every market and timeframe, and one failure does not stop the rest', async () => {
    const calls = [];
    const history = {
        async sync(market, tf, from, opts) {
            calls.push([market, tf, from, opts.fromIfEmpty]);
            if (market === 'SOLUSDT' && tf === '1h') throw Object.assign(new Error('blocked'), { code: 'binance_451' });
        },
    };
    const warnings = [];
    const job = createHistorySync({ history, targets: () => ({ markets: ['BTCUSDT', 'SOLUSDT'], timeframes: ['1h', '1d'] }), fromOf: (tf) => (tf === '1h' ? 100 : 200), log: { ...silentLog, warn: (m) => warnings.push(m) } });
    const res = await job.runOnce();
    assert.deepEqual(calls.map(c => c.slice(0, 2).join('/')), ['BTCUSDT/1h', 'BTCUSDT/1d', 'SOLUSDT/1h', 'SOLUSDT/1d']);
    assert.ok(calls.every(c => c[2] === null), 'never asks further back by itself');
    assert.equal(calls[0][3], 100);
    assert.deepEqual([res.done, res.failed], [3, ['SOLUSDT/1h']]);
    assert.match(warnings[0], /binance_451/);
});

test('the job catches up after startup, and two runs never overlap', async () => {
    let release;
    let runs = 0;
    const history = { sync: () => { runs++; return new Promise(r => { release = r; }); } };
    const job = createHistorySync({ history, targets: () => ({ markets: ['BTCUSDT'], timeframes: ['1d'] }), fromOf: () => 0, log: silentLog });
    job.start({ startupDelayMs: 0 });
    await new Promise(r => setTimeout(r, 20));
    assert.equal(runs, 1, 'runs without waiting for 00:01');
    assert.deepEqual(await job.runOnce(), { skipped: true });
    release();
    job.stop();
});
