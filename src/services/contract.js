// Validation for the Market State (docs/contract/market-state.md) and per-timeframe snapshots.
const SCHEMA_VERSION = 2;
const { REASON_CODES, FILTER_CODES } = require('./signal');

const ENUMS = {
    context: ['near_support', 'near_resistance', 'compression_zone', 'mid_range'],
    tf_context: ['near_support', 'near_resistance', 'mid_range', 'unknown'],
    momentum: ['bullish', 'bearish', 'neutral'],
    regime: ['trending', 'ranging', 'unknown'],
    position: ['closer_to_support', 'closer_to_resistance', 'mid_range'],
    zone_state: ['normal', 'compression'],
    dominant_side: ['support', 'resistance', 'equilibrium'],
    market_pressure: ['bullish_compression', 'bearish_compression', 'neutral_compression', 'bullish_lean', 'bearish_lean', 'balanced'],
    market_energy: ['explosive', 'building', 'cooling', 'stable'],
    volume_state: ['high', 'increasing', 'normal', 'low'],
    breakout_confirmation: ['strong', 'medium', 'weak', 'noise', 'none'],
    setup_state: ['breakout_entry_ready', 'waiting_breakout', 'potential_bounce_entry', 'watching_support', 'potential_reject_entry', 'watching_resistance', 'no_trade'],
    fake_breakout_risk: ['low', 'medium', 'high'],
    regime_global: ['trending', 'ranging', 'unknown', 'weak_trend', 'mixed'],
    status: ['ok', 'degraded', 'stale'],
    signal_action: ['BUY', 'SELL', 'WAIT'],
    divergence: ['bullish', 'bearish', 'none'],
    signal_strength: ['weak', 'medium', 'strong'],
    input_status: ['ok', 'stale', 'missing'],
};

const ERROR_CODES = [
    'binance_429', 'binance_418', 'binance_451', 'binance_http', 'timeout', 'network',
    'invalid_response', 'insufficient_data', 'calculation_failed', 'storage_failed',
    'missing_input', 'invalid_summary',
];

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function validateLevel(level, path, errors) {
    if (!isObj(level)) return errors.push(`${path} is not an object`);
    for (const k of ['low', 'high', 'mid', 'score', 'score_raw']) {
        if (!isNum(level[k])) errors.push(`${path}.${k} must be a finite number`);
    }
    if (level.touches !== undefined && !isNum(level.touches)) errors.push(`${path}.touches must be a number when present`);
    if (!Array.isArray(level.tfs) || !level.tfs.every(t => typeof t === 'string')) errors.push(`${path}.tfs must be a string array`);
    if (isNum(level.low) && isNum(level.high) && level.low > level.high) errors.push(`${path}.low exceeds high`);
}

