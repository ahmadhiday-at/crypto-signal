// Backtest CLI (docs/roadmap/level-5.md).
// Usage: npm run backtest -- [SYMBOL] [--days 365] [--fee 0] [--sweep key=v1,v2 ...]
// --sweep (Level 6) replays parameter variants on the same history: keys `threshold`, `min_rr` and
// `w_<tf>` (zone weight of a role timeframe, e.g. w_15m=1,2,3). Several --sweep options combine.
// Downloads/extends the history cache in data/history/, replays the signal engine and writes
// data/backtest/{SYMBOL}.json (shown at /backtest/{SYMBOL}). In Docker run it inside the app
// container so requests go through the VPN: docker compose exec app npm run backtest -- BTCUSDT
const path = require('path');
const config = require('../src/config/env');
const binance = require('../src/services/binance.service');
const indicators = require('../src/services/indicator.service');
const { tfSeconds } = require('../src/services/candles');
const { createHistory } = require('../src/services/history');
const { runBacktest, createReports } = require('../src/services/backtest');

const DATA = path.join(__dirname, '../data');

const MAX_VARIANTS = 64;

// `threshold=4,5,6` → ['threshold', [4, 5, 6]].
function parseSweep(spec, roleTfs) {
    const m = /^([a-z0-9_]+)=([0-9.,]+)$/.exec(spec || '');
    if (!m) throw new Error(`--sweep expects key=v1,v2 (got ${String(spec).slice(0, 40)})`);
    const [, key, list] = m;
    const values = [...new Set(list.split(',').filter(Boolean).map(Number))];
    if (!values.length || values.some(v => !Number.isFinite(v))) throw new Error(`--sweep ${key}: invalid values`);
    if (key === 'threshold') {
        if (values.some(v => !Number.isInteger(v) || v < 1 || v > 15)) throw new Error('--sweep threshold: integers 1–15');
    } else if (key === 'min_rr') {
        if (values.some(v => v < 0 || v > 10)) throw new Error('--sweep min_rr: 0–10');
    } else if (key.startsWith('w_') && roleTfs.includes(key.slice(2))) {
        if (values.some(v => v < 0 || v > 20)) throw new Error(`--sweep ${key}: 0–20`);
    } else {
        throw new Error(`--sweep key must be threshold, min_rr or w_<tf> with tf in ${roleTfs.join(', ')}`);
    }
    return [key, values];
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

function parseArgs(argv, roleTfs) {
    const args = { market: config.MARKETS[0], days: 365, fee: 0, sweeps: [] };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--days') args.days = Number(argv[++i]);
        else if (a === '--fee') args.fee = Number(argv[++i]);
        else if (a === '--sweep') args.sweeps.push(parseSweep(argv[++i], roleTfs));
        else if (!a.startsWith('--')) args.market = a.toUpperCase();
        else throw new Error(`Unknown option ${a}`);
    }
    if (!(args.days > 0 && args.days <= 1500)) throw new Error('--days must be 1–1500');
    if (!(args.fee >= 0 && args.fee < 5)) throw new Error('--fee must be a round-trip percent between 0 and 5');
    if (!/^[A-Z0-9]{2,20}$/.test(args.market)) throw new Error(`Invalid symbol ${args.market}`);
    if (new Set(args.sweeps.map(([k]) => k)).size !== args.sweeps.length) throw new Error('--sweep: each key once');
    args.variants = variantsOf(args.sweeps);
    return args;
}

const fmt = (v, d = 2) => (v === null || v === undefined ? '-' : Number(v).toFixed(d));

const table = (rows) => rows.map(r => r.map(String).map((c, i) => (i ? c.padStart(9) : c.padEnd(9))).join('')).join('\n');

// One line per variant, best taken expectancy first; `*` marks the live parameters.
function printSweep(report, keys) {
    const label = (p) => keys.map(k => `${k}=${k.startsWith('w_') ? p.weights[k.slice(2)] : p[k]}`).join(' ');
    const rows = [...report.sweep].sort((a, b) => (b.taken.expectancy_r ?? -Infinity) - (a.taken.expectancy_r ?? -Infinity));
    const width = Math.max(...rows.map(r => label(r.params).length)) + 2;
    console.log(`\nSweep (taken)${' '.repeat(Math.max(0, width - 13))}${['trades', 'win%', 'exp R', 'total R', 'PF', 'maxDD R'].map(h => h.padStart(9)).join('')}`);
    for (const r of rows) {
        const s = r.taken;
        const cells = [s.trades, fmt(s.win_rate === null ? null : s.win_rate * 100, 1), fmt(s.expectancy_r, 3), fmt(s.total_r), fmt(s.profit_factor), fmt(s.max_drawdown_r)];
        console.log(`${(r.base ? '* ' : '  ') + label(r.params)}`.padEnd(width) + cells.map(c => String(c).padStart(9)).join(''));
    }
}

async function main() {
    const roles = config.TF_ROLES;
    const roleTfs = [...new Set(Object.values(roles))];
    const args = parseArgs(process.argv.slice(2), roleTfs);
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
        market: args.market, candlesByTf, roles, weights: config.TF_WEIGHTS, indicators,
        startSec, feePct: args.fee, window, variants: args.variants,
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
