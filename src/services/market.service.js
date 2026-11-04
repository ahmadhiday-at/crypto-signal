const { tfSeconds, isBoundary, expectedLastClose, normalizeCandles, splitClosed, countGaps } = require('./candles');
const { computeInputs, summaryStatus, inputStatus, FUTURE_TOLERANCE_S } = require('./freshness');
const { SCHEMA_VERSION, ERROR_CODES, validateMarketState, validateSnapshot } = require('./contract');
const { computeSignal, TREND_DEFAULTS } = require('./signal');
const { detectDivergence } = require('./divergence');

// Defaults of the calculation config's `market` group (config/calculation.json): volume state,
// market energy, breakout score and its confirmation, dominant side and the volatility ratio.
const MARKET_DEFAULTS = {
    volume_candles: 20, volume_high: 1.5, volume_increasing: 1.2, volume_low: 0.8,
    energy_explosive: 0.1, energy_building: 0.05, energy_cooling: 0.02,
    breakout_distance_percent: 1, breakout_volume_high: 1, breakout_volume_increasing: 0.8, breakout_volume_normal: 0.5, breakout_volume_low: 0.3,
    compression_bonus: 0.2, breakout_strong: 0.7, breakout_weak: 0.4, dominant_percent: 20, volatility_candles: 100,
};

