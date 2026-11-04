// Request handlers. Every market/timeframe parameter is checked against the configured lists before
// it reaches storage or Binance.
const { toCsv } = require('../../services/signal-log');
const { edgeSummary, shadowSummary, liveParams } = require('../../services/edge');
const { boardRow, buildBoard } = require('../../services/signal-board');
const { LIMITS, WEIGHT_LIMITS, LOOKBACK_LIMITS } = require('../../config/calculation');
const { tfSeconds, tfLabel } = require('../../services/candles');
const { appVersion } = require('../../config/version');

// engine.timeframes plus the role timeframes, which are always fetched. With additions the list runs
// from the longest timeframe to the shortest; otherwise it keeps the configured order.
function chartTimeframes(config) {
    const added = [...new Set(Object.values(config.TF_ROLES))].filter(tf => !config.TIMEFRAMES.includes(tf));
    const codes = added.length ? [...config.TIMEFRAMES, ...added].sort((a, b) => tfSeconds(b) - tfSeconds(a)) : config.TIMEFRAMES;
    return codes.map(code => ({ code, label: tfLabel(code) }));
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

    // The values a page needs to explain a signal; null without a calculation config.
    function signalContext() {
        if (!calc) return null;
        const c = calc.get();
        return {
            model: c.signal.model,
            threshold: c.signal.threshold,
            strong_score: c.scoring.strong_score,
            min_rr: c.signal.min_rr,
            stop_atr: c.trend.stop_atr,
            target_r: c.trend.target_r,
            volatility_extreme: c.filters.volatility_extreme,
            volatility_dead: c.filters.volatility_dead,
            no_mans_land_percent: c.filters.no_mans_land_percent,
            expiry_candles: c.evaluation.expiry_candles,
            min_trades: c.evaluation.min_trades,
            fee_pct: c.backtest.fee_pct,
            slippage_pct: c.backtest.slippage_pct,
            entry: c.backtest.entry,
        };
    }

    function getConfig(req, res) {
        res.json({
            markets: config.MARKETS.map(code => ({ code, label: code })),
            timeframes: chartTimeframes(config),
            roles: config.TF_ROLES,
            version: appVersion(),
            admin_configured: Boolean(config.ADMIN_TOKEN),
            signal: signalContext(),
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

    // One market's row of the signal board. A market that fails is shown as unavailable, not as an error for all.
    async function boardRowOf(market) {
        const [market_state, log, report] = await Promise.all([
            engine.getMarketState(market).catch(() => null),
            engine.signalRecords(market).catch(() => null),
            reports ? reports.read(market) : null,
        ]);
        const state = market_state?.httpStatus === 200 ? market_state.body : null;
        return boardRow({
            market, state, log, edge: edgeSummary(market, report, log, liveParams(config, calc)),
            roles: config.TF_ROLES, expiryCandles: calc?.get().evaluation.expiry_candles ?? null,
        });
    }

    // Every market's signal, open trades and latest results (docs/contract/rest.md).
    async function getSignalBoard(req, res, next) {
        try {
            const rows = await Promise.all(config.MARKETS.map(boardRowOf));
            res.json(buildBoard({ rows, model: calc?.get().signal.model ?? null, roles: config.TF_ROLES, now: Math.floor(Date.now() / 1000) }));
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
            // ?states=0 leaves out the Market State of each trade (the report page has no use for it).
            if (req.query.states === '0' && Array.isArray(report.trades)) report.trades = report.trades.map(({ state, ...t }) => t);
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
            // Markets, timeframes, roles and candle limit in use; a saved `engine` that differs needs a restart.
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

    // Summary line of every earlier backtest run of a market, newest first.
    async function getBacktestHistory(req, res, next) {
        try {
            const { market } = req.params;
            if (!engine.isMarket(market)) return unknown(res);
            res.json({ market, runs: reports ? await reports.history(market) : [] });
        } catch (err) {
            next(err);
        }
    }

    return { getSignalBoard, getBacktestHistory, getMarketAnalysis, getConfig, getSnapshot, getSignals, getBacktest, getEdge, getCalcConfig, updateCalcConfig, getBacktestRuns, startBacktestRun, getHealth, resetData };
}

module.exports = { createMarketController };
