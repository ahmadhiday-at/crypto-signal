const crypto = require('crypto');
const express = require('express');

// Rejects state-changing requests that a cross-site page could trigger. Requires a custom header
// (cross-origin browsers must preflight it, and no CORS is granted) and a same-origin Origin.
function requireSameOriginAction(req, res, next) {
    if (req.get('X-Requested-With') !== 'crypto-signal') {
        return res.status(403).json({ error: 'missing_action_header' });
    }
    const site = req.get('Sec-Fetch-Site');
    if (site && site !== 'same-origin' && site !== 'none') {
        return res.status(403).json({ error: 'cross_site_request' });
    }
    const origin = req.get('Origin');
    if (origin) {
        let host = null;
        try { host = new URL(origin).host; } catch (e) { /* invalid origin */ }
        if (host !== req.get('Host')) return res.status(403).json({ error: 'cross_origin_request' });
    }
    next();
}

// Rejects actions without the ADMIN_TOKEN (header X-Admin-Token). Without a configured token every
// action is refused. Both values are hashed first, so the comparison does not depend on their length.
function requireAdmin(token) {
    const digest = (v) => crypto.createHash('sha256').update(String(v)).digest();
    const expected = token ? digest(token) : null;
    return (req, res, next) => {
        if (!expected) return res.status(403).json({ error: 'admin_token_not_configured' });
        const given = req.get('X-Admin-Token');
        if (!given || !crypto.timingSafeEqual(digest(given), expected)) return res.status(401).json({ error: 'admin_token_invalid' });
        next();
    };
}

function createApiRouter(controller, config = {}) {
    const router = express.Router();
    const action = [requireSameOriginAction, requireAdmin(config.ADMIN_TOKEN)];

    router.get('/market/:market', controller.getMarketAnalysis);
    router.get('/config', controller.getConfig);
    router.get('/signals/:market', controller.getSignals);
    router.get('/backtest/:market', controller.getBacktest);
    router.get('/edge/:market', controller.getEdge);
    router.get('/calc-config', controller.getCalcConfig);
    router.put('/calc-config', action, express.json({ limit: '16kb' }), controller.updateCalcConfig);
    router.get('/backtest-runs', controller.getBacktestRuns);
    router.post('/backtest-runs', action, express.json({ limit: '4kb' }), controller.startBacktestRun);
    router.get('/health', controller.getHealth);
    router.post('/reset', action, controller.resetData);
    router.all('/reset', (req, res) => res.set('Allow', 'POST').status(405).json({ error: 'method_not_allowed' }));
    router.get('/:market/:timeframe', controller.getSnapshot);
    router.use((req, res) => res.status(404).json({ error: 'not_found' }));

    return router;
}

module.exports = { createApiRouter, requireSameOriginAction, requireAdmin };
