// Level 2 scoring (docs/roadmap/level-2.md): a weighted point system over existing Market State
// fields, producing a heuristic BUY/SELL/WAIT signal with its reasons. Pure and deterministic.

const THRESHOLD = 5;
const HTF_PROXIMITY_PERCENT = 1;

// Level 2.5B trade filter (docs/roadmap/level-2.5b.md). Starting values, to be reviewed.
// These constants are the defaults; the live values come from config/calculation.json.
const NO_MANS_LAND_PERCENT = 1;
const VOLATILITY_EXTREME = 2.0;
const VOLATILITY_DEAD = 0.5;
// Breakout confirmations from weakest to strongest; config `scoring.breakout_confirmed` is the
// weakest one that lets a BUY into resistance (SELL into support) pass.
const CONFIRMATION_LEVELS = ['weak', 'medium', 'strong'];

// Defaults of the calculation config's `scoring` group: points per reason and the score for
// strength `strong` (Level 6.5 B3 calibrates these).
const SCORING_DEFAULTS = {
    near_zone: 2, momentum: 2, htf_zone: 3, divergence: 2, volume: 1, strong_score: 7, breakout_confirmed: 'medium',
};

// Level 6.5 B1 HTF trend filter (docs/roadmap/level-6.5.md): which role timeframes' `trend` may veto
// a signal against it. 'off' until the B4 validation adopts it.
const HTF_TREND_MODES = ['off', 'htf', 'htf+structure'];
const HTF_TREND = 'off';

// Level 6.5 B2 entry location: maximum distance from price to the entry zone, × ATR (0 = off).
const ENTRY_MAX_ATR = 0;

const FILTER_CODES = ['no_mans_land', 'volatility_extreme', 'volatility_dead', 'buy_into_resistance', 'sell_into_support', 'low_rr', 'against_htf_trend', 'far_from_entry'];

// Level 3 trade plan (docs/roadmap/level-3.md). Starting values, to be reviewed.
const STOP_ATR_BUFFER = 0.5;
const TRAILING_ATR = 1.5;
const MIN_RISK_REWARD = 1.5;
// Level 6.5 B2 target choice: 'tp1' nearest opposite zone, 'rr_zone' the first zone ahead that gives
// at least the minimum risk/reward, 'tp2' the major HTF zone.
const TARGET_MODES = ['tp1', 'rr_zone', 'tp2'];
const TARGET = 'tp1';

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v) => (num(v) ? +v.toPrecision(10) : null);

