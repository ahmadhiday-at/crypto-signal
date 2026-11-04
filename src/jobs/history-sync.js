// Keeps data/history complete: once shortly after startup (catching up on any time the app was off),
// then every day at 00:01 UTC, just after the daily candle closes. Each run only fetches what is
// missing, per market and timeframe. A failure is logged and the next run tries again; Binance
// restrictions (HTTP 451) get no workaround.
const DAY_MS = 86400000;
const RUN_AT_MS = 60000; // 00:01 UTC
const STARTUP_DELAY_MS = 60000;

// The first run time after `t`.
function nextRunMs(t) {
    const today = Math.floor(t / DAY_MS) * DAY_MS + RUN_AT_MS;
    return today > t ? today : today + DAY_MS;
}

// `targets()` returns { markets, timeframes }; `fromOf(tf)` is where a market without history starts.
function createHistorySync({ history, targets, fromOf, now = () => Date.now(), log = console }) {
    let timer = null;
    let running = false;
    let busy = false;

    async function runOnce() {
        if (busy) return { skipped: true };
        busy = true;
        const failed = [];
        let done = 0;
        try {
            const { markets, timeframes } = targets();
            for (const market of markets) {
                for (const tf of timeframes) {
                    try {
                        await history.sync(market, tf, null, { fromIfEmpty: fromOf(tf) });
                        done++;
                    } catch (err) {
                        failed.push(`${market}/${tf}`);
                        log.warn(`[HistorySync] ${market}/${tf}: ${err.code || 'error'}: ${err.message}`);
                    }
                }
            }
            log.log(`[HistorySync] ${done} up to date${failed.length ? `, ${failed.length} failed` : ''}`);
            return { done, failed };
        } finally {
            busy = false;
        }
    }

    function schedule(delay) {
        timer = setTimeout(async () => {
            if (!running) return;
            schedule(nextRunMs(now()) - now());
            await runOnce().catch(err => log.error(`[HistorySync] ${err.message}`));
        }, Math.max(0, delay));
    }

    return {
        runOnce,
        start({ startupDelayMs = STARTUP_DELAY_MS } = {}) {
            if (running) return;
            running = true;
            schedule(startupDelayMs);
        },
        stop() {
            running = false;
            if (timer) clearTimeout(timer);
            timer = null;
        },
    };
}

module.exports = { createHistorySync, nextRunMs };
