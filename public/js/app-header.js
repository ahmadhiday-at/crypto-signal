// Top bar of every page: brand, views, market picker, version, plus the helpers pages share (toast,
// clipboard, admin requests, live price stream).
// A page puts <header id="app-header" data-view="signals|market|chart|backtest|config">; children with
// data-header-slot="left" or "right" are kept and placed in the bar.
(function () {
    const STORE_MARKET = 'cs.lastMarket';
    const STORE_TF = 'cs.chartTf';
    const STORE_ADMIN = 'cs.adminToken';

    const store = {
        get(key) { try { return localStorage.getItem(key); } catch (e) { return null; } },
        set(key, value) { try { localStorage.setItem(key, value); } catch (e) { /* private mode */ } },
    };
    // The admin token lives in this tab only and is asked for once.
    const adminStore = {
        get() { try { return sessionStorage.getItem(STORE_ADMIN); } catch (e) { return null; } },
        set(v) { try { sessionStorage.setItem(STORE_ADMIN, v); } catch (e) { /* private mode */ } },
        clear() { try { sessionStorage.removeItem(STORE_ADMIN); } catch (e) { /* private mode */ } },
    };

    const state = { view: null, market: null, chartTf: null, config: null };
    const VIEWS = [
        ['signals', 'Signals', 'Every market: long, short or wait'],
        ['market', 'Market', 'One market: signal, plan and chart'],
        ['chart', 'Chart', 'Full chart of one timeframe'],
        ['backtest', 'Backtest', 'How the signal did on history'],
        ['config', 'Config', 'Settings, backtest runs, operations'],
    ];
    const MARKET_VIEWS = ['market', 'chart', 'backtest'];

    // fetch for the actions that change something (config save, backtest run, reset).
    async function adminFetch(url, options = {}) {
        if (state.config && state.config.admin_configured === false) {
            throw new Error('ADMIN_TOKEN is not set on the server: add it to .env and restart the app');
        }
        for (let attempt = 0; attempt < 2; attempt++) {
            const token = adminStore.get() || (window.prompt(attempt ? 'Wrong token. Admin token:' : 'Admin token (ADMIN_TOKEN in .env):') || '').trim();
            if (!token) throw new Error('admin token required');
            adminStore.set(token);
            const res = await fetch(url, { ...options, headers: { ...options.headers, 'X-Requested-With': 'crypto-signal', 'X-Admin-Token': token } });
            if (res.status !== 401) return res;
            adminStore.clear();
        }
        throw new Error('admin token rejected');
    }

    function currentMarket() {
        const markets = (state.config?.markets || []).map((m) => m.code);
        if (state.market) return state.market;
        const last = store.get(STORE_MARKET);
        return markets.includes(last) ? last : markets[0] || '';
    }

    function viewPath(view, market) {
        const m = encodeURIComponent(market);
        if (view === 'signals') return '/signals';
        if (view === 'config') return '/config';
        if (view === 'chart') return `/${m}/${encodeURIComponent(state.chartTf)}`;
        if (view === 'backtest') return `/backtest/${m}`;
        return `/${m}`;
    }

    function updateLinks() {
        document.querySelectorAll('#app-header [data-nav]').forEach((a) => { a.href = viewPath(a.dataset.nav, currentMarket()); });
    }

    // The Chart link and the market picker follow the timeframe chosen on the Market or Chart page.
    function setChartTf(tf) {
        if (!state.config || !state.config.timeframes.some((t) => t.code === tf)) return;
        state.chartTf = tf;
        store.set(STORE_TF, tf);
        updateLinks();
    }

    function render(root, config, slots) {
        const nav = VIEWS.map(([v, label, title]) => `<a data-nav="${v}" title="${title}"${v === state.view ? ' aria-current="page"' : ''}>${label}</a>`).join('');
        root.innerHTML = `
            <div class="topbar-group" data-slot="left">
                <a class="brand" href="/signals">Crypto<span>Signal</span></a>
                <nav class="nav" aria-label="Views">${nav}</nav>
            </div>
            <div class="topbar-group" data-slot="right">
                <span class="version hide-sm" title="App version"></span>
            </div>`;
        root.querySelector('.version').textContent = config.version ? `v${config.version}` : '';

        const left = root.querySelector('[data-slot="left"]');
        const right = root.querySelector('[data-slot="right"]');
        if (MARKET_VIEWS.includes(state.view)) {
            const select = document.createElement('select');
            select.className = 'field market-picker';
            select.setAttribute('aria-label', 'Market');
            for (const m of config.markets) select.add(new Option(m.label, m.code, false, m.code === state.market));
            // Keep the URL symbol visible even when it is not configured.
            if (!config.markets.some((m) => m.code === state.market)) {
                const opt = new Option(`${state.market} (not configured)`, state.market, true, true);
                opt.disabled = true;
                select.prepend(opt);
            }
            select.addEventListener('change', () => { window.location.pathname = viewPath(state.view, select.value); });
            left.appendChild(select);
        }
        for (const el of slots) {
            if (el.dataset.headerSlot === 'right') right.insertBefore(el, right.lastElementChild);
            else left.appendChild(el);
        }
        updateLinks();
    }

    // Renders the bar and resolves with /api/config (null if it could not be loaded).
    async function init({ market = null, chartTf = null } = {}) {
        const root = document.getElementById('app-header');
        state.view = root.dataset.view;
        state.market = market;
        root.classList.add('topbar');
        const slots = [...root.querySelectorAll(':scope > [data-header-slot]')];

        const config = await fetch('/api/config').then((r) => (r.ok ? r.json() : null)).catch(() => null);
        state.config = config || { markets: [], timeframes: [], roles: {} };
        const tfs = state.config.timeframes.map((t) => t.code);
        state.chartTf = [chartTf, store.get(STORE_TF), state.config.roles?.entry].find((tf) => tfs.includes(tf)) || tfs[0] || '1h';
        if (market && state.config.markets.some((m) => m.code === market)) store.set(STORE_MARKET, market);
        render(root, state.config, slots);
        return config;
    }

    let toastTimer = null;
    function toast(message) {
        let el = document.getElementById('toast');
        if (!el) {
            el = document.createElement('div');
            el.id = 'toast';
            el.className = 'toast';
            el.setAttribute('role', 'status');
            document.body.appendChild(el);
        }
        el.textContent = message;
        el.classList.add('show');
        clearTimeout(toastTimer);
        toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
    }

    async function copy(text, message = 'Copied') {
        try {
            await navigator.clipboard.writeText(text);
            toast(message);
        } catch (e) {
            toast('Could not copy');
        }
    }

    // Live messages of one market (one socket per market). `timeframe` chooses which update_ready
    // arrives; onMessage gets every parsed message, onState true/false as the socket opens and closes.
    function live({ market, timeframe, onMessage, onState }) {
        let tf = timeframe;
        let ws = null;
        const send = () => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: 'subscribe', market, timeframe: tf })); };
        function connect() {
            ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}`);
            ws.onopen = () => { if (onState) onState(true); send(); };
            ws.onmessage = (event) => {
                let msg;
                try { msg = JSON.parse(event.data); } catch (e) { return; }
                onMessage(msg);
            };
            ws.onclose = () => { if (onState) onState(false); setTimeout(connect, 5000); };
        }
        connect();
        return { subscribe(next) { tf = next; send(); } };
    }

    function setConn(el, connected) {
        el.classList.toggle('on', connected);
        el.classList.toggle('off', !connected);
        el.textContent = connected ? 'Live' : 'Reconnecting';
    }

    // The action shared by the Market and Config pages: refetch every timeframe, keep data on failure.
    window.AppHeader = { init, setChartTf, adminFetch, toast, copy, live, setConn, store };
})();
