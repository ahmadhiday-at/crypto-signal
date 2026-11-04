// Full chart of one timeframe. URL: /:market/:timeframe (src/api/routes/view.routes.js).
(function () {
    const { esc, price: fmtPrice, num, isNum } = Fmt;
    const $ = (id) => document.getElementById(id);

    const parts = location.pathname.split('/').filter(Boolean).map(decodeURIComponent);
    const market = parts[parts.length - 2] || '';
    const tf = parts[parts.length - 1] || '';
    let livePrice = null;

    function setTitle() {
        document.title = `${livePrice === null ? '' : `${fmtPrice(livePrice)} · `}${market} ${tf} | Crypto Signal`;
    }

    function showProblem(text) {
        const el = $('chart-status');
        el.textContent = text;
        el.className = 't-meta warn';
    }

    function renderLevels(levels) {
        const chip = (z, name, cls) => `<span class="trend ${cls}" title="Score ${esc(num(z.score, 1))}">${name} ${esc(fmtPrice(z.mid))}</span>`;
        $('levels').innerHTML = [
            ...(levels?.resistance || []).map((z, i) => chip(z, `R${i + 1}`, 'down')),
            ...(levels?.support || []).map((z, i) => chip(z, `S${i + 1}`, 'up')),
        ].join('');
    }

    function copyValues(data) {
        const last = (arr) => (Array.isArray(arr) ? arr[arr.length - 1] ?? null : null);
        const ind = data.indicators || {};
        return JSON.stringify({
            market, timeframe: tf, price: livePrice ?? data.price, context: data.context, momentum: data.momentum, regime: data.regime,
            ohlcv: { ...last(data.candles), volume: last(ind.volume) },
            indicators: { ma14: last(ind.ma14), ma50: last(ind.ma50), ma200: last(ind.ma200), rsi: last(ind.rsi), macd: last(ind.macd) },
            levels: data.levels, timestamp: data.timestamp,
        }, null, 2);
    }

    async function init() {
        setTitle();
        const config = (await AppHeader.init({ market, chartTf: tf })) || { markets: [], timeframes: [] };

        // A symbol or timeframe outside the server config: say so instead of loading charts.
        const markets = config.markets.map((m) => m.code);
        const tfs = config.timeframes.map((t) => t.code);
        const problems = [];
        if (!markets.includes(market)) problems.push(`${market} is not in the market list (engine.markets). Available: ${markets.join(', ') || 'none'}.`);
        if (!tfs.includes(tf)) problems.push(`${tf} is not a configured timeframe. Available: ${tfs.join(', ') || 'none'}.`);

        $('tf-selector').innerHTML = config.timeframes.map((t) => `<button type="button" data-tf="${esc(t.code)}" title="${esc(t.label)}" aria-pressed="${t.code === tf}">${esc(t.code)}</button>`).join('');
        $('tf-selector').addEventListener('click', (ev) => {
            const next = ev.target.closest('[data-tf]')?.dataset.tf;
            if (next) window.location.pathname = `/${encodeURIComponent(market)}/${encodeURIComponent(next)}`;
        });
        if (problems.length) { showProblem(problems.join(' ')); return; }
        AppHeader.setChartTf(tf);

        const chart = PaneChart.create($('chart'), {
            market,
            onStatus: (text, level) => { const el = $('chart-status'); el.textContent = text; el.className = `t-meta ${level === 'ok' ? 'muted' : 'neg'}`; },
        });
        const apply = (data) => {
            if (!data) return;
            chart.setLevels(data.levels);
            renderLevels(data.levels);
        };
        apply(await chart.load(tf));
        const last = chart.lastClosed();
        const first = chart.snapshot()?.forming_candle?.close ?? last?.close;
        if (isNum(first)) { livePrice = first; $('price').textContent = fmtPrice(first); setTitle(); }

        $('copy').addEventListener('click', () => {
            const data = chart.snapshot();
            if (data) AppHeader.copy(copyValues(data), 'Data copied');
        });

        AppHeader.live({
            market,
            timeframe: tf,
            onState: (on) => AppHeader.setConn($('conn'), on),
            onMessage: (msg) => {
                if (msg.type === 'price' && isNum(msg.price)) {
                    const el = $('price');
                    el.classList.toggle('pos', msg.price > livePrice);
                    el.classList.toggle('neg', msg.price < livePrice);
                    livePrice = msg.price;
                    el.textContent = fmtPrice(msg.price);
                    chart.setLivePrice(msg.price);
                    setTitle();
                } else if (msg.type === 'update_ready' && msg.market === market && msg.timeframe === tf) {
                    chart.load(tf, { keepRange: true }).then(apply);
                }
            },
        });
    }

    init();
})();