// Entry zone, stop loss, targets, risk/reward and a trailing stop for a BUY (long) or SELL (short).
// Returns null when the inputs needed for a plan are missing. `target` is one of TARGET_MODES, or
// (backtest sweep only) a number N for a fixed target at N × risk. 'rr_zone' falls back to the
// nearest zone when no zone ahead reaches `minRiskReward` (the plan is then filtered as low_rr).
function tradePlan(state, action, htfTf, { stopAtr = STOP_ATR_BUFFER, target = TARGET, trailingAtr = TRAILING_ATR, minRiskReward = MIN_RISK_REWARD } = {}) {
    const price = state.price;
    const atr = state.indicators?.atr;
    const long = action === 'BUY';
    const zone = long ? state.levels?.support?.[0] : state.levels?.resistance?.[0];
    if (!num(price) || !num(atr) || !zone || !num(zone.low) || !num(zone.high)) return null;

    const stop = long ? zone.low - stopAtr * atr : zone.high + stopAtr * atr;
    const beyond = (l) => num(l.mid) && (long ? l.mid > price : l.mid < price);
    const targets = (long ? state.levels?.resistance : state.levels?.support || []) || [];
    const ahead = targets.filter(beyond).sort((a, b) => (long ? a.mid - b.mid : b.mid - a.mid));
    const risk = long ? price - stop : stop - price;
    const rrTo = (mid) => (risk > 0 ? (long ? mid - price : price - mid) / risk : null);
    // The highest-scored HTF zone farther than `level` (the major target beyond it).
    const majorBeyond = (level) => ahead
        .filter(l => l !== level && ahead.indexOf(l) > ahead.indexOf(level) && Array.isArray(l.tfs) && l.tfs.includes(htfTf))
        .sort((a, b) => b.score - a.score)[0] ?? null;

    let first = ahead[0] ?? null;
    if (target === 'rr_zone') first = ahead.find(l => rrTo(l.mid) >= minRiskReward) ?? first;
    const tp2 = first ? majorBeyond(first)?.mid ?? null : null;
    let tp1 = first ? first.mid : null;
    if (target === 'tp2') tp1 = tp2;
    else if (num(target)) tp1 = risk > 0 ? (long ? price + target * risk : price - target * risk) : null;
    const reward = num(tp1) ? (long ? tp1 - price : price - tp1) : null;
    const rr = risk > 0 && num(reward) && reward > 0 ? reward / risk : null;
    // How far price already is from the entry zone, × ATR (0 inside the zone).
    const away = long ? Math.max(0, price - zone.high, zone.low - price) : Math.max(0, zone.low - price, price - zone.high);

    return {
        side: long ? 'long' : 'short',
        entry_zone: [round(zone.low), round(zone.high)],
        stop_loss: round(stop),
        take_profit_1: round(tp1),
        take_profit_2: round(tp2),
        risk_reward: num(rr) ? +rr.toFixed(2) : null,
        trailing_stop: round(long ? price - trailingAtr * atr : price + trailingAtr * atr),
        entry_distance_atr: atr > 0 ? +(away / atr).toFixed(2) : null,
    };
}

// Returns the filter codes that reject a BUY/SELL; an empty list means the setup passes.
// `trendTfs` are the timeframes checked by the HTF trend filter (empty = off): a BUY is rejected
// when one of them trends down, a SELL when one trends up; `ranging` and `unknown` never reject.
function tradeFilters(state, action, { noMansLand = NO_MANS_LAND_PERCENT, volatilityExtreme = VOLATILITY_EXTREME, volatilityDead = VOLATILITY_DEAD, trendTfs = [], scoring = {} } = {}) {
    const failed = [];
    const dist = state.distance_percent || {};
    const nearest = Math.min(dist.to_support ?? Infinity, dist.to_resistance ?? Infinity);
    if (state.context === 'mid_range' && nearest > noMansLand) failed.push('no_mans_land');

    const vr = state.volatility_ratio;
    if (typeof vr === 'number') {
        if (vr > volatilityExtreme) failed.push('volatility_extreme');
        if (vr < volatilityDead) failed.push('volatility_dead');
    }

    const minConfirmed = CONFIRMATION_LEVELS.indexOf({ ...SCORING_DEFAULTS, ...scoring }.breakout_confirmed);
    const confirmed = CONFIRMATION_LEVELS.indexOf(state.breakout_confirmation) >= minConfirmed;
    if (action === 'BUY' && state.context === 'near_resistance' && !confirmed) failed.push('buy_into_resistance');
    if (action === 'SELL' && state.context === 'near_support' && !confirmed) failed.push('sell_into_support');

    const against = action === 'BUY' ? 'down' : 'up';
    if (trendTfs.some(tf => state.timeframes?.[tf]?.trend === against)) failed.push('against_htf_trend');
    return failed;
}

const REASON_CODES = [
    'near_support', 'near_resistance', 'bullish_momentum', 'bearish_momentum',
    'strong_htf_support', 'strong_htf_resistance', 'bullish_divergence', 'bearish_divergence',
    'volume_surge', 'weak_volume', 'data_not_current',
    // Trend models (since 2.20.0)
    'htf_trend_up', 'htf_trend_down', 'structure_trend_up', 'structure_trend_down', 'entry_trend_up', 'entry_trend_down',
    'pullback_to_ma', 'channel_breakout_up', 'channel_breakout_down',
];

