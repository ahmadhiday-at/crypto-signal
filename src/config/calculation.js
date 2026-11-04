// Calculation config (config/calculation.json): signal score threshold, trade plan, trade filters,
// zone weights, score points, indicator periods, S/R zones, market-state thresholds, divergence,
// trade evaluation and backtest defaults. Kept apart from .env (deployment settings). Edited by hand
// or from the /config view; the running app reloads it without a restart.
const fs = require('fs');
const path = require('path');
const { TF_SECONDS } = require('../services/candles');
const { SIGNAL_DEFAULTS, FILTER_DEFAULTS, SCORING_DEFAULTS, TREND_DEFAULTS, HTF_TREND_MODES, TARGET_MODES, MODELS, CONFIRMATION_LEVELS } = require('../services/signal');
const { INDICATOR_DEFAULTS, ZONE_DEFAULTS } = require('../services/indicator.service');
const { MARKET_DEFAULTS } = require('../services/market.service');
const { DIVERGENCE_DEFAULTS } = require('../services/divergence');
const { EXPIRY_CANDLES } = require('../services/signal-log');

const FILE = path.join(__dirname, '../../config/calculation.json');
const WATCH_INTERVAL_MS = 2000;

// Role timeframes and CANDLE_LIMIT (group `engine`): applied at startup only (src/config/calculation.js
// applyEngine), so a change needs a restart. Seeded from TF_* / CANDLE_LIMIT in .env.
const ROLE_KEYS = ['htf', 'structure', 'mid', 'entry'];
const TF_CHOICES = { values: Object.keys(TF_SECONDS) };
const ENGINE_DEFAULTS = { htf: '1d', structure: '4h', mid: '1h', entry: '15m', candle_limit: 500 };
// Shadow signal log (group `shadow`): a second model on its own role timeframes, logged next to the
// live signal without changing it. Its other values (threshold, filters, points) are the live ones.
const SHADOW_DEFAULTS = { enabled: 'on', model: 'trend_pullback', htf: '1w', structure: '1d', mid: '4h', entry: '1h', stop_atr: 3, target_r: 2 };

// S/R lookback candles per timeframe (group `lookback`, was MAPPING_CANDLE); unlisted timeframes use 200.
const LOOKBACK_LIMITS = [20, 1000, true];
const LOOKBACK_DEFAULT = 200;

// [min, max, integer] per numeric key, { values } for a choice. Weights are checked separately: any
// supported timeframe, 0.1–20 (a weight of 0 would fall back to the default weight in the zone merge).
const LIMITS = {
    engine: {
        htf: TF_CHOICES,
        structure: TF_CHOICES,
        mid: TF_CHOICES,
        entry: TF_CHOICES,
        // Binance returns at most 1000 klines; at least 201 rows give 200 closed candles.
        candle_limit: [201, 1000, true],
    },
    shadow: {
        enabled: { values: ['off', 'on'] },
        model: { values: MODELS },
        htf: TF_CHOICES,
        structure: TF_CHOICES,
        mid: TF_CHOICES,
        entry: TF_CHOICES,
        stop_atr: [0.1, 20],
        target_r: [0.5, 20],
    },
    signal: {
        threshold: [1, 15, true],
        min_rr: [0, 10],
        stop_atr: [0, 3],
        trailing_atr: [0, 10],
        htf_proximity_percent: [0, 10],
        target: { values: TARGET_MODES },
        model: { values: MODELS },
    },
    // Trend models (signal.model trend_pullback / breakout). Points are integers like `scoring`.
    trend: {
        htf_points: [0, 10, true],
        structure_points: [0, 10, true],
        entry_points: [0, 10, true],
        pullback_points: [0, 10, true],
        breakout_points: [0, 10, true],
        momentum_points: [0, 10, true],
        volume_points: [0, 5, true],
        pullback_atr: [0, 10],
        channel_candles: [2, 500, true],
        stop_atr: [0.1, 20],
        target_r: [0.5, 20],
    },
    filters: {
        no_mans_land_percent: [0, 10],
        volatility_extreme: [0, 10],
        volatility_dead: [0, 10],
        htf_trend: { values: HTF_TREND_MODES },
        entry_max_atr: [0, 10],
    },
    // Points are integers: the signal score is an integer (docs/contract/market-state.md §4.1).
    scoring: {
        near_zone: [0, 10, true],
        momentum: [0, 10, true],
        htf_zone: [0, 10, true],
        divergence: [0, 10, true],
        volume: [0, 5, true],
        strong_score: [1, 30, true],
        breakout_confirmed: { values: CONFIRMATION_LEVELS },
    },
    indicators: {
        ma_fast: [2, 500, true],
        ma_mid: [2, 500, true],
        ma_slow: [2, 1000, true],
        rsi_period: [2, 100, true],
        macd_fast: [2, 100, true],
        macd_slow: [2, 200, true],
        macd_signal: [2, 100, true],
        atr_period: [2, 100, true],
        min_candles: [50, 1500, true],
        rsi_bullish: [50, 100],
        rsi_bearish: [0, 50],
        regime_ma_percent: [0, 10],
    },
    zones: {
        cluster_percent: [0, 5],
        width_atr: [0, 5],
        touch_points: [0, 20],
        recency_candles: [0, 500, true],
        distance_penalty: [0, 100],
        ma_bonus: [0, 20],
        ma_proximity_percent: [0, 10],
        fallback_candles: [10, 1000, true],
        lookback_volatility_band: [0, 1],
        lookback_scale: [0, 0.9],
    },
    market: {
        volume_candles: [2, 200, true],
        volume_high: [0, 10],
        volume_increasing: [0, 10],
        volume_low: [0, 10],
        energy_explosive: [0, 1e6],
        energy_building: [0, 1e6],
        energy_cooling: [0, 1e6],
        breakout_distance_percent: [0.01, 10],
        breakout_volume_high: [0, 1],
        breakout_volume_increasing: [0, 1],
        breakout_volume_normal: [0, 1],
        breakout_volume_low: [0, 1],
        compression_bonus: [0, 1],
        breakout_strong: [0, 1],
        breakout_weak: [0, 1],
        dominant_percent: [0, 100],
        volatility_candles: [2, 1000, true],
    },
    divergence: {
        lookback: [10, 500, true],
        pivot_width: [1, 20, true],
        max_age: [1, 100, true],
    },
    evaluation: {
        expiry_candles: [1, 2000, true],
        min_trades: [1, 1000, true],
    },
    backtest: {
        days: [1, 1500, true],
        fee_pct: [0, 5],
        split: [0.5, 0.9],
    },
};
const WEIGHT_LIMITS = [0.1, 20];
const GROUPS = ['engine', 'shadow', 'signal', 'filters', 'weights', 'lookback', 'scoring', 'trend', 'indicators', 'zones', 'market', 'divergence', 'evaluation', 'backtest'];
// Groups that change the per-timeframe snapshots (indicators, zones): a change recalculates them.
const SNAPSHOT_GROUPS = ['indicators', 'zones', 'lookback'];

