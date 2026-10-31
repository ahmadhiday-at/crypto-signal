// Request handlers. Every market/timeframe parameter is checked against the configured lists before
// it reaches storage or Binance.
const fs = require('fs');
const path = require('path');
const { toCsv } = require('../../services/signal-log');

// Read on each call so a version bump shows up without restarting the server.
function appVersion() {
    try {
        return JSON.parse(fs.readFileSync(path.join(__dirname, '../../../package.json'), 'utf8')).version;
    } catch (e) {
        return null;
    }
}

function createMarketController({ engine, config }) {
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
            timeframes: config.TIMEFRAMES.map((code, i) => ({ code, label: config.TIMEFRAME_LABELS[i] || code })),
            roles: config.TF_ROLES,
            version: appVersion(),
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
            const body = await engine.signalRecords(market);
            if (!body) return res.status(404).json({ error: 'signal_log_disabled' });
            if (req.query.format === 'csv') {
                return res.type('text/csv').set('Content-Disposition', `attachment; filename="${market}_signals.csv"`).send(toCsv(body.records));
            }
            res.json(body);
        } catch (err) {
            next(err);
        }
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

    return { getMarketAnalysis, getConfig, getSnapshot, getSignals, getHealth, resetData };
}

module.exports = { createMarketController };
