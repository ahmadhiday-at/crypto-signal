// Level 5 backtest (docs/roadmap/level-5.md): replays the live pipeline (indicators → merge →
// enhanceMarketState → computeSignal) on each closed entry candle of a history, opens a
// hypothetical trade per candidate with the signal-log rules, and labels it with `evaluate`.
// Results are in R (multiples of the planned risk); fees are an optional round-trip % of price.
// Level 6 (docs/roadmap/level-6.md): per-feature breakdown and a parameter sweep on one replay.
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { composeMarketState } = require('./market.service');
const { computeSignal, THRESHOLD, MIN_RISK_REWARD, STOP_ATR_BUFFER, SIGNAL_DEFAULTS, FILTER_DEFAULTS } = require('./signal');
const { recordFrom, evaluate } = require('./signal-log');
const { defaultsOf, resultParams, RESULT_GROUPS } = require('../config/calculation');

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
const BREAKDOWN_DIMENSIONS = ['side', 'score', 'htf_trend', 'regime', 'context', 'momentum', 'volume_state', 'market_energy', 'breakout_confirmation', 'fake_breakout_risk', 'divergence', 'session_utc', 'filter'];

// `trendTfs` are the HTF and structure role timeframes: their trends joined, e.g. `down/ranging`.
function featuresOf(state, record, trendTfs) {
    const f = record.features;
    const hour = new Date(record.candle_close_time * 1000).getUTCHours();
    const block = Math.floor(hour / 4) * 4;
    return {
        htf_trend: trendTfs.map(tf => state.timeframes?.[tf]?.trend ?? 'unknown').join('/'),
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
function validation(runs, splitSec, minTrades = VALIDATION_MIN_TRADES) {
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
        if (r.in_sample.trades < minTrades || r.in_sample.expectancy_r === null) return;
        if (selected === null || r.in_sample.expectancy_r > rows[selected].in_sample.expectancy_r) selected = idx;
    });
    return { split_at: splitSec, min_trades: minTrades, selected, rows };
}

// One parameter set of the replay. `weights` changes the zone merge; `threshold`, `min_rr`,
// `stop_atr`, `target`, `htf_trend` and `entry_max_atr` the signal, its plan and filters; `side` and
// `skip_energy` drop candidates (backtest only: such candidates are neither taken nor filtered).
// `calc` holds the calculation config groups RESULT_GROUPS (score points, indicators, zones, market,
// divergence, evaluation); a variant overrides single keys, e.g. { calc: { scoring: { near_zone: 3 } } }.
const PARAM_KEYS = ['model', 'threshold', 'min_rr', 'stop_atr', 'target', 'htf_trend', 'entry_max_atr', 'side', 'skip_energy'];

function normalizeParams(base, over = {}) {
    const p = { weights: { ...base.weights, ...(over.weights || {}) } };
    for (const key of PARAM_KEYS) p[key] = over[key] ?? base[key];
    p.skip_energy = [...p.skip_energy].sort();
    p.calc = Object.fromEntries(RESULT_GROUPS.map(g => [g, { ...base.calc[g], ...(over.calc?.[g] || {}) }]));
    return p;
}

const paramsKey = (p) => JSON.stringify([...PARAM_KEYS.map(k => p[k]), Object.entries(p.weights).sort(), p.calc]);
// Variants sharing these values share the per-timeframe snapshots / the merged state.
const snapshotKey = (p) => JSON.stringify([p.calc.indicators, p.calc.zones, p.calc.lookback]);
const stateKey = (p) => JSON.stringify([snapshotKey(p), p.weights, p.calc.market, p.calc.divergence, p.calc.trend.channel_candles]);

// `candlesByTf` holds closed candles per role timeframe, sorted. `window` is the number of closed
// candles each snapshot sees (the live app uses engine.candle_limit − 1). `variants` (sweep) are parameter
// overrides replayed on the same snapshots; the base parameters always run and give the main report.
// `splitSec` adds the out-of-sample `validation` (trades signalled before it are in-sample).
// `fixed` holds the calculation-config values no variant changes (FIXED_KEYS); missing keys use the
// signal defaults. They are written to the report params. `calcParams` holds the calculation config
// groups `scoring`, `indicators`, `zones`, `market`, `divergence` and `evaluation` (missing groups use
// the defaults); written to the report params as `calc`. Variants may change any of them (`calc`);
// each distinct indicators/zones set computes its own snapshots, so such sweeps cost more time.
const FIXED_KEYS = ['trailing_atr', 'htf_proximity_percent', 'no_mans_land_percent', 'volatility_extreme', 'volatility_dead'];

