const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('events');
const { createBacktestRunner } = require('../src/services/backtest-runner');
const { silentLog } = require('./helpers');

// A child process stand-in: the test writes output and ends it.
function fakeSpawn() {
    const children = [];
    const spawn = (cmd, args) => {
        const child = new EventEmitter();
        child.args = args;
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        child.killed = false;
        child.kill = () => { child.killed = true; child.emit('close', null); };
        children.push(child);
        return child;
    };
    return { spawn, children };
}

const tick = () => new Promise(r => setImmediate(r));

test('runs markets one after another and reports progress and failures', async () => {
    const f = fakeSpawn();
    const runner = createBacktestRunner({ spawn: f.spawn, script: 'bt.js', log: silentLog });
    const started = runner.start(['BTCUSDT', 'SOLUSDT']);
    // The first market starts at once; the others wait.
    assert.deepEqual(started.jobs.map(j => j.state), ['running', 'queued']);
    assert.equal(runner.start(['BNBUSDT']).error, 'backtest_running');

    await tick();
    assert.equal(f.children.length, 1);
    assert.deepEqual(f.children[0].args, ['bt.js', 'BTCUSDT']);
    f.children[0].stdout.emit('data', '[History] BTCUSDT/15m 100 candles\r[Backtest] 500 candles');
    let s = runner.status();
    assert.equal(s.running, true);
    assert.equal(s.jobs.BTCUSDT.state, 'running');
    assert.equal(s.jobs.BTCUSDT.progress, '[Backtest] 500 candles');
    assert.equal(s.jobs.SOLUSDT.state, 'queued');

    f.children[0].emit('close', 0);
    await tick();
    f.children[1].stderr.emit('data', '\n[Backtest] failed (binance_451): restricted\n');
    f.children[1].emit('close', 1);
    await tick();
    s = runner.status();
    assert.equal(s.running, false);
    assert.equal(s.jobs.BTCUSDT.state, 'done');
    assert.equal(s.jobs.SOLUSDT.state, 'failed');
    assert.equal(s.jobs.SOLUSDT.error, '[Backtest] failed (binance_451): restricted');
    assert.equal(runner.start(['BNBUSDT']).jobs.length, 1);
});

test('a run past the time limit is stopped', async () => {
    const f = fakeSpawn();
    const runner = createBacktestRunner({ spawn: f.spawn, maxRunMs: 10, log: silentLog });
    runner.start(['BTCUSDT']);
    await new Promise(r => setTimeout(r, 30));
    assert.equal(f.children[0].killed, true);
    assert.equal(runner.status().jobs.BTCUSDT.error, 'timeout');
});
