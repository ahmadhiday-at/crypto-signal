// Signal board: every market's signal, the open trades and the latest results (GET /api/signals).
(function () {
    const { esc, price, r: fmtR, num, utc, span, tone } = Fmt;
    const POLL_MS = 30000;
    const STORE_ALERTS = 'cs.alerts';
    const $ = (id) => document.getElementById(id);

    const state = { board: null, config: null, prices: {}, lastActions: null, feeds: new Set(), alerts: AppHeader.store.get(STORE_ALERTS) === 'on' };

    function signalCell(row) {
        const sig = row.signal;
        if (!sig) return '<span class="badge">NO DATA</span>';
        if (sig.direction) {
            const inTrade = row.open.some((t) => t.side === sig.direction);
            return `<span class="badge ${sig.direction}">${SignalView.sideWord(sig.direction)}</span> <span class="muted">${inTrade ? 'trade open' : esc(sig.strength)}</span>`;
        }
        const title = esc(SignalView.waitReason(sig, row.status, state.config?.signal));
        if (sig.filtered) return `<span class="badge" title="${title}">WAIT</span> <span class="warn t-meta" title="${title}">${SignalView.sideWord(sig.setup)} blocked</span>`;
        return `<span class="badge" title="${title}">WAIT</span>`;
    }

    function gauge(score) {
        const threshold = state.config?.signal?.threshold ?? 5;
        const max = Math.max(10, Math.abs(score || 0));
        const width = Math.abs(score || 0) / max * 50;
        const color = score > 0 ? 'var(--long)' : 'var(--short)';
        const tick = (side) => `<span class="gauge-tick" style="left:${50 + side * threshold / max * 50}%"></span>`;
        return `<div class="gauge mini" title="Score ${score}; acts at ±${threshold}"><span class="gauge-mid"></span>${tick(-1)}${tick(1)}<span class="gauge-fill" style="background:${color};${score > 0 ? `left:50%;width:${width}%` : `left:${50 - width}%;width:${width}%`}"></span></div>`;
    }

    function trendChips(trends) {
        const arrow = { up: '▲', down: '▼', ranging: '→' };
        return `<span class="trends">${Object.values(trends).map((t) => `<span class="trend ${t.trend === 'up' || t.trend === 'down' ? t.trend : ''}" title="${esc(t.timeframe)} trend: ${esc(t.trend ?? 'unknown')}">${esc(t.timeframe)} ${arrow[t.trend] ?? '·'}</span>`).join('')}</span>`;
    }

    function edgeCell(edge) {
        if (!edge) return '<span class="muted">-</span>';
        const e = SignalView.edgeOf(edge.verdict);
        const title = esc((edge.reasons || []).map(SignalView.edgeReason).join('; ') || e.note);
        const value = edge.expectancy_r === null ? '' : ` <span class="${tone(edge.expectancy_r)}">${esc(fmtR(edge.expectancy_r))}</span>`;
        return `<span class="badge ${e.tone}" title="${title}">${e.word}</span>${value}`;
    }

    const STATUS_TONES = { ok: 'pos', degraded: 'warn', stale: 'neg', unavailable: 'neg' };

    function renderMarkets() {
        $('markets').innerHTML = state.board.markets.map((row) => {
            const plan = row.signal?.plan;
            const dim = plan && !row.signal.direction ? 'dimmed' : '';
            const cells = plan
                ? `<td class="right ${dim}">${price(plan.entry_zone?.[0])}</td><td class="right ${dim} neg">${price(plan.stop_loss)}</td><td class="right ${dim} pos">${price(plan.take_profit_1)}</td><td class="right ${dim}">${num(plan.risk_reward)}</td>`
                : '<td class="right faint">-</td><td class="right faint">-</td><td class="right faint">-</td><td class="right faint">-</td>';
            return `<tr class="link" data-market="${esc(row.market)}">
                <td class="strong-cell"><a href="/${encodeURIComponent(row.market)}" style="text-decoration:none">${esc(row.market)}</a></td>
                <td class="right" data-price="${esc(row.market)}">${price(state.prices[row.market] ?? row.price)}</td>
                <td>${signalCell(row)}</td>
                <td><div class="row" style="flex-wrap:nowrap"><span style="min-width:2em">${row.signal ? (row.signal.score > 0 ? '+' : '') + row.signal.score : '-'}</span>${row.signal ? gauge(row.signal.score) : ''}</div></td>
                <td>${trendChips(row.trends)}</td>
                ${cells}
                <td>${edgeCell(row.edge)}</td>
                <td><span class="badge ${STATUS_TONES[row.status] ?? ''}" title="${esc((row.errors || []).join(', '))}">${esc(row.status)}</span></td>
            </tr>`;
        }).join('') || '<tr><td colspan="11" class="muted">No markets configured.</td></tr>';
    }

    function renderOpen() {
        const closes = Object.fromEntries(state.board.markets.map((m) => [m.market, m.price]));
        const trades = state.board.markets.flatMap((m) => m.open);
        $('open').innerHTML = trades.map((t) => {
            const now = state.prices[t.market] ?? closes[t.market];
            const openR = SignalView.openR(t, now);
            return `<tr class="link" data-market="${esc(t.market)}">
                <td class="strong-cell">${esc(t.market)}</td>
                <td><span class="badge ${t.side}">${SignalView.sideWord(t.side)}</span></td>
                <td>${utc(t.opened_at)}</td>
                <td class="right">${price(t.entry)}</td>
                <td class="right" data-price="${esc(t.market)}">${price(now)}</td>
                <td class="right ${tone(openR)}" title="Before costs">${fmtR(openR)}</td>
                <td class="right neg">${price(t.stop_loss)}</td>
                <td class="right pos">${price(t.take_profit_1)}</td>
                <td>${utc(t.expires_at)}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="9" class="muted">No open trades on the current model.</td></tr>';
    }

    function renderRecent() {
        const older = state.board.markets.reduce((n, m) => n + m.older_records, 0);
        $('recent-note').textContent = `Current model and timeframe, before costs.${older ? ` ${older} older records from earlier models are kept in the log, not shown.` : ''}`;
        $('recent').innerHTML = state.board.recent.map((t) => `<tr class="link" data-market="${esc(t.market)}">
            <td>${utc(t.closed_at)}</td>
            <td class="strong-cell">${esc(t.market)}</td>
            <td><span class="badge ${t.side}">${SignalView.sideWord(t.side)}</span></td>
            <td class="right">${price(t.entry)}</td>
            <td class="right">${price(t.stop_loss)}</td>
            <td class="right">${price(t.take_profit_1)}</td>
            <td><span class="badge ${SignalView.resultTone(t.result)}">${esc(t.result)}</span></td>
            <td class="right ${tone(t.rr)}">${fmtR(t.rr)}</td>
            <td class="right">${esc(t.bars ?? '-')}</td>
        </tr>`).join('') || '<tr><td colspan="9" class="muted">No closed trades on the current model yet.</td></tr>';
    }

    // Warn once when a signal is showing on a market whose backtest does not support it.
    function renderEdgeNote() {
        const weak = state.board.markets.filter((m) => m.edge && m.edge.verdict !== 'positive').map((m) => m.market);
        const note = $('edge-note');
        note.hidden = weak.length === 0;
        note.textContent = weak.length === state.board.markets.length
            ? 'No market has a proven edge in the backtest after costs. Read these signals as an experiment, and size them accordingly.'
            : `No proven edge in the backtest after costs: ${weak.join(', ')}.`;
    }

    function alertChanges() {
        const now = Object.fromEntries(state.board.markets.map((m) => [m.market, m.signal?.direction ?? null]));
        const before = state.lastActions;
        state.lastActions = now;
        if (!before) return;
        for (const [market, side] of Object.entries(now)) {
            if (!side || before[market] === side) continue;
            const text = `${market}: ${SignalView.sideWord(side)} signal`;
            AppHeader.toast(text);
            if (state.alerts && window.Notification && Notification.permission === 'granted') new Notification(text, { body: 'Open the market page for the plan.' });
        }
    }

    function renderAlerts() {
        const btn = $('alerts');
        btn.textContent = state.alerts ? 'Alerts on' : 'Alerts off';
        btn.setAttribute('aria-pressed', String(state.alerts));
        btn.classList.toggle('active', state.alerts);
    }

    async function toggleAlerts() {
        if (!state.alerts && window.Notification && Notification.permission === 'default') await Notification.requestPermission();
        if (!state.alerts && window.Notification && Notification.permission === 'denied') AppHeader.toast('Notifications are blocked in this browser; alerts stay on this page only');
        state.alerts = !state.alerts;
        AppHeader.store.set(STORE_ALERTS, state.alerts ? 'on' : 'off');
        renderAlerts();
    }

    function startFeeds() {
        const entry = state.board.roles.entry;
        for (const m of state.board.markets) {
            if (state.feeds.has(m.market)) continue;
            state.feeds.add(m.market);
            AppHeader.live({
                market: m.market,
                timeframe: entry,
                onState: (on) => AppHeader.setConn($('conn'), on),
                onMessage: (msg) => {
                    if (msg.type === 'price' && Fmt.isNum(msg.price)) {
                        state.prices[m.market] = msg.price;
                        document.querySelectorAll(`[data-price="${m.market}"]`).forEach((el) => { el.textContent = price(msg.price); });
                        if (m.open.length) renderOpen();
                    } else if (msg.type === 'summary_ready') {
                        refresh();
                    }
                },
            });
        }
    }

    async function refresh() {
        try {
            const res = await fetch('/api/signals');
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            state.board = await res.json();
        } catch (err) {
            $('load-error').hidden = false;
            $('load-error').textContent = `Signals could not be loaded (${err.message}). Showing the last values.`;
            return;
        }
        $('load-error').hidden = true;
        const b = state.board;
        $('n-long').textContent = b.totals.long;
        $('n-short').textContent = b.totals.short;
        $('n-wait').textContent = b.totals.wait;
        $('n-open').textContent = b.totals.open;
        $('model').textContent = SignalView.modelLabel(b.model);
        $('entry-tf').textContent = b.roles.entry ?? '-';
        const latest = Math.max(0, ...b.markets.map((m) => m.generated_at ?? 0));
        $('updated').textContent = latest ? `Candle data built ${span(b.generated_at - latest)} ago · ${utc(latest)} UTC` : '';
        renderEdgeNote();
        renderMarkets();
        renderOpen();
        renderRecent();
        alertChanges();
        startFeeds();
    }

    async function init() {
        state.config = await AppHeader.init();
        renderAlerts();
        $('alerts').addEventListener('click', toggleAlerts);
        document.querySelector('main').addEventListener('click', (ev) => {
            const row = ev.target.closest('tr.link');
            if (row && !ev.target.closest('a')) window.location.href = `/${encodeURIComponent(row.dataset.market)}`;
        });
        await refresh();
        setInterval(refresh, POLL_MS);
    }

    init();
})();
