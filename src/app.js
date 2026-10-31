const express = require("express");
const path = require("path");
const {
  createMarketController,
} = require("./api/controllers/market.controller");
const { createApiRouter } = require("./api/routes/api.routes");
const viewRoutes = require("./api/routes/view.routes");

// Host name from a Host header value (IPv6 stays bracketed), or null when it cannot be parsed.
function hostnameOf(hostHeader) {
  if (!hostHeader) return null;
  try {
    return new URL(`http://${hostHeader}`).hostname.toLowerCase();
  } catch (e) {
    return null;
  }
}

function createHostCheck(allowedHosts) {
  const allowed = new Set(allowedHosts);
  return (hostHeader) => allowed.has(hostnameOf(hostHeader));
}

function createApp({ engine, config, reports = null, log = console }) {
  const app = express();

  app.disable("x-powered-by");
  // The app uses no query strings; the simple parser avoids qs (moderate advisory pinned by express 4).
  app.set("query parser", "simple");

  // A page on another domain that re-points its DNS to this machine still sends its own Host
  // header; only requests addressed to an allowed host name are served.
  const isAllowedHost = createHostCheck(
    config.ALLOWED_HOSTS || ["localhost", "127.0.0.1", "[::1]"],
  );
  app.use((req, res, next) => {
    if (!isAllowedHost(req.headers.host))
      return res.status(403).json({ error: "host_not_allowed" });
    next();
  });

  app.use((req, res, next) => {
    res.set({
      "X-Content-Type-Options": "nosniff",
      "X-Frame-Options": "DENY",
      "Referrer-Policy": "no-referrer",
    });
    next();
  });

  app.use(express.static(path.join(__dirname, "../public")));
  app.use("/api", createApiRouter(createMarketController({ engine, config, reports })));
  app.use("/", viewRoutes);

  // Never leak internal error details to clients.
  app.use((err, req, res, next) => {
    log.error(`[API] ${req.method} ${req.path} failed: ${err.message}`);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: "internal_error" });
  });

  return app;
}

module.exports = { createApp, createHostCheck };
