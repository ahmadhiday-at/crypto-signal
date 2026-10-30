const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { createMarketEngine } = require('../src/services/market.service');
const { validateMarketState } = require('../src/services/contract');
const { BinanceError } = require('../src/services/binance.service');
const { expectedLastClose } = require('../src/services/candles');
const { fakeBinance, tempStorage, testConfig, silentLog } = require('./helpers');

const MIDNIGHT = Date.UTC(2026, 9, 29) / 1000;

function setup({ nowSec = MIDNIGHT + 5 } = {}) {
    const clock = { ms: nowSec * 1000 };
    const now = () => clock.ms;
    const binance = fakeBinance({ now });
    const storage = tempStorage();
    const events = [];
    const engine = createMarketEngine({
        storage,
        binance,
        indicators: require('../src/services/indicator.service'),
        config: testConfig,
        now,
        log: silentLog,
        notify: {
            timeframeUpdated: (m, tf) => events.push(`tf:${tf}`),
            summaryUpdated: (m) => events.push('summary'),
        },
    });
    return { engine, binance, storage, clock, events };
}

test('stores closed candles only; the forming candle is kept apart', async () => {
    const { engine, storage, clock } = setup({ nowSec: MIDNIGHT + 7 * 60 });
    const r = await engine.updateTimeframe('BTCUSDT', '15m');
    assert.equal(r.updated, true);
    const snap = await storage.readSnapshot('BTCUSDT', '15m');
    const nowSec = clock.ms / 1000;
    assert.equal(snap.candle_close_time, expectedLastClose(nowSec, '15m'));
    assert.ok(snap.candles.every(c => c.close_time <= nowSec));
    assert.equal(snap.forming_candle.time, MIDNIGHT);
    assert.ok(!snap.candles.some(c => c.time === snap.forming_candle.time));
    assert.equal(snap.indicators.volume.length, snap.candles.length, 'indicators cover closed candles only');
});

test('concurrent updates of the same timeframe share one fetch', async () => {
    const { engine, binance } = setup();
    binance.delayMs = 20;
    const [a, b] = await Promise.all([engine.updateTimeframe('BTCUSDT', '15m'), engine.updateTimeframe('BTCUSDT', '15m')]);
    assert.equal(binance.calls.length, 1);
    assert.deepEqual(a, b);
});

test('boundary run updates every closing timeframe, then publishes one summary', async () => {
    const { engine, binance, storage, events } = setup();
    await engine.runBoundary(MIDNIGHT);
    assert.deepEqual([...binance.calls].sort(), ['BTCUSDT|15m', 'BTCUSDT|1d', 'BTCUSDT|1h', 'BTCUSDT|4h']);
    assert.equal(events.filter(e => e === 'summary').length, 1);
    assert.equal(events[events.length - 1], 'summary', 'summary published after all timeframe updates');

    const summary = await storage.readMarketSnapshot('BTCUSDT');
    assert.deepEqual(validateMarketState(summary), []);
    assert.equal(summary.schema_version, 2);
    assert.equal(summary.status, 'ok');
    assert.equal(summary.inputs['15m'].candle_close_time, MIDNIGHT);
    assert.equal(summary.inputs['1d'].candle_close_time, MIDNIGHT);
    assert.equal(summary.timestamp, MIDNIGHT - 900, 'timestamp is the open time of the last closed entry candle');
});

test('a quarter-hour boundary only updates the 15m timeframe once others are current', async () => {
    const { engine, binance, clock } = setup();
    await engine.runBoundary(MIDNIGHT);
    binance.calls.length = 0;
    clock.ms = (MIDNIGHT + 900 + 5) * 1000;
    await engine.runBoundary(MIDNIGHT + 900);
    assert.deepEqual(binance.calls, ['BTCUSDT|15m']);
});

test('served status turns stale as data ages, without any new update', async () => {
    const { engine, clock } = setup();
    await engine.runBoundary(MIDNIGHT);
    assert.equal((await engine.getMarketState('BTCUSDT')).body.status, 'ok');
    clock.ms += 31 * 60 * 1000;
    const r = await engine.getMarketState('BTCUSDT');
    assert.equal(r.httpStatus, 200);
    assert.equal(r.body.status, 'stale');
    assert.equal(r.body.inputs['15m'].status, 'stale');
    assert.equal(r.body.inputs['15m'].age_seconds, 31 * 60 + 5, 'measured from the candle close, not the fetch');
    assert.equal(r.body.signal.action, 'WAIT', 'stale data never yields BUY/SELL');
    assert.ok(r.body.signal.reasons.some(x => x.code === 'data_not_current'));
});

test('only stale higher timeframes give a degraded status', async () => {
    const { engine, binance } = setup();
    binance.options['1d'] = { shiftCandles: 3 };
    await engine.runBoundary(MIDNIGHT);
    const r = await engine.getMarketState('BTCUSDT');
    assert.equal(r.body.inputs['1d'].status, 'stale');
    assert.equal(r.body.status, 'degraded');
});

