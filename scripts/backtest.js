// Backtest CLI (docs/roadmap/level-5.md).
// Usage: npm run backtest -- [SYMBOL] [--days N] [--fee PCT] [--sweep key=v1,v2 ...] [--split 0.7]
// The base parameters, and the --days/--fee/--split defaults, come from config/calculation.json.
// --sweep (Level 6) replays parameter variants on the same history. Keys: `threshold`, `min_rr`,
// `stop_atr` (SL buffer in ATR), `target` (tp1, tp2 or a fixed R multiple), `htf_trend` (off, htf,
// htf+structure: Level 6.5 B1 trend filter), `side` (both, buy, sell),
// `skip_energy` (none or market_energy values joined with +, e.g. explosive+building) and `w_<tf>`
// (zone weight of a role timeframe, e.g. w_15m=1,2,3). Several --sweep options combine.
// --split 0.7 (Level 6 validation) picks the best variant on the first 70% of the period and
// reports how it does on the remaining 30%; --split none turns it off.
// Downloads/extends the history cache in data/history/, replays the signal engine and writes
// data/backtest/{SYMBOL}.json (shown at /backtest/{SYMBOL}). In Docker run it inside the app
// container so requests go through the VPN: docker compose exec app npm run backtest -- BTCUSDT
const path = require('path');
const config = require('../src/config/env');
const { createCalcConfig } = require('../src/config/calculation');
const binance = require('../src/services/binance.service');
const indicators = require('../src/services/indicator.service');
const { tfSeconds } = require('../src/services/candles');
const { createHistory } = require('../src/services/history');
const { runBacktest, createReports, FIXED_KEYS } = require('../src/services/backtest');
const { HTF_TREND_MODES } = require('../src/services/signal');

const DATA = path.join(__dirname, '../data');

const MAX_VARIANTS = 144;
const ENERGIES = ['explosive', 'building', 'stable', 'cooling'];

const number = (min, max, int = false) => (raw) => {
    const v = Number(raw);
    return raw !== '' && Number.isFinite(v) && v >= min && v <= max && (!int || Number.isInteger(v)) ? v : undefined;
};

// Per key: parses one raw value, or returns undefined when it is invalid.
const SWEEP_KEYS = {
    threshold: [number(1, 15, true), 'integers 1–15'],
    min_rr: [number(0, 10), '0–10'],
    stop_atr: [number(0, 3), '0–3'],
    target: [(raw) => (raw === 'tp1' || raw === 'tp2' ? raw : number(0.5, 10)(raw)), 'tp1, tp2 or 0.5–10'],
    htf_trend: [(raw) => (HTF_TREND_MODES.includes(raw) ? raw : undefined), HTF_TREND_MODES.join(', ')],
    side: [(raw) => (['both', 'buy', 'sell'].includes(raw) ? raw : undefined), 'both, buy or sell'],
    skip_energy: [(raw) => {
        if (raw === 'none') return [];
        const list = raw.split('+');
        return list.every(e => ENERGIES.includes(e)) ? [...new Set(list)].sort() : undefined;
    }, `none or ${ENERGIES.join('+')} values joined with +`],
};

// `threshold=4,5,6` → ['threshold', [4, 5, 6]].
function parseSweep(spec, roleTfs) {
    const m = /^([a-z0-9_]+)=([a-z0-9.,+]+)$/.exec(spec || '');
    if (!m) throw new Error(`--sweep expects key=v1,v2 (got ${String(spec).slice(0, 40)})`);
    const [, key, list] = m;
    const tfKey = key.startsWith('w_') && roleTfs.includes(key.slice(2));
    const [parse, hint] = tfKey ? [number(0, 20), '0–20'] : SWEEP_KEYS[key] || [];
    if (!parse) throw new Error(`--sweep key must be ${Object.keys(SWEEP_KEYS).join(', ')} or w_<tf> with tf in ${roleTfs.join(', ')}`);
    const raws = list.split(',').filter(Boolean);
    const values = raws.map(parse);
    if (!values.length || values.some(v => v === undefined)) throw new Error(`--sweep ${key}: ${hint}`);
    const unique = [...new Map(values.map(v => [JSON.stringify(v), v])).values()];
    return [key, unique];
}

