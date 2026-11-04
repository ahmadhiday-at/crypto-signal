const http = require('http');
const config = require('./src/config/env');
const { createApp, createHostCheck } = require('./src/app');

const wsManager = require('./src/websocket/ws.manager');
const binanceService = require('./src/services/binance.service');
const { createMarketEngine } = require('./src/services/market.service');
const { createScheduler } = require('./src/jobs/scheduler');
const { createSignalLog } = require('./src/services/signal-log');
const { createReports } = require('./src/services/backtest');
const path = require('path');

const { createCalcConfig, snapshotChanged, engineChanged, applyEngine, signalConfig } = require('./src/config/calculation');
const { appVersion } = require('./src/config/version');
const { createBacktestRunner } = require('./src/services/backtest-runner');

// Calculation config (config/calculation.json): loaded before the engine, reloaded on hand edits.
const calc = createCalcConfig();
calc.load();
calc.watch();
// Markets, timeframes, roles and candle limit come from the config; they change on restart only.
applyEngine(config, binanceService, calc.get());

const engine = createMarketEngine({
    storage: require('./src/data/storage'),
    binance: binanceService,
    indicators: require('./src/services/indicator.service'),
    config,
    calc,
    signalLog: createSignalLog({
        dir: path.join(__dirname, 'data/signals'), entryTf: config.TF_ROLES.entry,
        threshold: () => calc.get().signal.threshold, expiry: () => calc.get().evaluation.expiry_candles,
        describe: () => {
            const cfg = calc.get();
            return { model: cfg.signal.model, config: signalConfig(cfg, cfg.signal.model, config.TF_ROLES), app_version: appVersion() };
        },
    }),
    // Shadow model (config `shadow`), logged apart in data/signals-shadow/.
    shadowLog: createSignalLog({
        dir: path.join(__dirname, 'data/signals-shadow'), entryTf: () => calc.get().shadow.entry,
        threshold: () => calc.get().signal.threshold, expiry: () => calc.get().evaluation.expiry_candles,
        describe: () => {
            const cfg = calc.get();
            const so = calc.shadowOptions();
            const model = so?.signal.model ?? cfg.shadow.model;
            return { model, config: signalConfig(cfg, model, so?.roles ?? null, { trend: so?.signal.trend ?? cfg.trend }), app_version: appVersion() };
        },
    }),
    notify: {
        timeframeUpdated: (market, timeframe) => wsManager.broadcastUpdate(market, timeframe),
        summaryUpdated: (market) => wsManager.broadcastSummary(market),
    },
});

// Indicator or zone settings change the per-timeframe snapshots: recalculate them from the stored
// candles, then rebuild. Other groups only change the merge and enhancement: rebuild every summary.
// Signal values apply on the next read either way.
calc.onChange((next, prev) => {
    if (engineChanged(next, prev)) console.warn('[CalcConfig] engine (role timeframes / candle limit) changed: restart the app to apply it');
    if (snapshotChanged(next, prev)) {
        engine.recalculateAll().catch(err => console.error(`[CalcConfig] recalculation failed: ${err.message}`));
        return;
    }
    for (const market of config.MARKETS) engine.rebuildSummary(market).catch(err => console.error(`[CalcConfig] ${market}: rebuild failed: ${err.message}`));
});

const runner = createBacktestRunner();
process.on('exit', () => runner.stop());

const app = createApp({ engine, config, calc, runner, reports: createReports({ dir: path.join(__dirname, 'data/backtest') }) });
const server = http.createServer(app);

wsManager.init(server, {
    isValidSubscription: (market, timeframe) => engine.isMarket(market) && engine.isTimeframe(timeframe),
    isAllowedHost: createHostCheck(config.ALLOWED_HOSTS),
});

// Live ticker prices are display-only. After a reconnect, catch up any timeframe that fell behind.
binanceService.connectWebSocket(
    (market, price, eventTime) => wsManager.broadcastPrice(market, price, eventTime),
    config.MARKETS,
    { onReconnect: () => engine.refreshStale() }
);

const scheduler = createScheduler(engine);

server.listen(config.PORT, config.HOST, async () => {
    if (!config.ADMIN_TOKEN) console.warn('[Security] ADMIN_TOKEN is not set: config save, backtest run and reset are refused');
    console.log(`Trading Chart Server running on http://${config.HOST}:${config.PORT}`);

    try {
        await engine.initialize();
        // Stored snapshots may predate a config edit made while the app was down.
        await engine.recalculateAll();
        console.log('System snapshots initialization complete.');
    } catch (err) {
        console.error('[Init] Initialization failed:', err.message);
    }
    scheduler.start();
});
