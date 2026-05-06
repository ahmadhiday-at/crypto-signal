const express = require('express');
const router = express.Router();
const marketController = require('../controllers/market.controller');

router.get('/market/:market', marketController.getMarketAnalysis);
router.get('/config', marketController.getConfig);
router.get('/reset', marketController.resetData);
router.get('/:market/:timeframe', marketController.getSnapshot);

module.exports = router;
