require("dotenv").config();
const parseList = (envVar, defaultList = []) => {
  return process.env[envVar]
    ? process.env[envVar].split(",").map((s) => s.trim()).filter(Boolean)
    : defaultList;
};

// Moved to config/calculation.json (editable on /config) in 3.0.0. Named at startup, never their values.
const OBSOLETE = ["MARKET_LIST", "TIMEFRAME_LIST", "TIMEFRAME_LABELS", "TF_HTF", "TF_STRUCTURE", "TF_MID", "TF_ENTRY",
  "CANDLE_LIMIT", "MAPPING_CANDLE", "WEIGHT_1D", "WEIGHT_4H", "WEIGHT_1H", "WEIGHT_15M", "WEIGHT_1W", "WEIGHT_1M"];
const ignored = OBSOLETE.filter((k) => process.env[k] !== undefined);
if (ignored.length) console.warn(`[Config] No longer read from .env (now in config/calculation.json): ${ignored.join(", ")}`);

// Host names the server answers to (Host header). Blocks DNS-rebinding pages from reaching the API.
const ALLOWED_HOSTS = [...new Set(["localhost", "127.0.0.1", "[::1]",
  ...parseList("ALLOWED_HOSTS", []).map((h) => h.toLowerCase())])];

// Protects the actions that change something (config save, backtest run, reset). Too short a token
// counts as none: those actions stay refused.
const MIN_ADMIN_TOKEN = 16;
const rawAdminToken = (process.env.ADMIN_TOKEN || "").trim();
if (rawAdminToken && rawAdminToken.length < MIN_ADMIN_TOKEN) {
  console.warn(`[Config] ADMIN_TOKEN ignored: it needs at least ${MIN_ADMIN_TOKEN} characters`);
}
const ADMIN_TOKEN = rawAdminToken.length >= MIN_ADMIN_TOKEN ? rawAdminToken : "";

module.exports = {
  PORT: process.env.PORT || 11000,
  ALLOWED_HOSTS,
  ADMIN_TOKEN,
  // Listening interface. Defaults to all interfaces (existing behaviour); set HOST=127.0.0.1 for
  // local runs. Docker Compose sets HOST=0.0.0.0 and restricts the published port instead.
  HOST: process.env.HOST || "0.0.0.0",
  // Filled at startup from config/calculation.json (applyEngine in src/config/calculation.js).
  MARKETS: [],
  TIMEFRAMES: [],
  TF_ROLES: {},
};