// Every combination of the swept values, as runBacktest variants.
function variantsOf(sweeps) {
    let combos = [{}];
    for (const [key, values] of sweeps) combos = combos.flatMap(c => values.map(v => ({ ...c, [key]: v })));
    if (combos.length > MAX_VARIANTS) throw new Error(`--sweep gives ${combos.length} variants (max ${MAX_VARIANTS})`);
    return sweeps.length ? combos.map((c) => {
        const v = { weights: {} };
        for (const [key, value] of Object.entries(c)) {
            if (key.startsWith('w_')) v.weights[key.slice(2)] = value;
            else v[key] = value;
        }
        return v;
    }) : [];
}

// `defaults` is the calculation config's `backtest` group.
function parseArgs(argv, roleTfs, defaults = { days: 365, fee_pct: 0, split: null }) {
    const args = { market: config.MARKETS[0], days: defaults.days, fee: defaults.fee_pct, sweeps: [], split: defaults.split ?? null };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--days') args.days = Number(argv[++i]);
        else if (a === '--fee') args.fee = Number(argv[++i]);
        else if (a === '--sweep') args.sweeps.push(parseSweep(argv[++i], roleTfs));
        else if (a === '--split') {
            const v = argv[++i];
            args.split = v === 'none' ? null : Number(v);
        }
        else if (!a.startsWith('--')) args.market = a.toUpperCase();
        else throw new Error(`Unknown option ${a}`);
    }
    if (!(args.days > 0 && args.days <= 1500)) throw new Error('--days must be 1–1500');
    if (!(args.fee >= 0 && args.fee < 5)) throw new Error('--fee must be a round-trip percent between 0 and 5');
    if (args.split !== null && !(args.split >= 0.5 && args.split <= 0.9)) throw new Error('--split must be between 0.5 and 0.9');
    if (!/^[A-Z0-9]{2,20}$/.test(args.market)) throw new Error(`Invalid symbol ${args.market}`);
    if (new Set(args.sweeps.map(([k]) => k)).size !== args.sweeps.length) throw new Error('--sweep: each key once');
    args.variants = variantsOf(args.sweeps);
    return args;
}

const fmt = (v, d = 2) => (v === null || v === undefined ? '-' : Number(v).toFixed(d));

const table = (rows) => rows.map(r => r.map(String).map((c, i) => (i ? c.padStart(9) : c.padEnd(9))).join('')).join('\n');

function valueOf(p, key) {
    if (key.startsWith('w_')) return p.weights[key.slice(2)];
    if (key === 'skip_energy') return p.skip_energy.join('+') || 'none';
    return p[key];
}

// One line per variant, best taken expectancy first; `*` marks the live parameters.
function printSweep(report, keys) {
    const label = (p) => keys.map(k => `${k}=${valueOf(p, k)}`).join(' ');
    const rows = [...report.sweep].sort((a, b) => (b.taken.expectancy_r ?? -Infinity) - (a.taken.expectancy_r ?? -Infinity));
    const width = Math.max(...rows.map(r => label(r.params).length)) + 2;
    console.log(`\nSweep (taken)${' '.repeat(Math.max(0, width - 13))}${['trades', 'win%', 'exp R', 'total R', 'PF', 'maxDD R'].map(h => h.padStart(9)).join('')}`);
    for (const r of rows) {
        const s = r.taken;
        const cells = [s.trades, fmt(s.win_rate === null ? null : s.win_rate * 100, 1), fmt(s.expectancy_r, 3), fmt(s.total_r), fmt(s.profit_factor), fmt(s.max_drawdown_r)];
        console.log(`${(r.base ? '* ' : '  ') + label(r.params)}`.padEnd(width) + cells.map(c => String(c).padStart(9)).join(''));
    }
}