// `params` is the calculation config's `market` group (defaults above).
function enhanceMarketState(data, params = {}) {
    const p = { ...MARKET_DEFAULTS, ...params };
    const price = data.price;
    const support = data.levels.support;
    const resistance = data.levels.resistance;

    function normalizeScores(levels) {
        const maxScore = Math.max(...levels.map(l => l.score), 1);
        return levels.map(l => ({ ...l, score_raw: l.score, score: +(l.score / maxScore * 10).toFixed(2) }));
    }

    const normSupport = normalizeScores(support);
    const normResistance = normalizeScores(resistance);
    const nearestSupport = normSupport[0];
    const nearestResistance = normResistance[0];

    const distSupport = Math.abs(price - nearestSupport.mid) / price;
    const distResistance = Math.abs(price - nearestResistance.mid) / price;
    const distSupportPct = distSupport * 100;
    const distResistancePct = distResistance * 100;

    const isInsideSupport = price >= nearestSupport.low && price <= nearestSupport.high;
    const isInsideResistance = price >= nearestResistance.low && price <= nearestResistance.high;
    const isOverlap = nearestSupport.high > nearestResistance.low && price <= nearestSupport.high && price >= nearestResistance.low;

    let position = "mid_range";
    if (distSupport < distResistance) position = "closer_to_support";
    else if (distResistance < distSupport) position = "closer_to_resistance";

    let context = "mid_range";
    let zone_state = "normal";
    if (isOverlap) {
        context = "compression_zone";
        zone_state = "compression";
    } else if (isInsideSupport) {
        context = "near_support";
    } else if (isInsideResistance) {
        context = "near_resistance";
    }

    let dominant_side = "neutral";
    const sScore = nearestSupport.score_raw;
    const rScore = nearestResistance.score_raw;
    const diff = Math.abs(sScore - rScore);
    const threshold = Math.max(sScore, rScore) * p.dominant_percent / 100;
    if (diff > threshold) dominant_side = sScore > rScore ? "support" : "resistance";
    else dominant_side = "equilibrium";

    let market_pressure = "stable";
    if (zone_state === "compression") {
        if (dominant_side === "support") market_pressure = "bullish_compression";
        else if (dominant_side === "resistance") market_pressure = "bearish_compression";
        else market_pressure = "neutral_compression";
    } else {
        market_pressure = dominant_side === "support" ? "bullish_lean" : dominant_side === "resistance" ? "bearish_lean" : "balanced";
    }

    let volume_state = "normal";
    let volMultiplier = 1.0;
    if (data.indicators && Array.isArray(data.indicators.volume)) {
        const volumes = data.indicators.volume;
        const currentVol = volumes[volumes.length - 1];
        const avgVol = volumes.slice(-p.volume_candles).reduce((a, b) => a + b, 0) / p.volume_candles;
        volMultiplier = currentVol / (avgVol || 1);
        if (currentVol > avgVol * p.volume_high) volume_state = "high";
        else if (currentVol > avgVol * p.volume_increasing) volume_state = "increasing";
        else if (currentVol < avgVol * p.volume_low) volume_state = "low";
    }

    let market_energy = "stable";
    const macdHist = data.indicators?.macd?.histogram || 0;
    const absMacd = Math.abs(macdHist);
    if (volume_state === "high" && absMacd > p.energy_explosive) market_energy = "explosive";
    else if (volume_state === "increasing" && absMacd > p.energy_building) market_energy = "building";
    else if (volume_state === "low" || absMacd < p.energy_cooling) market_energy = "cooling";

    const minDistance = Math.min(distSupportPct, distResistancePct);
    const distanceFactor = Math.max(0, 1 - (minDistance / p.breakout_distance_percent));
    let volumeFactor = p.breakout_volume_normal;
    if (volume_state === "high") volumeFactor = p.breakout_volume_high;
    else if (volume_state === "increasing") volumeFactor = p.breakout_volume_increasing;
    else if (volume_state === "low") volumeFactor = p.breakout_volume_low;

    let breakout_score = distanceFactor * volumeFactor;
    if (zone_state === "compression") breakout_score += p.compression_bonus;
    breakout_score = Math.min(1, +breakout_score.toFixed(2));

    let breakout_confirmation = "none";
    if (breakout_score > p.breakout_strong) {
        if (volume_state === "high") breakout_confirmation = "strong";
        else if (volume_state === "increasing") breakout_confirmation = "medium";
        else breakout_confirmation = "weak";
    } else if (breakout_score > p.breakout_weak) {
        breakout_confirmation = volume_state === "high" ? "noise" : "weak";
    }

    let setup_state = "no_trade";
    if (zone_state === "compression") {
        setup_state = breakout_score > p.breakout_strong ? "breakout_entry_ready" : "waiting_breakout";
    } else if (context === "near_support" && dominant_side === "support") {
        setup_state = volume_state === "high" ? "potential_bounce_entry" : "watching_support";
    } else if (context === "near_resistance" && dominant_side === "resistance") {
        setup_state = volume_state === "high" ? "potential_reject_entry" : "watching_resistance";
    }

    let fake_breakout_risk = "low";
    if (zone_state === "compression" && market_energy === "cooling") {
        if (context === "near_resistance" || context === "near_support") fake_breakout_risk = "high";
        else fake_breakout_risk = "medium";
    } else if (market_energy === "cooling" && (context === "near_resistance" || context === "near_support")) {
        fake_breakout_risk = "medium";
    }

    const regimes = Object.values(data.timeframes || {}).map(t => t.regime);
    let regime_global = "mixed";
    if (regimes.length > 0) {
        const unique = [...new Set(regimes)];
        if (unique.length === 1) regime_global = unique[0];
        else if (unique.includes("trending") && unique.includes("ranging")) regime_global = "weak_trend";
    }

    return {
        ...data,
        context, position, zone_state, dominant_side, market_pressure, market_energy,
        breakout_score, breakout_confirmation, volume_state, setup_state, fake_breakout_risk, regime_global,
        distance: { to_support: +distSupport.toFixed(4), to_resistance: +distResistance.toFixed(4) },
        distance_percent: { to_support: +distSupportPct.toFixed(2), to_resistance: +distResistancePct.toFixed(2) },
        levels: { support: normSupport, resistance: normResistance }
    };
}


// High / low of the `n` closed entry candles before the latest one (trend model `breakout`).
function channelOf(candles, n) {
    const prev = (candles || []).slice(-(n + 1), -1);
    if (prev.length < n) return null;
    return { high: Math.max(...prev.map(c => c.high)), low: Math.min(...prev.map(c => c.low)), candles: n };
}

