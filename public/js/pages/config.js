// Calculation config editor, backtest runs and operations. Keys and ranges come from GET /api/calc-config.
(function () {
    const { esc, num, utc } = Fmt;
    const $ = (id) => document.getElementById(id);

    // What each tab holds. `runs` and `ops` show the panels outside the form.
    const SECTIONS = [
        { id: 'markets', title: 'Markets', groups: ['engine'] },
        { id: 'signal', title: 'Signal', groups: ['signal', 'trend', 'scoring'] },
        { id: 'risk', title: 'Filters & exits', groups: ['filters', 'evaluation'] },
        { id: 'levels', title: 'Indicators & zones', groups: ['indicators', 'zones', 'weights', 'lookback'] },
        { id: 'state', title: 'Market state', groups: ['market', 'divergence'] },
        { id: 'backtest', title: 'Backtest', groups: ['backtest'], runs: true },
        { id: 'shadow', title: 'Shadow', groups: ['shadow'] },
        { id: 'ops', title: 'Operations', groups: [], ops: true },
    ];

    const GROUPS = {
        engine: { title: 'Markets and timeframes', note: 'Restart required', help: {
            markets: 'Markets to track, comma separated, e.g. BTCUSDT, SOLUSDT',
            timeframes: 'Timeframes fetched and shown on the charts; the roles below are always added',
            htf: 'Highest timeframe: long-term trend and major zones',
            structure: 'Structure timeframe',
            mid: 'Mid timeframe',
            entry: 'Signal timeframe: signals, plans and the signal log',
            candle_limit: 'Candles fetched per timeframe; snapshots see this − 1 closed candles',
        } },
        signal: { title: 'Signal', help: {
            model: 'bounce: S/R score; trend_pullback: pullback to the entry MA50 in the HTF trend; breakout: close beyond the entry channel in the trend',
            threshold: 'Minimum |score| for a long or short',
            min_rr: 'Minimum plan risk/reward (else filter low_rr)',
            trailing_atr: 'Trailing stop distance, × ATR',
            stop_atr: 'Stop loss buffer beyond the entry zone, × ATR',
            htf_proximity_percent: 'Max distance (%) to an HTF zone for its points',
            target: 'TP1: tp1 nearest zone, rr_zone first zone with RR ≥ min_rr, tp2 major HTF zone',
        } },
        trend: { title: 'Trend model points and plan', help: {
            htf_points: 'HTF trend up / down, ± points',
            structure_points: 'Structure trend, ± points',
            entry_points: 'Entry trend, ± points',
            pullback_points: 'Price within pullback_atr × ATR of the entry MA50, points in the trend direction',
            breakout_points: 'Close beyond the channel high / low, ± points',
            momentum_points: 'MACD histogram in the score direction, points',
            volume_points: 'High volume adds, low volume removes (points)',
            pullback_atr: 'Pullback distance to the entry MA50, × ATR',
            channel_candles: 'Entry candles in the breakout channel (before the signal candle)',
            stop_atr: 'Stop loss distance from price, × ATR',
            target_r: 'TP1 at this multiple of the risk',
        } },
        scoring: { title: 'S/R bounce model points', help: {
            near_zone: 'Price inside the top support / resistance zone, ± points',
            momentum: 'Bullish / bearish momentum, ± points',
            htf_zone: 'Top zone is an HTF zone within htf_proximity_percent, ± points',
            divergence: 'RSI divergence, ± points',
            volume: 'High volume adds, low volume removes conviction (points)',
            strong_score: 'Minimum |score| for strength strong (every model)',
            breakout_confirmed: 'Weakest breakout confirmation that lets a long into resistance / short into support pass',
        } },
        filters: { title: 'Trade filters', help: {
            volatility_extreme: 'volatility_ratio above this → no trade',
            volatility_dead: 'volatility_ratio below this → no trade',
            htf_trend: 'Reject a long when the HTF (or structure) timeframe trends down, a short when up',
            no_mans_land_percent: 'mid_range farther than this % from any zone → no trade',
            entry_max_atr: 'Price farther than this × ATR from the entry zone → no trade (0 = off)',
        } },
        evaluation: { title: 'Trade evaluation', note: 'Signal log, backtest, verdict', help: {
            expiry_candles: 'Entry candles before an open trade closes as EXPIRED',
            min_trades: 'Minimum taken trades for the verdict and the out-of-sample pick',
        } },
        indicators: { title: 'Indicators', note: 'A change recalculates every snapshot', help: {
            ma_fast: 'Fast SMA period (field name stays ma14)',
            ma_mid: 'Mid SMA period (field ma50)',
            ma_slow: 'Slow SMA period (field ma200)',
            rsi_period: 'RSI period',
            macd_fast: 'MACD fast EMA period',
            macd_slow: 'MACD slow EMA period',
            macd_signal: 'MACD signal period',
            atr_period: 'ATR period',
            min_candles: 'Closed candles needed before a timeframe is calculated',
            rsi_bullish: 'Momentum bullish: RSI above this and MACD histogram > 0',
            rsi_bearish: 'Momentum bearish: RSI below this and MACD histogram < 0',
            regime_ma_percent: 'Regime ranging when fast and mid SMA are within this % of price',
        } },
        zones: { title: 'Support and resistance zones', note: 'A change recalculates every snapshot', help: {
            cluster_percent: 'Swings within this % of each other form one zone',
            width_atr: 'Zone half-width, × ATR',
            max_width_percent: 'Maximum total zone width, % of its price',
            touch_points: 'Score per swing in the zone',
            recency_candles: 'Recency bonus: this many points minus candles since the last touch',
            distance_penalty: 'Score minus distance from price (fraction) × this',
            ma_bonus: 'Score bonus when the zone is near the mid or slow SMA',
            ma_proximity_percent: 'Distance (%) to the SMA for that bonus',
            fallback_candles: 'Candles for the high/low fallback level when a side has no zone',
            lookback_volatility_band: 'Lookback widens / narrows when volatility is beyond ± this share of its mean',
            lookback_scale: 'By this share (lookback × (1 ± scale))',
        } },
        weights: { title: 'Zone weight per timeframe', help: {} },
        lookback: { title: 'S/R lookback candles per timeframe', note: 'A change recalculates every snapshot', help: {} },
        market: { title: 'Market state thresholds', help: {
            volume_candles: 'Candles in the volume average',
            volume_high: 'Volume above average × this → high',
            volume_increasing: 'Above average × this → increasing',
            volume_low: 'Below average × this → low',
            energy_explosive: '|MACD histogram| / ATR above this with high volume → explosive',
            energy_building: '|MACD histogram| / ATR above this with increasing volume → building',
            energy_cooling: '|MACD histogram| / ATR below this (or low volume) → cooling',
            breakout_distance_percent: 'Breakout score distance factor reaches 0 at this % from the nearest zone',
            breakout_volume_high: 'Breakout score volume factor, high volume',
            breakout_volume_increasing: 'Volume factor, increasing',
            breakout_volume_normal: 'Volume factor, normal',
            breakout_volume_low: 'Volume factor, low',
            compression_bonus: 'Breakout score bonus in a compression zone',
            breakout_strong: 'Breakout score above this → confirmation strong / medium / weak by volume',
            breakout_weak: 'Above this → weak (noise with high volume)',
            dominant_percent: 'Dominant side when the top zone scores differ by more than this %',
            volatility_candles: 'Candles in the ATR mean of volatility_ratio',
        } },
        divergence: { title: 'RSI divergence', help: {
            lookback: 'Closed entry candles searched for swings',
            pivot_width: 'Bars on each side a swing must exceed',
            max_age: 'The latest swing must be at most this many bars old',
        } },
        backtest: { title: 'Backtest settings', help: {
            days: 'History length in days',
            fee_pct: 'Round-trip fee, % of price',
            slippage_pct: 'Round-trip slippage, % of price; added to the fee',
            entry: 'next_open: fill at the open after the signal candle; close: at the signal candle close',
            folds: 'Walk-forward periods judged with the variant that was best before them',
            split: 'In-sample share for the out-of-sample check',
        } },
        shadow: { title: 'Shadow signal log', note: 'A second model logged apart; the live signal is unchanged', help: {
            enabled: 'on: log the shadow model to data/signals-shadow/ after each Market State build',
            model: 'Signal model of the shadow log',
            htf: 'Shadow HTF timeframe (must be in engine.timeframes or the roles)',
            structure: 'Shadow structure timeframe',
            mid: 'Shadow mid timeframe',
            entry: 'Shadow entry timeframe: its candles judge the shadow trades',
            stop_atr: 'Trend models: stop distance, × ATR',
            target_r: 'Trend models: TP1 at this multiple of the risk',
        } },
    };

    // Keys the selected signal model ignores (src/services/signal.js): shown dimmed, still editable.
    const BOUNCE_ONLY = { signal: ['stop_atr', 'htf_proximity_percent', 'target'], filters: ['no_mans_land_percent', 'entry_max_atr'], scoring: ['near_zone', 'momentum', 'htf_zone', 'divergence', 'volume', 'breakout_confirmed'] };
    const usedByModel = (model, group, key) => {
        if (group === 'trend') {
            if (model === 'bounce') return false;
            if (key === 'breakout_points' || key === 'channel_candles') return model === 'breakout';
            if (key === 'pullback_points' || key === 'pullback_atr') return model === 'trend_pullback';
            return true;
        }
        return model === 'bounce' || !BOUNCE_ONLY[group]?.includes(key);
    };

    const state = { saved: null, defaults: null, limits: null, roles: {}, markets: [], runs: null, edges: {}, running: null, section: 'signal' };

    const perTf = (group) => group === 'weights' || group === 'lookback';
    const limitsOf = (group, key) => (perTf(group) ? state.limits[group] : state.limits[group][key]);
    const isList = (group, key) => Boolean(limitsOf(group, key).list);
    const choicesOf = (group, key) => (isList(group, key) || Array.isArray(limitsOf(group, key)) ? null : limitsOf(group, key).values);
    const fieldValue = (el) => {
        if (el.dataset.list) return el.value.split(',').map((s) => s.trim()).filter(Boolean);
        return el.tagName === 'SELECT' ? el.value : el.value === '' ? NaN : Number(el.value);
    };
    const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
    const inputs = () => [...$('form').querySelectorAll('[data-group]')];

    // Same rule as the server: at least min_items, no duplicates, every item allowed.
    function listOk(v, l) {
        if (v.length < l.min_items || v.length > (l.max_items ?? Infinity) || new Set(v).size !== v.length) return false;
        return v.every((item) => (l.values ? l.values.includes(item) : new RegExp(l.pattern).test(item)));
    }

    function fieldHtml(group, key) {
        const id = `f-${group}-${key}`;
        const attrs = `id="${id}" data-group="${group}" data-key="${esc(key)}"`;
        if (isList(group, key)) return `<input ${attrs} data-list="1" type="text" spellcheck="false" class="field list-field">`;
        const choices = choicesOf(group, key);
        if (choices) return `<select ${attrs} class="field">${choices.map((c) => `<option value="${esc(c)}">${esc(c)}</option>`).join('')}</select>`;
        const [min, max, int] = limitsOf(group, key);
        return `<input ${attrs} type="number" min="${min}" max="${max}" step="${int ? 1 : 'any'}" class="field num-field">`;
    }

    function rangeText(group, key) {
        if (isList(group, key)) return `at least ${limitsOf(group, key).min_items}`;
        const choices = choicesOf(group, key);
        if (choices) return '';
        const [min, max] = limitsOf(group, key);
        return `${min}–${max}`;
    }

    function renderForm() {
        const roleOf = Object.fromEntries(Object.entries(state.roles).map(([role, tf]) => [tf, role]));
        $('form').innerHTML = SECTIONS.filter((s) => s.groups.length).map((s) => `<div class="grid grid-2" data-section="${s.id}">${s.groups.map((group) => {
            const g = GROUPS[group];
            const rows = Object.keys(state.saved[group]).map((key) => {
                const help = perTf(group) ? (roleOf[key] ? `Role ${roleOf[key]}` : 'Not a role timeframe') : g.help[key] || '';
                const meta = [help, `default ${state.defaults[group][key] ?? '-'}`, rangeText(group, key)].filter(Boolean).join(' · ');
                return `<div class="config-row" data-row="${group}.${esc(key)}">
                    <label for="f-${group}-${esc(key)}"><div class="config-key">${esc(key)}</div><div class="config-help">${esc(meta)}</div></label>
                    <div>${fieldHtml(group, key)}</div>
                </div>`;
            }).join('');
            return `<div class="card"><div class="card-head"><h2 class="card-title">${esc(g.title)}</h2>${g.note ? `<span class="card-note">${esc(g.note)}</span>` : ''}</div>${rows}</div>`;
        }).join('')}</div>`).join('');
        fillForm(state.saved);
        $('form').addEventListener('input', markDirty);
        $('form').addEventListener('change', markDirty);
    }

    function fillForm(cfg) {
        for (const el of inputs()) {
            const v = cfg[el.dataset.group][el.dataset.key] ?? state.saved[el.dataset.group][el.dataset.key];
            el.value = Array.isArray(v) ? v.join(', ') : v;
        }
        markDirty();
    }

    // Reads the form; returns { value, bad } where bad lists invalid fields.
    function readForm() {
        const value = Object.fromEntries(Object.keys(GROUPS).map((g) => [g, {}]));
        const bad = [];
        for (const el of inputs()) {
            const { group, key } = el.dataset;
            const v = fieldValue(el);
            const choices = choicesOf(group, key);
            const list = isList(group, key);
            const [min, max, int] = choices || list ? [] : limitsOf(group, key);
            const ok = list ? listOk(v, limitsOf(group, key)) : choices ? choices.includes(v) : Number.isFinite(v) && v >= min && v <= max && (!int || Number.isInteger(v));
            el.classList.toggle('bad', !ok);
            if (!ok) bad.push(`${group}.${key}`);
            value[group][key] = v;
        }
        return { value, bad };
    }

    const dirtyInputs = () => inputs().filter((el) => !same(fieldValue(el), state.saved[el.dataset.group][el.dataset.key]));

    function markUnused() {
        const model = $('f-signal-model')?.value ?? state.saved.signal.model;
        for (const el of inputs()) {
            const row = el.closest('.config-row');
            const used = usedByModel(model, el.dataset.group, el.dataset.key);
            row.classList.toggle('unused', !used);
            row.title = used ? '' : `Not used by the ${model} model`;
        }
    }

    function markDirty() {
        const dirty = dirtyInputs();
        for (const el of inputs()) el.classList.toggle('dirty', dirty.includes(el));
        const { bad } = readForm();
        $('save').disabled = dirty.length === 0 || bad.length > 0;
        $('revert').disabled = dirty.length === 0;
        const status = $('save-status');
        status.className = `t-data ${bad.length ? 'neg' : 'warn'}`;
        status.textContent = bad.length ? `Out of range: ${bad.join(', ')}` : dirty.length ? `${dirty.length} unsaved ${dirty.length === 1 ? 'change' : 'changes'}` : '';
        markUnused();
        renderTabs();
        renderRuns();
    }

    function renderTabs() {
        const dirtyGroups = dirtyInputs().map((el) => el.dataset.group);
        $('tabs').innerHTML = SECTIONS.map((s) => {
            const n = dirtyGroups.filter((g) => s.groups.includes(g)).length;
            return `<button type="button" role="tab" data-show="${s.id}" aria-selected="${s.id === state.section}">${esc(s.title)}${n ? `<span class="count">${n}</span>` : ''}</button>`;
        }).join('');
    }

    function showSection(id) {
        state.section = id;
        const section = SECTIONS.find((s) => s.id === id);
        $('form').hidden = section.groups.length === 0;
        for (const el of $('form').querySelectorAll('[data-section]')) el.hidden = el.dataset.section !== id;
        $('runs-card').hidden = !section.runs;
        $('ops-card').hidden = !section.ops;
        $('save-bar').hidden = section.groups.length === 0;
        if (section.ops) loadHealth();
        renderTabs();
    }

    async function save() {
        const { value, bad } = readForm();
        if (bad.length) return;
        $('save').disabled = true;
        try {
            const res = await AppHeader.adminFetch('/api/calc-config', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.problems ? data.problems.join('; ') : data.error || `HTTP ${res.status}`);
            state.saved = data.config;
            fillForm(state.saved);
            renderRestartNote();
            $('save-status').className = 't-data pos';
            $('save-status').textContent = 'Saved and applied. Re-run the backtest to measure it.';
            await loadEdges();
        } catch (err) {
            markDirty();
            $('save-status').className = 't-data neg';
            $('save-status').textContent = `Save failed: ${err.message}`;
        }
    }

    async function loadEdges() {
        await Promise.all(state.markets.map(async (m) => {
            try {
                const res = await fetch(`/api/edge/${encodeURIComponent(m)}`);
                state.edges[m] = res.ok ? await res.json() : null;
            } catch (e) {
                state.edges[m] = null;
            }
        }));
        renderRuns();
    }

    const JOB_TONES = { queued: 'muted', running: 'warn', done: 'pos', failed: 'neg' };

    function renderRuns() {
        if (!state.markets.length) return;
        const busy = state.runs?.running;
        const dirty = state.saved && dirtyInputs().length > 0;
        $('run-all').disabled = busy || dirty;
        $('run-all').title = dirty ? 'Save the config first' : busy ? 'A backtest is running' : '';
        $('runs').innerHTML = state.markets.map((m) => {
            const e = state.edges[m];
            const b = e?.backtest;
            const job = state.runs?.jobs?.[m];
            const match = !b ? '<span class="muted">no report</span>' : b.params_match ? '<span class="pos">current</span>' : '<span class="warn" title="The report used other settings">differs</span>';
            const jobCell = job ? `<span class="${JOB_TONES[job.state] || ''}" title="${esc(job.output.join('\n'))}">${esc(job.state)}</span> <span class="muted">${esc((job.state === 'failed' ? job.error : job.progress) || '')}</span>` : '';
            const verdict = e ? SignalView.edgeOf(e.verdict) : null;
            return `<tr>
                <td class="strong-cell"><a href="/backtest/${encodeURIComponent(m)}">${esc(m)}</a></td>
                <td class="muted">${b ? `${utc(b.generated_at)} · fee ${esc(b.fee_pct)}%` : '-'}</td>
                <td>${match}</td>
                <td class="right">${b?.taken ? esc(b.taken.trades) : '-'}</td>
                <td class="right ${Fmt.tone(b?.taken?.expectancy_r)}">${num(b?.taken?.expectancy_r, 3)}</td>
                <td class="right ${Fmt.tone(b?.out_of_sample?.expectancy_r)}">${b?.out_of_sample ? `${num(b.out_of_sample.expectancy_r, 3)} <span class="muted">(${esc(b.out_of_sample.trades)})</span>` : '-'}</td>
                <td>${verdict ? `<span class="badge ${verdict.tone}">${verdict.word}</span>` : '-'}</td>
                <td class="wrap">${jobCell}</td>
                <td><button type="button" data-run="${esc(m)}" class="btn small" ${busy || dirty ? 'disabled' : ''}>Run</button></td>
            </tr>`;
        }).join('');
        $('run-note').textContent = busy ? 'Running… markets run one after another; this page refreshes by itself.' : '';
    }

    let pollTimer = null;
    async function loadRuns() {
        try {
            const res = await fetch('/api/backtest-runs');
            if (!res.ok) return;
            const prev = state.runs;
            state.runs = await res.json();
            const finished = Object.entries(state.runs.jobs).some(([m, j]) => j.state === 'done' && prev?.jobs?.[m] && prev.jobs[m].state !== 'done');
            if (finished) await loadEdges();
            renderRuns();
            clearTimeout(pollTimer);
            if (state.runs.running) pollTimer = setTimeout(loadRuns, 2000);
        } catch (e) { /* keep the last state */ }
    }

    async function startRun(market) {
        try {
            const res = await AppHeader.adminFetch('/api/backtest-runs', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ market }) });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
            $('run-note').textContent = '';
        } catch (err) {
            $('run-note').textContent = `Could not start: ${err.message}`;
            return;
        }
        await loadRuns();
    }

    // The engine group applies at startup only: say which saved values wait for a restart.
    function renderRestartNote() {
        const note = $('restart-note');
        const saved = state.saved.engine || {};
        const diff = state.running ? Object.keys(saved).filter((k) => !same(saved[k], state.running[k])) : [];
        note.hidden = diff.length === 0;
        note.textContent = diff.length ? `Restart the app to apply: ${diff.map((k) => `engine.${k} ${state.running[k]} → ${saved[k]}`).join(', ')}. Until then the running values stay in use.` : '';
    }

    async function resetData() {
        if (!window.confirm('Refetch every timeframe from Binance and rebuild the Market State? Existing data is kept if a fetch fails.')) return;
        const btn = $('reset');
        const note = $('reset-note');
        btn.disabled = true;
        note.className = 't-data muted';
        note.textContent = 'Refetching…';
        try {
            const res = await AppHeader.adminFetch('/api/reset', { method: 'POST' });
            const data = await res.json().catch(() => ({}));
            if (res.status === 409) throw new Error('a refetch is already running');
            if (res.status === 429) throw new Error(`wait ${data.retry_after ?? 'a moment'} s before the next one`);
            if (!res.ok || !data.success) throw new Error(data.error || (data.results ? 'some timeframes failed; their existing data was kept' : `HTTP ${res.status}`));
            note.className = 't-data pos';
            note.textContent = 'Done.';
        } catch (err) {
            note.className = 't-data neg';
            note.textContent = `Refetch failed: ${err.message}`;
        }
        btn.disabled = false;
        loadHealth();
    }

    async function loadHealth() {
        const h = await fetch('/api/health').then((r) => (r.ok ? r.json() : null)).catch(() => null);
        if (!h) { $('health-note').textContent = 'Unavailable'; return; }
        const stream = h.binance?.stream;
        const cool = h.binance?.cooldown;
        $('health-note').textContent = [cool ? `Binance paused (${cool.code}) until ${utc(cool.until)} UTC` : 'Binance reachable', stream ? `price stream ${stream.connected ? 'connected' : 'disconnected'}` : ''].filter(Boolean).join(' · ');
        const markets = Object.keys(h.markets);
        const tfs = [...new Set(markets.flatMap((m) => Object.keys(h.markets[m])))];
        $('health-head').innerHTML = `<tr><th>Market</th>${tfs.map((tf) => `<th>${esc(tf)}</th>`).join('')}</tr>`;
        $('health').innerHTML = markets.map((m) => `<tr><td class="strong-cell">${esc(m)}</td>${tfs.map((tf) => {
            const c = h.markets[m][tf];
            const code = c?.last_error?.code;
            return `<td>${code ? `<span class="neg" title="${esc(c.last_error.message ?? '')}">${esc(code)}</span>` : '<span class="pos">ok</span>'}</td>`;
        }).join('')}</tr>`).join('');
    }

    async function init() {
        const app = (await AppHeader.init()) || {};
        try {
            const res = await fetch('/api/calc-config');
            if (!res.ok) throw new Error(`GET /api/calc-config: HTTP ${res.status}`);
            const data = await res.json();
            state.saved = data.config;
            state.defaults = data.defaults;
            state.limits = data.limits;
            state.roles = data.role_timeframes || {};
            state.running = data.running_engine;
            state.markets = (app.markets || []).map((m) => m.code);
            $('file').textContent = data.file;
        } catch (err) {
            $('load-error').textContent = `Config unavailable: ${err.message}`;
            $('load-error').hidden = false;
            return;
        }
        renderForm();
        renderRestartNote();
        showSection(state.section);
        $('tabs').addEventListener('click', (ev) => {
            const id = ev.target.closest('[data-show]')?.dataset.show;
            if (id) showSection(id);
        });
        $('save').addEventListener('click', save);
        $('revert').addEventListener('click', () => fillForm(state.saved));
        $('defaults').addEventListener('click', () => fillForm(state.defaults));
        $('run-all').addEventListener('click', () => startRun('all'));
        $('reset').addEventListener('click', resetData);
        $('runs').addEventListener('click', (ev) => {
            const m = ev.target.closest('button[data-run]')?.dataset.run;
            if (m) startRun(m);
        });
        await Promise.all([loadEdges(), loadRuns()]);
    }

    init();
})();