// Returns a list of contract violations; an empty list means the object is valid.
function validateMarketState(s) {
    const errors = [];
    if (!isObj(s)) return ['market state is not an object'];

    const enumField = (field, values = ENUMS[field]) => {
        if (!values.includes(s[field])) errors.push(`${field} has invalid value ${JSON.stringify(s[field])}`);
    };

    if (s.schema_version !== SCHEMA_VERSION) errors.push(`schema_version must be ${SCHEMA_VERSION}`);
    if (typeof s.market !== 'string' || !s.market) errors.push('market must be a non-empty string');
    if (s.timeframe !== 'multitimeframe') errors.push('timeframe must be "multitimeframe"');
    if (!Array.isArray(s.timeframe_list) || s.timeframe_list.length === 0) errors.push('timeframe_list must be a non-empty array');
    for (const f of ['price', 'timestamp', 'generated_at', 'breakout_score']) {
        if (!isNum(s[f])) errors.push(`${f} must be a finite number`);
    }
    if (isNum(s.breakout_score) && (s.breakout_score < 0 || s.breakout_score > 1)) errors.push('breakout_score must be within 0..1');

    for (const f of ['context', 'momentum', 'regime', 'position', 'zone_state', 'dominant_side', 'market_pressure',
        'market_energy', 'volume_state', 'breakout_confirmation', 'setup_state', 'fake_breakout_risk', 'regime_global', 'status']) {
        enumField(f);
    }

    if (!isObj(s.ohlcv)) errors.push('ohlcv must be an object');
    else for (const k of ['time', 'open', 'high', 'low', 'close', 'volume']) {
        if (!isNum(s.ohlcv[k])) errors.push(`ohlcv.${k} must be a finite number`);
    }

    if (!isObj(s.indicators)) errors.push('indicators must be an object');
    else {
        for (const k of ['ma14', 'ma50', 'ma200', 'rsi', 'atr', 'volume']) {
            if (!isNum(s.indicators[k])) errors.push(`indicators.${k} must be a finite number`);
        }
        const m = s.indicators.macd;
        if (!isObj(m) || !['MACD', 'signal', 'histogram'].every(k => isNum(m[k]))) errors.push('indicators.macd must have finite MACD, signal, histogram');
    }

    if (!isObj(s.levels)) errors.push('levels must be an object');
    else for (const side of ['support', 'resistance']) {
        const list = s.levels[side];
        if (!Array.isArray(list) || list.length === 0 || list.length > 3) errors.push(`levels.${side} must contain 1-3 levels`);
        else list.forEach((l, i) => validateLevel(l, `levels.${side}[${i}]`, errors));
    }

    for (const g of ['distance', 'distance_percent']) {
        if (!isObj(s[g]) || !isNum(s[g].to_support) || !isNum(s[g].to_resistance)) errors.push(`${g} must have finite to_support and to_resistance`);
    }

    if (!isObj(s.timeframes)) errors.push('timeframes must be an object');
    else for (const [tf, t] of Object.entries(s.timeframes)) {
        if (!isObj(t) || !isNum(t.price) || !isNum(t.timestamp) || !ENUMS.tf_context.includes(t.context)
            || !ENUMS.momentum.includes(t.momentum) || !ENUMS.regime.includes(t.regime)) {
            errors.push(`timeframes.${tf} is invalid`);
        }
    }

    if (!isObj(s.inputs)) errors.push('inputs must be an object');
    else {
        for (const tf of s.timeframe_list || []) {
            const inp = s.inputs[tf];
            if (!isObj(inp) || !ENUMS.input_status.includes(inp.status)) {
                errors.push(`inputs.${tf} is missing or has an invalid status`);
            } else if (inp.status !== 'missing' && (!isNum(inp.candle_close_time) || !isNum(inp.age_seconds))) {
                errors.push(`inputs.${tf} must have candle_close_time and age_seconds`);
            }
        }
    }

    if (!Array.isArray(s.errors) || !s.errors.every(e => typeof e === 'string')) errors.push('errors must be a string array');

    const sig = s.signal;
    if (!isObj(sig)) errors.push('signal must be an object');
    else {
        if (!ENUMS.signal_action.includes(sig.action)) errors.push('signal.action is invalid');
        if (!ENUMS.signal_strength.includes(sig.strength)) errors.push('signal.strength is invalid');
        if (!Number.isInteger(sig.score)) errors.push('signal.score must be an integer');
        if (!Array.isArray(sig.reasons) || !sig.reasons.every(r => isObj(r) && REASON_CODES.includes(r.code) && Number.isInteger(r.points))) {
            errors.push('signal.reasons must be {code, points} items with known codes');
        }
        if (typeof sig.filtered !== 'boolean') errors.push('signal.filtered must be a boolean');
        if (!Array.isArray(sig.filters) || !sig.filters.every(f => FILTER_CODES.includes(f))) errors.push('signal.filters must list known filter codes');
        if (sig.filtered !== (Array.isArray(sig.filters) && sig.filters.length > 0)) errors.push('signal.filtered must match signal.filters');
    }
    if (s.volatility_ratio !== null && !isNum(s.volatility_ratio)) errors.push('volatility_ratio must be a finite number or null');
    if (!ENUMS.divergence.includes(s.divergence)) errors.push('divergence has invalid value ' + JSON.stringify(s.divergence));

    return errors;
}

// Validates a per-timeframe snapshot written by the indicator service.
function validateSnapshot(snap, market, tf) {
    const errors = [];
    if (!isObj(snap)) return ['snapshot is not an object'];
    if (snap.market !== market) errors.push('market mismatch');
    if (snap.timeframe !== tf) errors.push('timeframe mismatch');
    if (!isNum(snap.candle_close_time)) errors.push('candle_close_time must be a finite number');
    if (!isNum(snap.price)) errors.push('price must be a finite number');
    if (!Array.isArray(snap.candles) || snap.candles.length === 0) errors.push('candles must be a non-empty array');
    else {
        const last = snap.candles[snap.candles.length - 1];
        if (!isObj(last) || last.close_time !== snap.candle_close_time) errors.push('last candle does not match candle_close_time');
    }
    if (!isObj(snap.indicators)) errors.push('indicators must be an object');
    if (!Array.isArray(snap.support) || !Array.isArray(snap.resistance)) errors.push('support/resistance must be arrays');
    if (!ENUMS.tf_context.includes(snap.context)) errors.push('context is invalid');
    if (!ENUMS.momentum.includes(snap.momentum)) errors.push('momentum is invalid');
    if (!ENUMS.regime.includes(snap.regime)) errors.push('regime is invalid');
    return errors;
}

module.exports = { SCHEMA_VERSION, ENUMS, ERROR_CODES, validateMarketState, validateSnapshot };
