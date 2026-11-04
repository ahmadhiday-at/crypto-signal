// One number and time format for every page. Plain script in the browser (window.Fmt), require() in tests.
(function (root) {
    var cache = {};
    function nf(d) {
        return cache[d] || (cache[d] = new Intl.NumberFormat(undefined, { minimumFractionDigits: d, maximumFractionDigits: d }));
    }
    function isNum(v) { return typeof v === 'number' && isFinite(v); }
    function priceDecimals(v) {
        var a = Math.abs(v);
        return a >= 1 ? 2 : a >= 0.01 ? 4 : 6;
    }
    function num(v, d) { return isNum(v) ? nf(d === undefined ? 2 : d).format(v) : '-'; }
    function price(v) { return isNum(v) ? nf(priceDecimals(v)).format(v) : '-'; }
    function signed(v, d) { return isNum(v) ? (v > 0 ? '+' : '') + nf(d === undefined ? priceDecimals(v) : d).format(v) : '-'; }
    function pct(v, d) { return isNum(v) ? nf(d === undefined ? 2 : d).format(v) + '%' : '-'; }
    function signedPct(v, d) { return isNum(v) ? (v > 0 ? '+' : '') + nf(d === undefined ? 2 : d).format(v) + '%' : '-'; }
    // A share (0.3) as a percentage.
    function share(v, d) { return isNum(v) ? nf(d === undefined ? 1 : d).format(v * 100) + '%' : '-'; }
    function r(v, d) { return isNum(v) ? (v > 0 ? '+' : '') + nf(d === undefined ? 2 : d).format(v) + ' R' : '-'; }
    function vol(v) {
        if (!isNum(v)) return '-';
        var a = Math.abs(v);
        return a >= 1e9 ? nf(2).format(v / 1e9) + 'B' : a >= 1e6 ? nf(2).format(v / 1e6) + 'M' : a >= 1e3 ? nf(2).format(v / 1e3) + 'K' : nf(2).format(v);
    }
    // Candle times are UTC boundaries, so every page shows UTC.
    function utc(sec) { return isNum(sec) ? new Date(sec * 1000).toISOString().replace('T', ' ').slice(0, 16) : '-'; }
    function day(sec) { return isNum(sec) ? new Date(sec * 1000).toISOString().slice(0, 10) : '-'; }
    function span(seconds) {
        if (!isNum(seconds)) return '-';
        var s = Math.abs(seconds);
        if (s < 90) return Math.round(s) + 's';
        if (s < 5400) return Math.round(s / 60) + 'm';
        if (s < 172800) return Math.round(s / 3600) + 'h';
        return Math.round(s / 86400) + 'd';
    }
    function esc(s) {
        return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (c) {
            return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
        });
    }
    function tone(v) { return !isNum(v) || v === 0 ? '' : v > 0 ? 'pos' : 'neg'; }

    var api = { isNum: isNum, priceDecimals: priceDecimals, num: num, price: price, signed: signed, pct: pct, signedPct: signedPct, share: share, r: r, vol: vol, utc: utc, day: day, span: span, esc: esc, tone: tone };
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    else root.Fmt = api;
})(typeof window !== 'undefined' ? window : this);
