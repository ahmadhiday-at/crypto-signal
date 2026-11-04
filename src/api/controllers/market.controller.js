// Request handlers. Every market/timeframe parameter is checked against the configured lists before
// it reaches storage or Binance.
const fs = require('fs');
const path = require('path');
const { toCsv } = require('../../services/signal-log');
const { edgeSummary, shadowSummary, liveParams } = require('../../services/edge');
const { LIMITS, WEIGHT_LIMITS, LOOKBACK_LIMITS } = require('../../config/calculation');
const { tfSeconds } = require('../../services/candles');

// TIMEFRAME_LIST plus the role timeframes, which are always fetched. With additions the list runs
// from the longest timeframe to the shortest; otherwise it keeps the configured order.
function chartTimeframes(config) {
    const listed = config.TIMEFRAMES.map((code, i) => ({ code, label: config.TIMEFRAME_LABELS[i] || code }));
    const added = [...new Set(Object.values(config.TF_ROLES))].filter(tf => !config.TIMEFRAMES.includes(tf));
    if (!added.length) return listed;
    return [...listed, ...added.map(code => ({ code, label: code }))].sort((a, b) => tfSeconds(b.code) - tfSeconds(a.code));
}

// Read on each call so a version bump shows up without restarting the server.
function appVersion() {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8')).version;
    } catch (e) {
        return null;
    }
}

// `calc` (calculation config) and `runner` (backtest runner) are optional; their endpoints answer
// 404 without them.
function createMarketController({ engine, config, reports = null, calc = null, runner = null }) {
    const unknown = (res) => res.status(404).json({ error: 'unknown_market_or_timeframe' });

    async function getMarketAnalysis(req, res, next) {
        try {
            const { market } = req.params;
            if (!engine.isMarket(market)) return unknown(res);
            const { httpStatus, body } = await engine.getMarketState(market);
            res.status(httpStatus).json(body);
        } catch (err) {
            next(err);
        }
    }

    function getConfig(req, res) {
        res.json({
            markets: config.MARKETS.map(code => ({ code, label: code })),
            timeframes: chartTimeframes(config),
            roles: config.TF_ROLES,
            version: appVersion(),
            admin_configured: Boolean(config.ADMIN_TOKEN),
        });
    }

    async function getSnapshot(req, res, next) {
        try {
            const { market, timeframe } = req.params;
            if (!engine.isMarket(market) || !engine.isTimeframe(timeframe)) return unknown(res);
            const { httpStatus, body } = await engine.getTimeframeSnapshot(market, timeframe);
            res.status(httpStatus).json(body);
        } catch (err) {
            next(err);
        }
    }

    // ?format=csv returns the flattened dataset (docs/contract/rest.md).
    async function getSignals(req, res, next) {
        try {
            const { market } = req.params;
            if (!engine.isMarket(market)) return unknown(res);
            // ?source=shadow reads the shadow log (calculation config `shadow`).
            const shadow = req.query.source === 'shadow';
            const body = await engine.signalRecords(market, shadow ? 'shadow' : 'live');
            if (!body) return res.status(404).json({ error: 'signal_log_disabled' });
            if (req.query.format === 'csv') {
                return res.type('text/csv').set('Content-Disposition', `attachment; filename="${market}_${shadow ? 'shadow_' : ''}signals.csv"`).send(toCsv(body.records));
            }
            res.json(body);
        } catch (err) {
            next(err);
        }
    }

    // Latest backtest report written by `npm run backtest` (docs/contract/rest.md).
    async function getBacktest(req, res, next) {
        try {
            const { market } = req.params;
            if (!engine.isMarket(market)) return unknown(res);
            const report = reports ? await reports.read(market) : null;
            if (!report) return res.status(404).json({ error: 'backtest_not_found' });
            res.json(report);
        } catch (err) {
            next(err);
        }
    }

    // How proven the signal is: latest backtest + live signal log (docs/contract/rest.md).
    async function getEdge(req, res, next) {
        try {
            const { market } = req.params;
            if (!engine.isMarket(market)) return unknown(res);
            const [report, log, shadow] = await Promise.all([
                reports ? reports.read(market) : null,
                engine.signalRecords(market),
                engine.signalRecords(market, 'shadow'),
            ]);
            res.json({ ...edgeSummary(market, report, log, liveParams(config, calc)), shadow: shadowSummary(shadow) });
        } catch (err) {
            next(err);
        }
    }

    // Calculation config (docs/contract/rest.md): values in use, defaults and allowed ranges.
    function getCalcConfig(req, res) {
        if (!calc) return res.status(404).json({ error: 'calc_config_disabled' });
        res.json({
            file: 'config/calculation.json',
            config: calc.get(),
            defaults: calc.defaults(),
            limits: { ...LIMITS, weights: WEIGHT_LIMITS, lookback: LOOKBACK_LIMITS },
            role_timeframes: config.TF_ROLES,
            // Role timeframes and candle limit in use; a saved `engine` that differs needs a restart.
            running_engine: config.ENGINE_RUNNING ?? null,
        });
    }

    // Saves a full or partial config; it applies at once (no restart).
    function updateCalcConfig(req, res, next) {
        try {
            if (!calc) return res.status(404).json({ error: 'calc_config_disabled' });
            const { problems, config: saved, changed } = calc.update(req.body);
            if (problems) return res.status(400).json({ error: 'invalid_config', problems });
            res.json({ config: saved, changed });
        } catch (err) {
            next(err);
        }
    }

    function getBacktestRuns(req, res) {
        if (!runner) return res.status(404).json({ error: 'backtest_runner_disabled' });
        res.json(runner.status());
    }

    // Body {"market": "BTCUSDT"} or {"market": "all"}: re-runs the backtest with the current config.
    function startBacktestRun(req, res) {
        if (!runner) return res.status(404).json({ error: 'backtest_runner_disabled' });
        const market = req.body?.market;
        const markets = market === 'all' ? config.MARKETS : [market];
        if (market !== 'all' && !engine.isMarket(market)) return unknown(res);
        const { error, jobs } = runner.start(markets);
        if (error) return res.status(409).json({ error });
        res.status(202).json({ jobs });
    }

    function getHealth(req, res) {
        res.json(engine.healthReport());
    }

    // Reset re-fetches every configured timeframe and rebuilds the summaries. Files are replaced
    // atomically on success; nothing is deleted, so a failed refetch keeps the last good data.
    async function resetData(req, res, next) {
        try {
            const { run, error, retryAfter } = engine.reset();
            if (error === 'reset_in_progress') return res.status(409).json({ error });
            if (error === 'reset_cooldown') return res.set('Retry-After', String(retryAfter)).status(429).json({ error, retry_after: retryAfter });
            const results = await run;
            const success = Object.values(results).every(r => r.failed.length === 0);
            // 502: the refetch reached Binance (or tried to) and at least one timeframe failed.
            res.status(success ? 200 : 502).json({ success, results });
        } catch (err) {
            next(err);
        }
    }

    return { getMarketAnalysis, getConfig, getSnapshot, getSignals, getBacktest, getEdge, getCalcConfig, updateCalcConfig, getBacktestRuns, startBacktestRun, getHealth, resetData };
}

module.exports = { createMarketController };
