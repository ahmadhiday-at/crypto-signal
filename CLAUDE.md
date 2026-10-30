# CLAUDE.md

Guidance for Claude Code in this repository. Details live in `docs/`; read a doc only when the task touches it (see the document map).

## Stack

Node.js ≥ 22 (Docker image: Node 24), Express 4, CommonJS, `ws`, `axios`, `technicalindicators`, dotenv. Tests: built-in `node:test`. Runs in Docker behind a gluetun WireGuard VPN container.

## Commands

```bash
npm install
npm run dev     # nodemon; watches server.js + src/, ignores data/
npm start       # node server.js
npm test                                   # all tests (node:test, no network, no Binance calls)
node --test test/engine.test.js            # one file
node --test --test-name-pattern="reset" "test/**/*.test.js"   # tests matching a name
docker compose up -d            # app behind gluetun WireGuard VPN (see docs/DEPLOYMENT.md)
docker compose up -d --build    # needed when package.json, package-lock.json or the Dockerfile change
docker compose restart app      # after .env changes
```

- No linter or build step.
- Tests use fakes from `test/helpers.js` (`fakeBinance`, `tempStorage`, `rawKlines`); never hit real Binance in tests. End-to-end: point `BINANCE_REST_URL` at a local fake server and run `server.js` with `HOST=127.0.0.1` and a spare `PORT`.
- The Docker app container bind-mounts this folder and runs nodemon, so **editing `server.js` or `src/` hot-reloads the user's running app**. For multi-step changes, work in a separate git worktree and apply the finished diff.
- `data/` is committed to git and rewritten by the running app; don't commit it unless asked.

## Architecture

Express "Market State Reducer": fetches Binance klines, computes indicators and S/R zones per timeframe from **closed candles only**, and merges the four role timeframes into one Market State per symbol (`docs/DATA_CONTRACT.md`, schema v2). A UTC boundary scheduler drives updates; freshness (`ok`/`degraded`/`stale`) is recomputed on every read. Plain HTML pages in `public/` use the REST API and WebSocket. Full design, Operating Model, code map and configuration notes: `docs/ARCHITECTURE.md`.

A Binance HTTP 451 is an access restriction; whether VPN routing is acceptable is an open policy question (`docs/DEPLOYMENT.md` → "Akses Binance"). Never add automatic workarounds for it.

## Document map

| Change touches | Read / update |
|---|---|
| Endpoints, `/api/market/:symbol` fields, `enhanceMarketState` output | `docs/DATA_CONTRACT.md` (update it first) |
| Architecture, data flow, update/freshness/failure behaviour, config notes | `docs/ARCHITECTURE.md` |
| Commands, stack, workflow rules | `CLAUDE.md` |
| Setup, install, run | `README.md`, `.env.example` |
| Env vars | `.env.example`, `docs/ARCHITECTURE.md` (Configuration Notes), `docs/DEPLOYMENT.md` if Docker-related |
| Docker / VPN / compose | `docs/DEPLOYMENT.md` (Indonesian) |
| Completing or changing a planned item | `docs/ROADMAP.md` |
| Release notes | `docs/changelog/`, `CHANGELOG.md` |

## When a task is done

Every change to code, config, or behaviour ships with:

1. **Version bump** in `package.json` (and lock):
   ```bash
   npm version patch --no-git-tag-version   # fix, refactor, tweak that changes no contract
   npm version minor --no-git-tag-version   # new feature, endpoint, field, timeframe, env var
   npm version major --no-git-tag-version   # breaking change
   ```
   Breaking = renaming/removing a field in the `enhanceMarketState` output or `/api/*` responses, changing WS message shapes (`price`, `update_ready`, `subscribe`), changing `data/` file paths/format, or renaming/removing an env var. Bump once per task. A version-only change needs no `--build`.
2. **Detail file** `docs/changelog/vX.Y.Z.md` (exact `package.json` version) following `docs/changelog/TEMPLATE.md`. Mention required actions (new env var, `docker compose restart app`, `--build`, deleting `data/`). List updated docs under "Dokumentasi". Never edit a released changelog file.
3. **Index line** at the TOP of the list in `CHANGELOG.md` (read at most its first 20 lines):
   `- [vX.Y.Z](docs/changelog/vX.Y.Z.md) — YYYY-MM-DD — one-sentence summary`
4. **Update affected docs** per the document map.

Not a change: diffs under `data/` produced by running the app (no bump, no changelog).

## Do not touch

- `PROMPT_AI_*.md` and everything in `.prompt_manual/`: maintained manually by the user; no code uses them. **Do not read, search, open or edit them** unless the user explicitly asks for a specific file. Reads/edits are blocked in `.claude/settings.json`; exclude them in shell searches too (e.g. `grep --exclude='PROMPT_AI_*' --exclude-dir=.prompt_manual`).
