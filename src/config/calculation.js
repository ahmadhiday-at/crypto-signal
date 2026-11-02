// Calculation config (config/calculation.json): signal score threshold, trade plan, trade filters,
// zone weights and backtest defaults. Kept apart from .env (deployment settings). Edited by hand or
// from the /config view; the running app reloads it without a restart.
const fs = require('fs');
const path = require('path');
const { TF_SECONDS } = require('../services/candles');
const { SIGNAL_DEFAULTS, FILTER_DEFAULTS } = require('../services/signal');

const FILE = path.join(__dirname, '../../config/calculation.json');
const WATCH_INTERVAL_MS = 2000;

// [min, max, integer] per key. Weights are checked separately: any supported timeframe, 0.1–20
// (a weight of 0 would fall back to the default weight in the zone merge).
const LIMITS = {
    signal: {
        threshold: [1, 15, true],
        min_rr: [0, 10],
        stop_atr: [0, 3],
        trailing_atr: [0, 10],
        htf_proximity_percent: [0, 10],
    },
    filters: {
        no_mans_land_percent: [0, 10],
        volatility_extreme: [0, 10],
        volatility_dead: [0, 10],
    },
    backtest: {
        days: [1, 1500, true],
        fee_pct: [0, 5],
        split: [0.5, 0.9],
    },
};
const WEIGHT_LIMITS = [0.1, 20];
const GROUPS = ['signal', 'filters', 'weights', 'backtest'];

const BACKTEST_DEFAULTS = { days: 365, fee_pct: 0.1, split: 0.7 };

const copy = (v) => JSON.parse(JSON.stringify(v));

// `envWeights` is config.TF_WEIGHTS: the WEIGHT_* env vars seed the default weights.
function defaultsOf(envWeights = {}) {
    const weights = {};
    for (const [tf, w] of Object.entries(envWeights)) if (TF_SECONDS[tf]) weights[tf] = w;
    return { signal: { ...SIGNAL_DEFAULTS }, filters: { ...FILTER_DEFAULTS }, weights, backtest: { ...BACKTEST_DEFAULTS } };
}

const inRange = (v, [min, max, int]) => typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max && (!int || Number.isInteger(v));
const hint = ([min, max, int]) => `${int ? 'an integer' : 'a number'} ${min}–${max}`;

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
            const limits = group === 'weights' ? (TF_SECONDS[key] ? WEIGHT_LIMITS : null) : LIMITS[group][key];
            if (!limits) problems.push(`unknown key ${group}.${key}`);
            else if (!inRange(v, limits)) problems.push(`${group}.${key} must be ${hint(limits)}`);
            else value[group][key] = v;
        }
    }
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
        noMansLand: cfg.filters.no_mans_land_percent,
        volatilityExtreme: cfg.filters.volatility_extreme,
        volatilityDead: cfg.filters.volatility_dead,
    };
}

// Zone weights for the merge: the configured timeframes plus DEFAULT for the others.
const mergeWeights = (cfg) => ({ ...cfg.weights, DEFAULT: 1.0 });

function createCalcConfig({ file = FILE, envWeights = {}, log = console } = {}) {
    const defaults = defaultsOf(envWeights);
    let current = copy(defaults);
    const listeners = [];

    function write(value) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const tmp = `${file}.${process.pid}.tmp`;
        fs.writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n');
        fs.renameSync(tmp, file);
    }

    function apply(value) {
        const changed = JSON.stringify(value) !== JSON.stringify(current);
        current = value;
        if (changed) for (const fn of listeners) fn(get());
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
    };
}

module.exports = { createCalcConfig, validate, defaultsOf, signalOptions, mergeWeights, LIMITS, WEIGHT_LIMITS, FILE };
