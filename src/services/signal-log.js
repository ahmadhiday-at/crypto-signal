// Level 4 signal logging (docs/roadmap/level-4.md): records every BUY/SELL candidate (filtered or
// not) with its features, then labels it WIN/LOSS/EXPIRED from later entry-timeframe candles.
// Storage: one append-only JSONL file per market. A `signal` line opens a record; an `outcome`
// line with the same id closes it. Readers merge the two.
const fs = require('fs').promises;
const path = require('path');
const { THRESHOLD } = require('./signal');

// A record still open after this many entry-timeframe candles is closed as EXPIRED.
const EXPIRY_CANDLES = 96;
const RESULTS = ['WIN', 'LOSS', 'EXPIRED', 'UNKNOWN'];
const MARKET_RE = /^[A-Z0-9]{2,20}$/;

const num = (v) => typeof v === 'number' && Number.isFinite(v);
const round = (v, d = 4) => (num(v) ? +v.toFixed(d) : null);

// The direction the score points to before filters, or null when it is not a candidate.
function candidateDirection(state) {
    const s = state.signal;
    if (!s || state.status !== 'ok') return null;
    if (s.score >= THRESHOLD) return 'BUY';
    if (s.score <= -THRESHOLD) return 'SELL';
    return null;
}

// Flat state variables for the dataset (docs/contract/market-state.md).
function featuresOf(state) {
    const s = state.signal;
    return {
        context: state.context ?? null,
        momentum: state.momentum ?? null,
        regime: state.regime ?? null,
        volume_state: state.volume_state ?? null,
        breakout_confirmation: state.breakout_confirmation ?? null,
        divergence: state.divergence ?? null,
        volatility_ratio: state.volatility_ratio ?? null,
        distance_to_support: state.distance_percent?.to_support ?? null,
        distance_to_resistance: state.distance_percent?.to_resistance ?? null,
        rsi: round(state.indicators?.rsi, 2),
        atr: state.indicators?.atr ?? null,
        score: s.score,
        strength: s.strength,
        reasons: s.reasons.map(r => r.code),
    };
}

// Walks the closed candles after the signal candle. A candle that touches both SL and TP1 counts as
// LOSS (the order inside the candle is unknown). Returns null while the record stays open.
function evaluate(record, candles) {
    const long = record.signal === 'BUY';
    const risk = long ? record.price - record.sl : record.sl - record.price;
    const after = candles.filter(c => c.time > record.candle_time);
    // The candle right after the signal is no longer in the history: the path cannot be checked.
    if (after.length && after[0].time > record.candle_close_time) {
        return { result: 'UNKNOWN', rr: null, closed_at: after[0].close_time, bars: null };
    }
    for (let i = 0; i < after.length; i++) {
        const c = after[i];
        const hitSl = long ? c.low <= record.sl : c.high >= record.sl;
        const hitTp = long ? c.high >= record.tp1 : c.low <= record.tp1;
        if (hitSl) return { result: 'LOSS', rr: -1, closed_at: c.close_time, bars: i + 1 };
        if (hitTp) return { result: 'WIN', rr: record.risk_reward, closed_at: c.close_time, bars: i + 1 };
        if (i + 1 >= EXPIRY_CANDLES) {
            const move = long ? c.close - record.price : record.price - c.close;
            return { result: 'EXPIRED', rr: risk > 0 ? round(move / risk, 2) : null, closed_at: c.close_time, bars: i + 1 };
        }
    }
    return null;
}

// A signal record for a candidate state at the entry candle `last`, or null when the state is not
// a candidate or its plan has no SL/TP1. Shared with the backtest.
function recordFrom(market, entryTf, state, last) {
    const direction = candidateDirection(state);
    const plan = state.signal?.plan;
    if (!direction || !last || !plan || !num(plan.stop_loss) || !num(plan.take_profit_1)) return null;
    return {
        type: 'signal',
        id: `${market}-${last.time}-${direction}`,
        timestamp: state.generated_at,
        market,
        timeframe: entryTf,
        candle_time: last.time,
        candle_close_time: last.close_time,
        signal: direction,
        filtered: state.signal.filtered,
        filters: state.signal.filters,
        strength: state.signal.strength,
        price: state.price,
        entry_zone: plan.entry_zone,
        sl: plan.stop_loss,
        tp1: plan.take_profit_1,
        tp2: plan.take_profit_2,
        risk_reward: plan.risk_reward,
        features: featuresOf(state),
    };
}

