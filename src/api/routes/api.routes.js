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

function createApiRouter(controller) {
    const router = express.Router();

    router.get('/market/:market', controller.getMarketAnalysis);
    router.get('/config', controller.getConfig);
    router.get('/signals/:market', controller.getSignals);
    router.get('/health', controller.getHealth);
    router.post('/reset', requireSameOriginAction, controller.resetData);
    router.all('/reset', (req, res) => res.set('Allow', 'POST').status(405).json({ error: 'method_not_allowed' }));
    router.get('/:market/:timeframe', controller.getSnapshot);
    router.use((req, res) => res.status(404).json({ error: 'not_found' }));

    return router;
}

module.exports = { createApiRouter, requireSameOriginAction };