test('a missing role timeframe yields an explicit 503, not a fabricated state', async () => {
    const { engine, binance } = setup();
    binance.failures['4h'] = new BinanceError('timeout', 'timed out');
    await engine.runBoundary(MIDNIGHT);
    const r = await engine.getMarketState('BTCUSDT');
    assert.equal(r.httpStatus, 503);
    assert.equal(r.body.status, 'stale');
    assert.equal(r.body.error, 'market_state_unavailable');
    assert.equal(r.body.inputs['4h'].status, 'missing');
    assert.ok(r.body.errors.includes('timeout'));
    assert.ok(r.body.errors.includes('missing_input'));
    assert.equal(r.body.price, undefined);
});

test('a failed refresh keeps the last good data and reports the error', async () => {
    const { engine, binance, storage, clock } = setup();
    await engine.runBoundary(MIDNIGHT);
    const before = await storage.readSnapshot('BTCUSDT', '15m');

    clock.ms = (MIDNIGHT + 900 + 5) * 1000;
    binance.failures['15m'] = new BinanceError('binance_451', 'restricted');
    await engine.runBoundary(MIDNIGHT + 900);

    assert.deepEqual(await storage.readSnapshot('BTCUSDT', '15m'), before);
    const r = await engine.getMarketState('BTCUSDT');
    assert.equal(r.httpStatus, 200);
    assert.deepEqual(r.body.errors, ['binance_451']);
    assert.equal(engine.healthReport().markets.BTCUSDT['15m'].last_error.code, 'binance_451');
});

test('older fetched data never overwrites newer stored data', async () => {
    const { engine, binance, storage } = setup();
    await engine.updateTimeframe('BTCUSDT', '15m');
    binance.options['15m'] = { shiftCandles: 2 };
    const r = await engine.updateTimeframe('BTCUSDT', '15m');
    assert.equal(r.reason, 'older');
    assert.equal((await storage.readSnapshot('BTCUSDT', '15m')).candle_close_time, MIDNIGHT);
});

test('startup ignores corrupt and legacy cache files and refetches them', async () => {
    const { engine, binance, storage } = setup();
    await storage.ensureDirs();
    fs.writeFileSync(path.join(storage.chartDataDir, 'BTCUSDT_15m.json'), '{"broken":');
    fs.writeFileSync(path.join(storage.chartDataDir, 'BTCUSDT_1h.json'), JSON.stringify({ market: 'BTCUSDT', timeframe: '1h', price: 1 }));
    fs.writeFileSync(path.join(storage.marketDataDir, 'BTCUSDT.json'), JSON.stringify({ market: 'BTCUSDT', price: 1 }));
    await engine.initialize();
    assert.deepEqual([...binance.calls].sort(), ['BTCUSDT|15m', 'BTCUSDT|1d', 'BTCUSDT|1h', 'BTCUSDT|4h']);
    const summary = await storage.readMarketSnapshot('BTCUSDT');
    assert.equal(summary.schema_version, 2);
});

test('startup skips timeframes that are already current', async () => {
    const { engine, binance, storage, clock } = setup();
    await engine.runBoundary(MIDNIGHT);
    const restarted = createMarketEngine({ storage, binance, indicators: require('../src/services/indicator.service'), config: testConfig, now: () => clock.ms, log: silentLog });
    binance.calls.length = 0;
    await restarted.initialize();
    assert.deepEqual(binance.calls, []);
});

test('failed timeframes are retried on later ticks, throttled', async () => {
    const { engine, binance, clock } = setup();
    binance.failures['1d'] = new BinanceError('timeout', 'timed out');
    await engine.runBoundary(MIDNIGHT);
    delete binance.failures['1d'];

    binance.calls.length = 0;
    clock.ms = (MIDNIGHT + 60 + 5) * 1000;
    await engine.runBoundary(MIDNIGHT + 60);
    assert.deepEqual(binance.calls, [], 'not retried within the throttle window');

    clock.ms = (MIDNIGHT + 300 + 5) * 1000;
    await engine.runBoundary(MIDNIGHT + 300);
    assert.deepEqual(binance.calls, ['BTCUSDT|1d']);
});

test('reset refetches everything and rejects a concurrent reset', async () => {
    const { engine, binance } = setup();
    binance.delayMs = 10;
    const first = engine.reset();
    assert.equal(engine.reset().error, 'reset_in_progress');
    const results = await first.run;
    assert.equal(results.BTCUSDT.summary, 'ok');
    assert.equal(binance.calls.length, 4);
    const again = engine.reset();
    assert.equal(again.error, 'reset_cooldown');
    assert.ok(again.retryAfter > 0 && again.retryAfter <= 60);
});