// Signal models (Level 6.5 follow-up, docs/roadmap/level-6.5.md): 'bounce' is the S/R score above;
// 'trend_pullback' buys a pullback to the entry MA50 in an HTF up trend (sells the mirror);
// 'breakout' buys a close above the entry channel high in the trend direction (sells the mirror).
const MODELS = ['bounce', 'trend_pullback', 'breakout'];
const MODEL = 'bounce';

// Defaults of the calculation config's `trend` group: points, stop and target of the trend models.
const TREND_DEFAULTS = {
    htf_points: 3, structure_points: 2, entry_points: 1, pullback_points: 2, breakout_points: 3, momentum_points: 1, volume_points: 1,
    pullback_atr: 1, channel_candles: 20, stop_atr: 1.5, target_r: 2,
};

function strengthOf(score, threshold = THRESHOLD, strongScore = SCORING_DEFAULTS.strong_score) {
    const a = Math.abs(score);
    if (a >= strongScore) return 'strong';
    if (a >= threshold) return 'medium';
    return 'weak';
}

// The timeframes the HTF trend filter checks for a mode; `structureTf` is the TF_STRUCTURE role.
function trendTfsOf(mode, htfTf, structureTf) {
    if (mode === 'htf') return [htfTf];
    if (mode === 'htf+structure') return [...new Set([htfTf, structureTf].filter(Boolean))];
    return [];
}

// `state` is a Market State (contract v2) with `status` already computed; `htfTf` is the TF_HTF role.
// `opts` holds the calculation config (signalOptions in src/config/calculation.js) plus
// `structureTf` and `entryTf` (the TF_STRUCTURE / TF_ENTRY roles); missing keys use the defaults
// above. `opts.model` picks the signal model (MODELS).
function computeSignal(state, htfTf, opts = {}) {
    const model = opts.model ?? MODEL;
    return model === 'bounce' ? bounceSignal(state, htfTf, opts) : trendSignal(state, htfTf, model, opts);
}

