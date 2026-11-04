// Backtest report of one market (GET /api/backtest/:symbol). Results are hypothetical.
(function () {
    const { esc, isNum, num, price: fmtPrice, share, utc, day, tone } = Fmt;
    const $ = (id) => document.getElementById(id);
    const MIN_SAMPLE = 20;

    const market = decodeURIComponent(location.pathname.split('/').filter(Boolean).pop() || '').toUpperCase();
    document.title = `${market} Backtest | Crypto Signal`;
    const header = AppHeader.init({ market });

    const SIDE_OF = { BUY: 'long', SELL: 'short' };
    const metric = (label, value, cls = '') => `<div><div class="t-label">${esc(label)}</div><div class="metric-value ${cls}">${esc(value)}</div></div>`;

    function renderGroup(name, g) {
        const s = g.summary;
        $(`m-${name}`).innerHTML = [
            metric('Trades', String(s.trades)),
            metric('Win rate (TP1)', share(s.win_rate)),
            metric('Expectancy', `${num(s.expectancy_r, 3)} R`, tone(s.expectancy_r)),
            metric('Total', `${num(s.total_r)} R`, tone(s.total_r)),
            metric('Profit factor', num(s.profit_factor)),
            metric('Max drawdown', `${num(s.max_drawdown_r)} R`),
            metric('Avg win / loss', `${num(s.avg_win_r)} / ${num(s.avg_loss_r)}`),
            metric('W / L / Exp', `${s.wins} / ${s.losses} / ${s.expired}`),
        ].join('');
        const side = (k) => {
            const b = g.by_side[k];
            return `${SIDE_OF[k].toUpperCase()}: ${b.trades} trades, win ${share(b.win_rate)}, ${num(b.expectancy_r, 3)} R`;
        };
        const extra = [];
        if (s.open) extra.push(`${s.open} still open at the end`);
        if (s.unknown) extra.push(`${s.unknown} unknown`);
        if (g.ci95) extra.push(`95% interval ${num(g.ci95[0], 3)} to ${num(g.ci95[1], 3)} R`);
        $(`s-${name}`).textContent = [side('BUY'), side('SELL'), ...extra].join(' · ');
    }

    // lightweight-charts needs strictly increasing times: keep the last point per second.
    function curveData(points) {
        const byTime = new Map();
        for (const p of points) byTime.set(p.time, p.equity);
        return [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([time, value]) => ({ time, value }));
    }

    function renderEquity(report) {
        const chart = LightweightCharts.createChart($('equity'), {
            layout: { background: { color: 'transparent' }, textColor: '#8d96a7' },
            grid: { vertLines: { color: 'rgba(255,255,255,0.04)' }, horzLines: { color: 'rgba(255,255,255,0.04)' } },
            timeScale: { timeVisible: true, borderColor: 'rgba(255,255,255,0.1)' },
            rightPriceScale: { borderColor: 'rgba(255,255,255,0.1)' },
            localization: { priceFormatter: (v) => num(v) },
            autoSize: true,
        });
        chart.addLineSeries({ color: '#16c784', lineWidth: 2 }).setData(curveData(report.taken.equity));
        chart.addLineSeries({ color: '#f0b90b', lineWidth: 1 }).setData(curveData(report.filtered.equity));
        // autoSize applies the container size on the next frame; fit after that.
        requestAnimationFrame(() => chart.timeScale().fitContent());
    }

    function renderTrades(report) {
        const mode = $('trade-filter').value;
        const list = report.trades.filter((t) => mode === 'all' || (mode === 'filtered') === t.filtered).slice(-200).reverse();
        $('trades').innerHTML = list.map((t) => {
            const side = SIDE_OF[t.signal];
            return `<tr>
                <td>${utc(t.time)}</td>
                <td><span class="badge ${side}">${SignalView.sideWord(side)}</span></td>
                <td class="right">${esc(t.score)}</td>
                <td class="right">${fmtPrice(t.price)}</td>
                <td class="right">${fmtPrice(t.sl)}</td>
                <td class="right">${fmtPrice(t.tp1)}</td>
                <td class="right">${num(t.risk_reward)}</td>
                <td><span class="badge ${SignalView.resultTone(t.result)}">${esc(t.result ?? 'OPEN')}</span></td>
                <td class="right ${tone(t.net_r)}">${num(t.net_r)}</td>
                <td class="right">${esc(t.bars ?? '-')}</td>
                <td class="muted">${esc((t.filters || []).join(', '))}</td>
            </tr>`;
        }).join('') || '<tr><td colspan="11" class="muted">No trades</td></tr>';
    }

    const DIM_LABELS = {
        side: 'Side', score: '|Score|', htf_trend: 'Trend HTF / structure', regime: 'Regime (entry TF)', context: 'Context', momentum: 'Momentum',
        volume_state: 'Volume', market_energy: 'Market energy', breakout_confirmation: 'Breakout confirmation',
        fake_breakout_risk: 'Fake breakout risk', divergence: 'Divergence', session_utc: 'Session (UTC hours)', filter: 'Rejected by filter',
    };

    function paramLabel(p, base) {
        const parts = [];
        if (p.model && p.model !== base.model) parts.push(p.model);
        parts.push(`threshold ${p.threshold}`);
        parts.push(`min RR ${p.min_rr}`);
        // Setup keys are shown only when they differ from the live parameters.
        if (p.stop_atr !== undefined && p.stop_atr !== base.stop_atr) parts.push(`SL ${p.stop_atr} ATR`);
        if (p.target !== undefined && p.target !== base.target) parts.push(`target ${typeof p.target === 'number' ? `${p.target}R` : p.target}`);
        if (p.entry_max_atr !== undefined && p.entry_max_atr !== (base.entry_max_atr ?? 0)) parts.push(`entry ≤ ${p.entry_max_atr} ATR`);
        if (p.htf_trend !== undefined && p.htf_trend !== (base.htf_trend ?? 'off')) parts.push(`trend filter ${p.htf_trend}`);
        if (p.side !== undefined && p.side !== base.side) parts.push(`${p.side} only`);
        if (p.skip_energy?.length && p.skip_energy.join() !== (base.skip_energy || []).join()) parts.push(`skip ${p.skip_energy.join('+')}`);
        for (const [tf, w] of Object.entries(p.weights || {})) {
            if (w !== base.weights?.[tf]) parts.push(`w ${tf} ${w}`);
        }
        for (const [group, values] of Object.entries(p.calc || {})) {
            for (const [key, v] of Object.entries(values)) {
                if (base.calc?.[group] && v !== base.calc[group][key]) parts.push(`${group}.${key} ${v}`);
            }
        }
        return parts.join(' · ');
    }

    function renderSweep(report) {
        if (!report.sweep) return false;
        $('sweep-card').hidden = false;
        const base = report.sweep.find((r) => r.base)?.params || report.params;
        const rows = [...report.sweep].sort((a, b) => (b.taken.expectancy_r ?? -Infinity) - (a.taken.expectancy_r ?? -Infinity));
        $('sweep').innerHTML = rows.map((r) => {
            const s = r.taken;
            return `<tr class="${s.trades < MIN_SAMPLE ? 'thin' : ''}">
                <td>${r.base ? '★ ' : ''}${esc(paramLabel(r.params, base))}</td>
                <td class="right">${esc(s.trades)}</td>
                <td class="right">${share(s.win_rate)}</td>
                <td class="right ${tone(s.expectancy_r)}">${num(s.expectancy_r, 3)}</td>
                <td class="right ${tone(s.total_r)}">${num(s.total_r)}</td>
                <td class="right">${num(s.profit_factor)}</td>
                <td class="right">${num(s.max_drawdown_r)}</td>
                <td class="right ${tone(r.filtered.expectancy_r)}">${num(r.filtered.expectancy_r, 3)}</td>
            </tr>`;
        }).join('');
        return true;
    }

    // Parameters chosen on the first part of the period, judged on the unseen rest.
    function renderValidation(report) {
        const v = report.validation;
        if (!v) return false;
        $('validation-card').hidden = false;
        $('validation-note').textContent = `In-sample: before ${utc(v.split_at)} UTC. ▶ = best in-sample with ${v.min_trades}+ trades; ★ = live parameters.`;
        const base = v.rows.find((r) => r.base)?.params || report.params;
        $('validation').innerHTML = v.rows.map((r, idx) => {
            const a = r.in_sample;
            const b = r.out_of_sample;
            return `<tr class="${idx === v.selected ? 'picked' : ''}">
                <td>${idx === v.selected ? '▶ ' : ''}${r.base ? '★ ' : ''}${esc(paramLabel(r.params, base))}</td>
                <td class="right">${esc(a.trades)}</td>
                <td class="right ${tone(a.expectancy_r)}">${num(a.expectancy_r, 3)}</td>
                <td class="right">${esc(b.trades)}</td>
                <td class="right">${share(b.win_rate)}</td>
                <td class="right ${tone(b.expectancy_r)}">${num(b.expectancy_r, 3)}</td>
                <td class="right ${tone(b.total_r)}">${num(b.total_r)}</td>
                <td class="right">${num(b.profit_factor)}</td>
            </tr>`;
        }).join('');
        const pick = v.rows[v.selected];
        const verdict = $('validation-verdict');
        if (!pick) {
            verdict.textContent = `No variant has ${v.min_trades}+ in-sample trades: nothing to validate.`;
        } else {
            const oos = pick.out_of_sample.expectancy_r;
            verdict.className = `t-body ${tone(oos)}`;
            verdict.textContent = `Pick: ${paramLabel(pick.params, base)} → out-of-sample ${num(oos, 3)} R over ${pick.out_of_sample.trades} trades` +
                (pick.out_of_sample.trades < MIN_SAMPLE ? ' (too few trades to judge).'
                    : isNum(oos) && oos > 0 ? ' (edge held on unseen data).' : ' (edge did not hold on unseen data).');
        }
        return true;
    }

    function renderWalkForward(report) {
        const w = report.walk_forward;
        if (!w) return false;
        $('wf-card').hidden = false;
        $('wf').innerHTML = w.rows.map((r) => `<tr><td>${day(r.from)}</td><td class="right">${esc(r.test.trades)}</td><td class="right ${tone(r.test.expectancy_r)}">${num(r.test.expectancy_r, 3)}</td><td class="right">${num(r.test.profit_factor)}</td></tr>`).join('');
        const interval = w.ci95 ? `, 95% interval ${num(w.ci95[0], 3)} to ${num(w.ci95[1], 3)} R` : '';
        $('wf-verdict').className = `t-body ${tone(w.test.expectancy_r)}`;
        $('wf-verdict').textContent = `All periods: ${num(w.test.expectancy_r, 3)} R over ${w.test.trades} trades, positive in ${w.positive_folds} of ${w.judged_folds}${interval}.`;
        return true;
    }

    async function renderHistory() {
        const body = await fetch(`/api/backtest-history/${encodeURIComponent(market)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (!body || !body.runs.length) return false;
        $('history-card').hidden = false;
        $('history').innerHTML = body.runs.slice(0, 20).map((r) => `<tr>
            <td>${utc(r.generated_at)}</td><td>${esc(r.config_hash ?? '-')}</td><td>${esc(r.model ?? '-')}</td><td>${esc(r.exit ?? '-')}</td>
            <td class="right">${num((r.fee_pct || 0) + (r.slippage_pct || 0))}</td><td class="right">${esc(r.taken?.trades ?? '-')}</td>
            <td class="right ${tone(r.taken?.expectancy_r)}">${num(r.taken?.expectancy_r, 3)}</td>
            <td class="right">${r.ci95 ? `${num(r.ci95[0], 3)} … ${num(r.ci95[1], 3)}` : '-'}</td>
            <td class="right ${tone(r.out_of_sample?.expectancy_r)}">${num(r.out_of_sample?.expectancy_r, 3)}</td>
            <td class="right ${tone(r.walk_forward?.test?.expectancy_r)}">${num(r.walk_forward?.test?.expectancy_r, 3)}</td>
        </tr>`).join('');
        return true;
    }

    function renderBreakdown(report) {
        const dims = report[$('breakdown-group').value].breakdown || {};
        $('breakdown').innerHTML = Object.entries(dims).map(([dim, rows]) => `<div class="table-wrap">
            <div class="t-label" style="margin-bottom:4px">${esc(DIM_LABELS[dim] || dim)}</div>
            <table class="tbl"><thead><tr><th>Value</th><th class="right">Trades</th><th class="right">Win</th><th class="right">R</th><th class="right">Total</th></tr></thead>
            <tbody>${rows.map((r) => `<tr class="${r.trades < MIN_SAMPLE ? 'thin' : ''}">
                <td>${esc(r.value)}</td>
                <td class="right">${esc(r.trades)}</td>
                <td class="right">${share(r.win_rate)}</td>
                <td class="right ${tone(r.expectancy_r)}">${num(r.expectancy_r, 3)}</td>
                <td class="right ${tone(r.total_r)}">${num(r.total_r)}</td>
            </tr>`).join('')}</tbody></table>
        </div>`).join('') || '<div class="empty">No breakdown in this report.</div>';
    }

    // The one line to read first: the verdict of the live server, with what it is based on.
    async function renderVerdict(report) {
        const edge = await fetch(`/api/edge/${encodeURIComponent(market)}`).then((r) => (r.ok ? r.json() : null)).catch(() => null);
        const box = $('verdict');
        if (!edge) { box.hidden = true; return; }
        const e = SignalView.edgeOf(edge.verdict);
        const reasons = edge.reasons.map(SignalView.edgeReason).join('; ');
        box.className = `banner ${{ pos: 'ok', neg: 'neg', warn: 'warn' }[e.tone]}`;
        box.innerHTML = `<span class="badge ${e.tone}">${e.word}</span><span>${esc(e.note)}${reasons ? ` ${esc(reasons)}.` : ''}</span>`;
    }

    function renderAssumptions(report) {
        const p = report.params;
        const entry = p.entry === 'next_open' ? 'the open after the signal candle' : 'the close of the signal candle';
        const exit = p.exit === 'trailing' ? `a stop trailing ${p.trail_atr} × ATR behind the best price` : 'TP1 or stop';
        const costs = p.fee_pct ? `Fee ${num(p.fee_pct)}% and slippage ${num(p.slippage_pct ?? 0)}% round trip included.` : 'No fees or slippage included.';
        $('assumptions').textContent = `Hypothetical results, not executed trades: entry at ${entry}, exit at ${exit} (both in one candle counts as a stop), expiry after ${p.expiry_candles} entry candles. Results are in R (multiples of the planned risk). ${costs}`;
    }

    function setupTabs() {
        const tabs = [...document.querySelectorAll('[data-tab]')];
        tabs.forEach((b) => b.addEventListener('click', () => {
            tabs.forEach((o) => o.setAttribute('aria-selected', String(o === b)));
            document.querySelectorAll('[data-panel]').forEach((p) => { p.hidden = p.dataset.panel !== b.dataset.tab; });
        }));
    }

    async function load() {
        setupTabs();
        const res = await fetch(`/api/backtest/${encodeURIComponent(market)}?states=0`);
        const err = res.ok ? null : await res.json().catch(() => ({}));
        if (err?.error === 'unknown_market_or_timeframe') {
            const config = (await header) || { markets: [] };
            $('empty').hidden = false;
            $('empty').textContent = `${market} is not in the market list (engine.markets). Available: ${config.markets.map((m) => m.code).join(', ') || 'none'}.`;
            return;
        }
        if (!res.ok) {
            $('empty').hidden = false;
            $('empty-cmd').textContent = `npm run backtest -- ${market}`;
            return;
        }
        await header;
        const report = await res.json();
        $('report').hidden = false;
        $('period').textContent = `${day(report.period.start)} to ${day(report.period.end)} · entry ${report.entry_tf} · generated ${utc(report.generated_at)} UTC`;
        renderAssumptions(report);
        renderVerdict(report);
        renderGroup('taken', report.taken);
        renderGroup('filtered', report.filtered);
        renderEquity(report);
        const checks = [renderValidation(report), renderWalkForward(report), renderSweep(report), await renderHistory()];
        $('robust-empty').hidden = checks.some(Boolean);
        $('min-sample').textContent = MIN_SAMPLE;
        renderBreakdown(report);
        $('breakdown-group').addEventListener('change', () => renderBreakdown(report));
        renderTrades(report);
        $('trade-filter').addEventListener('change', () => renderTrades(report));
    }

    load();
})();