function createSignalLog({ dir, entryTf, log = console }) {
    // market -> Map(id -> record) of records without an outcome yet.
    const open = new Map();
    const fileOf = (market) => {
        if (!MARKET_RE.test(market)) throw new Error(`Invalid market name: ${String(market).slice(0, 30)}`);
        return path.join(dir, `${market}.jsonl`);
    };

    async function readLines(market) {
        let content;
        try {
            content = await fs.readFile(fileOf(market), 'utf8');
        } catch (e) {
            if (e.code === 'ENOENT') return [];
            throw e;
        }
        const lines = [];
        for (const line of content.split('\n')) {
            if (!line.trim()) continue;
            try {
                lines.push(JSON.parse(line));
            } catch (e) {
                // A crash mid-append can leave a truncated last line; skip it.
                log.warn(`[SignalLog] ${market}: skipping unreadable line`);
            }
        }
        return lines;
    }

    // Signal records with their outcome merged in, oldest first.
    async function records(market) {
        const byId = new Map();
        for (const line of await readLines(market)) {
            if (line.type === 'signal') byId.set(line.id, { ...line, result: null, rr: null, closed_at: null, bars: null });
            else if (line.type === 'outcome' && byId.has(line.id)) {
                const { type, id, ...outcome } = line;
                Object.assign(byId.get(id), outcome);
            }
        }
        return [...byId.values()].map(({ type, ...r }) => r);
    }

    async function append(market, entry) {
        await fs.mkdir(dir, { recursive: true });
        await fs.appendFile(fileOf(market), JSON.stringify(entry) + '\n');
    }

    async function load(markets) {
        for (const m of markets) {
            const pending = new Map();
            for (const r of await records(m)) if (r.result === null) pending.set(r.id, r);
            open.set(m, pending);
        }
    }

    // Called after a summary is published. `candles` are the entry timeframe's closed candles.
    // Closes open records first, so a new record is never judged on its own signal candle.
    async function onSummary(market, state, candles) {
        if (!open.has(market)) open.set(market, new Map());
        const pending = open.get(market);

        for (const r of [...pending.values()]) {
            const outcome = evaluate(r, candles);
            if (!outcome) continue;
            await append(market, { type: 'outcome', id: r.id, ...outcome });
            pending.delete(r.id);
        }

        const record = recordFrom(market, entryTf, state, candles[candles.length - 1]);
        if (!record) return;
        // One open record per direction: a setup that persists over several candles is logged once.
        if ([...pending.values()].some(r => r.signal === record.signal)) return;
        await append(market, record);
        const { type, ...rest } = record;
        pending.set(record.id, { ...rest, result: null, rr: null, closed_at: null, bars: null });
    }

    return { load, onSummary, records };
}

const CSV_COLUMNS = [
    'id', 'timestamp', 'market', 'timeframe', 'signal', 'filtered', 'filters', 'strength', 'price', 'sl', 'tp1', 'tp2',
    'risk_reward', 'result', 'rr', 'closed_at', 'bars',
    'context', 'momentum', 'regime', 'volume_state', 'breakout_confirmation', 'divergence', 'volatility_ratio',
    'distance_to_support', 'distance_to_resistance', 'rsi', 'atr', 'score', 'reasons',
];

// Flattens records (features included) into CSV; list values are joined with '|'.
function toCsv(rows) {
    const cell = (v) => {
        if (v === null || v === undefined) return '';
        const s = Array.isArray(v) ? v.join('|') : String(v);
        return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = rows.map(r => {
        const flat = { ...r, ...r.features };
        return CSV_COLUMNS.map(k => cell(flat[k])).join(',');
    });
    return [CSV_COLUMNS.join(','), ...lines].join('\n') + '\n';
}

module.exports = { createSignalLog, evaluate, candidateDirection, recordFrom, toCsv, EXPIRY_CANDLES, RESULTS };
