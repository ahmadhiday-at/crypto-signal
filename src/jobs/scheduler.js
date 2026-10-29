// One UTC-aligned timer per process. It fires a few seconds after every minute boundary (so Binance
// has finalised the candle) and hands the boundary to the engine, which decides which timeframes
// closed at that instant.
const BOUNDARY_DELAY_MS = 5000;
const MINUTE_MS = 60000;

function createScheduler(engine, { delayMs = BOUNDARY_DELAY_MS, now = () => Date.now(), log = console } = {}) {
    let timer = null;
    let running = false;
    let lastBoundary = null;

    function scheduleNext() {
        const t = now();
        const next = (Math.floor((t - delayMs) / MINUTE_MS) + 1) * MINUTE_MS + delayMs;
        timer = setTimeout(tick, Math.max(0, next - t));
    }

    async function tick() {
        if (!running) return;
        scheduleNext();
        const boundarySec = Math.floor((now() - delayMs) / MINUTE_MS) * 60;
        // A timer that fires marginally early must not run the same boundary twice. A larger
        // backward jump means the clock was stepped back; resynchronise instead of stalling.
        if (lastBoundary !== null && boundarySec <= lastBoundary && boundarySec > lastBoundary - 120) return;
        lastBoundary = boundarySec;
        try {
            await engine.runBoundary(boundarySec);
        } catch (err) {
            log.error('[Scheduler] Boundary run failed:', err.message);
        }
    }

    return {
        start() {
            if (running) return;
            running = true;
            scheduleNext();
            log.log(`[Scheduler] Boundary scheduler started (UTC, +${delayMs / 1000}s after each close).`);
        },
        stop() {
            running = false;
            if (timer) clearTimeout(timer);
            timer = null;
        },
    };
}

module.exports = { createScheduler, BOUNDARY_DELAY_MS };
