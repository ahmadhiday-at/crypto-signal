const { SMA, RSI, MACD, ATR } = require('technicalindicators');

class CalculationError extends Error {
    constructor(code, message) {
        super(message);
        this.name = 'CalculationError';
        this.code = code;
    }
}

const lastOf = (arr) => (Array.isArray(arr) && arr.length > 0 ? arr[arr.length - 1] : undefined);

// S/R lookback candles for a timeframe missing from the calculation config's `lookback` group.
const LOOKBACK_DEFAULT = 200;

// Defaults of the calculation config's `indicators` and `zones` groups (config/calculation.json).
// The snapshot keeps the field names ma14 / ma50 / ma200 whatever the configured periods are.
const INDICATOR_DEFAULTS = {
    ma_fast: 14, ma_mid: 50, ma_slow: 200, rsi_period: 14, macd_fast: 12, macd_slow: 26, macd_signal: 9, atr_period: 14,
    min_candles: 200, rsi_bullish: 60, rsi_bearish: 40, regime_ma_percent: 1,
};
const ZONE_DEFAULTS = {
    cluster_percent: 0.5, width_atr: 0.5, touch_points: 2, recency_candles: 50, distance_penalty: 10,
    ma_bonus: 1, ma_proximity_percent: 1, fallback_candles: 100, lookback_volatility_band: 0.2, lookback_scale: 0.2,
};

class IndicatorService {
    // `klines` must contain closed candles only, sorted and deduplicated. The forming candle is
    // carried through for chart display only (`meta.forming`) and never enters a calculation.
    // `params` holds the calculation config's `indicators`, `zones` and `lookback` groups (defaults above).
    calculateAll(klines, market, timeframe, meta = {}, params = {}) {
        const ind = { ...INDICATOR_DEFAULTS, ...params.indicators };
        const zoneParams = { ...ZONE_DEFAULTS, ...params.zones };
        try {
            if (!klines || klines.length < ind.min_candles) {
                throw new CalculationError('insufficient_data', `Insufficient data for indicator calculation (${klines ? klines.length : 0} closed candles, need at least ${ind.min_candles})`);
            }

            const closes = klines.map(k => k.close);
            const highs = klines.map(k => k.high);
            const lows = klines.map(k => k.low);
            const volumes = klines.map(k => k.volume);

            const ma14 = SMA.calculate({ period: ind.ma_fast, values: closes });
            const ma50 = SMA.calculate({ period: ind.ma_mid, values: closes });
            const ma200 = SMA.calculate({ period: ind.ma_slow, values: closes });
            const rsi = RSI.calculate({ period: ind.rsi_period, values: closes });
            const macdResult = MACD.calculate({
                values: closes,
                fastPeriod: ind.macd_fast,
                slowPeriod: ind.macd_slow,
                signalPeriod: ind.macd_signal,
            });
            const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: ind.atr_period });

            // S/R lookback of this timeframe (config `lookback`, was MAPPING_CANDLE).
            const baseCandles = params.lookback?.[timeframe] ?? LOOKBACK_DEFAULT;
            
            const currentPrice = closes[closes.length - 1];
            const currentAtr = atr[atr.length - 1];
            const volatility = currentAtr / currentPrice;
            const allVolatilities = atr.map((val, idx) => val / closes[idx]);
            const avgVolatility = allVolatilities.reduce((a, b) => a + b, 0) / allVolatilities.length;

            // The S/R lookback widens in volatile markets and narrows in quiet ones.
            const band = zoneParams.lookback_volatility_band;
            let adjustedCount = baseCandles;
            if (volatility > avgVolatility * (1 + band)) {
                adjustedCount = Math.round(baseCandles * (1 + zoneParams.lookback_scale));
            } else if (volatility < avgVolatility * (1 - band)) {
                adjustedCount = Math.round(baseCandles * (1 - zoneParams.lookback_scale));
            }

