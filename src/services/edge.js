// Level 6.5 A (docs/roadmap/level-6.5.md): how much the signal is proven, from the latest backtest
// report and the live signal log. Shown next to the signal so a BUY/SELL is never read as a proven
// edge when the measured expectancy says otherwise.
const { metrics } = require('./backtest');
const { MIN_RISK_REWARD, STOP_ATR_BUFFER, SIGNAL_DEFAULTS, FILTER_DEFAULTS } = require('./signal');
const { FIXED_KEYS } = require('./backtest');
const { defaultsOf, resultParams, RESULT_GROUPS } = require('../config/calculation');
const binance = require('./binance.service');

// Below this many taken trades a result is too small to call. Default of the calculation config's
// `evaluation.min_trades`.
const MIN_TRADES = 30;
const CALC_DEFAULTS = resultParams(defaultsOf());
const CLOSED = ['WIN', 'LOSS', 'EXPIRED'];

const pick = (s) => (s ? { trades: s.trades, win_rate: s.win_rate, expectancy_r: s.expectancy_r, profit_factor: s.profit_factor } : null);

// True when the report was produced with the parameters the live signal uses now.
function paramsMatch(params, live) {
    if (!params) return false;
    if (params.threshold !== live.threshold) return false;
    // The snapshot window (CANDLE_LIMIT − 1) changes indicators and zones, so it must match too.
    if (params.window !== undefined && params.window !== live.window) return false;
    if ((params.min_rr ?? MIN_RISK_REWARD) !== live.min_rr) return false;
    if ((params.stop_atr ?? STOP_ATR_BUFFER) !== live.stop_atr) return false;
    // Reports older than v2.16.0 ran without the HTF trend filter.
    if ((params.htf_trend ?? 'off') !== live.htf_trend) return false;
    // Reports older than v2.17.0 used the nearest target and no entry-distance filter.
    if ((params.target ?? 'tp1') !== live.target || (params.entry_max_atr ?? 0) !== live.entry_max_atr) return false;
    // Reports older than v2.14.0 carry no fixed values: they ran with the defaults.
    const defaults = { ...SIGNAL_DEFAULTS, ...FILTER_DEFAULTS };
    for (const k of FIXED_KEYS) if ((params[k] ?? defaults[k]) !== live[k]) return false;
    // Reports older than v2.20.0 ran the bounce model.
    if ((params.model ?? 'bounce') !== live.model) return false;
    if ((params.side ?? 'both') !== 'both' || (params.skip_energy || []).length) return false;
    // Reports older than v2.18.0 have no `calc`: they ran with the defaults of these groups.
    for (const g of RESULT_GROUPS) {
        const ran = { ...CALC_DEFAULTS[g], ...params.calc?.[g] };
        if (Object.keys(CALC_DEFAULTS[g]).some(k => ran[k] !== live.calc[g][k])) return false;
    }
    if (params.weights) {
        for (const tf of live.role_tfs) if (params.weights[tf] !== live.weights[tf]) return false;
    }
    return true;
}

// Reports carry the role timeframes they ran with; reports without them match any roles.
function rolesMatch(reportRoles, liveRoles) {
    if (!reportRoles || !liveRoles) return true;
    return ['htf', 'structure', 'mid', 'entry'].every(r => reportRoles[r] === liveRoles[r]);
}

// Taken records of a signal log: open count and the summary of the closed ones (rr before fees).
function logSummary(records, entryTf) {
    const taken = records.filter(r => !r.filtered && (!entryTf || r.timeframe === entryTf));
    const closed = taken.filter(r => CLOSED.includes(r.result)).map(r => ({ ...r, net_r: r.rr }));
    return { open: taken.filter(r => r.result === null).length, ...pick(metrics(closed).summary) };
}

// The shadow log (engine.signalRecords(market, 'shadow')) for the Edge response, or null when off.
function shadowSummary(body) {
    if (!body || !body.enabled) return null;
    return {
        model: body.model, roles: body.roles, latest: body.latest ? { action: body.latest.signal.action, score: body.latest.signal.score, status: body.latest.status } : null,
        ...logSummary(body.records, body.entry_tf),
    };
}

// `report`: backtest report or null. `log`: engine.signalRecords() result or null.
// `live`: liveParams() result.
function edgeSummary(market, report, log, live) {
    const reasons = [];
    let backtest = null;
    if (report) {
        const base = report.validation?.rows?.find(r => r.base);
        backtest = {
            generated_at: report.generated_at ?? null,
            period: report.period,
            fee_pct: report.params?.fee_pct ?? 0,
            params_match: paramsMatch(report.params, live) && rolesMatch(report.roles, live.roles),
            taken: pick(report.taken?.summary),
            out_of_sample: base ? { split_at: report.validation.split_at, ...pick(base.out_of_sample) } : null,
        };
    }

    const liveLog = log ? logSummary(log.records, log.entry_tf) : null;

    let verdict;
    const taken = backtest?.taken;
    const oos = backtest?.out_of_sample;
    if (!backtest || !taken) {
        verdict = 'unproven';
        reasons.push('no_backtest');
    } else if (!backtest.params_match) {
        verdict = 'unproven';
        reasons.push('params_differ');
    } else if (taken.trades < live.min_trades || taken.expectancy_r === null) {
        verdict = 'unproven';
        reasons.push('too_few_trades');
    } else if (taken.expectancy_r <= 0 || (oos && oos.trades > 0 && oos.expectancy_r !== null && oos.expectancy_r <= 0)) {
        verdict = 'negative';
        reasons.push(taken.expectancy_r <= 0 ? 'negative_expectancy' : 'negative_out_of_sample');
    } else {
        verdict = 'positive';
    }
    if (backtest && !backtest.fee_pct) reasons.push('no_fees');

    return { market, verdict, reasons, min_trades: live.min_trades, backtest, live_log: liveLog };
}

// Live parameters, for paramsMatch. `calc` is the calculation config (src/config/calculation.js);
// without it the defaults and env weights apply. The backtest CLI uses the same window.
function liveParams(config, calc = null, window = binance.candleLimit() - 1) {
    const cfg = calc ? calc.get() : defaultsOf(config.TF_WEIGHTS);
    const weights = calc ? calc.weights() : config.TF_WEIGHTS;
    return {
        window,
        threshold: cfg.signal.threshold,
        min_rr: cfg.signal.min_rr,
        stop_atr: cfg.signal.stop_atr,
        htf_trend: cfg.filters.htf_trend,
        target: cfg.signal.target,
        model: cfg.signal.model,
        entry_max_atr: cfg.filters.entry_max_atr,
        ...Object.fromEntries(FIXED_KEYS.map(k => [k, cfg.signal[k] ?? cfg.filters[k]])),
        weights,
        calc: resultParams(cfg),
        min_trades: cfg.evaluation.min_trades,
        roles: { ...config.TF_ROLES },
        role_tfs: [...new Set(Object.values(config.TF_ROLES))],
    };
}

module.exports = { edgeSummary, shadowSummary, liveParams, MIN_TRADES };
