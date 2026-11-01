// Level 6.5 A (docs/roadmap/level-6.5.md): how much the signal is proven, from the latest backtest
// report and the live signal log. Shown next to the signal so a BUY/SELL is never read as a proven
// edge when the measured expectancy says otherwise.
const { metrics } = require('./backtest');
const { THRESHOLD, MIN_RISK_REWARD, STOP_ATR_BUFFER } = require('./signal');
const binance = require('./binance.service');

// Below this many taken trades a result is too small to call.
const MIN_TRADES = 30;
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
    if ((params.target ?? 'tp1') !== 'tp1' || (params.side ?? 'both') !== 'both' || (params.skip_energy || []).length) return false;
    if (params.weights) {
        for (const tf of live.role_tfs) if (params.weights[tf] !== live.weights[tf]) return false;
    }
    return true;
}

// `report`: backtest report or null. `log`: engine.signalRecords() result or null.
// `live`: {threshold, min_rr, stop_atr, window, weights, role_tfs}.
function edgeSummary(market, report, log, live) {
    const reasons = [];
    let backtest = null;
    if (report) {
        const base = report.validation?.rows?.find(r => r.base);
        backtest = {
            generated_at: report.generated_at ?? null,
            period: report.period,
            fee_pct: report.params?.fee_pct ?? 0,
            params_match: paramsMatch(report.params, live),
            taken: pick(report.taken?.summary),
            out_of_sample: base ? { split_at: report.validation.split_at, ...pick(base.out_of_sample) } : null,
        };
    }

    let liveLog = null;
    if (log) {
        const taken = log.records.filter(r => !r.filtered);
        const closed = taken.filter(r => CLOSED.includes(r.result)).map(r => ({ ...r, net_r: r.rr }));
        const s = metrics(closed).summary;
        liveLog = { open: taken.filter(r => r.result === null).length, ...pick(s) };
    }

    let verdict;
    const taken = backtest?.taken;
    const oos = backtest?.out_of_sample;
    if (!backtest || !taken) {
        verdict = 'unproven';
        reasons.push('no_backtest');
    } else if (!backtest.params_match) {
        verdict = 'unproven';
        reasons.push('params_differ');
    } else if (taken.trades < MIN_TRADES || taken.expectancy_r === null) {
        verdict = 'unproven';
        reasons.push('too_few_trades');
    } else if (taken.expectancy_r <= 0 || (oos && oos.trades > 0 && oos.expectancy_r !== null && oos.expectancy_r <= 0)) {
        verdict = 'negative';
        reasons.push(taken.expectancy_r <= 0 ? 'negative_expectancy' : 'negative_out_of_sample');
    } else {
        verdict = 'positive';
    }
    if (backtest && !backtest.fee_pct) reasons.push('no_fees');

    return { market, verdict, reasons, min_trades: MIN_TRADES, backtest, live_log: liveLog };
}

// Live parameters from the config, for paramsMatch. The backtest CLI uses the same window.
function liveParams(config, window = binance.candleLimit() - 1) {
    return {
        window,
        threshold: THRESHOLD,
        min_rr: MIN_RISK_REWARD,
        stop_atr: STOP_ATR_BUFFER,
        weights: config.TF_WEIGHTS,
        role_tfs: [...new Set(Object.values(config.TF_ROLES))],
    };
}

module.exports = { edgeSummary, liveParams, MIN_TRADES };
