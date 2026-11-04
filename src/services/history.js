// Closed-candle history for the backtest (docs/roadmap/level-5.md), one file per calendar year (UTC,
// by candle open time): `data/history/{MARKET}/{tf}/{YYYY}.json`, one [time, open, high, low, close,
// volume] row per line. Committed to git: a finished year never changes, so only the current year's
// file gets new lines. `meta.json` remembers what Binance does not have, so it is not asked again:
// `earliest` (first candle it has) and `gaps` (open times of holes it could not fill).
const fs = require('fs').promises;
const path = require('path');
const crypto = require('crypto');
const { tfSeconds, normalizeCandles } = require('./candles');

const MARKET_RE = /^[A-Z0-9]{2,20}$/;
const TF_RE = /^\d{1,2}[mhdw]$/;
const YEAR_RE = /^\d{4}\.json$/;
const PAGE = 1000;
const PAUSE_MS = 250;

const toRow = (c) => [c.time, c.open, c.high, c.low, c.close, c.volume];
const fromRow = (r, len) => ({ time: r[0], open: r[1], high: r[2], low: r[3], close: r[4], volume: r[5], close_time: r[0] + len });
const yearOf = (sec) => new Date(sec * 1000).getUTCFullYear();
const render = (rows) => `[\n${rows.map(r => JSON.stringify(r)).join(',\n')}\n]\n`;

