// Decides how the dashboard presents a Market State response (DATA_CONTRACT.md §7).
// Loaded by the browser as a plain script (window.MarketStatus) and by Node tests via require().
(function (root) {
    var SCHEMA_VERSION = 2;

    function formatAge(seconds) {
        if (typeof seconds !== 'number' || !isFinite(seconds)) return 'unknown age';
        if (seconds < 90) return Math.round(seconds) + 's ago';
        if (seconds < 5400) return Math.round(seconds / 60) + 'm ago';
        if (seconds < 172800) return Math.round(seconds / 3600) + 'h ago';
        return Math.round(seconds / 86400) + 'd ago';
    }

    function formatUtc(sec) {
        if (typeof sec !== 'number' || !isFinite(sec)) return '-';
        return new Date(sec * 1000).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
    }

    // Returns { level: 'ok'|'degraded'|'stale'|'unavailable', showValues, title, detail, errors }.
    // `httpStatus` is the HTTP status of /api/market/:symbol, `data` its parsed body (or null).
    function describeMarketState(data, httpStatus, entryTf) {
        if (!data || typeof data !== 'object') {
            return { level: 'unavailable', showValues: false, title: 'UNAVAILABLE', detail: 'Market state could not be loaded (HTTP ' + (httpStatus || 'error') + ').', errors: [] };
        }
        var errors = Array.isArray(data.errors) ? data.errors : [];
        if (data.error === 'market_state_unavailable') {
            return { level: 'stale', showValues: false, title: 'STALE — NO MARKET STATE', detail: 'Required inputs are missing; no market state can be shown.', errors: errors };
        }
        if (httpStatus !== 200 || data.schema_version !== SCHEMA_VERSION) {
            return { level: 'unavailable', showValues: false, title: 'UNAVAILABLE', detail: 'Unexpected response (HTTP ' + httpStatus + ', schema ' + data.schema_version + ').', errors: errors };
        }
        var entry = data.inputs && data.inputs[entryTf];
        var asOf = entry ? 'As of ' + entryTf + ' close ' + formatUtc(entry.candle_close_time) + ' (' + formatAge(entry.age_seconds) + ')' : 'As of unknown close';
        if (data.status === 'ok') {
            return { level: 'ok', showValues: true, title: 'OK', detail: asOf, errors: errors };
        }
        if (data.status === 'degraded') {
            var stale = Object.keys(data.inputs || {}).filter(function (tf) { return data.inputs[tf].status !== 'ok'; });
            return { level: 'degraded', showValues: true, title: 'DEGRADED', detail: asOf + ' · stale higher timeframes: ' + stale.join(', '), errors: errors };
        }
        if (data.status === 'stale') {
            return { level: 'stale', showValues: true, title: 'STALE — NOT CURRENT', detail: asOf + ' · last known values, do not act on them', errors: errors };
        }
        return { level: 'unavailable', showValues: false, title: 'UNAVAILABLE', detail: 'Unknown status ' + data.status, errors: errors };
    }

    var api = { describeMarketState: describeMarketState, formatAge: formatAge, formatUtc: formatUtc, SCHEMA_VERSION: SCHEMA_VERSION };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.MarketStatus = api;
})(typeof window !== 'undefined' ? window : this);
