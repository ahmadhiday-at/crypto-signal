# CLAUDE.md

Details live in `docs/`; read a doc only when the task touches it (see Document map).

## Commands

Node.js ≥22 (Docker: Node 24). No linter/build step.

```bash
npm run dev    # nodemon: server.js + src/, ignores data/
npm test       # node:test, no network
node --test --test-name-pattern="reset" "test/**/*.test.js"
docker compose up -d            # add --build if package*.json or Dockerfile changed
docker compose restart app      # after .env changes
```

- Tests: use fakes from `test/helpers.js`; never hit real Binance. E2E: point `BINANCE_REST_URL` at a local fake server, run `server.js` with `HOST=127.0.0.1` and a spare `PORT`.
- Docker bind-mounts this folder with nodemon: **editing `server.js`/`src/` hot-reloads the user's running app**. For multi-step changes use a separate git worktree and apply the finished diff.
- `data/` is committed but rewritten by the running app: don't commit it unless asked; its diffs need no version bump or changelog.

## Architecture

Express "Market State Reducer": fetches Binance klines, computes indicators and S/R zones per timeframe from **closed candles only**, merges the 4 role timeframes into one Market State per symbol (schema v2). A UTC boundary scheduler drives updates; freshness (`ok`/`degraded`/`stale`) is recomputed on every read. `public/` HTML pages use REST + WebSocket.

Binance HTTP 451 = access restriction; open policy question; never add automatic workarounds.

## Document map

- REST endpoints, 503 body → `docs/contract/rest.md`
- `/api/market/:symbol` fields, `enhanceMarketState` output → `docs/contract/market-state.md` (update first)
- WS message shapes → `docs/contract/websocket.md`
- Code map, components → `docs/architecture/overview.md`
- Update/freshness/failure behaviour → `docs/architecture/operating-model.md`
- Env vars, config → `docs/architecture/config.md`, `.env.example`
- Docker/VPN → `docs/DEPLOYMENT.md` (Indonesian)
- Planned work → `docs/roadmap/level-3.md` (active); other levels in `docs/roadmap/`

## When a task is done

Every code/config/behaviour change ships with:

1. `npm version <patch|minor|major> --no-git-tag-version`, once per task. patch = fix/refactor, no contract change; minor = new feature/endpoint/field/timeframe/env var; major = breaking: renaming/removing a field in `enhanceMarketState` or `/api/*` output, changing WS shapes (`price`, `update_ready`, `subscribe`), changing `data/` paths/format, renaming/removing an env var.
2. `docs/changelog/vX.Y.Z.md` (exact package.json version) per `docs/changelog/TEMPLATE.md`: terse, one line per point; always fill **Breaking**/**Aksi** when relevant. Never edit a released changelog file.
3. Add at TOP of `CHANGELOG.md` list (read ≤20 lines): `- [vX.Y.Z](docs/changelog/vX.Y.Z.md) — YYYY-MM-DD — one-sentence summary`
4. Update affected docs per Document map.

## Do not touch

`PROMPT_AI_*.md`, `.prompt_manual/`: user-maintained, unused by code. Never read, search or edit (blocked in settings; don't bypass via shell). Exclude in searches: `--exclude='PROMPT_AI_*' --exclude-dir=.prompt_manual`. If needed, ask the user to paste content.
