// Runs the backtest CLI (scripts/backtest.js) in a child process for the /config view, so a replay
// never blocks the server. One batch at a time; its markets run one after another, and each run
// writes data/backtest/{SYMBOL}.json like `npm run backtest -- SYMBOL`.
const { spawn: nodeSpawn } = require('child_process');
const path = require('path');

const ROOT = path.join(__dirname, '../..');
const SCRIPT = path.join(ROOT, 'scripts/backtest.js');
// A run longer than this is stopped (a year of 15m candles normally takes a few minutes).
const MAX_RUN_MS = 60 * 60 * 1000;
const TAIL_LINES = 15;

function createBacktestRunner({ spawn = nodeSpawn, script = SCRIPT, now = () => Date.now(), maxRunMs = MAX_RUN_MS, log = console } = {}) {
    const sec = () => Math.floor(now() / 1000);
    // market -> latest job for that market.
    const jobs = new Map();
    let running = false;
    let child = null;

    const copy = (job) => ({ ...job, output: [...job.output] });

    function runOne(job) {
        return new Promise((resolve) => {
            job.state = 'running';
            job.started_at = sec();
            let done = false;
            let timer = null;
            const finish = (ok, error = null) => {
                if (done) return;
                done = true;
                clearTimeout(timer);
                child = null;
                job.state = ok ? 'done' : 'failed';
                job.finished_at = sec();
                job.error = ok ? null : error;
                if (ok) log.log(`[BacktestRun] ${job.market} done`);
                else log.error(`[BacktestRun] ${job.market} failed: ${job.error}`);
                resolve();
            };
            const onData = (chunk) => {
                // The CLI rewrites its progress line with \r; keep the latest lines only.
                for (const line of String(chunk).split(/[\r\n]+/)) {
                    const text = line.trim();
                    if (!text) continue;
                    job.progress = text;
                    job.output.push(text);
                    if (job.output.length > TAIL_LINES) job.output.shift();
                }
            };
            try {
                child = spawn(process.execPath, [script, job.market], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
            } catch (err) {
                finish(false, err.message);
                return;
            }
            timer = setTimeout(() => {
                const running = child;
                finish(false, 'timeout');
                running.kill('SIGTERM');
            }, maxRunMs);
            if (timer.unref) timer.unref();
            child.stdout.on('data', onData);
            child.stderr.on('data', onData);
            child.on('error', (err) => finish(false, err.message));
            child.on('close', (code) => finish(code === 0, code === 0 ? null : (job.progress || `exit code ${code}`)));
        });
    }

    // Queues `markets` and runs them in order. Returns { error } while another batch runs.
    function start(markets) {
        if (running) return { error: 'backtest_running' };
        const batch = markets.map(market => ({ market, state: 'queued', queued_at: sec(), started_at: null, finished_at: null, progress: null, error: null, output: [] }));
        for (const job of batch) jobs.set(job.market, job);
        running = true;
        (async () => {
            for (const job of batch) await runOne(job);
        })().finally(() => { running = false; });
        return { jobs: batch.map(copy) };
    }

    function status() {
        return { running, jobs: Object.fromEntries([...jobs].map(([m, job]) => [m, copy(job)])) };
    }

    // Stops a run in progress (server shutdown).
    function stop() {
        if (child) child.kill('SIGTERM');
    }

    return { start, status, stop };
}

module.exports = { createBacktestRunner, MAX_RUN_MS };
