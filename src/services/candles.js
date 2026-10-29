// Pure candle helpers: parsing, validation, closed-candle selection and UTC boundary math.
// All times are Unix seconds, UTC.

const TF_SECONDS = {
    '1m': 60,
    '3m': 180,
    '5m': 300,
    '15m': 900,
    '30m': 1800,
    '1h': 3600,
    '2h': 7200,
    '4h': 14400,
    '6h': 21600,
    '8h': 28800,
    '12h': 43200,
    '1d': 86400,
    '1w': 604800,
};

// Binance weekly candles open on Monday 00:00 UTC; the Unix epoch was a Thursday.
const WEEK_OFFSET = 4 * 86400;

function tfSeconds(tf) {
    return TF_SECONDS[tf] || null;
}

function boundaryOffset(tf) {
    return tf === '1w' ? WEEK_OFFSET : 0;
}

// True when `sec` is exactly a candle boundary (open/close instant) for `tf`.
function isBoundary(sec, tf) {
    const len = tfSeconds(tf);
    if (!len) return false;
    return (sec - boundaryOffset(tf)) % len === 0;
}

// Close time of the most recent candle that is fully closed at `nowSec`.
function expectedLastClose(nowSec, tf) {
    const len = tfSeconds(tf);
    if (!len) return null;
    const off = boundaryOffset(tf);
    return Math.floor((nowSec - off) / len) * len + off;
}

const isFiniteNumber = (v) => typeof v === 'number' && Number.isFinite(v);

// Converts a raw Binance kline row into a candle, or returns null when the row is malformed.
// Binance row: [openTimeMs, open, high, low, close, volume, closeTimeMs, ...]
function parseKline(row, tf) {
    if (!Array.isArray(row) || row.length < 7) return null;
    const len = tfSeconds(tf);
    const openMs = Number(row[0]);
    const closeMs = Number(row[6]);
    const candle = {
        time: openMs / 1000,
        open: parseFloat(row[1]),
        high: parseFloat(row[2]),
        low: parseFloat(row[3]),
        close: parseFloat(row[4]),
        volume: parseFloat(row[5]),
        // End of the candle interval (exclusive), i.e. open + timeframe length.
        close_time: Math.round((closeMs + 1) / 1000),
    };
    const numeric = ['time', 'open', 'high', 'low', 'close', 'volume', 'close_time'];
    if (!numeric.every(k => isFiniteNumber(candle[k]))) return null;
    if (!Number.isInteger(candle.time)) return null;
    if (candle.open <= 0 || candle.high <= 0 || candle.low <= 0 || candle.close <= 0 || candle.volume < 0) return null;
    if (candle.high < candle.low || candle.high < Math.max(candle.open, candle.close) || candle.low > Math.min(candle.open, candle.close)) return null;
    if (len && candle.close_time - candle.time !== len) return null;
    return candle;
}

// Parses a raw kline response. Malformed rows are dropped and counted, never repaired.
function parseKlines(raw, tf) {
    if (!Array.isArray(raw)) return { candles: [], rejected: 0, valid: false };
    const candles = [];
    let rejected = 0;
    for (const row of raw) {
        const c = parseKline(row, tf);
        if (c) candles.push(c);
        else rejected++;
    }
    return { candles, rejected, valid: true };
}

// Sorts by open time and removes duplicates (the later row for the same open time wins).
function normalizeCandles(candles) {
    const byTime = new Map();
    for (const c of candles) byTime.set(c.time, c);
    return [...byTime.values()].sort((a, b) => a.time - b.time);
}

// Splits candles into those closed at `nowSec` and the (at most one) forming candle.
// With `lastIsCurrent`, the final candle is treated as still forming unless it closed more than
// `graceSec` ago: Binance always returns its current candle last, so this relies on Binance's
// clock rather than the host's when the two disagree.
function splitClosed(candles, nowSec, { lastIsCurrent = false, graceSec = 60 } = {}) {
    const closed = [];
    let forming = null;
    candles.forEach((c, i) => {
        const isLast = i === candles.length - 1;
        if (c.close_time <= nowSec && !(lastIsCurrent && isLast && c.close_time > nowSec - graceSec)) closed.push(c);
        else if (c.time <= nowSec) forming = c;
    });
    return { closed, forming };
}

// Number of missing candles between consecutive candles.
function countGaps(candles, tf) {
    const len = tfSeconds(tf);
    if (!len) return 0;
    let gaps = 0;
    for (let i = 1; i < candles.length; i++) {
        const step = candles[i].time - candles[i - 1].time;
        if (step > len) gaps += Math.round(step / len) - 1;
    }
    return gaps;
}

module.exports = {
    TF_SECONDS,
    tfSeconds,
    isBoundary,
    expectedLastClose,
    parseKline,
    parseKlines,
    normalizeCandles,
    splitClosed,
    countGaps,
};
