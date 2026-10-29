// Freshness model (ARCHITECTURE.md → O5). Ages are measured from candle close times, never from
// file modification or generation time.
const { tfSeconds } = require('./candles');

const STALE_MULTIPLIER = 2;
// A close time further than this in the future means a clock problem; the input is not trusted.
const FUTURE_TOLERANCE_S = 60;

// Status of one role timeframe input.
function inputStatus(candleCloseTime, tf, nowSec) {
    const len = tfSeconds(tf);
    if (!len || !Number.isFinite(candleCloseTime) || candleCloseTime > nowSec + FUTURE_TOLERANCE_S) {
        return { candle_close_time: null, age_seconds: null, status: 'missing' };
    }
    const age = Math.max(0, Math.floor(nowSec - candleCloseTime));
    return {
        candle_close_time: candleCloseTime,
        age_seconds: age,
        status: age > STALE_MULTIPLIER * len ? 'stale' : 'ok',
    };
}

// Overall status. Precedence: stale > degraded > ok.
//   stale    — the entry timeframe is stale or missing, or any role timeframe is missing
//   degraded — only non-entry role timeframes are stale
//   ok       — every role timeframe is present and fresh
function summaryStatus(inputs, roleTfs, entryTf) {
    const statusOf = (tf) => inputs[tf]?.status || 'missing';
    if (roleTfs.some(tf => statusOf(tf) === 'missing')) return 'stale';
    if (statusOf(entryTf) !== 'ok') return 'stale';
    if (roleTfs.some(tf => statusOf(tf) === 'stale')) return 'degraded';
    return 'ok';
}

// Builds `inputs` for the role timeframes from a map of tf → candle close time.
function computeInputs(closeTimes, roleTfs, nowSec) {
    const inputs = {};
    for (const tf of roleTfs) inputs[tf] = inputStatus(closeTimes[tf], tf, nowSec);
    return inputs;
}

module.exports = { STALE_MULTIPLIER, FUTURE_TOLERANCE_S, inputStatus, summaryStatus, computeInputs };