function createHistory({ dir, binance, now = () => Date.now(), sleep = (ms) => new Promise(r => setTimeout(r, ms)), log = console }) {
    const dirOf = (market, tf) => {
        if (!MARKET_RE.test(market) || !TF_RE.test(tf)) throw new Error(`Invalid market/timeframe: ${market}/${tf}`);
        return path.join(dir, market, tf);
    };

    async function writeAtomic(file, content) {
        const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
        await fs.writeFile(tmp, content);
        await fs.rename(tmp, file);
    }

    // Splits rows into year files. A file whose content is unchanged is not touched.
    async function writeYears(market, tf, rows) {
        const folder = dirOf(market, tf);
        await fs.mkdir(folder, { recursive: true });
        const years = new Map();
        for (const row of rows) {
            const y = yearOf(row[0]);
            if (!years.has(y)) years.set(y, []);
            years.get(y).push(row);
        }
        for (const [year, list] of years) {
            const file = path.join(folder, `${year}.json`);
            const content = render(list);
            const current = await fs.readFile(file, 'utf8').catch(() => null);
            if (current !== content) await writeAtomic(file, content);
        }
    }

    // The single-file cache of versions before 4.0.0: split once, verified, then removed.
    async function migrateFlat(market, tf) {
        const flat = path.join(dir, `${market}_${tf}.json`);
        let rows;
        try {
            rows = JSON.parse(await fs.readFile(flat, 'utf8'));
        } catch (e) {
            if (e.code !== 'ENOENT') log.warn(`[History] ${market}/${tf}: unreadable old cache left in place`);
            return;
        }
        if (!Array.isArray(rows)) return;
        // Rows already in the year files stay; the old file only adds what they lack.
        const known = await readRows(market, tf);
        const merged = new Map([...rows, ...known].map(r => [r[0], r]));
        const all = [...merged.values()].sort((a, b) => a[0] - b[0]);
        await writeYears(market, tf, all);
        const saved = await readRows(market, tf);
        if (saved.length !== all.length || saved[saved.length - 1]?.[0] !== all[all.length - 1]?.[0]) {
            throw new Error(`${market}/${tf}: old cache split does not match, kept ${flat}`);
        }
        await fs.unlink(flat);
        log.log(`[History] ${market}/${tf}: split ${all.length} candles into year files`);
    }

    async function readRows(market, tf) {
        const folder = dirOf(market, tf);
        const names = await fs.readdir(folder).catch(() => []);
        const rows = [];
        for (const name of names.filter(n => YEAR_RE.test(n)).sort()) {
            try {
                const list = JSON.parse(await fs.readFile(path.join(folder, name), 'utf8'));
                if (Array.isArray(list)) rows.push(...list);
            } catch (e) {
                log.warn(`[History] ${market}/${tf}/${name}: unreadable, its candles count as missing`);
            }
        }
        return rows;
    }

    const readMeta = async (market, tf) => {
        try {
            return JSON.parse(await fs.readFile(path.join(dirOf(market, tf), 'meta.json'), 'utf8'));
        } catch (e) {
            return {};
        }
    };

    async function read(market, tf) {
        dirOf(market, tf);
        await migrateFlat(market, tf);
        return (await readRows(market, tf)).map(r => fromRow(r, tfSeconds(tf)));
    }

    // Candles of [start, end) from Binance, page by page, in order. Each page goes to `keep` at once,
    // so the pages before a failure are not lost.
    async function fetchRange(market, tf, start, end, keep, onPage) {
        const len = tfSeconds(tf);
        const found = [];
        let from = start;
        for (;;) {
            const nowSec = Math.floor(now() / 1000);
            if (from + len > nowSec || from >= end) break;
            const page = await binance.getKlinesFrom(market, tf, from * 1000);
            const closed = page.filter(c => c.close_time <= nowSec && c.time >= from && c.time < end);
            found.push(...closed);
            keep(closed);
            if (onPage) onPage(tf, found.length);
            if (page.length < PAGE || !closed.length) break;
            from = closed[closed.length - 1].time + len;
            await sleep(PAUSE_MS);
        }
        return found;
    }

    // Fills what is missing and nothing else: before the first candle (down to `fromSec`, when Binance
    // has it), holes inside, and after the last candle. `fromSec` null keeps the current start; a market
    // without history then starts at `fromIfEmpty`. Candles found before a failure are kept. Binance
    // errors (including 451) are thrown to the caller. Returns the closed candles from `fromSec`.
    async function sync(market, tf, fromSec, { onPage, fromIfEmpty = null } = {}) {
        const len = tfSeconds(tf);
        if (!len) throw new Error(`Unsupported timeframe: ${tf}`);
        let candles = await read(market, tf);
        const meta = await readMeta(market, tf);
        const gaps = new Set(meta.gaps || []);
        let earliest = meta.earliest ?? null;
        const before = candles.length;
        const merge = (more) => { if (more.length) candles = normalizeCandles([...candles, ...more]); };

        let failure = null;
        try {
            const from = fromSec ?? (candles.length ? null : fromIfEmpty);
            const first = candles[0]?.time ?? null;
            const reachesBack = first !== null && earliest !== null && earliest >= first;
            if (from !== null && (first === null || (first > from && !reachesBack))) {
                const found = await fetchRange(market, tf, from, first ?? Infinity, merge, onPage);
                // Binance starts later than asked: that is where this market begins.
                const start = found[0]?.time ?? first;
                if (start !== null && start > from) earliest = start;
            }
            const holes = [];
            for (let i = 1; i < candles.length; i++) {
                if (candles[i].time - candles[i - 1].time > len && !gaps.has(candles[i - 1].time + len)) holes.push([candles[i - 1].time + len, candles[i].time]);
            }
            for (const [start, end] of holes) {
                const found = await fetchRange(market, tf, start, end, merge, onPage);
                // Binance has no such candles (an outage on its side): do not ask again.
                if (!found.length) gaps.add(start);
            }
            if (candles.length) await fetchRange(market, tf, candles[candles.length - 1].time + len, Infinity, merge, onPage);
        } catch (err) {
            failure = err;
        }

        if (candles.length !== before) await writeYears(market, tf, candles.map(toRow));
        const nextMeta = { ...(earliest !== null ? { earliest } : {}), ...(gaps.size ? { gaps: [...gaps].sort((a, b) => a - b) } : {}) };
        if (JSON.stringify(nextMeta) !== JSON.stringify({ ...(meta.earliest !== undefined ? { earliest: meta.earliest } : {}), ...(meta.gaps?.length ? { gaps: meta.gaps } : {}) })) {
            await fs.mkdir(dirOf(market, tf), { recursive: true });
            await writeAtomic(path.join(dirOf(market, tf), 'meta.json'), JSON.stringify(nextMeta) + '\n');
        }
        if (failure) throw failure;
        return fromSec === null || fromSec === undefined ? candles : candles.filter(c => c.time >= fromSec);
    }

    return { read, sync };
}

module.exports = { createHistory };
