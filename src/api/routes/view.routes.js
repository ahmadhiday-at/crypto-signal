const express = require('express');
const router = express.Router();
const viewController = require('../controllers/view.controller');

router.get('/market/:market', viewController.renderMarketDashboard);
router.get('/:market/:timeframe', viewController.renderChartPage);

module.exports = router;