            const levels = this.calculateSRLevels(
                klines, 
                currentPrice, 
                currentAtr, 
                ma50[ma50.length - 1], 
                ma200[ma200.length - 1], 
                adjustedCount,
                zoneParams
            );

            const indicators = {
                ma14: this.alignData(closes, ma14),
                ma50: this.alignData(closes, ma50),
                ma200: this.alignData(closes, ma200),
                rsi: this.alignData(closes, rsi),
                macd: this.alignData(closes, macdResult),
                atr: this.alignData(closes, atr),
                volume: volumes
            };

            const latest = [lastOf(ma14), lastOf(ma50), lastOf(ma200), lastOf(rsi), lastOf(atr),
                lastOf(macdResult)?.MACD, lastOf(macdResult)?.signal, lastOf(macdResult)?.histogram, currentPrice];
            if (!latest.every(v => typeof v === 'number' && Number.isFinite(v))) {
                throw new CalculationError('calculation_failed', 'Indicator calculation produced non-finite values');
            }
            if (levels.support.length === 0 || levels.resistance.length === 0) {
                throw new CalculationError('calculation_failed', 'Support/resistance calculation produced no levels');
            }

            const interpretation = this.interpretMarket({
                price: currentPrice,
                support: levels.support,
                resistance: levels.resistance,
                indicators: indicators
            }, ind);

