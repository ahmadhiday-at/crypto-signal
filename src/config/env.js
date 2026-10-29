require("dotenv").config();
const { TF_SECONDS } = require("../services/candles");

const parseList = (envVar, defaultList = []) => {
  return process.env[envVar]
    ? process.env[envVar].split(",").map((s) => s.trim()).filter(Boolean)
    : defaultList;
};

// Symbols become file names and URL segments, so only plain upper-case symbols are accepted.
const MARKET_RE = /^[A-Z0-9]{5,20}$/;

const keepValid = (list, isValid, label) => {
  const valid = [];
  for (const item of list) {
    if (isValid(item)) valid.push(item);
    else console.warn(`[Config] Ignoring unsupported ${label}: ${item}`);
  }
  return valid;
};

const MARKETS = keepValid(parseList("MARKET_LIST", ["BTCUSDT"]), (m) => MARKET_RE.test(m), "market");
const RAW_TIMEFRAMES = parseList("TIMEFRAME_LIST", ["15m"]);
const RAW_LABELS = parseList("TIMEFRAME_LABELS", []);
const TIMEFRAMES = [];
const TIMEFRAME_LABELS = [];
RAW_TIMEFRAMES.forEach((tf, i) => {
  if (TF_SECONDS[tf]) {
    TIMEFRAMES.push(tf);
    TIMEFRAME_LABELS.push(RAW_LABELS[i]);
  } else {
    console.warn(`[Config] Ignoring unsupported timeframe: ${tf}`);
  }
});

const TF_ROLES = {
  htf: process.env.TF_HTF || "1d",
  structure: process.env.TF_STRUCTURE || "4h",
  mid: process.env.TF_MID || "1h",
  entry: process.env.TF_ENTRY || "15m",
};
for (const [role, tf] of Object.entries(TF_ROLES)) {
  if (!TF_SECONDS[tf]) throw new Error(`[Config] TF role ${role} uses unsupported timeframe: ${tf}`);
}

const TF_WEIGHTS = {
  "1d": parseFloat(process.env.WEIGHT_1D || "3.0"),
  "4h": parseFloat(process.env.WEIGHT_4H || "2.0"),
  "1h": parseFloat(process.env.WEIGHT_1H || "1.5"),
  "15m": parseFloat(process.env.WEIGHT_15M || "1.0"),
  "1w": parseFloat(process.env.WEIGHT_1W || "1.0"),
  "1m": parseFloat(process.env.WEIGHT_1M || "1.0"),
  DEFAULT: 1.0,
};

// Host names the server answers to (Host header). Blocks DNS-rebinding pages from reaching the API.
const ALLOWED_HOSTS = [...new Set(["localhost", "127.0.0.1", "[::1]",
  ...parseList("ALLOWED_HOSTS", []).map((h) => h.toLowerCase())])];

module.exports = {
  PORT: process.env.PORT || 11000,
  ALLOWED_HOSTS,
  // Listening interface. Defaults to all interfaces (existing behaviour); set HOST=127.0.0.1 for
  // local runs. Docker Compose sets HOST=0.0.0.0 and restricts the published port instead.
  HOST: process.env.HOST || "0.0.0.0",
  MARKETS,
  TIMEFRAMES,
  TIMEFRAME_LABELS,
  TF_ROLES,
  TF_WEIGHTS,
};
