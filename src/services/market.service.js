const storage = require('../data/storage');
const binance = require('./binance.service');
const indicators = require('./indicator.service');
const config = require('../config/env');
const wsManager = require('../websocket/ws.manager');

function enhanceMarketState(data) {
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
    const threshold = Math.max(sScore, rScore) * 0.2;
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
        const avgVol = volumes.slice(-20).reduce((a, b) => a + b, 0) / 20;
        volMultiplier = currentVol / (avgVol || 1);
        if (currentVol > avgVol * 1.5) volume_state = "high";
        else if (currentVol > avgVol * 1.2) volume_state = "increasing";
        else if (currentVol < avgVol * 0.8) volume_state = "low";
    }

    let market_energy = "stable";
    const macdHist = data.indicators?.macd?.histogram || 0;
    const absMacd = Math.abs(macdHist);
    if (volume_state === "high" && absMacd > 0.1) market_energy = "explosive";
    else if (volume_state === "increasing" && absMacd > 0.05) market_energy = "building";
    else if (volume_state === "low" || absMacd < 0.02) market_energy = "cooling";

    const minDistance = Math.min(distSupportPct, distResistancePct);
    const distanceFactor = Math.max(0, 1 - (minDistance / 1.0));
    let volumeFactor = 0.5; 
    if (volume_state === "high") volumeFactor = 1.0;
    else if (volume_state === "increasing") volumeFactor = 0.8;
    else if (volume_state === "low") volumeFactor = 0.3;

    let breakout_score = distanceFactor * volumeFactor;
    if (zone_state === "compression") breakout_score += 0.2;
    breakout_score = Math.min(1, +breakout_score.toFixed(2));

    let breakout_confirmation = "none";
    if (breakout_score > 0.7) {
        if (volume_state === "high") breakout_confirmation = "strong";
        else if (volume_state === "increasing") breakout_confirmation = "medium";
        else breakout_confirmation = "weak";
    } else if (breakout_score > 0.4) {
        breakout_confirmation = volume_state === "high" ? "noise" : "weak";
    }

    let setup_state = "no_trade";
    if (zone_state === "compression") {
        setup_state = breakout_score > 0.7 ? "breakout_entry_ready" : "waiting_breakout";
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

async function updateMarketSnapshot(market) {
    try {
        console.log(`[MTF] Generating consolidated market snapshot for ${market}...`);
        const roles = config.TF_ROLES;
        const tfList = Object.values(roles);
        const timeframesState = {};
        let mergedSupport = [];
        let mergedResistance = [];
        let entryData = null;

        for (const tf of tfList) {
            const data = await storage.readSnapshot(market, tf);
            if (!data) {
                console.warn(`[MTF] Missing critical snapshot for ${market}/${tf}. Cannot merge.`);
                return null;
            }
            timeframesState[tf] = { price: data.price, context: data.context, momentum: data.momentum, regime: data.regime, timestamp: data.timestamp };
            if (tf === roles.entry) entryData = data;
            
            let weight = config.TF_WEIGHTS[tf] || config.TF_WEIGHTS['DEFAULT'];
            
            if (data.support) {
                data.support.forEach(lvl => {
                    const weightedScore = Math.round((lvl.score * weight) * 10) / 10;
                    const existing = mergedSupport.find(ms => lvl.mid >= ms.low && lvl.mid <= ms.high);
                    if (existing) {
                        existing.score += weightedScore;
                        if (!existing.tfs?.includes(tf)) {
                            if(!existing.tfs) existing.tfs = [];
                            existing.tfs.push(tf);
                        }
                    } else {
                        mergedSupport.push({ ...lvl, score: weightedScore, tfs: [tf] });
                    }
                });
            }
            if (data.resistance) {
                data.resistance.forEach(lvl => {
                    const weightedScore = Math.round((lvl.score * weight) * 10) / 10;
                    const existing = mergedResistance.find(mr => lvl.mid >= mr.low && lvl.mid <= mr.high);
                    if (existing) {
                        existing.score += weightedScore;
                        if (!existing.tfs?.includes(tf)) {
                            if(!existing.tfs) existing.tfs = [];
                            existing.tfs.push(tf);
                        }
                    } else {
                        mergedResistance.push({ ...lvl, score: weightedScore, tfs: [tf] });
                    }
                });
            }
        }

        if (!entryData) return null;
        const lastIndicators = {};
        if (entryData.indicators) {
            for (const [key, values] of Object.entries(entryData.indicators)) {
                if (Array.isArray(values)) lastIndicators[key] = values[values.length - 1];
                else if (typeof values === 'object' && values !== null) {
                    const macdLast = {};
                    for (const [mKey, mValues] of Object.entries(values)) {
                        macdLast[mKey] = Array.isArray(mValues) ? mValues[mValues.length - 1] : mValues;
                    }
                    lastIndicators[key] = macdLast;
                } else lastIndicators[key] = values;
            }
        }

        const finalDataRaw = {
            market: market,
            timeframe: "multitimeframe",
            timeframe_list: tfList,
            price: entryData.price,
            context: entryData.context,
            momentum: entryData.momentum,
            regime: entryData.regime,
            ohlcv: entryData.candles ? entryData.candles[entryData.candles.length - 1] : null,
            indicators: lastIndicators,
            levels: {
                support: mergedSupport.sort((a, b) => b.score - a.score).slice(0, 3),
                resistance: mergedResistance.sort((a, b) => b.score - a.score).slice(0, 3)
            },
            timestamp: entryData.timestamp,
            timeframes: timeframesState
        };

        const finalData = enhanceMarketState(finalDataRaw);
        await storage.writeMarketSnapshot(market, finalData);
        console.log(`[MTF] Successfully saved market snapshot for ${market}.`);
        return finalData;
    } catch (err) {
        console.error(`[MTF] Critical Error updating market snapshot [${market}]:`, err);
        return null;
    }
}

async function updateMarketData(market, timeframe) {
    try {
        console.log(`[Update] Fetching fresh data for ${market}/${timeframe}...`);
        const klines = await binance.getKlines(market, timeframe);
        const processedData = indicators.calculateAll(klines, market, timeframe);
        await storage.writeSnapshot(market, timeframe, processedData);
        console.log(`[Update] Successfully updated ${market}/${timeframe}. Timestamp: ${processedData.timestamp}`);
        
        wsManager.broadcastUpdate(market, timeframe);
        
        if (timeframe === config.TF_ROLES.entry) {
            await updateMarketSnapshot(market);
        }
    } catch (err) {
        console.error(`Critical Update Error [${market}/${timeframe}]:`, err);
    }
}

async function initializeAllSnapshots() {
    console.log('Initializing system snapshots...');
    const markets = config.MARKETS;
    const timeframes = config.TIMEFRAMES;
    const roles = Object.values(config.TF_ROLES).filter(Boolean);
    const allRequiredTf = [...new Set([...timeframes, ...roles])];

    for (const market of markets) {
        for (const timeframe of allRequiredTf) {
            try {
                const data = await storage.readSnapshot(market, timeframe);
                let needsUpdate = false;
                if (!data) {
                    console.log(`[Init] No data for ${market}/${timeframe}, fetching...`);
                    needsUpdate = true;
                } else {
                    const lastTimestamp = data.timestamp;
                    const currentTime = Math.floor(Date.now() / 1000);
                    let tfSeconds = config.TF_TO_SECONDS[timeframe] || 900; 
                    if (currentTime - lastTimestamp >= tfSeconds) {
                        console.log(`[Init] Data stale for ${market}/${timeframe}, updating...`);
                        needsUpdate = true;
                    }
                }
                if (needsUpdate) await updateMarketData(market, timeframe);
            } catch (err) {
                console.error(`[Init] Error processing ${market}/${timeframe}:`, err);
            }
        }
        await updateMarketSnapshot(market);
    }
    console.log('System snapshots initialization complete.');
}

module.exports = {
    enhanceMarketState,
    updateMarketSnapshot,
    updateMarketData,
    initializeAllSnapshots
};
