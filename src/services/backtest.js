// Level 5 backtest (docs/roadmap/level-5.md): replays the live pipeline (indicators → merge →
// enhanceMarketState → computeSignal) on each closed entry candle of a history, opens a
// hypothetical trade per candidate with the signal-log rules, and labels it with `evaluate`.
// Results are in R (multiples of the planned risk); fees are an optional round-trip % of price.
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { composeMarketState } = require('./market.service');
const { computeSignal, THRESHOLD } = require('./signal');
const { recordFrom, evaluate, EXPIRY_CANDLES } = require('./signal-log');

const MARKET_RE = /^[A-Z0-9]{2,20}$/;
const CLOSED_RESULTS = ['WIN', 'LOSS', 'EXPIRED'];
const r2 = (v) => (Number.isFinite(v) ? +v.toFixed(2) : null);
const r4 = (v) => (Number.isFinite(v) ? +v.toFixed(4) : null);

// Win rate, expectancy, profit factor and max drawdown over trades closed as WIN/LOSS/EXPIRED,
// in close order. `net_r` already includes fees.
function metrics(trades) {
    const closed = trades.filter(t => CLOSED_RESULTS.includes(t.result)).sort((a, b) => a.closed_at - b.closed_at);
    const count = (res) => closed.filter(t => t.result === res).length;
    const rs = closed.map(t => t.net_r);
    const gain = rs.filter(r => r > 0).reduce((a, b) => a + b, 0);
    const loss = -rs.filter(r => r < 0).reduce((a, b) => a + b, 0);

    let equity = 0;
    let peak = 0;
    let maxDd = 0;
    const curve = closed.map(t => {
        equity += t.net_r;
        peak = Math.max(peak, equity);
        maxDd = Math.max(maxDd, peak - equity);
        return { time: t.closed_at, equity: r4(equity) };
    });

    const total = rs.reduce((a, b) => a + b, 0);
    return {
        summary: {
            trades: closed.length,
            wins: count('WIN'),
            losses: count('LOSS'),
            expired: count('EXPIRED'),
            win_rate: closed.length ? r4(count('WIN') / closed.length) : null,
            avg_win_r: r2(gain / (rs.filter(r => r > 0).length || NaN)),
            avg_loss_r: r2(-loss / (rs.filter(r => r < 0).length || NaN)),
            expectancy_r: closed.length ? r4(total / closed.length) : null,
            total_r: r2(total),
            profit_factor: loss > 0 ? r2(gain / loss) : null,
            max_drawdown_r: r2(maxDd),
            open: trades.filter(t => t.result === null).length,
            unknown: trades.filter(t => t.result === 'UNKNOWN').length,
        },
        equity: curve,
    };
}

// `candlesByTf` holds closed candles per role timeframe, sorted. `window` is the number of closed
// candles each snapshot sees (the live app uses CANDLE_LIMIT − 1).
function runBacktest({ market, candlesByTf, roles, weights, indicators, startSec, endSec = Infinity, feePct = 0, window = 499, onProgress }) {
    const roleTfs = [...new Set(Object.values(roles))];
    const entry = candlesByTf[roles.entry] || [];
    const pointer = Object.fromEntries(roleTfs.map(tf => [tf, -1]));
    const snaps = {};
    const trades = [];
    // Each group (taken / filtered) holds at most one open trade per direction, like the signal log.
    const busyUntil = { taken: {}, filtered: {} };
    let steps = 0;
    let skipped = 0;

    for (let i = 0; i < entry.length; i++) {
        const t = entry[i].close_time;
        if (t < startSec || t > endSec) continue;
        steps++;
        if (onProgress && steps % 500 === 0) onProgress(steps);

        let ready = true;
        for (const tf of roleTfs) {
            const list = candlesByTf[tf];
            let p = pointer[tf];
            while (p + 1 < list.length && list[p + 1].close_time <= t) p++;
            if (p !== pointer[tf] || !snaps[tf]) {
                pointer[tf] = p;
                try {
                    snaps[tf] = indicators.calculateAll(list.slice(Math.max(0, p + 1 - window), p + 1), market, tf);
                } catch (e) {
                    snaps[tf] = null;
                }
            }
            if (!snaps[tf]) ready = false;
        }
        if (!ready) { skipped++; continue; }

        let state;
        try {
            state = { ...composeMarketState(market, snaps, roles, weights), generated_at: t, status: 'ok' };
        } catch (e) {
            skipped++;
            continue;
        }
        state.signal = computeSignal(state, roles.htf);

        const record = recordFrom(market, roles.entry, state, entry[i]);
        if (!record) continue;
        const group = record.filtered ? 'filtered' : 'taken';
        if ((busyUntil[group][record.signal] ?? -Infinity) >= t) continue;

        const outcome = evaluate(record, entry.slice(i, i + EXPIRY_CANDLES + 2));
        const risk = Math.abs(record.price - record.sl);
        const feeR = risk > 0 ? (feePct / 100) * record.price / risk : 0;
        const trade = {
            id: record.id, time: record.candle_close_time, signal: record.signal, filtered: record.filtered,
            filters: record.filters, strength: record.strength, score: state.signal.score,
            price: record.price, sl: record.sl, tp1: record.tp1, risk_reward: record.risk_reward,
            result: outcome ? outcome.result : null,
            rr: outcome ? outcome.rr : null,
            net_r: outcome && Number.isFinite(outcome.rr) ? r4(outcome.rr - feeR) : null,
            closed_at: outcome ? outcome.closed_at : null,
            bars: outcome ? outcome.bars : null,
        };
        trades.push(trade);
        busyUntil[group][record.signal] = outcome ? outcome.closed_at : Infinity;
    }

    const groupReport = (list) => {
        const all = metrics(list);
        return {
            ...all,
            by_side: { BUY: metrics(list.filter(t => t.signal === 'BUY')).summary, SELL: metrics(list.filter(t => t.signal === 'SELL')).summary },
        };
    };

    return {
        market,
        entry_tf: roles.entry,
        roles,
        period: { start: entry.find(c => c.close_time >= startSec)?.close_time ?? null, end: [...entry].reverse().find(c => c.close_time <= endSec)?.close_time ?? null },
        params: { threshold: THRESHOLD, expiry_candles: EXPIRY_CANDLES, window, fee_pct: feePct },
        steps,
        skipped_steps: skipped,
        taken: groupReport(trades.filter(t => !t.filtered)),
        filtered: groupReport(trades.filter(t => t.filtered)),
        trades,
    };
}

// Reports live in `data/backtest/{MARKET}.json`.
function createReports({ dir }) {
    const fileOf = (market) => {
        if (!MARKET_RE.test(market)) throw new Error(`Invalid market name: ${String(market).slice(0, 30)}`);
        return path.join(dir, `${market}.json`);
    };
    return {
        async read(market) {
            try {
                return JSON.parse(await fs.readFile(fileOf(market), 'utf8'));
            } catch (e) {
                return null;
            }
        },
        async write(market, report) {
            await fs.mkdir(dir, { recursive: true });
            const file = fileOf(market);
            const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
            await fs.writeFile(tmp, JSON.stringify(report));
            await fs.rename(tmp, file);
        },
    };
}

module.exports = { runBacktest, metrics, createReports };
