const path = require('path');

function renderMarketDashboard(req, res) {
    try {
        res.sendFile(path.join(__dirname, '../../../public/market_view.html'));
    } catch (err) {
        console.error('View Error:', err);
        res.status(500).send('Error loading view');
    }
}

function renderChartPage(req, res) {
    try {
        res.sendFile(path.join(__dirname, '../../../public/index.html'));
    } catch (err) {
        console.error('View Error:', err);
        res.status(500).send('Error loading view');
    }
}

function renderBacktestPage(req, res) {
    res.sendFile(path.join(__dirname, '../../../public/backtest.html'));
}

module.exports = {
    renderBacktestPage,
    renderMarketDashboard,
    renderChartPage
};
