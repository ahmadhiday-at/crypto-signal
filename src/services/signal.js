// Level 2 scoring (docs/roadmap/level-2.md): a weighted point system over existing Market State
// fields, producing a heuristic BUY/SELL/WAIT signal with its reasons. Pure and deterministic.

const THRESHOLD = 5;
const HTF_PROXIMITY_PERCENT = 1;

// Level 2.5B trade filter (docs/roadmap/level-2.5b.md). Starting values, to be reviewed.
const NO_MANS_LAND_PERCENT = 1;
const VOLATILITY_EXTREME = 2.0;
const VOLATILITY_DEAD = 0.5;
const CONFIRMED_BREAKOUT = ['medium', 'strong'];

const FILTER_CODES = ['no_mans_land', 'volatility_extreme', 'volatility_dead', 'buy_into_resistance', 'sell_into_support', 'low_rr'];

// Level 3 trade plan (docs/roadmap/level-3.md). Starting values, to be reviewed.
const STOP_ATR_BUFFER = 0.5;
const TRAILING_ATR = 1.5;
const MIN_RISK_REWARD = 1.5;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v) => (num(v) ? +v.toPrecision(10) : null);

// Entry zone, stop loss, targets, risk/reward and a trailing stop for a BUY (long) or SELL (short).
// Returns null when the inputs needed for a plan are missing.
function tradePlan(state, action, htfTf) {
    const price = state.price;
    const atr = state.indicators?.atr;
    const long = action === 'BUY';
    const zone = long ? state.levels?.support?.[0] : state.levels?.resistance?.[0];
    if (!num(price) || !num(atr) || !zone || !num(zone.low) || !num(zone.high)) return null;

    const stop = long ? zone.low - STOP_ATR_BUFFER * atr : zone.high + STOP_ATR_BUFFER * atr;
    const beyond = (l) => num(l.mid) && (long ? l.mid > price : l.mid < price);
    const targets = (long ? state.levels?.resistance : state.levels?.support || []) || [];
    const ahead = targets.filter(beyond).sort((a, b) => (long ? a.mid - b.mid : b.mid - a.mid));
    const tp1 = ahead[0]?.mid ?? null;
    const major = ahead
        .filter(l => l !== ahead[0] && Array.isArray(l.tfs) && l.tfs.includes(htfTf))
        .sort((a, b) => b.score - a.score)[0];
    const tp2 = major ? major.mid : null;

    const risk = long ? price - stop : stop - price;
    const reward = num(tp1) ? (long ? tp1 - price : price - tp1) : null;
    const rr = risk > 0 && num(reward) && reward > 0 ? reward / risk : null;

    return {
        side: long ? 'long' : 'short',
        entry_zone: [round(zone.low), round(zone.high)],
        stop_loss: round(stop),
        take_profit_1: round(tp1),
        take_profit_2: round(tp2),
        risk_reward: num(rr) ? +rr.toFixed(2) : null,
        trailing_stop: round(long ? price - TRAILING_ATR * atr : price + TRAILING_ATR * atr),
    };
}

// Returns the filter codes that reject a BUY/SELL; an empty list means the setup passes.
function tradeFilters(state, action) {
    const failed = [];
    const dist = state.distance_percent || {};
    const nearest = Math.min(dist.to_support ?? Infinity, dist.to_resistance ?? Infinity);
    if (state.context === 'mid_range' && nearest > NO_MANS_LAND_PERCENT) failed.push('no_mans_land');

    const vr = state.volatility_ratio;
    if (typeof vr === 'number') {
        if (vr > VOLATILITY_EXTREME) failed.push('volatility_extreme');
        if (vr < VOLATILITY_DEAD) failed.push('volatility_dead');
    }

    const confirmed = CONFIRMED_BREAKOUT.includes(state.breakout_confirmation);
    if (action === 'BUY' && state.context === 'near_resistance' && !confirmed) failed.push('buy_into_resistance');
    if (action === 'SELL' && state.context === 'near_support' && !confirmed) failed.push('sell_into_support');
    return failed;
}

const REASON_CODES = [
    'near_support', 'near_resistance', 'bullish_momentum', 'bearish_momentum',
    'strong_htf_support', 'strong_htf_resistance', 'bullish_divergence', 'bearish_divergence',
    'volume_surge', 'weak_volume', 'data_not_current',
];

function strengthOf(score) {
    const a = Math.abs(score);
    if (a >= 7) return 'strong';
    if (a >= THRESHOLD) return 'medium';
    return 'weak';
}

// `state` is a Market State (contract v2) with `status` already computed; `htfTf` is the TF_HTF role.
function computeSignal(state, htfTf) {
    const reasons = [];
    let score = 0;
    const add = (code, points) => { reasons.push({ code, points }); score += points; };

    if (state.context === 'near_support') add('near_support', 2);
    if (state.context === 'near_resistance') add('near_resistance', -2);

    if (state.momentum === 'bullish') add('bullish_momentum', 2);
    if (state.momentum === 'bearish') add('bearish_momentum', -2);

    const topSupport = state.levels?.support?.[0];
    const topResistance = state.levels?.resistance?.[0];
    if (topSupport?.tfs?.includes(htfTf) && state.distance_percent?.to_support <= HTF_PROXIMITY_PERCENT) {
        add('strong_htf_support', 3);
    }
    if (topResistance?.tfs?.includes(htfTf) && state.distance_percent?.to_resistance <= HTF_PROXIMITY_PERCENT) {
        add('strong_htf_resistance', -3);
    }

    if (state.divergence === 'bullish') add('bullish_divergence', 2);
    if (state.divergence === 'bearish') add('bearish_divergence', -2);

    // Volume changes conviction, not direction: one point toward or away from zero.
    if (score !== 0) {
        const dir = Math.sign(score);
        if (state.volume_state === 'high') add('volume_surge', dir);
        if (state.volume_state === 'low') add('weak_volume', -dir);
    }

    let action = score >= THRESHOLD ? 'BUY' : score <= -THRESHOLD ? 'SELL' : 'WAIT';
    const plan = action === 'WAIT' ? null : tradePlan(state, action, htfTf);
    const filters = action === 'WAIT' ? [] : tradeFilters(state, action);
    if (action !== 'WAIT' && !(plan?.risk_reward >= MIN_RISK_REWARD)) filters.push('low_rr');
    if (filters.length) action = 'WAIT';
    if (state.status !== 'ok') {
        reasons.push({ code: 'data_not_current', points: 0 });
        action = 'WAIT';
    }

    return { action, score, strength: strengthOf(score), reasons, filtered: filters.length > 0, filters, plan };
}

module.exports = { computeSignal, tradeFilters, tradePlan, REASON_CODES, FILTER_CODES, THRESHOLD, HTF_PROXIMITY_PERCENT, MIN_RISK_REWARD };
