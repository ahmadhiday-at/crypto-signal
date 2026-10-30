const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const WebSocket = require('ws');
const { createApp, createHostCheck } = require('../src/app');
const { WsManager } = require('../src/websocket/ws.manager');
const { createMarketEngine } = require('../src/services/market.service');
const { fakeBinance, tempStorage, testConfig, silentLog } = require('./helpers');

const MIDNIGHT = Date.UTC(2026, 9, 29) / 1000;

async function startServer() {
    const clock = { ms: (MIDNIGHT + 5) * 1000 };
    const binance = fakeBinance({ now: () => clock.ms });
    const engine = createMarketEngine({
        storage: tempStorage(), binance, indicators: require('../src/services/indicator.service'),
        config: testConfig, now: () => clock.ms, log: silentLog,
    });
    const config = { ...testConfig, ALLOWED_HOSTS: ['localhost', '127.0.0.1', '[::1]'] };
    const app = createApp({ engine, config, log: silentLog });
    const server = http.createServer(app);
    const ws = new WsManager();
    ws.init(server, {
        isValidSubscription: (m, tf) => engine.isMarket(m) && engine.isTimeframe(tf),
        isAllowedHost: createHostCheck(config.ALLOWED_HOSTS),
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    const base = `http://127.0.0.1:${server.address().port}`;
    return {
        base, engine, binance, clock, ws, server,
        close: () => { ws.close(); return new Promise(r => server.close(r)); },
    };
}

const req = (base, path, opts = {}) => fetch(base + path, opts).then(async r => ({ status: r.status, headers: r.headers, body: await r.json().catch(() => null) }));

test('market state endpoint serves the contract with freshness', async (t) => {
    const s = await startServer();
    t.after(s.close);
    await s.engine.runBoundary(MIDNIGHT);
    const r = await req(s.base, '/api/market/BTCUSDT');
    assert.equal(r.status, 200);
    assert.equal(r.body.schema_version, 2);
    assert.equal(r.body.status, 'ok');
    assert.equal(r.headers.get('x-powered-by'), null);
    assert.equal(r.headers.get('x-content-type-options'), 'nosniff');
});

test('market state endpoint returns 503 diagnostics when inputs are missing', async (t) => {
    const s = await startServer();
    t.after(s.close);
    s.binance.failures['1d'] = Object.assign(new Error('x'), { code: 'binance_451' });
    const r = await req(s.base, '/api/market/BTCUSDT');
    assert.equal(r.status, 503);
    assert.equal(r.body.error, 'market_state_unavailable');
    assert.equal(r.body.status, 'stale');
});

test('unknown markets, timeframes and traversal attempts are rejected before storage or Binance', async (t) => {
    const s = await startServer();
    t.after(s.close);
    for (const path of ['/api/market/ETHUSDT', '/api/market/..%2F..%2Fpackage', '/api/BTCUSDT/2h', '/api/..%2Fmarket%2FBTCUSDT/15m', '/api/btcusdt/15m']) {
        const r = await req(s.base, path);
        assert.equal(r.status, 404, path);
    }
    assert.equal(s.binance.calls.length, 0);
    assert.equal((await req(s.base, '/api/nope/a/b')).status, 404);
});

test('timeframe endpoint reports candle close time and freshness', async (t) => {
    const s = await startServer();
    t.after(s.close);
    const r = await req(s.base, '/api/BTCUSDT/15m');
    assert.equal(r.status, 200);
    assert.equal(r.body.candle_close_time, MIDNIGHT);
    assert.equal(r.body.status, 'ok');
    assert.ok(r.body.forming_candle);
});

test('reset rejects GET and cross-site requests', async (t) => {
    const s = await startServer();
    t.after(s.close);
    const get = await req(s.base, '/api/reset');
    assert.equal(get.status, 405);
    assert.equal(get.headers.get('allow'), 'POST');
    assert.equal((await req(s.base, '/api/reset', { method: 'POST' })).status, 403, 'missing action header');
    const crossOrigin = await req(s.base, '/api/reset', { method: 'POST', headers: { 'X-Requested-With': 'crypto-signal', Origin: 'https://evil.example' } });
    assert.equal(crossOrigin.status, 403);
    const crossSite = await req(s.base, '/api/reset', { method: 'POST', headers: { 'X-Requested-With': 'crypto-signal', 'Sec-Fetch-Site': 'cross-site' } });
    assert.equal(crossSite.status, 403);
    assert.equal(s.binance.calls.length, 0);
});

test('reset runs for same-origin requests and reports a concurrent reset', async (t) => {
    const s = await startServer();
    t.after(s.close);
    s.binance.delayMs = 30;
    const headers = { 'X-Requested-With': 'crypto-signal', Origin: s.base };
    const first = req(s.base, '/api/reset', { method: 'POST', headers });
    await new Promise(r => setTimeout(r, 5));
    const second = await req(s.base, '/api/reset', { method: 'POST', headers });
    assert.equal(second.status, 409);
    const done = await first;
    assert.equal(done.status, 200);
    assert.equal(done.body.success, true);
    const third = await req(s.base, '/api/reset', { method: 'POST', headers });
    assert.equal(third.status, 429, 'resets are rate limited');
    assert.ok(Number(third.headers.get('retry-after')) > 0);
});

test('reset reports failed timeframes with 502 and keeps going', async (t) => {
    const s = await startServer();
    t.after(s.close);
    s.binance.failures['1h'] = Object.assign(new Error('x'), { code: 'binance_451' });
    const r = await req(s.base, '/api/reset', { method: 'POST', headers: { 'X-Requested-With': 'crypto-signal' } });
    assert.equal(r.status, 502);
    assert.equal(r.body.success, false);
    assert.deepEqual(r.body.results.BTCUSDT.failed, [{ timeframe: '1h', error: 'binance_451' }]);
    assert.deepEqual(r.body.results.BTCUSDT.refreshed.sort(), ['15m', '1d', '4h']);
});

test('health endpoint exposes per-timeframe diagnostics without internals', async (t) => {
    const s = await startServer();
    t.after(s.close);
    s.binance.failures['4h'] = Object.assign(new Error('secret detail'), { code: 'timeout' });
    await s.engine.runBoundary(MIDNIGHT);
    const r = await req(s.base, '/api/health');
    assert.equal(r.status, 200);
    assert.equal(r.body.markets.BTCUSDT['4h'].last_error.code, 'timeout');
    assert.ok(!JSON.stringify(r.body).includes('secret detail'));
});

function wsConnect(base, headers = {}) {
    return new Promise((resolve) => {
        const ws = new WebSocket(base.replace('http', 'ws'), { headers });
        ws.on('open', () => resolve({ ws, ok: true }));
        ws.on('error', () => resolve({ ws, ok: false }));
    });
}

test('websocket rejects cross-origin pages and invalid subscriptions', async (t) => {
    const s = await startServer();
    t.after(s.close);
    const evil = await wsConnect(s.base, { Origin: 'https://evil.example' });
    assert.equal(evil.ok, false);

    const { ws, ok } = await wsConnect(s.base, { Origin: s.base });
    assert.equal(ok, true);
    const reply = new Promise(r => ws.once('message', m => r(JSON.parse(m))));
    ws.send(JSON.stringify({ type: 'subscribe', market: '../x', timeframe: '15m' }));
    assert.equal((await reply).type, 'error');

    ws.send(JSON.stringify({ type: 'subscribe', market: 'BTCUSDT', timeframe: '15m' }));
    await new Promise(r => setTimeout(r, 20));
    const got = new Promise(r => ws.once('message', m => r(JSON.parse(m))));
    s.ws.broadcastSummary('BTCUSDT');
    assert.deepEqual(await got, { type: 'summary_ready', market: 'BTCUSDT' });
    ws.close();
});

// Raw request so the Host header can be set (fetch does not allow it).
function rawRequest(base, path, { method = 'GET', headers = {} } = {}) {
    const u = new URL(base);
    return new Promise((resolve, reject) => {
        const r = http.request({ host: u.hostname, port: u.port, path, method, headers }, (res) => {
            let body = '';
            res.on('data', d => { body += d; });
            res.on('end', () => resolve({ status: res.statusCode, body }));
        });
        r.on('error', reject);
        r.end();
    });
}

test('requests addressed to an unknown host name are refused (DNS rebinding)', async (t) => {
    const s = await startServer();
    t.after(s.close);
    const rebound = await rawRequest(s.base, '/api/reset', { method: 'POST', headers: { Host: 'evil.example:11000', 'X-Requested-With': 'crypto-signal', Origin: 'http://evil.example:11000' } });
    assert.equal(rebound.status, 403);
    assert.match(rebound.body, /host_not_allowed/);
    assert.equal((await rawRequest(s.base, '/api/config', { headers: { Host: 'evil.example' } })).status, 403);
    assert.equal((await rawRequest(s.base, '/api/config', { headers: { Host: `localhost:${new URL(s.base).port}` } })).status, 200);
    const ws = await wsConnect(s.base, { Host: 'evil.example', Origin: 'http://evil.example' });
    assert.equal(ws.ok, false);
    assert.equal(s.binance.calls.length, 0);
});

test('view routes serve the dashboard at /:market and the chart at /:market/:timeframe', async (t) => {
    const s = await startServer();
    t.after(s.close);
    const page = async (path) => {
        const r = await fetch(s.base + path);
        return { status: r.status, title: (/<title>([^<]*)/.exec(await r.text()) || [])[1] };
    };
    assert.deepEqual(await page('/BTCUSDT'), { status: 200, title: 'Market State Engine | Dashboard' });
    assert.deepEqual(await page('/BTCUSDT/1h'), { status: 200, title: 'Real-time Trading Chart' });
    assert.equal((await page('/js/market-status.js')).status, 200, 'static files still win over view routes');
    assert.equal((await req(s.base, '/api/config')).status, 200, 'api routes still win over view routes');
});