            const lastCandle = klines[klines.length - 1];
            return {
                candle_close_time: lastCandle.close_time,
                fetched_at: meta.fetchedAt ?? null,
                gaps: meta.gaps ?? 0,
                forming_candle: meta.forming || null,
                price: currentPrice,
                context: interpretation.context,
                momentum: interpretation.momentum,
                regime: interpretation.regime,
                levels: {
                    support: levels.support,
                    resistance: levels.resistance,
                },
                support: levels.support,
                resistance: levels.resistance,
                market: market,
                timeframe: timeframe,
                timestamp: lastCandle.time,
                candles: klines,
                indicators: indicators
            };
        } catch (err) {
            if (err instanceof CalculationError) throw err;
            throw new CalculationError('calculation_failed', `Indicator calculation failed: ${err.message}`);
        }
    }

    interpretMarket(data, ind = INDICATOR_DEFAULTS) {
        const price = data.price;
        const support = data.support?.[0];
        const resistance = data.resistance?.[0];
        const indicators = data.indicators;

        let context = "unknown";
        let momentum = "neutral";
        let regime = "unknown";

        if (support && price >= support.low && price <= support.high) {
            context = "near_support";
        } else if (resistance && price >= resistance.low && price <= resistance.high) {
            context = "near_resistance";
        } else {
            context = "mid_range";
        }

        const rsiArr = indicators?.rsi || [];
        const rsi = rsiArr.length > 0 ? rsiArr[rsiArr.length - 1] : 50;
        const macdArr = indicators?.macd || [];
        const lastMacd = macdArr.length > 0 ? macdArr[macdArr.length - 1] : {};
        const macdHist = lastMacd?.histogram ?? 0;

        if (rsi > ind.rsi_bullish && macdHist > 0) {
            momentum = "bullish";
        } else if (rsi < ind.rsi_bearish && macdHist < 0) {
            momentum = "bearish";
        }

        const ma14Arr = indicators?.ma14 || [];
        const ma50Arr = indicators?.ma50 || [];
        const ma14 = ma14Arr.length > 0 ? ma14Arr[ma14Arr.length - 1] : null;
        const ma50 = ma50Arr.length > 0 ? ma50Arr[ma50Arr.length - 1] : null;

        if (ma14 && ma50) {
            const distance = Math.abs(ma14 - ma50) / price;
            if (distance < ind.regime_ma_percent / 100) {
                regime = "ranging";
            } else {
                regime = "trending";
            }
        }

        return { context, momentum, regime };
    }

    alignData(base, values) {
        if (!values) return Array(base.length).fill(null);
        const diff = base.length - values.length;
        return Array(diff).fill(null).concat(values);
    }

    calculateSRLevels(klines, price, atr, ma50, ma200, lookbackPeriod, zp = ZONE_DEFAULTS) {
        try {
            // At most 3 levels per side: the Market State contract allows 1–3.
            const MAX_LEVELS = 3;
            const CLUSTER_TOLERANCE = zp.cluster_percent / 100;
            const ATR_MULTIPLIER = zp.width_atr;
            const maProximity = zp.ma_proximity_percent / 100;

            const swings = [];
            const startIdx = Math.max(1, klines.length - lookbackPeriod);
            for (let i = startIdx; i < klines.length - 1; i++) {
                if (klines[i].high > klines[i-1].high && klines[i].high > klines[i+1].high) {
                    swings.push(klines[i].high);
                }
                if (klines[i].low < klines[i-1].low && klines[i].low < klines[i+1].low) {
                    swings.push(klines[i].low);
                }
            }

            const sortedSwings = swings.sort((a, b) => a - b);
            const clusters = [];
            for (const lvl of sortedSwings) {
                let placed = false;
                for (const cluster of clusters) {
                    if (Math.abs(cluster.mid - lvl) / lvl < CLUSTER_TOLERANCE) {
                        cluster.values.push(lvl);
                        cluster.mid = cluster.values.reduce((a, b) => a + b, 0) / cluster.values.length;
                        placed = true;
                        break;
                    }
                }
                if (!placed) {
                    clusters.push({ mid: lvl, values: [lvl] });
                }
            }

            const zones = clusters.map(c => {
                const width = (atr || price * 0.002) * ATR_MULTIPLIER;
                return {
                    low: c.mid - width,
                    high: c.mid + width,
                    mid: c.mid,
                    touches: c.values.length
                };
            });

            zones.forEach(z => {
                let score = 0;
                score += z.touches * zp.touch_points;
                // Candles since the zone was last touched; never touched → no recency bonus.
                let lastTouchIdx = Infinity;
                for (let i = klines.length - 1; i >= 0; i--) {
                    if (klines[i].low <= z.high && klines[i].high >= z.low) {
                        lastTouchIdx = klines.length - i;
                        break;
                    }
                }
                score += Math.max(0, zp.recency_candles - lastTouchIdx);
                const distance = Math.abs(z.mid - price) / price;
                score -= distance * zp.distance_penalty;
                if (ma50 && Math.abs(z.mid - ma50) / z.mid < maProximity) score += zp.ma_bonus;
                if (ma200 && Math.abs(z.mid - ma200) / z.mid < maProximity) score += zp.ma_bonus;
                z.score = Math.round(score * 10) / 10;
            });

            let support = zones.filter(z => z.mid < price).sort((a, b) => b.score - a.score);
            let resistance = zones.filter(z => z.mid > price).sort((a, b) => b.score - a.score);

            if (support.length === 0) {
                const fallbackLow = Math.min(...klines.slice(-zp.fallback_candles).map(k => k.low));
                support.push({ low: fallbackLow, high: fallbackLow, mid: fallbackLow, score: 1 });
            }
            if (resistance.length === 0) {
                const fallbackHigh = Math.max(...klines.slice(-zp.fallback_candles).map(k => k.high));
                resistance.push({ low: fallbackHigh, high: fallbackHigh, mid: fallbackHigh, score: 1 });
            }

            return { 
                resistance: resistance.slice(0, MAX_LEVELS), 
                support: support.slice(0, MAX_LEVELS) 
            };
        } catch (err) {
            console.error('S/R Engine Error:', err);
            return { resistance: [], support: [] };
        }
    }
}

module.exports = new IndicatorService();
module.exports.CalculationError = CalculationError;
module.exports.INDICATOR_DEFAULTS = INDICATOR_DEFAULTS;
module.exports.ZONE_DEFAULTS = ZONE_DEFAULTS;