// In-sample vs out-of-sample taken results; `>` marks the variant chosen in-sample.
function printValidation(report, keys) {
    const v = report.validation;
    const label = (p) => keys.map(k => `${k}=${valueOf(p, k)}`).join(' ') || 'live';
    const width = Math.max(14, ...v.rows.map(r => label(r.params).length)) + 2;
    console.log(`\nValidation, split ${new Date(v.split_at * 1000).toISOString().slice(0, 10)} (taken; pick = best in-sample exp with ≥ ${v.min_trades} trades)`);
    console.log(''.padEnd(width) + ['IS n', 'IS exp', 'OOS n', 'OOS win%', 'OOS exp', 'OOS PF'].map(h => h.padStart(9)).join(''));
    for (const [idx, r] of v.rows.entries()) {
        const a = r.in_sample;
        const b = r.out_of_sample;
        const cells = [a.trades, fmt(a.expectancy_r, 3), b.trades, fmt(b.win_rate === null ? null : b.win_rate * 100, 1), fmt(b.expectancy_r, 3), fmt(b.profit_factor)];
        const mark = (idx === v.selected ? '>' : ' ') + (r.base ? '*' : ' ');
        console.log(`${mark} ${label(r.params)}`.padEnd(width) + cells.map(c => String(c).padStart(9)).join(''));
    }
    if (v.selected === null) console.log(`No variant has ${v.min_trades}+ in-sample trades.`);
}

async function main() {
    const roles = config.TF_ROLES;
    const roleTfs = [...new Set(Object.values(roles))];
    const calc = createCalcConfig({ envWeights: config.TF_WEIGHTS });
    const loaded = calc.load();
    if (!loaded.loaded) throw new Error(`config/calculation.json is not usable (${loaded.error})`);
    const cfg = calc.get();
    const args = parseArgs(process.argv.slice(2), roleTfs, cfg.backtest);
    const window = binance.candleLimit() - 1;
    const nowSec = Math.floor(Date.now() / 1000);
    const startSec = nowSec - args.days * 86400;

    const history = createHistory({ dir: path.join(DATA, 'history'), binance });
    const candlesByTf = {};
    for (const tf of roleTfs) {
        // Each timeframe also needs `window` candles before the start for its first snapshot.
        const from = startSec - (window + 10) * tfSeconds(tf);
        process.stdout.write(`[History] ${args.market}/${tf} ...`);
        candlesByTf[tf] = await history.sync(args.market, tf, from, {
            onPage: (_, n) => process.stdout.write(`\r[History] ${args.market}/${tf} ${n} candles`),
        });
        process.stdout.write(`\r[History] ${args.market}/${tf} ${candlesByTf[tf].length} candles\n`);
    }

    const started = Date.now();
    const report = runBacktest({
        market: args.market, candlesByTf, roles, weights: calc.weights(), indicators,
        threshold: cfg.signal.threshold, minRiskReward: cfg.signal.min_rr, stopAtr: cfg.signal.stop_atr, htfTrend: cfg.filters.htf_trend,
        fixed: Object.fromEntries(FIXED_KEYS.map(k => [k, cfg.signal[k] ?? cfg.filters[k]])),
        startSec, feePct: args.fee, window, variants: args.variants,
        splitSec: args.split === null ? null : Math.floor(startSec + args.split * (nowSec - startSec)),
        onProgress: (n) => process.stdout.write(`\r[Backtest] ${n} candles`),
    });
    report.generated_at = Math.floor(Date.now() / 1000);
    process.stdout.write(`\r[Backtest] ${report.steps} candles in ${((Date.now() - started) / 1000).toFixed(0)} s\n`);

    await createReports({ dir: path.join(DATA, 'backtest') }).write(args.market, report);

    const rows = [['', 'trades', 'win%', 'exp R', 'total R', 'PF', 'maxDD R']];
    for (const g of ['taken', 'filtered']) {
        const s = report[g].summary;
        rows.push([g, s.trades, fmt(s.win_rate === null ? null : s.win_rate * 100, 1), fmt(s.expectancy_r, 3), fmt(s.total_r), fmt(s.profit_factor), fmt(s.max_drawdown_r)]);
    }
    console.log(table(rows));
    if (report.sweep) printSweep(report, args.sweeps.map(([k]) => k));
    if (report.validation) printValidation(report, args.sweeps.map(([k]) => k));
    console.log(`Fee ${args.fee}% round trip. Report: data/backtest/${args.market}.json → /backtest/${args.market}`);
}

if (require.main === module) {
    main().catch((err) => {
        // Binance 451 is an access restriction: report it and stop, no workaround.
        console.error(`\n[Backtest] failed (${err.code || 'error'}): ${err.message}`);
        process.exit(1);
    });
}

module.exports = { parseArgs };
