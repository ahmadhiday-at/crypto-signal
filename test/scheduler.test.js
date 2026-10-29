const test = require('node:test');
const assert = require('node:assert/strict');
const { createScheduler } = require('../src/jobs/scheduler');
const { silentLog } = require('./helpers');

test('fires once per minute boundary, after the delay, with the UTC boundary time', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const start = Date.UTC(2026, 9, 29, 12, 0, 30);
    let nowMs = start;
    const boundaries = [];
    const scheduler = createScheduler({ runBoundary: async (b) => { boundaries.push(b); } }, { delayMs: 5000, now: () => nowMs, log: silentLog });
    scheduler.start();

    nowMs = Date.UTC(2026, 9, 29, 12, 1, 5);
    t.mock.timers.tick(35000);
    assert.deepEqual(boundaries, [Date.UTC(2026, 9, 29, 12, 1) / 1000]);

    nowMs = Date.UTC(2026, 9, 29, 12, 2, 5);
    t.mock.timers.tick(60000);
    assert.deepEqual(boundaries, [Date.UTC(2026, 9, 29, 12, 1) / 1000, Date.UTC(2026, 9, 29, 12, 2) / 1000]);
    scheduler.stop();
});

test('recovers after the clock is stepped back', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let nowMs = Date.UTC(2026, 9, 29, 12, 1, 5);
    const boundaries = [];
    const scheduler = createScheduler({ runBoundary: async (b) => { boundaries.push(b); } }, { delayMs: 5000, now: () => nowMs, log: silentLog });
    scheduler.start();
    t.mock.timers.tick(60000);
    nowMs = Date.UTC(2026, 9, 29, 11, 31, 5); // NTP step back 30 minutes
    t.mock.timers.tick(60000);
    assert.equal(boundaries[boundaries.length - 1], Date.UTC(2026, 9, 29, 11, 31) / 1000);
    scheduler.stop();
});

test('an early timer does not run the same boundary twice', async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let nowMs = Date.UTC(2026, 9, 29, 12, 1, 5);
    const boundaries = [];
    const scheduler = createScheduler({ runBoundary: async (b) => { boundaries.push(b); } }, { delayMs: 5000, now: () => nowMs, log: silentLog });
    scheduler.start();
    t.mock.timers.tick(60000);
    nowMs = Date.UTC(2026, 9, 29, 12, 2, 4, 999);
    t.mock.timers.tick(60000);
    nowMs = Date.UTC(2026, 9, 29, 12, 2, 5);
    t.mock.timers.tick(60000);
    assert.equal(new Set(boundaries).size, boundaries.length);
    scheduler.stop();
});
