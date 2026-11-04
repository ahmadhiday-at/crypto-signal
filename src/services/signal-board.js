// Signal board (GET /api/signals): the view a trader reads first. One row per market with the current
// long/short/wait signal, its plan and backtest verdict, plus the signals still open and the latest
// results from the signal log. Pure: the controller passes in what it read.
const { isCurrentRecord } = require('./signal-log');
const { tfSeconds } = require('./candles');

const RECENT_LIMIT = 20;
const SIDES = { BUY: 'long', SELL: 'short' };

// A signal-log record without its features, in the board's terms.
function tradeOf(r, expiryCandles) {
    const seconds = r.timeframe && expiryCandles ? tfSeconds(r.timeframe) * expiryCandles : null;
    return {
        id: r.id,
        market: r.market,
        timeframe: r.timeframe,
        side: SIDES[r.signal] ?? null,
        strength: r.strength ?? null,
        score: r.features?.score ?? null,
        entry: r.price,
        stop_loss: r.sl,
        take_profit_1: r.tp1,
        take_profit_2: r.tp2 ?? null,
        risk_reward: r.risk_reward ?? null,
        opened_at: r.candle_close_time,
        expires_at: seconds && r.candle_close_time ? r.candle_close_time + seconds : null,
        result: r.result,
        rr: r.rr,
        closed_at: r.closed_at,
        bars: r.bars,
    };
}

// `state` is the /api/market body (null when unavailable), `log` the engine.signalRecords() body or
// null, `edge` the edgeSummary() result or null, `roles` the role timeframes of the live signal.
function boardRow({ market, state, log, edge, roles, expiryCandles }) {
    const records = log ? log.records.filter(r => isCurrentRecord(r, log.entry_tf, log.model)) : [];
    const taken = records.filter(r => !r.filtered);
    const sig = state?.signal ?? null;
    return {
        market,
        status: state?.status ?? 'unavailable',
        errors: state?.errors ?? [],
        price: state?.price ?? null,
        generated_at: state?.generated_at ?? null,
        signal: sig ? {
            action: sig.action,
            direction: SIDES[sig.action] ?? null,
            // The way the score points when a filter or stale data holds the signal back.
            setup: sig.plan?.side ?? null,
            score: sig.score,
            strength: sig.strength,
            filtered: sig.filtered,
            filters: sig.filters,
            plan: sig.plan,
        } : null,
        trends: Object.fromEntries(Object.entries(roles).map(([role, tf]) => [role, { timeframe: tf, trend: state?.timeframes?.[tf]?.trend ?? null }])),
        edge: edge ? {
            verdict: edge.verdict,
            reasons: edge.reasons,
            expectancy_r: edge.backtest?.taken?.expectancy_r ?? null,
            out_of_sample_r: edge.backtest?.out_of_sample?.expectancy_r ?? null,
            trades: edge.backtest?.taken?.trades ?? null,
        } : null,
        open: taken.filter(r => r.result === null).map(r => tradeOf(r, expiryCandles)),
        closed: taken.filter(r => r.result !== null).map(r => tradeOf(r, expiryCandles)),
        // Records from earlier timeframes or models: kept in the log, not counted here.
        older_records: log ? log.records.length - records.length : 0,
    };
}

// `rows` are boardRow() results. The closed trades move to one list, newest first.
function buildBoard({ rows, model, roles, now }) {
    const recent = rows.flatMap(r => r.closed)
        .sort((a, b) => (b.closed_at ?? 0) - (a.closed_at ?? 0))
        .slice(0, RECENT_LIMIT);
    const count = (dir) => rows.filter(r => r.signal?.direction === dir).length;
    return {
        generated_at: now,
        model,
        roles,
        totals: {
            long: count('long'),
            short: count('short'),
            wait: rows.length - count('long') - count('short'),
            open: rows.reduce((n, r) => n + r.open.length, 0),
        },
        markets: rows.map(({ closed, ...row }) => row),
        recent,
    };
}

module.exports = { boardRow, buildBoard, tradeOf, RECENT_LIMIT };
