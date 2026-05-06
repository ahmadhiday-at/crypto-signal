const cron = require('node-cron');
const config = require('../config/env');
const marketService = require('../services/market.service');

function scheduleCronJobs() {
    const markets = config.MARKETS;
    const timeframes = config.TIMEFRAMES;
    const tfToCron = config.TF_TO_CRON;

    markets.forEach(market => {
        timeframes.forEach(tf => {
            const cronExpr = tfToCron[tf];
            if (cronExpr) {
                cron.schedule(cronExpr, async () => {
                    console.log(`[Cron] Scheduled update for ${market}/${tf}`);
                    await marketService.updateMarketData(market, tf);
                });
            }
        });
    });
    console.log('Cron jobs scheduled for all market/timeframe combinations.');
}

module.exports = {
    scheduleCronJobs
};
