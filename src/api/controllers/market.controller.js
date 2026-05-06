const fs = require('fs').promises;
const path = require('path');
const config = require('../../config/env');
const storage = require('../../data/storage');
const marketService = require('../../services/market.service');

async function getMarketAnalysis(req, res) {
    try {
        const { market } = req.params;
        let marketSnapshot = await storage.readMarketSnapshot(market);
        if (!marketSnapshot) {
            console.log(`[API] Market snapshot for ${market} not found. Generating...`);
            marketSnapshot = await marketService.updateMarketSnapshot(market);
        }
        if (!marketSnapshot) {
            return res.status(404).json({ error: 'Market snapshot could not be generated' });
        }
        res.json(marketSnapshot);
    } catch (err) {
        console.error('MTF API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

function getConfig(req, res) {
    res.json({
        markets: config.MARKETS.map(code => ({ code, label: code })),
        timeframes: config.TIMEFRAMES.map((code, i) => ({ code, label: config.TIMEFRAME_LABELS[i] || code }))
    });
}

async function getSnapshot(req, res) {
    try {
        const { market, timeframe } = req.params;
        const data = await storage.readSnapshot(market, timeframe);
        if (!data) {
            await marketService.updateMarketData(market, timeframe);
            const newData = await storage.readSnapshot(market, timeframe);
            return res.json(newData || { error: 'Failed to generate snapshot' });
        }
        res.json(data);
    } catch (err) {
        console.error('API Error:', err);
        res.status(500).json({ error: 'Internal Server Error' });
    }
}

async function resetData(req, res) {
    try {
        console.log('[API] Reset requested. Clearing all snapshots...');
        const dirsToClear = [storage.chartDataDir, storage.marketDataDir];
        for (const dir of dirsToClear) {
            try {
                const files = await fs.readdir(dir);
                for (const file of files) {
                    if (file.endsWith('.json')) await fs.unlink(path.join(dir, file));
                }
                console.log(`[API] Cleared: ${dir}`);
            } catch (e) {
                console.warn(`[API] Directory not found or empty, skipping: ${dir}`);
            }
        }
        console.log('[API] All snapshots cleared. Regenerating...');
        await marketService.initializeAllSnapshots();
        res.json({ success: true, message: 'Data reset and regenerated successfully' });
    } catch (err) {
        console.error('Reset Error:', err);
        res.status(500).json({ error: 'Failed to reset data' });
    }
}

module.exports = {
    getMarketAnalysis,
    getConfig,
    getSnapshot,
    resetData
};
