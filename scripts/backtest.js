// Backtest CLI (docs/roadmap/level-5.md).
// Usage: npm run backtest -- [SYMBOL] [--days 365] [--fee 0]
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

function parseArgs(argv) {
    const args = { market: config.MARKETS[0], days: 365, fee: 0 };
    for (let i = 0; i < argv.length; i++) {
        const a = argv[i];
        if (a === '--days') args.days = Number(argv[++i]);
        else if (a === '--fee') args.fee = Number(argv[++i]);
        else if (!a.startsWith('--')) args.market = a.toUpperCase();
        else throw new Error(`Unknown option ${a}`);
    }
    if (!(args.days > 0 && args.days <= 1500)) throw new Error('--days must be 1–1500');
    if (!(args.fee >= 0 && args.fee < 5)) throw new Error('--fee must be a round-trip percent between 0 and 5');
    if (!/^[A-Z0-9]{2,20}$/.test(args.market)) throw new Error(`Invalid symbol ${args.market}`);
    return args;
}

const fmt = (v, d = 2) => (v === null || v === undefined ? '-' : Number(v).toFixed(d));

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const roles = config.TF_ROLES;
    const roleTfs = [...new Set(Object.values(roles))];
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
        startSec, feePct: args.fee, window,
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
    console.log(rows.map(r => r.map(String).map((c, i) => (i ? c.padStart(9) : c.padEnd(9))).join('')).join('\n'));
    console.log(`Fee ${args.fee}% round trip. Report: data/backtest/${args.market}.json → /backtest/${args.market}`);
}

main().catch((err) => {
    // Binance 451 is an access restriction: report it and stop, no workaround.
    console.error(`\n[Backtest] failed (${err.code || 'error'}): ${err.message}`);
    process.exit(1);
});
