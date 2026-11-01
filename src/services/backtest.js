// Level 5 backtest (docs/roadmap/level-5.md): replays the live pipeline (indicators → merge →
// enhanceMarketState → computeSignal) on each closed entry candle of a history, opens a
// hypothetical trade per candidate with the signal-log rules, and labels it with `evaluate`.
// Results are in R (multiples of the planned risk); fees are an optional round-trip % of price.
// Level 6 (docs/roadmap/level-6.md): per-feature breakdown and a parameter sweep on one replay.
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { composeMarketState } = require('./market.service');
const { computeSignal, THRESHOLD, MIN_RISK_REWARD, STOP_ATR_BUFFER } = require('./signal');
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

// Trade features used by the breakdown tables (Level 6 pattern correlation).
const BREAKDOWN_DIMENSIONS = ['side', 'score', 'regime', 'context', 'momentum', 'volume_state', 'market_energy', 'breakout_confirmation', 'fake_breakout_risk', 'divergence', 'session_utc', 'filter'];

function featuresOf(state, record) {
    const f = record.features;
    const hour = new Date(record.candle_close_time * 1000).getUTCHours();
    const block = Math.floor(hour / 4) * 4;
    return {
        regime: f.regime, context: f.context, momentum: f.momentum, volume_state: f.volume_state,
        market_energy: state.market_energy ?? null, breakout_confirmation: f.breakout_confirmation,
        fake_breakout_risk: state.fake_breakout_risk ?? null, divergence: f.divergence,
        session_utc: `${String(block).padStart(2, '0')}-${String(block + 4).padStart(2, '0')}`,
    };
}

function valuesOf(trade, dim) {
    if (dim === 'side') return [trade.signal];
    if (dim === 'score') return [String(Math.abs(trade.score))];
    if (dim === 'filter') return trade.filtered ? trade.filters : [];
    return [String(trade.features?.[dim] ?? 'none')];
}

// Per dimension, the summary of the trades sharing each value, most trades first. A filtered
// trade counts once under each filter that rejected it.
function breakdown(trades) {
    const out = {};
    for (const dim of BREAKDOWN_DIMENSIONS) {
        const groups = new Map();
        for (const t of trades) {
            for (const v of valuesOf(t, dim)) {
                if (!groups.has(v)) groups.set(v, []);
                groups.get(v).push(t);
            }
        }
        if (!groups.size) continue;
        out[dim] = [...groups].map(([value, list]) => ({ value, ...metrics(list).summary }))
            .sort((a, b) => b.trades - a.trades || String(a.value).localeCompare(String(b.value)));
    }
    return out;
}

// Out-of-sample check (Level 6): the variant with the best in-sample taken expectancy and at least
// this many in-sample taken trades is the one judged on the later, unseen part of the period.
const VALIDATION_MIN_TRADES = 30;

// Splits each run's taken trades at `splitSec` (signal time) and picks the in-sample best.
function validation(runs, splitSec) {
    const rows = runs.map((run, idx) => {
        const taken = run.trades.filter(t => !t.filtered);
        return {
            base: idx === 0,
            params: run.params,
            in_sample: metrics(taken.filter(t => t.time < splitSec)).summary,
            out_of_sample: metrics(taken.filter(t => t.time >= splitSec)).summary,
        };
    });
    let selected = null;
    rows.forEach((r, idx) => {
        if (r.in_sample.trades < VALIDATION_MIN_TRADES || r.in_sample.expectancy_r === null) return;
        if (selected === null || r.in_sample.expectancy_r > rows[selected].in_sample.expectancy_r) selected = idx;
    });
    return { split_at: splitSec, min_trades: VALIDATION_MIN_TRADES, selected, rows };
}

// One parameter set of the replay. `weights` changes the zone merge; `threshold`, `min_rr`,
// `stop_atr` and `target` the signal and its plan; `side` and `skip_energy` drop candidates
// (backtest only: such candidates are neither taken nor filtered).
const PARAM_KEYS = ['threshold', 'min_rr', 'stop_atr', 'target', 'side', 'skip_energy'];

function normalizeParams(base, over = {}) {
    const p = { weights: { ...base.weights, ...(over.weights || {}) } };
    for (const key of PARAM_KEYS) p[key] = over[key] ?? base[key];
    p.skip_energy = [...p.skip_energy].sort();
    return p;
}

const paramsKey = (p) => JSON.stringify([...PARAM_KEYS.map(k => p[k]), Object.entries(p.weights).sort()]);

