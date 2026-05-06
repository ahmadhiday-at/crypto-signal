const { SMA, RSI, MACD, ATR } = require('technicalindicators');
const fs = require('fs').promises;

class IndicatorService {
    calculateAll(klines, market, timeframe) {
        try {
            if (!klines || klines.length < 200) {
                throw new Error('Insufficient data for indicator calculation (need at least 200 candles)');
            }

            const closes = klines.map(k => k.close);
            const highs = klines.map(k => k.high);
            const lows = klines.map(k => k.low);
            const volumes = klines.map(k => k.volume);

            const ma14 = SMA.calculate({ period: 14, values: closes });
            const ma50 = SMA.calculate({ period: 50, values: closes });
            const ma200 = SMA.calculate({ period: 200, values: closes });
            const rsi = RSI.calculate({ period: 14, values: closes });
            const macdResult = MACD.calculate({
                values: closes,
                fastPeriod: 12,
                slowPeriod: 26,
                signalPeriod: 9,
            });
            const atr = ATR.calculate({ high: highs, low: lows, close: closes, period: 14 });

            const mappingStr = process.env.MAPPING_CANDLE || "";
            const mapping = Object.fromEntries(mappingStr.split(',').map(pair => pair.split(':')));
            const baseCandles = mapping[timeframe] ? parseInt(mapping[timeframe]) : 200;
            
            const currentPrice = closes[closes.length - 1];
            const currentAtr = atr[atr.length - 1];
            const volatility = currentAtr / currentPrice;
            const allVolatilities = atr.map((val, idx) => val / closes[idx]);
            const avgVolatility = allVolatilities.reduce((a, b) => a + b, 0) / allVolatilities.length;

            let adjustedCount = baseCandles;
            if (volatility > avgVolatility * 1.2) {
                adjustedCount = Math.round(baseCandles * 1.2);
            } else if (volatility < avgVolatility * 0.8) {
                adjustedCount = Math.round(baseCandles * 0.8);
            }

            const levels = this.calculateSRLevels(
                klines, 
                currentPrice, 
                currentAtr, 
                ma50[ma50.length - 1], 
                ma200[ma200.length - 1], 
                adjustedCount
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

            const interpretation = this.interpretMarket({
                price: currentPrice,
                support: levels.support,
                resistance: levels.resistance,
                indicators: indicators
            });

            return {
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
                timestamp: klines[klines.length - 1].time,
                candles: klines,
                indicators: indicators
            };
        } catch (err) {
            console.error('Indicator Calculation Error:', err.message);
            throw err;
        }
    }

    interpretMarket(data) {
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

        if (rsi > 60 && macdHist > 0) {
            momentum = "bullish";
        } else if (rsi < 40 && macdHist < 0) {
            momentum = "bearish";
        }

        const ma14Arr = indicators?.ma14 || [];
        const ma50Arr = indicators?.ma50 || [];
        const ma14 = ma14Arr.length > 0 ? ma14Arr[ma14Arr.length - 1] : null;
        const ma50 = ma50Arr.length > 0 ? ma50Arr[ma50Arr.length - 1] : null;

        if (ma14 && ma50) {
            const distance = Math.abs(ma14 - ma50) / price;
            if (distance < 0.01) {
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

    calculateSRLevels(klines, price, atr, ma50, ma200, lookbackPeriod) {
        try {
            const MAX_LEVELS = 3;
            const CLUSTER_TOLERANCE = 0.005;
            const ATR_MULTIPLIER = 0.5;

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
                score += z.touches * 2;
                let lastTouchIdx = 100;
                for (let i = klines.length - 1; i >= 0; i--) {
                    if (klines[i].low <= z.high && klines[i].high >= z.low) {
                        lastTouchIdx = klines.length - i;
                        break;
                    }
                }
                score += Math.max(0, 50 - lastTouchIdx);
                const distance = Math.abs(z.mid - price) / price;
                score -= distance * 10;
                if (ma50 && Math.abs(z.mid - ma50) / z.mid < 0.01) score += 1;
                if (ma200 && Math.abs(z.mid - ma200) / z.mid < 0.01) score += 1;
                z.score = Math.round(score * 10) / 10;
            });

            let support = zones.filter(z => z.mid < price).sort((a, b) => b.score - a.score);
            let resistance = zones.filter(z => z.mid > price).sort((a, b) => b.score - a.score);

            if (support.length === 0) {
                const fallbackLow = Math.min(...klines.slice(-100).map(k => k.low));
                support.push({ low: fallbackLow, high: fallbackLow, mid: fallbackLow, score: 1 });
            }
            if (resistance.length === 0) {
                const fallbackHigh = Math.max(...klines.slice(-100).map(k => k.high));
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
