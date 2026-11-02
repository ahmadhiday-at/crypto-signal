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

const { createCalcConfig } = require('./src/config/calculation');
const { createBacktestRunner } = require('./src/services/backtest-runner');

// Calculation config (config/calculation.json): loaded before the engine, reloaded on hand edits.
const calc = createCalcConfig({ envWeights: config.TF_WEIGHTS });
calc.load();
calc.watch();

const engine = createMarketEngine({
    storage: require('./src/data/storage'),
    binance: binanceService,
    indicators: require('./src/services/indicator.service'),
    config,
    calc,
    signalLog: createSignalLog({ dir: path.join(__dirname, 'data/signals'), entryTf: config.TF_ROLES.entry, threshold: () => calc.get().signal.threshold }),
    notify: {
        timeframeUpdated: (market, timeframe) => wsManager.broadcastUpdate(market, timeframe),
        summaryUpdated: (market) => wsManager.broadcastSummary(market),
    },
});

// New weights change the zone merge: rebuild every summary. The other values apply on the next read.
calc.onChange(() => {
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
    console.log(`Trading Chart Server running on http://${config.HOST}:${config.PORT}`);

    try {
        await engine.initialize();
        console.log('System snapshots initialization complete.');
    } catch (err) {
        console.error('[Init] Initialization failed:', err.message);
    }
    scheduler.start();
});