const BACKTEST_DEFAULTS = { days: 365, fee_pct: 0.1, split: 0.7 };

const copy = (v) => JSON.parse(JSON.stringify(v));

// `envWeights` is config.TF_WEIGHTS: the WEIGHT_* env vars seed the default weights.
// `envEngine` is config.ENGINE_ENV: the TF_* roles, CANDLE_LIMIT and MAPPING_CANDLE seed `engine`
// and `lookback`.
function defaultsOf(envWeights = {}, envEngine = {}) {
    const weights = {};
    for (const [tf, w] of Object.entries(envWeights)) if (TF_SECONDS[tf]) weights[tf] = w;
    const lookback = {};
    for (const [tf, n] of Object.entries(envEngine.lookback || {})) if (TF_SECONDS[tf]) lookback[tf] = n;
    return {
        engine: { ...ENGINE_DEFAULTS, ...(envEngine.roles || {}), candle_limit: envEngine.candle_limit ?? ENGINE_DEFAULTS.candle_limit },
        shadow: { ...SHADOW_DEFAULTS },
        signal: { ...SIGNAL_DEFAULTS }, filters: { ...FILTER_DEFAULTS }, weights, lookback,
        scoring: { ...SCORING_DEFAULTS }, trend: { ...TREND_DEFAULTS }, indicators: { ...INDICATOR_DEFAULTS }, zones: { ...ZONE_DEFAULTS },
        market: { ...MARKET_DEFAULTS }, divergence: { ...DIVERGENCE_DEFAULTS },
        evaluation: { expiry_candles: EXPIRY_CANDLES, min_trades: 30 },
        backtest: { ...BACKTEST_DEFAULTS },
    };
}

function inRange(v, limits) {
    if (!Array.isArray(limits)) return limits.values.includes(v);
    const [min, max, int] = limits;
    return typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max && (!int || Number.isInteger(v));
}
function hint(limits) {
    if (!Array.isArray(limits)) return `one of ${limits.values.join(', ')}`;
    const [min, max, int] = limits;
    return `${int ? 'an integer' : 'a number'} ${min}–${max}`;
}