// `candlesByTf` holds closed candles per role timeframe, sorted. `window` is the number of closed
// candles each snapshot sees (the live app uses CANDLE_LIMIT − 1). `variants` (sweep) are parameter
// overrides replayed on the same snapshots; the base parameters always run and give the main report.
// `splitSec` adds the out-of-sample `validation` (trades signalled before it are in-sample).
function runBacktest({ market, candlesByTf, roles, weights, indicators, startSec, endSec = Infinity, feePct = 0, window = 499, threshold = THRESHOLD, minRiskReward = MIN_RISK_REWARD, variants = [], splitSec = null, onProgress }) {
    const roleTfs = [...new Set(Object.values(roles))];
    const entry = candlesByTf[roles.entry] || [];
    const pointer = Object.fromEntries(roleTfs.map(tf => [tf, -1]));
    const snaps = {};
    const base = normalizeParams({ threshold, min_rr: minRiskReward, stop_atr: STOP_ATR_BUFFER, target: 'tp1', side: 'both', skip_energy: [], weights });
    // A variant equal to the base parameters is not replayed twice.
    const seen = new Set();
    const unique = [base, ...variants.map(v => normalizeParams(base, v))].filter((p) => {
        const key = paramsKey(p);
        return !seen.has(key) && seen.add(key);
    });
    const runs = unique.map(params => ({
        params,
        weightsKey: JSON.stringify(params.weights),
        trades: [],
        // Each group (taken / filtered) holds at most one open trade per direction, like the signal log.
        busyUntil: { taken: {}, filtered: {} },
    }));
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

        // Variants with the same weights share one merged state.
        const states = new Map();
        let failed = false;
        for (const run of runs) {
            if (!states.has(run.weightsKey)) {
                try {
                    states.set(run.weightsKey, { ...composeMarketState(market, snaps, roles, run.params.weights), generated_at: t, status: 'ok' });
                } catch (e) {
                    states.set(run.weightsKey, null);
                }
            }
            const merged = states.get(run.weightsKey);
            if (!merged) { if (run === runs[0]) failed = true; continue; }
            const { params } = run;
            const state = { ...merged, signal: computeSignal(merged, roles.htf, { threshold: params.threshold, minRiskReward: params.min_rr, stopAtr: params.stop_atr, target: params.target }) };

            const record = recordFrom(market, roles.entry, state, entry[i], params.threshold);
            if (!record) continue;
            if (params.side !== 'both' && record.signal !== params.side.toUpperCase()) continue;
            if (params.skip_energy.includes(state.market_energy)) continue;
            const group = record.filtered ? 'filtered' : 'taken';
            if ((run.busyUntil[group][record.signal] ?? -Infinity) >= t) continue;

            const outcome = evaluate(record, entry.slice(i, i + EXPIRY_CANDLES + 2));
            const risk = Math.abs(record.price - record.sl);
            const feeR = risk > 0 ? (feePct / 100) * record.price / risk : 0;
            run.trades.push({
                id: record.id, time: record.candle_close_time, signal: record.signal, filtered: record.filtered,
                filters: record.filters, strength: record.strength, score: state.signal.score,
                price: record.price, sl: record.sl, tp1: record.tp1, risk_reward: record.risk_reward,
                features: featuresOf(state, record),
                result: outcome ? outcome.result : null,
                rr: outcome ? outcome.rr : null,
                net_r: outcome && Number.isFinite(outcome.rr) ? r4(outcome.rr - feeR) : null,
                closed_at: outcome ? outcome.closed_at : null,
                bars: outcome ? outcome.bars : null,
            });
            run.busyUntil[group][record.signal] = outcome ? outcome.closed_at : Infinity;
        }
        if (failed) skipped++;
    }

    const groupReport = (list) => {
        const all = metrics(list);
        return {
            ...all,
            by_side: { BUY: metrics(list.filter(t => t.signal === 'BUY')).summary, SELL: metrics(list.filter(t => t.signal === 'SELL')).summary },
            breakdown: breakdown(list),
        };
    };

    const main = runs[0];
    return {
        market,
        entry_tf: roles.entry,
        roles,
        period: { start: entry.find(c => c.close_time >= startSec)?.close_time ?? null, end: [...entry].reverse().find(c => c.close_time <= endSec)?.close_time ?? null },
        params: { ...main.params, expiry_candles: EXPIRY_CANDLES, window, fee_pct: feePct },
        steps,
        skipped_steps: skipped,
        taken: groupReport(main.trades.filter(t => !t.filtered)),
        filtered: groupReport(main.trades.filter(t => t.filtered)),
        sweep: variants.length ? runs.map((run, idx) => ({
            base: idx === 0,
            params: run.params,
            taken: metrics(run.trades.filter(t => !t.filtered)).summary,
            filtered: metrics(run.trades.filter(t => t.filtered)).summary,
        })) : null,
        validation: splitSec === null ? null : validation(runs, splitSec),
        trades: main.trades,
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

module.exports = { runBacktest, metrics, breakdown, createReports, BREAKDOWN_DIMENSIONS, VALIDATION_MIN_TRADES };