// Merges the role-timeframe snapshots into the pre-enhancement Market State (unchanged merge rules).
// `params` holds the calculation config's `market`, `divergence` and `trend` groups.
function mergeSnapshots(market, snaps, roles, weights, params = {}) {
    const mp = { ...MARKET_DEFAULTS, ...params.market };
    const channelCandles = { ...TREND_DEFAULTS, ...params.trend }.channel_candles;
    // Two roles may share a timeframe; each timeframe is merged once.
    const tfList = [...new Set(Object.values(roles))];
    const timeframesState = {};
    const mergedSupport = [];
    const mergedResistance = [];

    const mergeSide = (merged, levels, tf, weight) => {
        levels.forEach(lvl => {
            const weightedScore = Math.round((lvl.score * weight) * 10) / 10;
            const existing = merged.find(m => lvl.mid >= m.low && lvl.mid <= m.high);
            if (existing) {
                existing.score += weightedScore;
                if (!existing.tfs) existing.tfs = [];
                if (!existing.tfs.includes(tf)) existing.tfs.push(tf);
            } else {
                merged.push({ ...lvl, score: weightedScore, tfs: [tf] });
            }
        });
    };

    for (const tf of tfList) {
        const data = snaps[tf];
        timeframesState[tf] = { price: data.price, context: data.context, momentum: data.momentum, regime: data.regime, trend: trendOf(data), timestamp: data.timestamp };
        const weight = weights[tf] || weights['DEFAULT'];
        if (data.support) mergeSide(mergedSupport, data.support, tf, weight);
        if (data.resistance) mergeSide(mergedResistance, data.resistance, tf, weight);
    }

    const entryData = snaps[roles.entry];
    const lastIndicators = {};
    for (const [key, values] of Object.entries(entryData.indicators || {})) {
        // Arrays hold one value per candle (MACD holds {MACD, signal, histogram} objects).
        lastIndicators[key] = Array.isArray(values) ? values[values.length - 1] : values;
    }

    const last = entryData.candles[entryData.candles.length - 1];
    return {
        raw: {
            market,
            timeframe: 'multitimeframe',
            timeframe_list: tfList,
            price: entryData.price,
            context: entryData.context,
            momentum: entryData.momentum,
            regime: entryData.regime,
            ohlcv: { time: last.time, open: last.open, high: last.high, low: last.low, close: last.close, volume: last.volume },
            indicators: lastIndicators,
            levels: {
                support: mergedSupport.sort((a, b) => b.score - a.score).slice(0, 3),
                resistance: mergedResistance.sort((a, b) => b.score - a.score).slice(0, 3)
            },
            timestamp: entryData.timestamp,
            timeframes: timeframesState,
            volatility_ratio: volatilityRatio(entryData.indicators?.atr, mp.volatility_candles),
            divergence: detectDivergence(entryData.candles, entryData.indicators?.rsi || [], params.divergence),
            channel: channelOf(entryData.candles, channelCandles),
        },
        // enhanceMarketState compares the latest volume with the 20-candle average, so it needs the
        // recent history rather than only the latest value.
        volumeHistory: (entryData.indicators?.volume || []).slice(-mp.volume_candles),
    };
}

const RESET_COOLDOWN_S = 60;

// Direction of a timeframe (Level 6.5 B1): `ranging` when its regime is ranging (MA14 within 1% of
// MA50), otherwise `up` / `down` by MA14 vs MA50. Derived from the snapshot, so stored snapshots
// from older versions get it too.
function trendOf(snap) {
    if (snap.regime === 'ranging') return 'ranging';
    const last = (arr) => (Array.isArray(arr) && arr.length ? arr[arr.length - 1] : null);
    const ma14 = last(snap.indicators?.ma14);
    const ma50 = last(snap.indicators?.ma50);
    if (snap.regime !== 'trending' || !Number.isFinite(ma14) || !Number.isFinite(ma50) || ma14 === ma50) return 'unknown';
    return ma14 > ma50 ? 'up' : 'down';
}

// Latest closed ATR divided by the mean ATR of the last `candles` closed candles (1.0 = typical).
function volatilityRatio(atr, candles = MARKET_DEFAULTS.volatility_candles) {
    const values = (atr || []).filter(v => typeof v === 'number' && Number.isFinite(v));
    if (values.length === 0) return null;
    const window = values.slice(-candles);
    const mean = window.reduce((a, b) => a + b, 0) / window.length;
    return mean > 0 ? +(values[values.length - 1] / mean).toFixed(3) : null;
}

function codeOf(err) {
    return err && ERROR_CODES.includes(err.code) ? err.code : 'calculation_failed';
}