// Rules between keys of the merged config (each key is already in range).
function crossProblems(c) {
    const out = [];
    for (const group of ['engine', 'shadow']) {
        const secs = ROLE_KEYS.map(r => TF_SECONDS[c[group][r]]);
        if (secs.some((v, i) => i > 0 && v > secs[i - 1])) out.push(`${group}: htf ≥ structure ≥ mid ≥ entry timeframe is required`);
    }
    const candleLimit = c.engine.candle_limit;
    const order = (group, keys) => {
        for (let i = 1; i < keys.length; i++) {
            if (!(c[group][keys[i - 1]] < c[group][keys[i]])) out.push(`${group}: ${keys.join(' < ')} is required`);
        }
    };
    order('indicators', ['ma_fast', 'ma_mid', 'ma_slow']);
    order('indicators', ['macd_fast', 'macd_slow']);
    order('indicators', ['rsi_bearish', 'rsi_bullish']);
    const ind = c.indicators;
    const needed = Math.max(ind.ma_slow, ind.macd_slow + ind.macd_signal, ind.rsi_period + 1, ind.atr_period + 1);
    if (ind.min_candles < needed) out.push(`indicators.min_candles must be at least ${needed} (the longest indicator period)`);
    // Each snapshot sees CANDLE_LIMIT − 1 closed candles.
    if (ind.min_candles > candleLimit - 1) out.push(`indicators.min_candles must be at most ${candleLimit - 1} (engine.candle_limit − 1)`);
    order('market', ['volume_low', 'volume_increasing', 'volume_high']);
    order('market', ['energy_cooling', 'energy_building', 'energy_explosive']);
    order('market', ['breakout_weak', 'breakout_strong']);
    if (c.divergence.pivot_width * 2 >= c.divergence.lookback) out.push('divergence: pivot_width × 2 < lookback is required');
    return [...new Set(out)];
}

// Merges `input` over `base` group by group. Returns { value, problems }; `value` is only usable
// when `problems` is empty.
function validate(input, base) {
    const problems = [];
    const value = copy(base);
    if (!input || typeof input !== 'object' || Array.isArray(input)) return { value, problems: ['config must be a JSON object'] };
    for (const group of Object.keys(input)) {
        if (!GROUPS.includes(group)) { problems.push(`unknown group ${group}`); continue; }
        const given = input[group];
        if (!given || typeof given !== 'object' || Array.isArray(given)) { problems.push(`${group} must be an object`); continue; }
        for (const [key, v] of Object.entries(given)) {
            const perTf = { weights: WEIGHT_LIMITS, lookback: LOOKBACK_LIMITS }[group];
            const limits = perTf ? (TF_SECONDS[key] ? perTf : null) : LIMITS[group][key];
            if (!limits) problems.push(`unknown key ${group}.${key}`);
            else if (!inRange(v, limits)) problems.push(`${group}.${key} must be ${hint(limits)}`);
            else value[group][key] = v;
        }
    }
    if (!problems.length) problems.push(...crossProblems(value));
    return { value, problems };
}

// Options for computeSignal / tradePlan / tradeFilters (src/services/signal.js).
function signalOptions(cfg) {
    return {
        threshold: cfg.signal.threshold,
        minRiskReward: cfg.signal.min_rr,
        stopAtr: cfg.signal.stop_atr,
        trailingAtr: cfg.signal.trailing_atr,
        htfProximity: cfg.signal.htf_proximity_percent,
        target: cfg.signal.target,
        noMansLand: cfg.filters.no_mans_land_percent,
        volatilityExtreme: cfg.filters.volatility_extreme,
        volatilityDead: cfg.filters.volatility_dead,
        htfTrend: cfg.filters.htf_trend,
        entryMaxAtr: cfg.filters.entry_max_atr,
        scoring: cfg.scoring,
        model: cfg.signal.model,
        trend: cfg.trend,
    };
}

// Zone weights for the merge: the configured timeframes plus DEFAULT for the others.
const mergeWeights = (cfg) => ({ ...cfg.weights, DEFAULT: 1.0 });

// Options for the per-timeframe snapshot (indicator.service calculateAll) and for the merged
// Market State (market.service composeMarketState).
const snapshotParams = (cfg) => ({ indicators: cfg.indicators, zones: cfg.zones, lookback: cfg.lookback });
const stateParams = (cfg) => ({ market: cfg.market, divergence: cfg.divergence, trend: cfg.trend });

// The groups whose values change backtest results; a report made with other values is params_differ.
const RESULT_GROUPS = ['scoring', 'trend', 'indicators', 'zones', 'lookback', 'market', 'divergence', 'evaluation'];
const resultParams = (cfg) => Object.fromEntries(RESULT_GROUPS.map(g => [g, cfg[g]]));

