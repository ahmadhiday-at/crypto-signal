// How a signal reads for a trader: words, labels and the arithmetic of a plan. The server decides the
// signal; nothing here changes it. Plain script in the browser (window.SignalView), require() in tests.
(function (root) {
    var isNum = function (v) { return typeof v === 'number' && isFinite(v); };

    var SIDE_WORDS = { long: 'LONG', short: 'SHORT' };
    var ACTION_SIDES = { BUY: 'long', SELL: 'short' };

    var MODEL_LABELS = { trend_pullback: 'Trend pullback', breakout: 'Breakout', bounce: 'S/R bounce' };

    var REASON_LABELS = {
        htf_trend_up: 'Higher timeframe trend up', htf_trend_down: 'Higher timeframe trend down',
        structure_trend_up: 'Structure trend up', structure_trend_down: 'Structure trend down',
        entry_trend_up: 'Entry timeframe trend up', entry_trend_down: 'Entry timeframe trend down',
        pullback_to_ma: 'Pullback to MA50',
        channel_breakout_up: 'Close above the channel', channel_breakout_down: 'Close below the channel',
        near_support: 'Price at support', near_resistance: 'Price at resistance',
        bullish_momentum: 'Momentum bullish', bearish_momentum: 'Momentum bearish',
        strong_htf_support: 'Strong HTF support nearby', strong_htf_resistance: 'Strong HTF resistance nearby',
        bullish_divergence: 'Bullish RSI divergence', bearish_divergence: 'Bearish RSI divergence',
        volume_surge: 'Volume surge', weak_volume: 'Weak volume',
        data_not_current: 'Data not current',
    };

    // `c` is the `signal` object of /api/config (may be null: the labels then leave the value out).
    function filterLabel(code, c) {
        c = c || {};
        var at = function (v, text) { return isNum(v) ? text.replace('{v}', v) : text.replace(' ({v})', ''); };
        var labels = {
            no_mans_land: at(c.no_mans_land_percent, "Too far from any zone (> {v}%)"),
            volatility_extreme: at(c.volatility_extreme, 'Volatility too high (ATR > {v}× average)'),
            volatility_dead: at(c.volatility_dead, 'Market too quiet (ATR < {v}× average)'),
            buy_into_resistance: 'Long into resistance without a breakout',
            sell_into_support: 'Short into support without a breakdown',
            low_rr: at(c.min_rr, 'Risk/reward below the minimum ({v})'),
            against_htf_trend: 'Against the higher timeframe trend',
            far_from_entry: 'Price too far from the entry zone',
        };
        return labels[code] || code;
    }

    function reasonLabel(code) { return REASON_LABELS[code] || code; }
    function modelLabel(model) { return MODEL_LABELS[model] || model || '-'; }

    var EDGE = {
        positive: { word: 'Positive', tone: 'pos', note: 'Positive in the backtest, also out of sample. Past results do not guarantee future ones.' },
        negative: { word: 'Negative', tone: 'neg', note: 'Negative in the backtest after costs. Treat this signal as an experiment, not as an edge.' },
        unproven: { word: 'Unproven', tone: 'warn', note: 'Not proven by a current backtest yet.' },
    };
    var EDGE_REASONS = {
        no_backtest: 'No backtest report yet',
        params_differ: 'The report used other settings: run it again from Config',
        too_few_trades: 'Too few backtest trades',
        negative_expectancy: 'Negative expectancy after costs',
        negative_out_of_sample: 'Negative on the out-of-sample part',
        no_fees: 'The report ran without fees',
    };
    function edgeOf(verdict) { return EDGE[verdict] || EDGE.unproven; }
    function edgeReason(code) { return EDGE_REASONS[code] || code; }

    function sideOfAction(action) { return ACTION_SIDES[action] || null; }
    function sideWord(side) { return SIDE_WORDS[side] || 'WAIT'; }

    // Why a signal is not active: one short sentence. `sig` is the Market State or board signal.
    function waitReason(sig, status, c) {
        if (!sig) return 'No signal available.';
        if (status && status !== 'ok') return 'Data is not current, so no signal is given.';
        var side = sig.plan ? sig.plan.side : null;
        if (sig.filtered) {
            var names = (sig.filters || []).map(function (f) { return filterLabel(f, c); }).join('; ');
            return (side ? sideWord(side) + ' setup blocked: ' : 'Blocked: ') + names + '.';
        }
        if (c && isNum(c.threshold)) return 'Score ' + (sig.score > 0 ? '+' : '') + sig.score + ', needs ±' + c.threshold + ' to act.';
        return 'Score too low to act.';
    }

    // True when the scored reasons pull in both directions.
    function isMixed(reasons) {
        var up = (reasons || []).some(function (r) { return r.points > 0; });
        var down = (reasons || []).some(function (r) { return r.points < 0; });
        return up && down;
    }

    // Distances of a plan from its entry. `entry` is the plan's reference price. `costPct` is the
    // round-trip fee plus slippage; costR is what it takes from a trade, in R.
    function planNumbers(plan, entry, costPct) {
        if (!plan || !isNum(entry) || entry <= 0) return null;
        var pctFrom = function (v) { return isNum(v) ? (v - entry) / entry * 100 : null; };
        var risk = isNum(plan.stop_loss) ? Math.abs(entry - plan.stop_loss) : null;
        return {
            entry: entry,
            risk: risk,
            stop_pct: pctFrom(plan.stop_loss),
            tp1_pct: pctFrom(plan.take_profit_1),
            tp2_pct: pctFrom(plan.take_profit_2),
            tp2_r: isNum(plan.take_profit_2) && risk ? Math.abs(plan.take_profit_2 - entry) / risk : null,
            cost_r: isNum(costPct) && risk ? costPct / 100 * entry / risk : null,
        };
    }

    // Size so that hitting the stop loses `riskPct` of `account`. Leaves out fees; null on bad input.
    function positionSize(account, riskPct, entry, stop) {
        if (![account, riskPct, entry, stop].every(isNum) || account <= 0 || riskPct <= 0 || entry <= 0) return null;
        var distance = Math.abs(entry - stop);
        if (distance === 0) return null;
        var riskAmount = account * riskPct / 100;
        var quantity = riskAmount / distance;
        var notional = quantity * entry;
        return { risk_amount: riskAmount, quantity: quantity, notional: notional, leverage: notional / account };
    }

    // Unrealised result of an open trade at `price`, in R of its planned risk; before costs.
    function openR(trade, price) {
        if (!trade || !isNum(price) || !isNum(trade.entry) || !isNum(trade.stop_loss)) return null;
        var risk = Math.abs(trade.entry - trade.stop_loss);
        if (risk === 0) return null;
        return (trade.side === 'short' ? trade.entry - price : price - trade.entry) / risk;
    }

    function resultTone(result) { return { WIN: 'pos', LOSS: 'neg', EXPIRED: 'warn' }[result] || 'muted'; }

    // Text to paste into an order ticket or a chat.
    function planText(market, timeframe, plan) {
        if (!plan) return '';
        var line = function (k, v) { return isNum(v) ? k + ': ' + v : null; };
        return [market + ' ' + sideWord(plan.side) + ' (' + timeframe + ')', line('Entry', plan.entry_zone && plan.entry_zone[0]), line('Stop', plan.stop_loss),
            line('TP1', plan.take_profit_1), line('TP2', plan.take_profit_2), line('R:R', plan.risk_reward)].filter(Boolean).join('\n');
    }

    var api = { reasonLabel: reasonLabel, filterLabel: filterLabel, modelLabel: modelLabel, edgeOf: edgeOf, edgeReason: edgeReason, sideOfAction: sideOfAction, sideWord: sideWord, waitReason: waitReason, isMixed: isMixed, planNumbers: planNumbers, positionSize: positionSize, openR: openR, resultTone: resultTone, planText: planText, REASON_LABELS: REASON_LABELS };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.SignalView = api;
})(typeof window !== 'undefined' ? window : this);