// Trend models: points for the HTF / structure / entry trends, then the trigger (pullback to the
// entry MA50, or a close beyond the entry channel), momentum and volume. The plan uses an ATR stop
// and a fixed-R target; the S/R filters of the bounce model (no_mans_land, buy_into_resistance,
// sell_into_support) do not apply.
function trendSignal(state, htfTf, model, opts) {
    const { threshold = THRESHOLD, minRiskReward = MIN_RISK_REWARD, htfTrend = HTF_TREND, structureTf, entryTf } = opts;
    const p = { ...TREND_DEFAULTS, ...opts.trend };
    const reasons = [];
    let score = 0;
    const add = (code, points) => { if (points) { reasons.push({ code, points }); score += points; } };
    const trendOf = (tf) => state.timeframes?.[tf]?.trend;
    const sideOf = (trend) => (trend === 'up' ? 1 : trend === 'down' ? -1 : 0);

    const htf = sideOf(trendOf(htfTf));
    if (htf) add(htf > 0 ? 'htf_trend_up' : 'htf_trend_down', htf * p.htf_points);
    const structure = structureTf && structureTf !== htfTf ? sideOf(trendOf(structureTf)) : 0;
    if (structure) add(structure > 0 ? 'structure_trend_up' : 'structure_trend_down', structure * p.structure_points);
    const entry = entryTf && ![htfTf, structureTf].includes(entryTf) ? sideOf(trendOf(entryTf)) : 0;
    if (entry) add(entry > 0 ? 'entry_trend_up' : 'entry_trend_down', entry * p.entry_points);
    // The trigger and momentum point the way the higher timeframes already do.
    const bias = Math.sign(score);

    const price = state.price;
    const atr = state.indicators?.atr;
    const ma50 = state.indicators?.ma50;
    if (model === 'trend_pullback' && bias && num(price) && num(atr) && num(ma50) && Math.abs(price - ma50) <= p.pullback_atr * atr) {
        add('pullback_to_ma', bias * p.pullback_points);
    }
    const ch = state.channel;
    if (model === 'breakout' && ch && num(price)) {
        if (num(ch.high) && price > ch.high && bias >= 0) add('channel_breakout_up', p.breakout_points);
        else if (num(ch.low) && price < ch.low && bias <= 0) add('channel_breakout_down', -p.breakout_points);
    }
    const hist = state.indicators?.macd?.histogram;
    if (score && num(hist) && Math.sign(hist) === Math.sign(score)) add(score > 0 ? 'bullish_momentum' : 'bearish_momentum', Math.sign(score) * p.momentum_points);
    if (score && state.volume_state === 'high') add('volume_surge', Math.sign(score) * p.volume_points);
    if (score && state.volume_state === 'low') add('weak_volume', -Math.sign(score) * p.volume_points);

    let action = score >= threshold ? 'BUY' : score <= -threshold ? 'SELL' : 'WAIT';
    const plan = action === 'WAIT' ? null : fixedRiskPlan(state, action, htfTf, p, opts.trailingAtr ?? TRAILING_ATR);
    const filters = [];
    if (action !== 'WAIT') {
        const vr = state.volatility_ratio;
        if (num(vr) && vr > (opts.volatilityExtreme ?? VOLATILITY_EXTREME)) filters.push('volatility_extreme');
        if (num(vr) && vr < (opts.volatilityDead ?? VOLATILITY_DEAD)) filters.push('volatility_dead');
        const against = action === 'BUY' ? 'down' : 'up';
        if (trendTfsOf(htfTrend, htfTf, structureTf).some(tf => trendOf(tf) === against)) filters.push('against_htf_trend');
        if (!(plan?.risk_reward >= minRiskReward)) filters.push('low_rr');
    }
    if (filters.length) action = 'WAIT';
    if (state.status !== 'ok') {
        reasons.push({ code: 'data_not_current', points: 0 });
        action = 'WAIT';
    }
    const strongScore = opts.scoring?.strong_score ?? SCORING_DEFAULTS.strong_score;
    return { action, score, strength: strengthOf(score, threshold, strongScore), reasons, filtered: filters.length > 0, filters, plan };
}

// Trend-model plan: stop `stop_atr` × ATR from price, TP1 at `target_r` × risk, TP2 the major HTF
// zone beyond TP1. The entry zone is the signal candle's close.
function fixedRiskPlan(state, action, htfTf, p, trailingAtr) {
    const price = state.price;
    const atr = state.indicators?.atr;
    if (!num(price) || !num(atr) || atr <= 0) return null;
    const long = action === 'BUY';
    const risk = p.stop_atr * atr;
    const tp1 = long ? price + p.target_r * risk : price - p.target_r * risk;
    const beyond = (l) => num(l.mid) && (long ? l.mid > tp1 : l.mid < tp1) && Array.isArray(l.tfs) && l.tfs.includes(htfTf);
    const major = ((long ? state.levels?.resistance : state.levels?.support) || []).filter(beyond).sort((a, b) => b.score - a.score)[0];
    return {
        side: long ? 'long' : 'short',
        entry_zone: [round(price), round(price)],
        stop_loss: round(long ? price - risk : price + risk),
        take_profit_1: round(tp1),
        take_profit_2: major ? round(major.mid) : null,
        risk_reward: risk > 0 ? +p.target_r.toFixed(2) : null,
        trailing_stop: round(long ? price - trailingAtr * atr : price + trailingAtr * atr),
        entry_distance_atr: 0,
    };
}

