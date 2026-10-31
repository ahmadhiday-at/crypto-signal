const express = require("express");
const router = express.Router();
const viewController = require("../controllers/view.controller");

router.get("/:market", viewController.renderMarketDashboard);
router.get("/backtest/:market", viewController.renderBacktestPage);
router.get("/:market/:timeframe", viewController.renderChartPage);

module.exports = router;
