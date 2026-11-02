// RSI/price divergence on closed candles (docs/roadmap/level-2.md). Pure and deterministic.
// Defaults of the calculation config's `divergence` group (config/calculation.json).
const LOOKBACK = 60;      // closed candles searched for swing points
const PIVOT_WIDTH = 3;    // bars on each side a swing must exceed
const MAX_AGE = 10;       // the latest swing must be within this many bars of the last closed candle
const DIVERGENCE_DEFAULTS = { lookback: LOOKBACK, pivot_width: PIVOT_WIDTH, max_age: MAX_AGE };

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

// Indices of swing lows (`low`) or swing highs (`high`) in `values` that also have an RSI value.
function pivots(values, rsi, kind, from, width) {
    const out = [];
    for (let i = Math.max(from, width); i < values.length - width; i++) {
        if (!isNum(values[i]) || !isNum(rsi[i])) continue;
        let ok = true;
        for (let k = 1; k <= width && ok; k++) {
            const a = values[i - k];
            const b = values[i + k];
            ok = kind === 'low' ? values[i] < a && values[i] <= b : values[i] > a && values[i] >= b;
        }
        if (ok) out.push(i);
    }
    return out;
}

// Returns 'bullish', 'bearish' or 'none' for candles {low, high} aligned with `rsi` values.
function detectDivergence(candles, rsi, params = {}) {
    const { lookback, pivot_width: width, max_age: maxAge } = { ...DIVERGENCE_DEFAULTS, ...params };
    if (!Array.isArray(candles) || !Array.isArray(rsi) || candles.length !== rsi.length) return 'none';
    const n = candles.length;
    const from = Math.max(0, n - lookback);
    const lows = candles.map(c => c.low);
    const highs = candles.map(c => c.high);
    const recent = (i) => n - 1 - i <= maxAge;

    const pl = pivots(lows, rsi, 'low', from, width);
    if (pl.length >= 2) {
        const [a, b] = pl.slice(-2);
        if (recent(b) && lows[b] < lows[a] && rsi[b] > rsi[a]) return 'bullish';
    }
    const ph = pivots(highs, rsi, 'high', from, width);
    if (ph.length >= 2) {
        const [a, b] = ph.slice(-2);
        if (recent(b) && highs[b] > highs[a] && rsi[b] < rsi[a]) return 'bearish';
    }
    return 'none';
}

module.exports = { detectDivergence, LOOKBACK, PIVOT_WIDTH, MAX_AGE, DIVERGENCE_DEFAULTS };