function runBacktest({ market, candlesByTf, roles, weights, indicators, startSec, endSec = Infinity, feePct = 0, window = 499, threshold = THRESHOLD, minRiskReward = MIN_RISK_REWARD, stopAtr = STOP_ATR_BUFFER, model = SIGNAL_DEFAULTS.model, target = 'tp1', htfTrend = 'off', entryMaxAtr = 0, fixed = {}, calcParams = {}, variants = [], splitSec = null, onProgress }) {
    const defaults = { ...SIGNAL_DEFAULTS, ...FILTER_DEFAULTS };
    const fixedParams = Object.fromEntries(FIXED_KEYS.map(k => [k, fixed[k] ?? defaults[k]]));
    const fixedOpts = {
        trailingAtr: fixedParams.trailing_atr,
        htfProximity: fixedParams.htf_proximity_percent,
        noMansLand: fixedParams.no_mans_land_percent,
        volatilityExtreme: fixedParams.volatility_extreme,
        volatilityDead: fixedParams.volatility_dead,
    };
    const calcDefaults = resultParams(defaultsOf());
    const baseCalc = Object.fromEntries(RESULT_GROUPS.map(g => [g, { ...calcDefaults[g], ...(calcParams[g] || {}) }]));
    const roleTfs = [...new Set(Object.values(roles))];
    const entry = candlesByTf[roles.entry] || [];
    const pointer = Object.fromEntries(roleTfs.map(tf => [tf, -1]));
    const base = normalizeParams({ model, threshold, min_rr: minRiskReward, stop_atr: stopAtr, target, htf_trend: htfTrend, entry_max_atr: entryMaxAtr, side: 'both', skip_energy: [], weights, calc: baseCalc });
    const minTrades = base.calc.evaluation.min_trades;
    const trendTfs = [...new Set([roles.htf, roles.structure].filter(Boolean))];
    // A variant equal to the base parameters is not replayed twice.
    const seen = new Set();
    const unique = [base, ...variants.map(v => normalizeParams(base, v))].filter((p) => {
        const key = paramsKey(p);
        return !seen.has(key) && seen.add(key);
    });
    // Per indicators/zones set: its params and the latest snapshot per timeframe.
    const snapshotSets = new Map();
    for (const params of unique) {
        const key = snapshotKey(params);
        if (!snapshotSets.has(key)) snapshotSets.set(key, { params: { indicators: params.calc.indicators, zones: params.calc.zones, lookback: params.calc.lookback }, snaps: {} });
    }
    const runs = unique.map(params => ({
        params,
        snapKey: snapshotKey(params),
        stateKey: stateKey(params),
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

        for (const tf of roleTfs) {
            const list = candlesByTf[tf];
            let p = pointer[tf];
            while (p + 1 < list.length && list[p + 1].close_time <= t) p++;
            const moved = p !== pointer[tf];
            pointer[tf] = p;
            for (const set of snapshotSets.values()) {
                if (!moved && set.snaps[tf] !== undefined) continue;
                try {
                    set.snaps[tf] = indicators.calculateAll(list.slice(Math.max(0, p + 1 - window), p + 1), market, tf, {}, set.params);
                } catch (e) {
                    set.snaps[tf] = null;
                }
            }
        }
        const ready = (set) => roleTfs.every(tf => set.snaps[tf]);
        if (!ready(snapshotSets.get(runs[0].snapKey))) { skipped++; continue; }

        // Variants with the same snapshots, weights and market/divergence values share one merged state.
        const states = new Map();
        let failed = false;
        for (const run of runs) {
            const set = snapshotSets.get(run.snapKey);
            if (!ready(set)) continue;
            if (!states.has(run.stateKey)) {
                try {
                    const stateParams = { market: run.params.calc.market, divergence: run.params.calc.divergence, trend: run.params.calc.trend, zones: run.params.calc.zones };
                    states.set(run.stateKey, { ...composeMarketState(market, set.snaps, roles, run.params.weights, stateParams), generated_at: t, status: 'ok' });
                } catch (e) {
                    states.set(run.stateKey, null);
                }
            }
            const merged = states.get(run.stateKey);
            if (!merged) { if (run === runs[0]) failed = true; continue; }
            const { params } = run;
            const state = { ...merged, signal: computeSignal(merged, roles.htf, { ...fixedOpts, threshold: params.threshold, minRiskReward: params.min_rr, stopAtr: params.stop_atr, target: params.target, htfTrend: params.htf_trend, entryMaxAtr: params.entry_max_atr, structureTf: roles.structure, entryTf: roles.entry, scoring: params.calc.scoring, model: params.model, trend: params.calc.trend }) };

            const record = recordFrom(market, roles.entry, state, entry[i], params.threshold);
            if (!record) continue;
            if (params.side !== 'both' && record.signal !== params.side.toUpperCase()) continue;
            if (params.skip_energy.includes(state.market_energy)) continue;
            const group = record.filtered ? 'filtered' : 'taken';
            if ((run.busyUntil[group][record.signal] ?? -Infinity) >= t) continue;

            const expiry = params.calc.evaluation.expiry_candles;
            const outcome = evaluate(record, entry.slice(i, i + expiry + 2), expiry);
            const risk = Math.abs(record.price - record.sl);
            const feeR = risk > 0 ? (feePct / 100) * record.price / risk : 0;
            run.trades.push({
                id: record.id, time: record.candle_close_time, signal: record.signal, filtered: record.filtered,
                filters: record.filters, strength: record.strength, score: state.signal.score,
                price: record.price, sl: record.sl, tp1: record.tp1, risk_reward: record.risk_reward,
                features: featuresOf(state, record, trendTfs),
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
        params: { ...main.params, ...fixedParams, expiry_candles: main.params.calc.evaluation.expiry_candles, window, fee_pct: feePct },
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
        validation: splitSec === null ? null : validation(runs, splitSec, minTrades),
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

module.exports = { runBacktest, metrics, breakdown, createReports, BREAKDOWN_DIMENSIONS, VALIDATION_MIN_TRADES, FIXED_KEYS };
