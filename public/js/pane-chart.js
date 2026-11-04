// Candles, volume, MACD and RSI in four synced panes, used by the Market and Chart pages. Closed candles
// come from the server; the forming candle is grey, is the only bar live prices move, and never enters
// a calculation.
(function () {
    const { isNum, num, price: fmtPrice, signed, signedPct, vol: fmtVol, utc } = Fmt;
    const UP = '#16c784';
    const DOWN = '#ff4d6d';
    const FORMING = '#6b7280';
    const PANES = ['main', 'vol', 'macd', 'rsi'];

    const legendItem = (k, v, color) => `<span class="k">${k}</span><span class="v" style="color:${color || '#d6dae3'}">${v}</span>`;

    // Builds the panes inside `root`. Returns { load(tf), setLevels(levels), setPlan(plan), setLivePrice(p), snapshot() }.
    // `onStatus(text, level)` reports what the chart shows ('ok' or 'bad').
    function create(root, { market, onStatus = () => {} }) {
        root.classList.add('chart-panes');
        root.innerHTML = PANES.map((n) => `<div class="pane ${n === 'main' ? 'pane-main' : 'pane-sub'}"><div class="pane-chart" data-pane="${n}"></div><div class="legend" data-legend="${n}"></div></div>`).join('');
        const paneEl = (n) => root.querySelector(`[data-pane="${n}"]`);
        const legendEl = (n) => root.querySelector(`[data-legend="${n}"]`);

        const s = { tf: null, data: null, times: [], lastClosedIdx: -1, forming: null, levelLines: [], planLines: [] };
        const base = {
            layout: { background: { color: 'transparent' }, textColor: '#8d96a7', fontSize: 11, fontFamily: "'JetBrains Mono', monospace" },
            grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
            crosshair: { mode: LightweightCharts.CrosshairMode.Normal },
            rightPriceScale: { borderVisible: false, minimumWidth: 80 },
            timeScale: { timeVisible: true, secondsVisible: false, rightOffset: 5, borderVisible: false, visible: false },
        };
        const charts = {};
        for (const n of PANES) {
            const el = paneEl(n);
            charts[n] = LightweightCharts.createChart(el, {
                ...base, width: el.clientWidth, height: el.clientHeight,
                localization: { priceFormatter: n === 'main' ? fmtPrice : num },
                timeScale: { ...base.timeScale, visible: n === 'rsi' },
            });
        }
        const sub = { type: 'custom', formatter: (v) => num(v), minMove: 0.01 };
        const flat = { lastValueVisible: false, priceLineVisible: false };
        const series = {
            candles: charts.main.addCandlestickSeries({ upColor: UP, downColor: DOWN, borderVisible: false, wickUpColor: UP, wickDownColor: DOWN }),
            ma14: charts.main.addLineSeries({ color: '#4fc3f7', lineWidth: 1, ...flat }),
            ma50: charts.main.addLineSeries({ color: '#ba68c8', lineWidth: 2, ...flat }),
            ma200: charts.main.addLineSeries({ color: '#e5e7eb', lineWidth: 2, ...flat }),
            vol: charts.vol.addHistogramSeries({ priceFormat: { type: 'custom', formatter: fmtVol, minMove: 0.01 }, ...flat }),
            macdHist: charts.macd.addHistogramSeries({ priceFormat: sub, ...flat }),
            macdLine: charts.macd.addLineSeries({ color: '#4c7dff', lineWidth: 2, priceFormat: sub, priceLineVisible: false }),
            macdSig: charts.macd.addLineSeries({ color: '#ff9800', lineWidth: 2, priceFormat: sub, priceLineVisible: false }),
            rsi: charts.rsi.addLineSeries({ color: '#b072d6', lineWidth: 2, priceFormat: sub, priceLineVisible: false }),
        };
        [30, 70].forEach((level) => series.rsi.createPriceLine({ price: level, color: '#4b5563', lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dashed, axisLabelVisible: false }));

        // Labels can widen one price scale; give every pane the widest so the bars line up vertically.
        let alignQueued = false;
        function alignScales() {
            if (alignQueued) return;
            alignQueued = true;
            requestAnimationFrame(() => {
                alignQueued = false;
                const widest = Math.max(...PANES.map((n) => charts[n].priceScale('right').width()));
                PANES.forEach((n) => { if (charts[n].priceScale('right').width() !== widest) charts[n].priceScale('right').applyOptions({ minimumWidth: widest }); });
            });
        }

        function barAt(i) {
            const d = s.data;
            if (!d || i < 0 || i >= s.times.length) return null;
            if (i <= s.lastClosedIdx) {
                const ind = d.indicators || {};
                return { candle: d.candles[i], forming: false, ma14: ind.ma14?.[i], ma50: ind.ma50?.[i], ma200: ind.ma200?.[i], volume: ind.volume?.[i], macd: ind.macd?.[i], rsi: ind.rsi?.[i] };
            }
            return s.forming ? { candle: s.forming, forming: true, volume: s.forming.volume } : null;
        }

        function updateLegends(i) {
            const bar = barAt(i);
            if (!bar) { PANES.forEach((n) => { legendEl(n).innerHTML = ''; }); return; }
            const c = bar.candle;
            const change = c.close - c.open;
            const dir = change >= 0 ? UP : DOWN;
            legendEl('main').innerHTML =
                `<div>${legendItem(utc(c.time) + (bar.forming ? ' forming' : ''), '')}${legendItem('O', fmtPrice(c.open), dir)}${legendItem('H', fmtPrice(c.high), dir)}${legendItem('L', fmtPrice(c.low), dir)}${legendItem('C', fmtPrice(c.close), dir)}${legendItem('', signedPct(change / c.open * 100), dir)}</div>` +
                `<div>${legendItem('MA14', fmtPrice(bar.ma14), '#4fc3f7')}${legendItem('MA50', fmtPrice(bar.ma50), '#ba68c8')}${legendItem('MA200', fmtPrice(bar.ma200), '#e5e7eb')}</div>`;
            legendEl('vol').innerHTML = legendItem('Vol', fmtVol(bar.volume), dir);
            const m = bar.macd || {};
            legendEl('macd').innerHTML = legendItem('MACD', num(m.MACD), '#4c7dff') + legendItem('Signal', num(m.signal), '#ff9800') + legendItem('Hist', num(m.histogram), (m.histogram ?? 0) >= 0 ? UP : DOWN);
            legendEl('rsi').innerHTML = legendItem('RSI', num(bar.rsi), '#b072d6');
        }

        // The pane under the mouse drives range and crosshair; with no mouse over a chart the main pane drives.
        const anchor = { main: series.candles, vol: series.vol, macd: series.macdLine, rsi: series.rsi };
        let activePane = null;
        const isDriver = (n) => (activePane ? activePane === n : n === 'main');
        let syncing = false;
        PANES.forEach((n) => {
            charts[n].timeScale().subscribeVisibleLogicalRangeChange((range) => {
                if (syncing || !range || !isDriver(n)) return;
                syncing = true;
                PANES.forEach((o) => { if (o !== n) charts[o].timeScale().setVisibleLogicalRange(range); });
                syncing = false;
                alignScales();
            });
            const el = paneEl(n);
            el.addEventListener('mouseenter', () => { activePane = n; });
            el.addEventListener('mouseleave', () => {
                if (activePane === n) activePane = null;
                PANES.forEach((o) => charts[o].clearCrosshairPosition());
                updateLegends(s.lastClosedIdx);
            });
            charts[n].subscribeCrosshairMove((param) => {
                if (activePane !== n) return;
                if (!param || param.time === undefined || param.logical === undefined) {
                    PANES.forEach((o) => { if (o !== n) charts[o].clearCrosshairPosition(); });
                    updateLegends(s.lastClosedIdx);
                    return;
                }
                const idx = Math.round(param.logical);
                PANES.forEach((o) => {
                    if (o === n) return;
                    const point = anchor[o].dataByIndex(idx);
                    const value = point && isNum(point.value) ? point.value : point && isNum(point.close) ? point.close : 0;
                    charts[o].setCrosshairPosition(value, param.time, anchor[o]);
                });
                updateLegends(idx);
            });
        });

        const ro = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width, height } = entry.contentRect;
                const chart = charts[entry.target.dataset.pane];
                if (chart && width > 0 && height > 0) chart.resize(Math.floor(width), Math.floor(height));
            }
            alignScales();
        });
        PANES.forEach((n) => ro.observe(paneEl(n)));

        async function load(tf, { keepRange = false } = {}) {
            s.tf = tf;
            let data = null;
            let res = null;
            try {
                res = await fetch(`/api/${encodeURIComponent(market)}/${encodeURIComponent(tf)}`);
                data = await res.json();
            } catch (e) { /* reported below */ }
            if (tf !== s.tf) return null; // a newer choice arrived meanwhile
            if (!res || !res.ok || !data || !Array.isArray(data.candles)) {
                s.data = null;
                onStatus(`${tf}: chart data unavailable (${data?.error || (res ? `HTTP ${res.status}` : 'no connection')})`, 'bad');
                return null;
            }
            s.data = data;
            s.forming = data.forming_candle ? { ...data.forming_candle } : null;
            onStatus(`${tf}: closed candles to ${utc(data.candle_close_time)} UTC (${Fmt.span(data.age_seconds)} ago) · ${String(data.status).toUpperCase()}${s.forming ? ' · grey candle = still forming, not used in calculations' : ''}`, data.status === 'ok' ? 'ok' : 'bad');

            // Every pane gets the same bar times; values that do not exist become whitespace.
            const candles = data.candles;
            s.times = candles.map((c) => c.time).concat(s.forming ? [s.forming.time] : []);
            s.lastClosedIdx = candles.length - 1;
            const ind = data.indicators || {};
            const line = (arr) => s.times.map((time, i) => (i < candles.length && isNum(arr?.[i]) ? { time, value: arr[i] } : { time }));

            const bars = candles.map((c) => ({ time: c.time, open: c.open, high: c.high, low: c.low, close: c.close }));
            if (s.forming) bars.push(formingBar());
            series.candles.setData(bars);
            series.ma14.setData(line(ind.ma14));
            series.ma50.setData(line(ind.ma50));
            series.ma200.setData(line(ind.ma200));

            const vols = candles.map((c, i) => (isNum(ind.volume?.[i]) ? { time: c.time, value: ind.volume[i], color: c.close >= c.open ? `${UP}66` : `${DOWN}66` } : { time: c.time }));
            if (s.forming) vols.push(isNum(s.forming.volume) ? { time: s.forming.time, value: s.forming.volume, color: `${FORMING}66` } : { time: s.forming.time });
            series.vol.setData(vols);

            const macd = ind.macd || [];
            const macdPart = (key) => s.times.map((time, i) => (i < candles.length && isNum(macd[i]?.[key]) ? { time, value: macd[i][key] } : { time }));
            series.macdLine.setData(macdPart('MACD'));
            series.macdSig.setData(macdPart('signal'));
            series.macdHist.setData(macdPart('histogram').map((p) => (isNum(p.value) ? { ...p, color: p.value >= 0 ? `${UP}99` : `${DOWN}99` } : p)));
            series.rsi.setData(line(ind.rsi));

            if (!keepRange) {
                const total = s.times.length;
                const range = { from: Math.max(0, total - 120), to: total + 4 };
                PANES.forEach((n) => charts[n].timeScale().setVisibleLogicalRange(range));
            }
            updateLegends(s.lastClosedIdx);
            alignScales();
            return data;
        }

        function formingBar() {
            const f = s.forming;
            return { time: f.time, open: f.open, high: f.high, low: f.low, close: f.close, color: FORMING, wickColor: FORMING };
        }

        // Live prices only ever move the forming candle.
        function setLivePrice(p) {
            if (!s.forming || !isNum(p)) return;
            s.forming = { ...s.forming, close: p, high: Math.max(s.forming.high, p), low: Math.min(s.forming.low, p) };
            series.candles.update(formingBar());
        }

        const clear = (list) => { list.forEach((l) => series.candles.removePriceLine(l)); list.length = 0; };

        // Support and resistance as thin dotted lines: context, not the first thing to read.
        function setLevels(levels) {
            clear(s.levelLines);
            const draw = (list, prefix, color) => (list || []).forEach((l, i) => s.levelLines.push(series.candles.createPriceLine({
                price: l.mid, color, lineWidth: 1, lineStyle: LightweightCharts.LineStyle.Dotted, axisLabelVisible: false, title: `${prefix}${i + 1}`,
            })));
            draw(levels?.resistance, 'R', `${DOWN}aa`);
            draw(levels?.support, 'S', `${UP}aa`);
        }

        // Keeps the plan lines inside the price scale.
        series.candles.applyOptions({
            autoscaleInfoProvider: (original) => {
                const auto = original();
                if (!auto || !s.planPrices?.length) return auto;
                return { ...auto, priceRange: { minValue: Math.min(auto.priceRange.minValue, ...s.planPrices), maxValue: Math.max(auto.priceRange.maxValue, ...s.planPrices) } };
            },
        });

        // The plan on the chart: { side, entry, stop_loss, take_profit_1, take_profit_2 } or null.
        function setPlan(plan) {
            clear(s.planLines);
            s.planPrices = plan ? [plan.entry, plan.stop_loss, plan.take_profit_1].filter(isNum) : [];
            if (!plan) return;
            const draw = (value, title, color) => {
                if (isNum(value)) s.planLines.push(series.candles.createPriceLine({ price: value, color, lineWidth: 2, lineStyle: LightweightCharts.LineStyle.Solid, axisLabelVisible: true, title }));
            };
            draw(plan.entry, `Entry ${plan.side === 'short' ? 'short' : 'long'}`, '#4c7dff');
            draw(plan.stop_loss, 'Stop', DOWN);
            draw(plan.take_profit_1, 'TP1', UP);
            draw(plan.take_profit_2, 'TP2', UP);
        }

        return { load, setLevels, setPlan, setLivePrice, snapshot: () => s.data, timeframe: () => s.tf, lastClosed: () => s.data?.candles?.[s.data.candles.length - 1] ?? null };
    }

    window.PaneChart = { create };
})();