// `envWeights` / `envEngine` (config.TF_WEIGHTS / config.ENGINE_ENV) seed the defaults.
function createCalcConfig({ file = FILE, envWeights = {}, envEngine = {}, log = console } = {}) {
    const defaults = defaultsOf(envWeights, envEngine);
    let current = copy(defaults);
    const listeners = [];

    function write(value) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
        fs.renameSync(tmp, file);
    }

    // Listeners get (next, previous) config copies.
    function apply(value) {
        const changed = JSON.stringify(value) !== JSON.stringify(current);
        const prev = current;
        current = value;
        if (changed) for (const fn of listeners) fn(get(), copy(prev));
        return changed;
    }

    // Reads the file. A missing file is created with the defaults; an unreadable or invalid file
    // keeps the values in use and logs why.
    function load() {
        let raw;
        try {
            raw = fs.readFileSync(file, 'utf8');
        } catch (err) {
            if (err.code !== 'ENOENT') {
                log.error(`[CalcConfig] cannot read ${file}: ${err.message}`);
                return { loaded: false, error: 'read_failed' };
            }
            try {
                write(current);
                log.warn(`[CalcConfig] ${file} not found; created it with the defaults`);
            } catch (e) {
                log.error(`[CalcConfig] cannot create ${file}: ${e.message}`);
            }
            return { loaded: true, changed: false };
        }
        let parsed;
        try {
            parsed = JSON.parse(raw);
        } catch (err) {
            log.error(`[CalcConfig] ${file} is not valid JSON (${err.message}); keeping the values in use`);
            return { loaded: false, error: 'invalid_json' };
        }
        const { value, problems } = validate(parsed, defaults);
        if (problems.length) {
            log.error(`[CalcConfig] ${file} rejected: ${problems.join('; ')}; keeping the values in use`);
            return { loaded: false, error: 'invalid_config', problems };
        }
        return { loaded: true, changed: apply(value) };
    }

    // Validates `input` (a full or partial config) over the values in use, saves and applies it.
    function update(input) {
        const { value, problems } = validate(input, current);
        if (problems.length) return { problems };
        write(value);
        const changed = apply(value);
        if (changed) log.log(`[CalcConfig] updated from the API`);
        return { config: get(), changed };
    }

    // Hand edits: polls the file (works on Docker bind mounts, where fs.watch may miss changes).
    function watch() {
        fs.watchFile(file, { interval: WATCH_INTERVAL_MS }, (cur, prev) => {
            if (cur.mtimeMs === prev.mtimeMs) return;
            const res = load();
            if (res.changed) log.warn(`[CalcConfig] reloaded ${file}`);
        });
    }

    const unwatch = () => fs.unwatchFile(file);
    const get = () => copy(current);
    const onChange = (fn) => listeners.push(fn);

    return {
        file,
        load,
        update,
        watch,
        unwatch,
        get,
        defaults: () => copy(defaults),
        onChange,
        signalOptions: () => signalOptions(current),
        weights: () => mergeWeights(current),
        snapshotParams: () => copy(snapshotParams(current)),
        stateParams: () => copy(stateParams(current)),
        resultParams: () => copy(resultParams(current)),
        shadowOptions: () => shadowOptions(copy(current)),
    };
}

// The shadow model's roles and computeSignal options: the live options with the shadow's model,
// stop and target. Null when the shadow log is off.
function shadowOptions(cfg) {
    const s = cfg.shadow;
    if (!s || s.enabled !== 'on') return null;
    const roles = Object.fromEntries(ROLE_KEYS.map(r => [r, s[r]]));
    return {
        roles,
        signal: { ...signalOptions(cfg), model: s.model, trend: { ...cfg.trend, stop_atr: s.stop_atr, target_r: s.target_r }, structureTf: roles.structure, entryTf: roles.entry },
    };
}

// True when a config change touches the snapshot groups (indicators, zones, lookback).
const snapshotChanged = (next, prev) => SNAPSHOT_GROUPS.some(g => JSON.stringify(next[g]) !== JSON.stringify(prev[g]));
const engineChanged = (next, prev) => JSON.stringify(next.engine) !== JSON.stringify(prev.engine);

// Startup: the saved role timeframes and candle limit replace the .env values for this process.
// Returns the engine values now running (shown by /config until the next restart).
function applyEngine(config, binance, cfg) {
    config.TF_ROLES = Object.fromEntries(ROLE_KEYS.map(r => [r, cfg.engine[r]]));
    binance.setCandleLimit(cfg.engine.candle_limit);
    config.ENGINE_RUNNING = { ...cfg.engine };
    return config.ENGINE_RUNNING;
}

module.exports = {
    createCalcConfig, validate, defaultsOf, signalOptions, mergeWeights, snapshotParams, stateParams, resultParams, snapshotChanged,
    engineChanged, applyEngine, shadowOptions, SHADOW_DEFAULTS, LIMITS, WEIGHT_LIMITS, LOOKBACK_LIMITS, LOOKBACK_DEFAULT, ROLE_KEYS, GROUPS, RESULT_GROUPS, FILE,
};