// The S/R bounce model (Level 2 score, Level 2.5B filters, Level 3 plan).
function bounceSignal(state, htfTf, opts) {
    const { threshold = THRESHOLD, minRiskReward = MIN_RISK_REWARD, htfProximity = HTF_PROXIMITY_PERCENT, htfTrend = HTF_TREND, entryMaxAtr = ENTRY_MAX_ATR, structureTf } = opts;
    const pts = { ...SCORING_DEFAULTS, ...opts.scoring };
    const reasons = [];
    let score = 0;
    const add = (code, points) => { reasons.push({ code, points }); score += points; };

    if (state.context === 'near_support') add('near_support', pts.near_zone);
    if (state.context === 'near_resistance') add('near_resistance', -pts.near_zone);

    if (state.momentum === 'bullish') add('bullish_momentum', pts.momentum);
    if (state.momentum === 'bearish') add('bearish_momentum', -pts.momentum);

    const topSupport = state.levels?.support?.[0];
    const topResistance = state.levels?.resistance?.[0];
    if (topSupport?.tfs?.includes(htfTf) && state.distance_percent?.to_support <= htfProximity) {
        add('strong_htf_support', pts.htf_zone);
    }
    if (topResistance?.tfs?.includes(htfTf) && state.distance_percent?.to_resistance <= htfProximity) {
        add('strong_htf_resistance', -pts.htf_zone);
    }

    if (state.divergence === 'bullish') add('bullish_divergence', pts.divergence);
    if (state.divergence === 'bearish') add('bearish_divergence', -pts.divergence);

    // Volume changes conviction, not direction: one point toward or away from zero.
    if (score !== 0) {
        const dir = Math.sign(score);
        if (state.volume_state === 'high') add('volume_surge', dir * pts.volume);
        if (state.volume_state === 'low') add('weak_volume', -dir * pts.volume);
    }

    let action = score >= threshold ? 'BUY' : score <= -threshold ? 'SELL' : 'WAIT';
    const plan = action === 'WAIT' ? null : tradePlan(state, action, htfTf, { ...opts, minRiskReward });
    const filters = action === 'WAIT' ? [] : tradeFilters(state, action, { ...opts, trendTfs: trendTfsOf(htfTrend, htfTf, structureTf) });
    if (action !== 'WAIT' && !(plan?.risk_reward >= minRiskReward)) filters.push('low_rr');
    if (action !== 'WAIT' && entryMaxAtr > 0 && plan?.entry_distance_atr > entryMaxAtr) filters.push('far_from_entry');
    if (filters.length) action = 'WAIT';
    if (state.status !== 'ok') {
        reasons.push({ code: 'data_not_current', points: 0 });
        action = 'WAIT';
    }

    return { action, score, strength: strengthOf(score, threshold, pts.strong_score), reasons, filtered: filters.length > 0, filters, plan };
}

// Defaults of the calculation config's `signal` and `filters` groups (config/calculation.json).
const SIGNAL_DEFAULTS = {
    threshold: THRESHOLD, min_rr: MIN_RISK_REWARD, stop_atr: STOP_ATR_BUFFER, trailing_atr: TRAILING_ATR,
    htf_proximity_percent: HTF_PROXIMITY_PERCENT, target: TARGET, model: MODEL,
};
const FILTER_DEFAULTS = {
    no_mans_land_percent: NO_MANS_LAND_PERCENT, volatility_extreme: VOLATILITY_EXTREME, volatility_dead: VOLATILITY_DEAD,
    htf_trend: HTF_TREND, entry_max_atr: ENTRY_MAX_ATR,
};

module.exports = { computeSignal, tradeFilters, tradePlan, REASON_CODES, FILTER_CODES, HTF_TREND_MODES, TARGET_MODES, MODELS, TREND_DEFAULTS, SCORING_DEFAULTS, CONFIRMATION_LEVELS, THRESHOLD, HTF_PROXIMITY_PERCENT, MIN_RISK_REWARD, STOP_ATR_BUFFER, SIGNAL_DEFAULTS, FILTER_DEFAULTS };
