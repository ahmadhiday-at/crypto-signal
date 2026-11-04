const path = require('path');

const page = (file) => (req, res) => res.sendFile(path.join(__dirname, '../../../public', file));

module.exports = {
    renderSignalsPage: page('signals.html'),
    renderMarketDashboard: page('market_view.html'),
    renderChartPage: page('index.html'),
    renderBacktestPage: page('backtest.html'),
    renderConfigPage: page('config.html'),
};
