// Closed-candle history for the backtest (docs/roadmap/level-5.md), cached per market and
// timeframe in `data/history/{MARKET}_{tf}.json` as compact rows [time, open, high, low, close, volume].
// Only the missing tail is downloaded on later runs.
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { tfSeconds, normalizeCandles } = require('./candles');

const MARKET_RE = /^[A-Z0-9]{2,20}$/;
const TF_RE = /^\d{1,2}[mhdw]$/;
const PAGE = 1000;
const PAUSE_MS = 250;

const toRow = (c) => [c.time, c.open, c.high, c.low, c.close, c.volume];
const fromRow = (r, len) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5], close_time: r[0] + len });

function createHistory({ dir, binance, now = () => Date.now(), sleep = (ms) => new Promise(r => setTimeout(r, ms)), log = console }) {
    const fileOf = (market, tf) => {
        if (!MARKET_RE.test(market) || !TF_RE.test(tf)) throw new Error(`Invalid market/timeframe: ${market}/${tf}`);
        return path.join(dir, `${market}_${tf}.json`);
    };

    async function read(market, tf) {
        try {
            const rows = JSON.parse(await fs.readFile(fileOf(market, tf), 'utf8'));
            return Array.isArray(rows) ? rows.map(r => fromRow(r, tfSeconds(tf))) : [];
        } catch (e) {
            if (e.code !== 'ENOENT') log.warn(`[History] ${market}/${tf}: unreadable cache, downloading again`);
            return [];
        }
    }

    async function write(market, tf, candles) {
        await fs.mkdir(dir, { recursive: true });
        const file = fileOf(market, tf);
        const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        await fs.writeFile(tmp, JSON.stringify(candles.map(toRow)));
        await fs.rename(tmp, file);
    }

    // Returns closed candles from `fromSec` to now. A cache that does not reach back to `fromSec`
    // is downloaded again in full. Binance errors (including 451) are thrown to the caller.
    async function sync(market, tf, fromSec, { onPage } = {}) {
        const len = tfSeconds(tf);
        if (!len) throw new Error(`Unsupported timeframe: ${tf}`);
        let candles = await read(market, tf);
        if (!candles.length || candles[0].time > fromSec) candles = [];

        let start = candles.length ? candles[candles.length - 1].time + len : fromSec;
        for (;;) {
            const nowSec = Math.floor(now() / 1000);
            if (start + len > nowSec) break;
            const page = await binance.getKlinesFrom(market, tf, start * 1000);
            const closed = page.filter(c => c.close_time <= nowSec && c.time >= start);
            candles = normalizeCandles([...candles, ...closed]);
            if (onPage) onPage(tf, candles.length);
            if (page.length < PAGE || !closed.length) break;
            start = closed[closed.length - 1].time + len;
            await sleep(PAUSE_MS);
        }
        await write(market, tf, candles);
        return candles.filter(c => c.time >= fromSec);
    }

    return { read, sync };
}

module.exports = { createHistory };
