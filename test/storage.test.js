const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { tempStorage } = require('./helpers');

test('writes atomically and leaves no temp files', async () => {
    const s = tempStorage();
    await s.writeSnapshot('BTCUSDT', '15m', { a: 1 });
    await s.writeSnapshot('BTCUSDT', '15m', { a: 2 });
    assert.deepEqual(await s.readSnapshot('BTCUSDT', '15m'), { a: 2 });
    assert.deepEqual(fs.readdirSync(s.chartDataDir), ['BTCUSDT_15m.json']);
});

test('concurrent writes never produce a partial file', async () => {
    const s = tempStorage();
    const big = (n) => ({ n, payload: 'x'.repeat(200000) });
    await Promise.all([1, 2, 3, 4, 5].map(n => s.writeMarketSnapshot('BTCUSDT', big(n))));
    const data = await s.readMarketSnapshot('BTCUSDT');
    assert.ok([1, 2, 3, 4, 5].includes(data.n));
    assert.equal(fs.readdirSync(s.marketDataDir).filter(f => f.endsWith('.tmp')).length, 0);
});

test('corrupt JSON reads as null with a reason', async () => {
    const s = tempStorage();
    await s.ensureDirs();
    fs.writeFileSync(path.join(s.chartDataDir, 'BTCUSDT_15m.json'), '{"truncated": ');
    const r = await s.readSnapshotResult('BTCUSDT', '15m');
    assert.equal(r.data, null);
    assert.equal(r.reason, 'corrupt');
    assert.equal((await s.readSnapshotResult('BTCUSDT', '1h')).reason, 'not_found');
});

test('rejects names that could escape the data directory', async () => {
    const s = tempStorage();
    for (const bad of ['../../etc', 'BTC/USDT', 'btcusdt', '', '..']) {
        await assert.rejects(s.readSnapshot(bad, '15m'), { code: 'storage_failed' });
    }
    await assert.rejects(s.writeSnapshot('BTCUSDT', '../x', {}), { code: 'storage_failed' });
    await assert.rejects(s.readMarketSnapshot('../package'), { code: 'storage_failed' });
});

test('cleanupTempFiles removes leftovers from interrupted writes', async () => {
    const s = tempStorage();
    await s.ensureDirs();
    fs.writeFileSync(path.join(s.chartDataDir, 'BTCUSDT_15m.json.123.abcd.tmp'), '{');
    await s.cleanupTempFiles();
    assert.deepEqual(fs.readdirSync(s.chartDataDir), []);
});

test('write failures surface as storage_failed', async () => {
    const s = tempStorage();
    await s.ensureDirs();
    fs.chmodSync(s.chartDataDir, 0o500);
    try {
        await assert.rejects(s.writeSnapshot('BTCUSDT', '15m', { a: 1 }), { code: 'storage_failed' });
    } finally {
        fs.chmodSync(s.chartDataDir, 0o700);
    }
});
