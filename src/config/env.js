require("dotenv").config();

const parseList = (envVar, defaultList = []) => {
  return process.env[envVar] ? process.env[envVar].split(",") : defaultList;
};

const MARKETS = parseList("MARKET_LIST", ["BTCUSDT"]);
const TIMEFRAMES = parseList("TIMEFRAME_LIST", ["15m"]);
const TIMEFRAME_LABELS = parseList("TIMEFRAME_LABELS", []);

const TF_ROLES = {
  htf: process.env.TF_HTF || "1d",
  structure: process.env.TF_STRUCTURE || "4h",
  mid: process.env.TF_MID || "1h",
  entry: process.env.TF_ENTRY || "15m",
};

const TF_WEIGHTS = {
  "1d": parseFloat(process.env.WEIGHT_1D || "3.0"),
  "4h": parseFloat(process.env.WEIGHT_4H || "2.0"),
  "1h": parseFloat(process.env.WEIGHT_1H || "1.5"),
  "15m": parseFloat(process.env.WEIGHT_15M || "1.0"),
  "1w": parseFloat(process.env.WEIGHT_1W || "1.0"),
  "1m": parseFloat(process.env.WEIGHT_1M || "1.0"),
  DEFAULT: 1.0,
};

const TF_TO_CRON = {
  "1m": "*/1 * * * *",
  "5m": "*/5 * * * *",
  "15m": "*/15 * * * *",
  "30m": "*/30 * * * *",
  "1h": "0 * * * *",
  "4h": "0 */4 * * *",
  "1d": "0 0 * * *",
  "1w": "0 0 * * 0",
};

const TF_TO_SECONDS = {
  "1w": 604800,
  "1d": 86400,
  "4h": 14400,
  "1h": 3600,
  "30m": 1800,
  "15m": 900,
  "1m": 60,
};

module.exports = {
  PORT: process.env.APP_PORT || 11000,
  MARKETS,
  TIMEFRAMES,
  TIMEFRAME_LABELS,
  TF_ROLES,
  TF_WEIGHTS,
  TF_TO_CRON,
  TF_TO_SECONDS,
};
