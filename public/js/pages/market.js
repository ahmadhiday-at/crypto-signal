// One market for a trader: the signal first, then its plan, size and reasons, next to the chart.
// The server decides the signal; this page only displays it (docs/contract/market-state.md).
(function () {
    const { esc, isNum, num, price: fmtPrice, signed, signedPct, r: fmtR, share, utc, tone } = Fmt;
    const $ = (id) => document.getElementById(id);
    const STORE_ACCOUNT = 'cs.account';
    const STORE_RISK = 'cs.riskPct';

    const s = { market: '', tf: '1h', entryTf: '1h', config: null, chart: null, stateData: null, board: null, livePrice: null };

    const kv = (k, v, cls = '') => `<div class="kv"><span>${esc(k)}</span><span class="${cls}">${v}</span></div>`;
    const signalContext = () => s.config?.signal ?? null;

    function renderStatus(desc, data) {
        const box = $('status');
        box.className = `banner ${{ ok: 'ok', degraded: 'warn', stale: 'neg' }[desc.level] ?? ''}`;
        $('status-title').textContent = desc.title;
        $('status-detail').textContent = desc.detail;
        $('status-errors').textContent = desc.errors.length ? `errors: ${desc.errors.join(', ')}` : '';
        // Anything not fresh is dimmed so it cannot be mistaken for current analysis.
        document.body.classList.toggle('not-current', Boolean(data) && desc.level !== 'ok');
    }

    function renderGauge(score) {
        const threshold = signalContext()?.threshold ?? 5;
        const max = Math.max(10, Math.abs(score));
        const width = Math.abs(score) / max * 50;
        const color = score > 0 ? 'var(--long)' : 'var(--short)';
        const tick = (side) => `<span class="gauge-tick" style="left:${50 + side * threshold / max * 50}%" title="Acts at ±${threshold}"></span>`;
        $('gauge').innerHTML = `<span class="gauge-mid"></span>${tick(-1)}${tick(1)}<span class="gauge-fill" style="background:${color};${score > 0 ? `left:50%;width:${width}%` : `left:${50 - width}%;width:${width}%`}"></span>`;
        $('score').textContent = `${score > 0 ? '+' : ''}${score} / ±${threshold}`;
    }

    // A setup that persists over several candles is one trade in the log, not a new entry each candle.
    function activeText(side) {
        const open = s.board?.open?.find((t) => t.side === side);
        return open ? `Still active. A ${SignalView.sideWord(side)} trade is already open since ${utc(open.opened_at)} UTC.` : `New setup: enter at the next ${s.entryTf} open. Plan below.`;
    }

    function renderSignal(sig, status) {
        const card = $('signal-card');
        const side = sig ? SignalView.sideOfAction(sig.action) : null;
        card.classList.toggle('side-long', side === 'long');
        card.classList.toggle('side-short', side === 'short');
        $('signal-tf').textContent = `· ${s.entryTf} close`;
        $('signal-word').textContent = !sig ? '-' : side ? SignalView.sideWord(side) : 'WAIT';
        const strength = $('signal-strength');
        strength.hidden = !side;
        strength.textContent = sig?.strength ?? '';
        $('signal-why').textContent = !sig ? 'No signal available.'
            : side ? activeText(side)
            : SignalView.waitReason(sig, status, signalContext());
        renderGauge(sig?.score ?? 0);
        renderReasons(sig);
        renderPlan(sig);
    }

    function renderReasons(sig) {
        const rows = (sig?.reasons || []).map((r) => {
            const points = r.points === 0 ? '' : `<span class="${r.points > 0 ? 'pos' : 'neg'}">${r.points > 0 ? '+' : ''}${r.points}</span>`;
            return kv(SignalView.reasonLabel(r.code), points);
        });
        for (const code of sig?.filters || []) rows.push(`<div class="t-data warn" style="padding:3px 0">Blocked: ${esc(SignalView.filterLabel(code, signalContext()))}</div>`);
        if (sig && SignalView.isMixed(sig.reasons)) rows.push('<div class="t-meta muted" style="padding-top:4px">The timeframes disagree, so the points cancel out.</div>');
        $('reasons').innerHTML = rows.join('') || '<div class="empty">No conditions met.</div>';
    }

    // Plan of the current signal, or of a setup a filter holds back (marked as not active).
    function renderPlan(sig) {
        const plan = sig?.plan ?? null;
        const active = Boolean(plan && SignalView.sideOfAction(sig.action));
        const card = $('plan-card');
        card.hidden = !plan;
        card.classList.toggle('dimmed', Boolean(plan && !active));
        if (plan) {
            const c = signalContext();
            const entry = plan.entry_zone?.[0];
            const cost = c ? c.fee_pct + c.slippage_pct : null;
            const n = SignalView.planNumbers(plan, entry, cost);
            $('plan-title').innerHTML = `Trade plan <span class="badge ${plan.side}">${SignalView.sideWord(plan.side)}</span>${active ? '' : ' <span class="t-meta warn">not active</span>'}`;
            const pct = (v) => (isNum(v) ? ` <small>${signedPct(v)}</small>` : '');
            $('plan-rows').innerHTML = [
                kv('Entry (reference)', fmtPrice(entry)),
                kv('Stop loss', `${fmtPrice(plan.stop_loss)}${pct(n?.stop_pct)}`, 'neg'),
                kv(`TP1 (${num(plan.risk_reward)} R)`, `${fmtPrice(plan.take_profit_1)}${pct(n?.tp1_pct)}`, 'pos'),
                isNum(plan.take_profit_2) ? kv(`TP2 (${num(n?.tp2_r)} R)`, `${fmtPrice(plan.take_profit_2)}${pct(n?.tp2_pct)}`, 'pos') : '',
                isNum(plan.trailing_stop) ? kv('Trailing stop', fmtPrice(plan.trailing_stop)) : '',
                isNum(n?.cost_r) ? kv('Cost per trade', `${num(n.cost_r)} R <small>${num(cost)}%</small>`) : '',
            ].join('');
            const expiry = c?.expiry_candles;
            $('plan-note').textContent = `Backtest rule: fill at the next ${s.entryTf} open${expiry ? `, close after ${expiry} candles if neither stop nor TP1 is hit` : ''}. Both in one candle counts as a loss.`;
        }
        updateChartPlan();
        renderSize();
    }

    // The sizing card follows the current plan, else the first open trade.
    function sizingBasis() {
        const plan = s.stateData?.signal?.plan;
        if (plan && SignalView.sideOfAction(s.stateData.signal.action)) return { entry: plan.entry_zone?.[0], stop: plan.stop_loss };
        const open = s.board?.open?.[0];
        return open ? { entry: open.entry, stop: open.stop_loss } : plan ? { entry: plan.entry_zone?.[0], stop: plan.stop_loss } : null;
    }

    function renderSize() {
        const basis = sizingBasis();
        $('size-card').hidden = !basis;
        if (!basis) return;
        const size = SignalView.positionSize(Number($('account').value), Number($('risk-pct').value), basis.entry, basis.stop);
        const base = s.market.replace(/(USDT|USDC|BUSD|USD)$/, '');
        $('size-rows').innerHTML = size ? [
            kv('Risk amount', num(size.risk_amount)),
            kv('Quantity', `${num(size.quantity, size.quantity >= 1 ? 3 : 5)} ${esc(base)}`),
            kv('Position value', num(size.notional)),
            kv('Leverage needed', `${num(size.leverage)}×`, size.leverage > 5 ? 'warn' : ''),
        ].join('') : '<div class="t-meta muted">Fill in your account size and risk per trade.</div>';
    }

    function renderOpen() {
        const trades = s.board?.open ?? [];
        $('open-card').hidden = trades.length === 0;
        $('open-rows').innerHTML = trades.map((t) => {
            const openR = SignalView.openR(t, s.livePrice);
            return `<div>
                <div class="row-between"><span class="badge ${t.side}">${SignalView.sideWord(t.side)}</span><span class="num ${tone(openR)}" title="At the live price, before costs">${fmtR(openR)}</span></div>
                ${kv('Entry', fmtPrice(t.entry))}${kv('Stop', fmtPrice(t.stop_loss), 'neg')}${kv('Target', fmtPrice(t.take_profit_1), 'pos')}
                ${kv('Opened', `${utc(t.opened_at)} UTC`)}${kv('Expires', `${utc(t.expires_at)} UTC`)}
            </div>`;
        }).join('<hr class="divider">');
    }

    function renderRecent(list) {
        $('recent-card').hidden = list.length === 0;
        $('recent-rows').innerHTML = list.slice(0, 5).map((t) => `<div class="kv">
            <span>${utc(t.closed_at)} <span class="badge ${t.side}">${SignalView.sideWord(t.side)}</span></span>
            <span><span class="badge ${SignalView.resultTone(t.result)}">${esc(t.result)}</span> <span class="${tone(t.rr)}">${fmtR(t.rr)}</span></span>
        </div>`).join('');
    }

    function updateChartPlan() {
        const sig = s.stateData?.signal;
        const plan = sig?.plan;
        if (!s.chart) return;
        if (plan && SignalView.sideOfAction(sig.action)) {
            s.chart.setPlan({ side: plan.side, entry: plan.entry_zone?.[0], stop_loss: plan.stop_loss, take_profit_1: plan.take_profit_1, take_profit_2: plan.take_profit_2 });
        } else {
            s.chart.setPlan(s.board?.open?.[0] ?? null);
        }
    }

    function renderTrends(data) {
        const roles = s.config?.roles ?? {};
        const arrow = { up: '▲', down: '▼', ranging: '→' };
        const names = { htf: 'HTF', structure: 'Structure', mid: 'Mid', entry: 'Entry' };
        $('trend-chips').innerHTML = Object.entries(roles).map(([role, tf]) => {
            const t = data?.timeframes?.[tf]?.trend;
            return `<span class="trend ${t === 'up' || t === 'down' ? t : ''}" title="${esc(names[role] ?? role)} timeframe, trend ${esc(t ?? 'unknown')}">${esc(tf)} ${arrow[t] ?? '·'}</span>`;
        }).join('');
    }

    const LABEL = (v) => String(v ?? '-').replace(/_/g, ' ');
    function renderContext(data) {
        const toneOf = (v) => (/bull|up/.test(v) ? 'pos' : /bear|down/.test(v) ? 'neg' : '');
        const risk = data.fake_breakout_risk;
        const items = [
            ['Bias', LABEL(data.regime_global), toneOf(data.regime_global)],
            ['Pressure', LABEL(data.market_pressure), toneOf(data.market_pressure)],
            ['Energy', LABEL(data.market_energy), ''],
            ['Volume', LABEL(data.volume_state), ''],
            ['RSI', num(data.indicators?.rsi, 1), ''],
            ['Volatility', isNum(data.volatility_ratio) ? `${num(data.volatility_ratio)}×` : '-', ''],
            ['To support', isNum(data.distance_percent?.to_support) ? `${num(data.distance_percent.to_support)}%` : '-', ''],
            ['To resistance', isNum(data.distance_percent?.to_resistance) ? `${num(data.distance_percent.to_resistance)}%` : '-', ''],
            ['Breakout risk', LABEL(risk), risk === 'high' ? 'neg' : risk === 'medium' ? 'warn' : ''],
            ['Divergence', LABEL(data.divergence ?? 'none'), toneOf(data.divergence ?? '')],
        ];
        $('context').innerHTML = items.map(([k, v, cls]) => `<div><div class="t-label">${esc(k)}</div><div class="t-data num ${cls}">${esc(v)}</div></div>`).join('');
    }

    function renderLevels(levels) {
        const rows = [
            ...(levels?.resistance || []).map((z, i) => ({ ...z, name: `R${i + 1}`, cls: 'neg' })),
            ...(levels?.support || []).map((z, i) => ({ ...z, name: `S${i + 1}`, cls: 'pos' })),
        ].sort((a, b) => b.mid - a.mid);
        $('levels').innerHTML = rows.map((z) => `<div class="kv">
            <span><span class="${z.cls}" style="font-weight:700">${z.name}</span> <small title="Timeframes in this zone">${esc((z.tfs || []).join(' '))}</small></span>
            <button type="button" class="btn small mono" data-copy="${esc(z.mid)}" title="Zone ${esc(fmtPrice(z.low))} to ${esc(fmtPrice(z.high))}; score ${esc(num(z.score, 1))}">${fmtPrice(z.mid)}</button>
        </div>`).join('') || '<div class="empty">No levels.</div>';
    }

    async function refreshState() {
        let res = null;
        let data = null;
        try {
            res = await fetch(`/api/market/${encodeURIComponent(s.market)}`);
            data = await res.json();
        } catch (e) { /* described below */ }
        const desc = MarketStatus.describeMarketState(data, res ? res.status : 0, s.entryTf);
        renderStatus(desc, desc.showValues ? data : null);
        s.stateData = desc.showValues ? data : null;
        if (!desc.showValues) {
            renderSignal(null);
            renderTrends(null);
            $('context').replaceChildren();
            renderLevels(null);
            s.chart?.setLevels(null);
            return;
        }
        renderSignal(data.signal ?? null, data.status);
        renderTrends(data);
        renderContext(data);
        renderLevels(data.levels);
        s.chart?.setLevels(data.levels);
    }

    // Open trades and recent results of this market come from the signal board.
    async function refreshBoard() {
        try {
            const res = await fetch('/api/signals');
            if (!res.ok) throw new Error();
            const board = await res.json();
            s.board = board.markets.find((m) => m.market === s.market) ?? null;
            renderOpen();
            renderRecent(board.recent.filter((t) => t.market === s.market));
            if (s.stateData?.signal) renderSignal(s.stateData.signal, s.stateData.status);
            updateChartPlan();
            renderSize();
        } catch (e) { /* keep the last values */ }
    }

    async function refreshEdge() {
        let edge;
        try {
            const res = await fetch(`/api/edge/${encodeURIComponent(s.market)}`);
            if (!res.ok) throw new Error();
            edge = await res.json();
        } catch (e) {
            $('edge').innerHTML = '<div class="empty">Unavailable.</div>';
            return;
        }
        const e = SignalView.edgeOf(edge.verdict);
        $('edge-line').innerHTML = `Backtest: <span class="badge ${e.tone}">${e.word}</span> <span class="muted">${esc(e.note)}</span>`;
        const stats = (x) => `${esc(fmtR(x.expectancy_r, 3))} <small>${esc(share(x.win_rate))} · n ${esc(x.trades)}</small>`;
        const b = edge.backtest;
        const rows = [`<div class="row-between" style="margin-bottom:4px"><span class="badge ${e.tone}">${e.word}</span><span class="t-meta muted">R per trade · win rate · trades</span></div>`];
        if (b?.taken) {
            rows.push(kv('Backtest', stats(b.taken), tone(b.taken.expectancy_r)));
            if (b.out_of_sample) rows.push(kv('Out of sample', stats(b.out_of_sample), tone(b.out_of_sample.expectancy_r)));
            rows.push(kv('Report', `${Fmt.day(b.generated_at)} <small>fee ${num(b.fee_pct)}%</small>`));
        }
        const live = edge.live_log;
        if (live) rows.push(kv('Live log', live.trades ? stats(live) : `0 closed <small>${esc(live.open)} open</small>`, live.trades ? tone(live.expectancy_r) : ''));
        for (const code of edge.reasons) rows.push(`<div class="t-meta warn" style="padding-top:2px">${esc(SignalView.edgeReason(code))}</div>`);
        const sh = edge.shadow;
        if (sh) {
            const roles = sh.roles ? `${sh.roles.entry}/${sh.roles.mid}/${sh.roles.structure}/${sh.roles.htf}` : '';
            rows.push('<hr class="divider">');
            rows.push(`<div class="t-label" title="A second model logged apart. It does not change the signal above.">Shadow · ${esc(SignalView.modelLabel(sh.model))} ${esc(roles)}</div>`);
            if (sh.latest) {
                const side = SignalView.sideOfAction(sh.latest.action);
                rows.push(kv('Now', `<span class="${side === 'long' ? 'pos' : side === 'short' ? 'neg' : ''}">${SignalView.sideWord(side)}</span> <small>score ${esc(sh.latest.score)}</small>`));
            }
            rows.push(kv('Log', sh.trades ? stats(sh) : `0 closed <small>${esc(sh.open)} open</small>`, sh.trades ? tone(sh.expectancy_r) : ''));
            rows.push(`<a class="t-meta" style="color:var(--accent)" href="/api/signals/${encodeURIComponent(s.market)}?source=shadow&format=csv">Shadow log CSV</a>`);
        }
        $('edge').innerHTML = rows.join('');
    }

    function renderLivePrice() {
        const p = s.livePrice;
        $('price').textContent = fmtPrice(p);
        const last = s.chart?.lastClosed();
        const change = $('price-change');
        if (!isNum(p) || !last) { change.textContent = ''; return; }
        const diff = p - last.close;
        change.textContent = `${signed(diff, Fmt.priceDecimals(last.close))} (${signedPct(diff / last.close * 100)}) vs ${s.tf} close`;
        change.className = `t-meta num ${tone(diff)}`;
    }

    function buildTfSelector(config) {
        const box = $('tf-selector');
        box.replaceChildren(...config.timeframes.map((tf) => {
            const b = document.createElement('button');
            b.type = 'button';
            b.textContent = tf.code;
            b.title = tf.label;
            b.setAttribute('aria-pressed', String(tf.code === s.tf));
            b.addEventListener('click', async () => {
                s.tf = tf.code;
                [...box.children].forEach((o) => o.setAttribute('aria-pressed', String(o === b)));
                AppHeader.setChartTf(tf.code);
                s.feed?.subscribe(tf.code);
                await s.chart.load(tf.code);
                renderLivePrice();
            });
            return b;
        }));
    }

    async function init() {
        s.market = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '');
        document.title = `${s.market} | Crypto Signal`;
        const config = (await AppHeader.init({ market: s.market })) || { markets: [], timeframes: [], roles: {} };
        s.config = config;
        s.entryTf = config.roles?.entry ?? s.tf;
        s.tf = config.timeframes.some((t) => t.code === s.entryTf) ? s.entryTf : config.timeframes[0]?.code ?? s.tf;

        const market = encodeURIComponent(s.market);
        $('csv').href = `/api/signals/${market}?format=csv`;
        $('backtest-link').href = `/backtest/${market}`;
        $('account').value = AppHeader.store.get(STORE_ACCOUNT) ?? '';
        $('risk-pct').value = AppHeader.store.get(STORE_RISK) ?? '1';
        $('account').addEventListener('input', () => { AppHeader.store.set(STORE_ACCOUNT, $('account').value); renderSize(); });
        $('risk-pct').addEventListener('input', () => { AppHeader.store.set(STORE_RISK, $('risk-pct').value); renderSize(); });

        if (!config.markets.some((m) => m.code === s.market)) {
            renderStatus(MarketStatus.describeUnknownMarket(s.market, config.markets.map((m) => m.code)), null);
            return;
        }
        AppHeader.setChartTf(s.tf);
        buildTfSelector(config);
        s.chart = PaneChart.create($('chart'), {
            market: s.market,
            onStatus: (text, level) => { const el = $('chart-status'); el.textContent = text; el.className = `t-meta ${level === 'ok' ? 'muted' : 'neg'}`; },
        });

        $('copy-state').addEventListener('click', async () => {
            const data = await fetch(`/api/market/${market}`).then((r) => r.json()).catch(() => null);
            if (data) AppHeader.copy(JSON.stringify(data, null, 2), 'Market State copied');
        });
        $('copy-plan').addEventListener('click', () => {
            AppHeader.copy(SignalView.planText(s.market, s.entryTf, s.stateData?.signal?.plan), 'Plan copied');
        });
        $('levels').addEventListener('click', (ev) => {
            const v = ev.target.closest('[data-copy]')?.dataset.copy;
            if (v) AppHeader.copy(v, 'Price copied');
        });

        const first = await s.chart.load(s.tf);
        // Until the first live tick the header shows the latest candle's price.
        s.livePrice = first?.forming_candle?.close ?? s.chart.lastClosed()?.close ?? null;
        renderLivePrice();
        await Promise.all([refreshState(), refreshBoard(), refreshEdge()]);

        s.feed = AppHeader.live({
            market: s.market,
            timeframe: s.tf,
            onState: (on) => AppHeader.setConn($('conn'), on),
            onMessage: (msg) => {
                if (msg.type === 'price' && isNum(msg.price)) {
                    s.livePrice = msg.price;
                    s.chart.setLivePrice(msg.price);
                    renderLivePrice();
                    if (s.board?.open?.length) renderOpen();
                } else if (msg.type === 'summary_ready') {
                    refreshState();
                    refreshBoard();
                } else if (msg.type === 'update_ready') {
                    s.chart.load(s.tf, { keepRange: true });
                }
            },
        });
        // Re-read the server's freshness verdict every minute even if no update messages arrive.
        setInterval(refreshState, 60000);
        setInterval(refreshBoard, 60000);
        setInterval(refreshEdge, 300000);
    }

    init();
})();
