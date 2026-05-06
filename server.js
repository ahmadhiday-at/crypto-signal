const express = require('express');
const http = require('http');
const path = require('path');
const config = require('./src/config/env');

const apiRoutes = require('./src/api/routes/api.routes');
const viewRoutes = require('./src/api/routes/view.routes');

const wsManager = require('./src/websocket/ws.manager');
const marketService = require('./src/services/market.service');
const binanceService = require('./src/services/binance.service');
const cronJobs = require('./src/jobs/cron.jobs');

const app = express();
const server = http.createServer(app);

// Initialize WebSocket Manager
wsManager.init(server);

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.use('/api', apiRoutes);
app.use('/view', viewRoutes);

// Connect to Binance WebSocket for real-time price updates and Klines
binanceService.connectWebSocket(
    (market, price) => {
        wsManager.broadcastPrice(market, price);
    },
    async (market, timeframe) => {
        await marketService.updateMarketData(market, timeframe);
    },
    config.MARKETS
);

// Start Server
server.listen(config.PORT, async () => {
    console.log(`Trading Chart Server running on http://localhost:${config.PORT}`);
    
    // Initialize initial market data
    await marketService.initializeAllSnapshots();
    
    // Start Cron Jobs
    cronJobs.scheduleCronJobs();
});
