// Header shared by Dashboard, Chart and Backtest: market picker (select2), view tabs, Config link, version.
// The Config page gets a short variant that only leads back to the Dashboard.
// A page puts <header id="app-header" data-view="dashboard|chart|backtest|config"> where the header goes;
// its children marked data-header-slot="left" or "right" are kept and placed next to the tabs.
(function () {
    const STORE_MARKET = 'cs.lastMarket';
    const STORE_TF = 'cs.chartTf';

    const store = {
        get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
        set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private mode */ } },
    };

    const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    // Turns a <select> into a select2 dropdown. select2 fires jQuery events only, so a native 'change'
    // is dispatched too: pages listen with addEventListener('change') and never set onchange.
    function select2(el, { width = 'resolve', search = false } = {}) {
        if (!window.jQuery || !jQuery.fn.select2) return el;
        jQuery(el).select2({ width, minimumResultsForSearch: search ? 0 : Infinity, dropdownAutoWidth: true });
        jQuery(el).on('select2:select', () => el.dispatchEvent(new Event('change', { bubbles: true })));
        return el;
    }

    const state = { view: null, market: null, chartTf: null, config: null };

    function viewPath(view, market) {
        const m = encodeURIComponent(market);
        if (view === 'chart') return `/${m}/${encodeURIComponent(state.chartTf)}`;
        if (view === 'backtest') return `/backtest/${m}`;
        return `/${m}`;
    }

    function updateTabs() {
        const root = document.getElementById('app-header');
        root.querySelectorAll('[data-tab]').forEach((a) => { a.href = viewPath(a.dataset.tab, state.market); });
    }

    // The Chart tab and the market picker follow the timeframe chosen on the Dashboard or Chart page.
    function setChartTf(tf) {
        if (!state.config || !state.config.timeframes.some((t) => t.code === tf)) return;
        state.chartTf = tf;
        store.set(STORE_TF, tf);
        updateTabs();
    }

    function renderConfigVariant(root, config) {
        const markets = config.markets.map((m) => m.code);
        const last = store.get(STORE_MARKET);
        const back = markets.includes(last) ? last : markets[0];
        root.innerHTML = `
            <div class="ah-group">
                <a class="ah-back t-title" href="${back ? `/${encodeURIComponent(back)}` : '/'}" title="Back to the Dashboard">← Dashboard</a>
                <span class="t-value" style="color:#9ca3af">Calculation config</span>
            </div>
            <div class="ah-group"><span class="ah-version t-meta mono" title="App version">${esc(config.version ? `v${config.version}` : '')}</span></div>`;
    }

    function renderMain(root, config, slots) {
        const tabs = [['dashboard', 'Dashboard', 'Market State, signal and zones'], ['chart', 'Chart', 'Full multi-pane chart of one timeframe'], ['backtest', 'Backtest', 'Latest backtest report']];
        root.innerHTML = `
            <div class="ah-group" data-slot="left">
                <select class="ah-market" aria-label="Market"></select>
                <nav class="ah-tabs t-control" aria-label="Views">
                    ${tabs.map(([v, label, title]) => `<a class="ah-tab" data-tab="${v}" title="${title}"${v === state.view ? ' aria-current="page"' : ''}>${label}</a>`).join('')}
                </nav>
            </div>
            <div class="ah-group" data-slot="right">
                <a class="ui-btn t-control" href="/config" title="Calculation config and backtest re-run">Config</a>
                <span class="ah-version t-meta mono" title="App version">${esc(config.version ? `v${config.version}` : '')}</span>
            </div>`;

        const select = root.querySelector('.ah-market');
        for (const m of config.markets) select.add(new Option(m.label, m.code, false, m.code === state.market));
        // Keep the URL symbol visible even when it is not configured.
        if (!config.markets.some((m) => m.code === state.market)) {
            const opt = new Option(`${state.market} (not configured)`, state.market, true, true);
            opt.disabled = true;
            select.prepend(opt);
        }
        select2(select, { width: 'style', search: config.markets.length > 6 });
        select.addEventListener('change', () => { window.location.pathname = viewPath(state.view, select.value); });

        // Page items join the header: left ones after the tabs, right ones before Config.
        const left = root.querySelector('[data-slot="left"]');
        const right = root.querySelector('[data-slot="right"]');
        for (const el of slots) {
            if (el.dataset.headerSlot === 'right') right.insertBefore(el, right.querySelector('a.ui-btn'));
            else left.appendChild(el);
        }
        updateTabs();
    }

    // Renders the header and resolves with /api/config (null if it could not be loaded).
    async function init({ market = null, chartTf = null } = {}) {
        const root = document.getElementById('app-header');
        state.view = root.dataset.view;
        state.market = market;
        root.classList.add('app-header');
        const slots = [...root.querySelectorAll(':scope > [data-header-slot]')];

        const config = await fetch('/api/config').then((r) => (r.ok ? r.json() : null)).catch(() => null);
        state.config = config || { markets: [], timeframes: [], roles: {} };
        const tfs = state.config.timeframes.map((t) => t.code);
        state.chartTf = [chartTf, store.get(STORE_TF), state.config.roles?.entry].find((tf) => tfs.includes(tf)) || tfs[0] || '15m';
        if (market && state.config.markets.some((m) => m.code === market)) store.set(STORE_MARKET, market);

        if (state.view === 'config') renderConfigVariant(root, state.config);
        else renderMain(root, state.config, slots);
        return config;
    }

    window.AppHeader = { init, setChartTf, select2 };
})();