test('a summary that fails to write is reported as storage_failed', async () => {
    const { engine, storage } = setup();
    await engine.runBoundary(MIDNIGHT);
    storage.writeMarketSnapshot = async () => { throw Object.assign(new Error('disk full'), { code: 'storage_failed' }); };
    const r = await engine.rebuildSummary('BTCUSDT');
    assert.equal(r.reason, 'storage_failed');
    assert.ok((await engine.getMarketState('BTCUSDT')).body.errors.includes('storage_failed'));
});

test('summary rebuilds for one market never run concurrently', async () => {
    const { engine, storage } = setup();
    await engine.runBoundary(MIDNIGHT);
    let active = 0;
    let maxActive = 0;
    const write = storage.writeMarketSnapshot.bind(storage);
    storage.writeMarketSnapshot = async (...args) => {
        active++;
        maxActive = Math.max(maxActive, active);
        await new Promise(r => setTimeout(r, 10));
        await write(...args);
        active--;
    };
    await Promise.all([1, 2, 3].map(() => engine.rebuildSummary('BTCUSDT')));
    assert.equal(maxActive, 1);
});

test('duplicate role timeframes still produce a usable summary', async () => {
    const config = { ...testConfig, TIMEFRAMES: ['15m', '4h', '1d'], TF_ROLES: { htf: '1d', structure: '4h', mid: '15m', entry: '15m' } };
    const clock = { ms: (MIDNIGHT + 5) * 1000 };
    const binance = fakeBinance({ now: () => clock.ms });
    const engine = createMarketEngine({ storage: tempStorage(), binance, indicators: require('../src/services/indicator.service'), config, now: () => clock.ms, log: silentLog });
    await engine.runBoundary(MIDNIGHT);
    const r = await engine.getMarketState('BTCUSDT');
    assert.equal(r.httpStatus, 200);
    assert.deepEqual(r.body.timeframe_list, ['1d', '4h', '15m']);
});

test('the last candle Binance returns is not treated as closed just after its close time', async () => {
    // Binance has not opened the next candle yet (or the host clock runs ahead).
    const { engine, binance, storage, clock } = setup({ nowSec: MIDNIGHT + 5 });
    for (const tf of ['1h', '4h', '1d']) await engine.updateTimeframe('BTCUSDT', tf);
    binance.options['15m'] = { includeForming: false };
    const r = await engine.updateTimeframe('BTCUSDT', '15m');
    assert.equal(r.updated, true);
    const snap = await storage.readSnapshot('BTCUSDT', '15m');
    assert.equal(snap.candle_close_time, MIDNIGHT - 900, 'the just-closed candle is held back');
    assert.equal(snap.forming_candle.time, MIDNIGHT - 900);

    // Not throttled: the next minute tick retries because the fetch itself succeeded.
    delete binance.options['15m'];
    binance.calls.length = 0;
    clock.ms = (MIDNIGHT + 65) * 1000;
    await engine.runBoundary(MIDNIGHT + 60);
    assert.deepEqual(binance.calls, ['BTCUSDT|15m']);
    assert.equal((await storage.readSnapshot('BTCUSDT', '15m')).candle_close_time, MIDNIGHT);
});

test('snapshots with close times in the future are not trusted', async () => {
    const { engine, storage, clock } = setup();
    await engine.runBoundary(MIDNIGHT);
    clock.ms -= 3600 * 1000; // clock stepped back an hour
    const r = await engine.getMarketState('BTCUSDT');
    assert.equal(r.httpStatus, 503);
    assert.equal(r.body.status, 'stale');
});

test('a stored summary that fails validation does not block publishing', async () => {
    const { engine, storage } = setup();
    await storage.ensureDirs();
    fs.writeFileSync(path.join(storage.marketDataDir, 'BTCUSDT.json'), JSON.stringify({ schema_version: 2, inputs: { '15m': { candle_close_time: 9e12 } } }));
    await engine.runBoundary(MIDNIGHT);
    assert.equal((await engine.getMarketState('BTCUSDT')).httpStatus, 200);
});

test('a snapshot corrupted after startup is refetched on the next tick', async () => {
    const { engine, binance, storage, clock } = setup();
    await engine.runBoundary(MIDNIGHT);
    fs.writeFileSync(path.join(storage.chartDataDir, 'BTCUSDT_1d.json'), '{bad');
    await engine.rebuildSummary('BTCUSDT');
    binance.calls.length = 0;
    clock.ms = (MIDNIGHT + 65) * 1000;
    await engine.runBoundary(MIDNIGHT + 60);
    assert.deepEqual(binance.calls, ['BTCUSDT|1d']);
});

test('many concurrent summary requests share queued builds', async () => {
    const { engine, storage } = setup();
    await engine.runBoundary(MIDNIGHT);
    let writes = 0;
    const write = storage.writeMarketSnapshot.bind(storage);
    storage.writeMarketSnapshot = async (...a) => { writes++; await new Promise(r => setTimeout(r, 5)); return write(...a); };
    await Promise.all(Array.from({ length: 20 }, () => engine.rebuildSummary('BTCUSDT')));
    assert.ok(writes <= 2, `expected at most 2 builds, got ${writes}`);
});