// Builds the Market State fields (without freshness or signal) from the role snapshots.
// Shared by the live engine and the backtest. Throws when a side has no merged level.
// `params` holds the calculation config's `market` and `divergence` groups.
function composeMarketState(market, snaps, roles, weights, params = {}) {
    const { raw, volumeHistory } = mergeSnapshots(market, snaps, roles, weights, params);
    if (raw.levels.support.length === 0 || raw.levels.resistance.length === 0) throw new Error('no merged levels');
    const enhanced = enhanceMarketState({ ...raw, indicators: { ...raw.indicators, volume: volumeHistory } }, params.market);
    enhanced.indicators = raw.indicators;
    return enhanced;
}

// `calc` is the calculation config (src/config/calculation.js); without it the engine uses the
// env weights and the signal defaults.
function createMarketEngine({ storage, binance, indicators, config, calc = null, signalLog = null, shadowLog = null, now = () => Date.now(), notify = {}, log = console }) {
    const nowSec = () => Math.floor(now() / 1000);
    const roles = config.TF_ROLES;
    const roleTfs = [...new Set(Object.values(roles))];
    const entryTf = roles.entry;
    const allTfs = [...new Set([...config.TIMEFRAMES, ...roleTfs])].filter(tf => tfSeconds(tf));
    const markets = config.MARKETS;

    const health = new Map();
    const inflight = new Map();
    const summaryChains = new Map();
    const queuedBuilds = new Map();
    const summaryErrors = new Map();
    let resetPromise = null;
    let lastResetAt = null;

    const weightsNow = () => (calc ? calc.weights() : config.TF_WEIGHTS);
    const snapshotParams = () => (calc ? calc.snapshotParams() : {});
    const stateParams = () => (calc ? calc.stateParams() : {});
    const signalOf = (state) => computeSignal(state, roles.htf, { ...(calc ? calc.signalOptions() : {}), structureTf: roles.structure, entryTf: roles.entry });

    const isMarket = (m) => markets.includes(m);
    const isTimeframe = (tf) => allTfs.includes(tf);

    function healthOf(market, tf) {
        const key = `${market}|${tf}`;
        if (!health.has(key)) {
            health.set(key, { candle_close_time: null, last_success_at: null, last_attempt_at: null, last_error: null });
        }
        return health.get(key);
    }

    async function readValidSnapshot(market, tf) {
        const res = await storage.readSnapshotResult(market, tf);
        if (!res.data) return { snap: null, reason: res.reason };
        const problems = validateSnapshot(res.data, market, tf);
        if (problems.length) return { snap: null, reason: 'invalid' };
        if (res.data.candle_close_time > nowSec() + FUTURE_TOLERANCE_S) return { snap: null, reason: 'future' };
        return { snap: res.data };
    }

    async function loadIndex() {
        for (const m of markets) {
            for (const tf of allTfs) {
                const { snap, reason } = await readValidSnapshot(m, tf);
                healthOf(m, tf).candle_close_time = snap ? snap.candle_close_time : null;
                if (!snap && reason !== 'not_found') log.warn(`[Init] Ignoring ${reason} snapshot ${m}/${tf}; it will be refetched`);
            }
        }
    }

    // True when the stored snapshot is older than the latest closed candle. Retries after a failure
    // are throttled to once per min(timeframe, 5 minutes) unless `ignoreThrottle` is set; when the
    // last fetch succeeded but Binance had not finalised the candle yet, the next tick retries.
    function isBehind(market, tf, t, { ignoreThrottle = false } = {}) {
        const h = healthOf(market, tf);
        const expected = expectedLastClose(t, tf);
        if (h.candle_close_time !== null && h.candle_close_time >= expected) return false;
        // Too little history (e.g. a recently listed pair on 1w): it grows only when a new candle closes.
        if (h.last_error?.code === 'insufficient_data' && expected <= h.last_error.until_close) return false;
        const failedRecently = h.last_error && h.last_attempt_at !== null && t - h.last_attempt_at < Math.min(tfSeconds(tf), 300);
        if (!ignoreThrottle && failedRecently) return false;
        return true;
    }

    async function doUpdate(market, tf) {
        const h = healthOf(market, tf);
        h.last_attempt_at = nowSec();
        try {
            const raw = await binance.getKlines(market, tf);
            const t = nowSec();
            const { closed, forming } = splitClosed(normalizeCandles(raw), t, { lastIsCurrent: true });
            const snap = indicators.calculateAll(closed, market, tf, { forming, fetchedAt: t, gaps: countGaps(closed, tf) }, snapshotParams());
            const problems = validateSnapshot(snap, market, tf);
            if (problems.length) {
                const err = new Error(`Snapshot failed validation: ${problems.slice(0, 3).join('; ')}`);
                err.code = 'calculation_failed';
                throw err;
            }
            if (h.candle_close_time !== null && snap.candle_close_time < h.candle_close_time) {
                log.warn(`[Update] ${market}/${tf}: fetched data is older than stored data; keeping stored snapshot`);
                return { updated: false, reason: 'older' };
            }
            await storage.writeSnapshot(market, tf, snap);
            h.candle_close_time = snap.candle_close_time;
            h.last_success_at = nowSec();
            h.last_error = null;
            if (notify.timeframeUpdated) notify.timeframeUpdated(market, tf);
            return { updated: true, candle_close_time: snap.candle_close_time };
        } catch (err) {
            const code = codeOf(err);
            const prev = h.last_error;
            h.last_error = { code, at: nowSec() };
            if (code === 'insufficient_data') {
                // Expected for pairs whose Binance history is shorter than 200 candles: warn once, then
                // wait for the next candle close instead of retrying every few minutes.
                h.last_error.until_close = expectedLastClose(nowSec(), tf);
                if (prev?.code !== 'insufficient_data') {
                    log.warn(`[Update] ${market}/${tf} skipped: ${err.message}; Binance history is too short, retrying after the next ${tf} close`);
                }
            } else {
                log.error(`[Update] ${market}/${tf} failed (${code}): ${err.message}`);
            }
            return { updated: false, error: code };
        }
    }

    // Shadow signal log (calculation config `shadow`): a second model on its own role timeframes,
    // built from the stored snapshots after each published summary and logged apart. The live signal
    // is not touched. Its role timeframes must be among the fetched ones (TIMEFRAME_LIST + roles).
    const shadowLatest = new Map();
    let shadowWarned = null;
    async function runShadow(market) {
        const so = calc ? calc.shadowOptions() : null;
        if (!so) { shadowLatest.delete(market); return; }
        const tfs = [...new Set(Object.values(so.roles))];
        const missing = tfs.filter(tf => !allTfs.includes(tf));
        if (missing.length) {
            const key = missing.join(',');
            if (shadowWarned !== key) log.warn(`[Shadow] role timeframes ${key} are not fetched (add them to TIMEFRAME_LIST); shadow log paused`);
            shadowWarned = key;
            return;
        }
        const snaps = {};
        const closeTimes = {};
        for (const tf of tfs) {
            const { snap } = await readValidSnapshot(market, tf);
            if (!snap) return;
            snaps[tf] = snap;
            closeTimes[tf] = snap.candle_close_time;
        }
        const t = nowSec();
        const inputs = computeInputs(closeTimes, tfs, t);
        const state = {
            ...composeMarketState(market, snaps, so.roles, weightsNow(), stateParams()),
            generated_at: t, inputs, status: summaryStatus(inputs, tfs, so.roles.entry),
        };
        state.signal = computeSignal(state, so.roles.htf, so.signal);
        shadowLatest.set(market, {
            model: so.signal.model, roles: so.roles, generated_at: t, status: state.status, price: state.price,
            signal: { action: state.signal.action, score: state.signal.score, filters: state.signal.filters, plan: state.signal.plan },
        });
        await shadowLog.onSummary(market, state, snaps[so.roles.entry].candles);
    }

    // At most one update per (market, timeframe); concurrent callers share the running update.
    function updateTimeframe(market, tf) {
        const key = `${market}|${tf}`;
        if (inflight.has(key)) return inflight.get(key);
        const p = doUpdate(market, tf).finally(() => inflight.delete(key));
        inflight.set(key, p);
        return p;
    }

    // Recomputes a stored snapshot from its own candles with the current indicator and zone settings
    // (no Binance request). On failure the stored snapshot stays.
    async function doRecalculate(market, tf) {
        const { snap } = await readValidSnapshot(market, tf);
        if (!snap) return { recalculated: false, reason: 'no_snapshot' };
        try {
            const next = indicators.calculateAll(snap.candles, market, tf, { forming: snap.forming_candle, fetchedAt: snap.fetched_at, gaps: snap.gaps }, snapshotParams());
            const problems = validateSnapshot(next, market, tf);
            if (problems.length) throw new Error(`failed validation: ${problems.slice(0, 3).join('; ')}`);
            await storage.writeSnapshot(market, tf, next);
        } catch (err) {
            log.warn(`[CalcConfig] ${market}/${tf}: recalculation failed (${err.message}); keeping the stored snapshot`);
            return { recalculated: false, reason: codeOf(err) };
        }
        if (notify.timeframeUpdated) notify.timeframeUpdated(market, tf);
        return { recalculated: true };
    }

    // Runs after any update or recalculation of the same (market, timeframe) already in flight.
    function recalculateTimeframe(market, tf) {
        const key = `${market}|${tf}`;
        const prev = inflight.get(key) || Promise.resolve();
        const p = prev.catch(() => {}).then(() => doRecalculate(market, tf)).finally(() => {
            if (inflight.get(key) === p) inflight.delete(key);
        });
        inflight.set(key, p);
        return p;
    }

    // After an `indicators` / `zones` config change: every stored snapshot, then every summary.
    async function recalculateAll() {
        const results = {};
        for (const m of markets) {
            const outcomes = await Promise.all(allTfs.map(tf => recalculateTimeframe(m, tf)));
            results[m] = { recalculated: allTfs.filter((tf, i) => outcomes[i].recalculated) };
            await rebuildSummary(m);
        }
        return results;
    }

    // Unresolved error codes relevant to a market's summary.
    function currentErrors(market) {
        const codes = new Set();
        for (const tf of roleTfs) {
            const h = healthOf(market, tf);
            if (h.last_error && (h.last_success_at === null || h.last_error.at >= h.last_success_at)) codes.add(h.last_error.code);
        }
        const se = summaryErrors.get(market);
        if (se) codes.add(se.code);
        const cooldown = binance.cooldownState && binance.cooldownState();
        if (cooldown) codes.add(cooldown.code);
        return [...codes].filter(c => ERROR_CODES.includes(c)).sort();
    }

    async function buildSummary(market) {
        const t = nowSec();
        const snaps = {};
        const closeTimes = {};
        for (const tf of roleTfs) {
            const { snap } = await readValidSnapshot(market, tf);
            if (snap) {
                snaps[tf] = snap;
                closeTimes[tf] = snap.candle_close_time;
            } else {
                // The file went missing or bad after it was indexed: make the timeframe refetchable.
                healthOf(market, tf).candle_close_time = null;
            }
        }
        const inputs = computeInputs(closeTimes, roleTfs, t);
        if (roleTfs.some(tf => !snaps[tf])) {
            summaryErrors.set(market, { code: 'missing_input', at: t });
            return { published: false, reason: 'missing_input' };
        }

        let enhanced;
        try {
            enhanced = composeMarketState(market, snaps, roles, weightsNow(), stateParams());
        } catch (err) {
            summaryErrors.set(market, { code: 'calculation_failed', at: t });
            log.error(`[MTF] ${market}: summary calculation failed: ${err.message}`);
            return { published: false, reason: 'calculation_failed' };
        }

        summaryErrors.delete(market);
        const summary = {
            schema_version: SCHEMA_VERSION,
            ...enhanced,
            generated_at: t,
            inputs,
            status: summaryStatus(inputs, roleTfs, entryTf),
            errors: currentErrors(market),
        };
        summary.signal = signalOf(summary);

        const problems = validateMarketState(summary);
        if (problems.length) {
            summaryErrors.set(market, { code: 'invalid_summary', at: t });
            log.error(`[MTF] ${market}: summary failed validation, not published: ${problems.slice(0, 3).join('; ')}`);
            return { published: false, reason: 'invalid_summary' };
        }

        const existing = (await storage.readMarketSnapshotResult(market)).data;
        const existingEntryClose = isUsableStored(existing, market) ? existing.inputs[entryTf].candle_close_time : null;
        if (Number.isFinite(existingEntryClose) && existingEntryClose > inputs[entryTf].candle_close_time) {
            log.warn(`[MTF] ${market}: stored summary is newer; not overwriting`);
            return { published: false, reason: 'older' };
        }

        try {
            await storage.writeMarketSnapshot(market, summary);
        } catch (err) {
            summaryErrors.set(market, { code: 'storage_failed', at: t });
            log.error(`[MTF] ${market}: ${err.message}`);
            return { published: false, reason: 'storage_failed' };
        }
        if (signalLog) {
            // Logging must never block publishing the Market State.
            try {
                await signalLog.onSummary(market, summary, snaps[entryTf].candles);
            } catch (err) {
                log.error(`[SignalLog] ${market}: ${err.message}`);
            }
        }
        if (shadowLog) {
            try {
                await runShadow(market);
            } catch (err) {
                log.error(`[Shadow] ${market}: ${err.message}`);
            }
        }
        if (notify.summaryUpdated) notify.summaryUpdated(market);
        return { published: true, status: summary.status };
    }

    // Summary builds for one market run one after another, never concurrently. A request made while
    // a build is already waiting to start shares that build, so the queue never exceeds one.
    function rebuildSummary(market) {
        if (queuedBuilds.has(market)) return queuedBuilds.get(market);
        const prev = summaryChains.get(market) || Promise.resolve();
        const p = prev.catch(() => {}).then(() => {
            queuedBuilds.delete(market);
            return buildSummary(market);
        });
        queuedBuilds.set(market, p);
        summaryChains.set(market, p);
        p.finally(() => {
            if (summaryChains.get(market) === p) summaryChains.delete(market);
        }).catch(() => {});
        return p;
    }

    // Boundary tick: update every timeframe whose candle closed at `boundarySec` (plus any that are
    // behind), then rebuild the summary once.
    async function runBoundary(boundarySec) {
        const t = nowSec();
        await Promise.all(markets.map(async (m) => {
            const due = allTfs.filter(tf => isBoundary(boundarySec, tf) || isBehind(m, tf, t));
            if (due.length === 0) return;
            await Promise.allSettled(due.map(tf => updateTimeframe(m, tf)));
            if (due.some(tf => roleTfs.includes(tf))) await rebuildSummary(m);
        }));
    }

    // Startup / reconnect / reset path. `force` refetches every timeframe.
    async function refreshStale({ force = false } = {}) {
        const results = {};
        for (const m of markets) {
            const t = nowSec();
            const due = force ? allTfs : allTfs.filter(tf => isBehind(m, tf, t, { ignoreThrottle: true }));
            const outcomes = await Promise.all(due.map(tf => updateTimeframe(m, tf)));
            const r = await rebuildSummary(m);
            results[m] = {
                refreshed: due.filter((tf, i) => !outcomes[i].error),
                failed: due.flatMap((tf, i) => (outcomes[i].error ? [{ timeframe: tf, error: outcomes[i].error }] : [])),
                summary: r.published ? r.status : `not_published:${r.reason}`,
            };
        }
        return results;
    }

    async function initialize() {
        await storage.ensureDirs();
        await storage.cleanupTempFiles();
        await loadIndex();
        for (const [name, l] of [['SignalLog', signalLog], ['Shadow', shadowLog]]) {
            if (!l) continue;
            try {
                await l.load(markets);
            } catch (err) {
                log.error(`[${name}] load failed: ${err.message}`);
            }
        }
        return refreshStale();
    }

    // Returns { run } or { error: 'reset_in_progress' | 'reset_cooldown', retryAfter }.
    function reset() {
        if (resetPromise) return { error: 'reset_in_progress' };
        const t = nowSec();
        if (lastResetAt !== null && t - lastResetAt < RESET_COOLDOWN_S) {
            return { error: 'reset_cooldown', retryAfter: RESET_COOLDOWN_S - (t - lastResetAt) };
        }
        lastResetAt = t;
        resetPromise = refreshStale({ force: true }).finally(() => { resetPromise = null; });
        return { run: resetPromise };
    }

    function unavailableBody(market) {
        const closeTimes = {};
        for (const tf of roleTfs) closeTimes[tf] = healthOf(market, tf).candle_close_time ?? undefined;
        const inputs = computeInputs(closeTimes, roleTfs, nowSec());
        const errors = currentErrors(market);
        if (roleTfs.some(tf => inputs[tf].status === 'missing') && !errors.includes('missing_input')) errors.push('missing_input');
        return {
            schema_version: SCHEMA_VERSION,
            market,
            status: 'stale',
            generated_at: null,
            inputs,
            errors: errors.sort(),
            error: 'market_state_unavailable',
        };
    }

    function isUsableStored(s, market) {
        return Boolean(s) && validateMarketState(s).length === 0
            && s.market === market
            && s.timeframe_list.length === roleTfs.length
            && roleTfs.every(tf => s.timeframe_list.includes(tf))
            && roleTfs.every(tf => s.inputs[tf].candle_close_time <= nowSec() + FUTURE_TOLERANCE_S);
    }

    // Serves the stored summary with status, ages and errors recomputed at request time, so an old
    // file is reported as stale even if no update has run since.
    async function getMarketState(market) {
        let stored = (await storage.readMarketSnapshotResult(market)).data;
        if (!isUsableStored(stored, market)) {
            await rebuildSummary(market);
            stored = (await storage.readMarketSnapshotResult(market)).data;
        }
        if (!isUsableStored(stored, market)) {
            return { httpStatus: 503, body: unavailableBody(market) };
        }
        const closeTimes = {};
        for (const tf of roleTfs) closeTimes[tf] = stored.inputs[tf]?.candle_close_time ?? undefined;
        const inputs = computeInputs(closeTimes, roleTfs, nowSec());
        return {
            httpStatus: 200,
            body: withSignal({ ...stored, inputs, status: summaryStatus(inputs, roleTfs, entryTf), errors: currentErrors(market) }),
        };
    }

    // The signal depends on the status, which is recomputed on every read, so it is recomputed too.
    function withSignal(state) {
        return { ...state, signal: signalOf(state) };
    }

    async function getTimeframeSnapshot(market, tf) {
        let { snap } = await readValidSnapshot(market, tf);
        if (!snap && isBehind(market, tf, nowSec())) {
            await updateTimeframe(market, tf);
            ({ snap } = await readValidSnapshot(market, tf));
        }
        if (!snap) {
            const h = healthOf(market, tf);
            return { httpStatus: 503, body: { market, timeframe: tf, status: 'missing', error: 'snapshot_unavailable', errors: h.last_error ? [h.last_error.code] : [] } };
        }
        const f = inputStatus(snap.candle_close_time, tf, nowSec());
        return { httpStatus: 200, body: { ...snap, status: f.status, age_seconds: f.age_seconds } };
    }

    // Logged signals with outcomes and per-result counts, or null when logging is off.
    // `source` 'shadow' reads the shadow log and adds the shadow model, roles and latest signal.
    async function signalRecords(market, source = 'live') {
        const l = source === 'shadow' ? shadowLog : signalLog;
        if (!l) return null;
        const records = await l.records(market);
        const stats = { total: records.length, open: 0, WIN: 0, LOSS: 0, EXPIRED: 0, UNKNOWN: 0 };
        for (const r of records) {
            if (r.result === null) stats.open++;
            else stats[r.result] = (stats[r.result] || 0) + 1;
        }
        if (source !== 'shadow') return { market, stats, records };
        const so = calc ? calc.shadowOptions() : null;
        return {
            market, source, enabled: Boolean(so), model: so?.signal.model ?? null, roles: so?.roles ?? null,
            latest: shadowLatest.get(market) ?? null, stats, records,
        };
    }

    function healthReport() {
        const report = {};
        for (const m of markets) {
            report[m] = {};
            for (const tf of allTfs) report[m][tf] = { ...healthOf(m, tf) };
        }
        const cooldown = binance.cooldownState && binance.cooldownState();
        return {
            now: nowSec(),
            binance: {
                cooldown: cooldown ? { code: cooldown.code, until: Math.ceil(cooldown.until / 1000) } : null,
                stream: binance.stream ? { ...binance.stream } : null,
            },
            markets: report,
        };
    }

    return {
        isMarket,
        isTimeframe,
        initialize,
        updateTimeframe,
        rebuildSummary,
        recalculateAll,
        runBoundary,
        refreshStale,
        reset,
        getMarketState,
        getTimeframeSnapshot,
        healthReport,
        signalRecords,
        timeframes: allTfs,
        roleTimeframes: roleTfs,
    };
}

module.exports = { createMarketEngine, enhanceMarketState, mergeSnapshots, composeMarketState, trendOf, MARKET_DEFAULTS };
