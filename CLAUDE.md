# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Elango — an autonomous AI "backpacker" that crawls across Tamil Nadu in real time. A Next.js 14 (App Router, JS — not TS) dashboard renders a live map, an AI-narrated journey feed, live stats, a walkie-talkie chat, a support economy, votes, a scrapbook, a diary, and observability panels. A background "ticker" advances Elango on an interval. All AI runs **locally via Ollama** (no hosted LLM).

## Commands

```bash
# Full stack (Postgres + Ollama + app + ticker), self-contained:
docker compose up -d            # app on http://localhost:3000
docker compose build app        # rebuild after ANY source change (prod image, no hot reload)
docker compose up -d app        # recreate app (also picks up .env changes)
docker compose logs -f app      # logs (incl. `[model] kind=… source=…` traces)

npm run lint                    # next lint
node scripts/ticker.mjs --once  # advance the journey one step locally (npm run tick)

# Advance / drive the engine by hand (CRON_SECRET_TOKEN from .env):
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/travel-tick      # one tick
curl -X POST http://localhost:3000/api/travel-tick -d '{"action":"coffee"}'       # coffee/bus/vote
curl -X POST http://localhost:3000/api/consolidate -H "Authorization: Bearer $TOKEN"  # memory sleep-pass
```

There is **no test suite**. Verify changes by running the app and observing behavior (Playwright/curl/DB), not by unit tests.

## Iterating fast (important — the prod build has no hot reload)

The `app` container is a production `next build` (standalone), so editing source does **not** live-reload `:3000`. The fast loop:

1. Run a local dev server that shares the SAME dockerized DB + Ollama:
   ```bash
   DATABASE_URL='postgres://elango:elango_secret@localhost:5432/travelbot' \
   LOCAL_LLM_ENDPOINT='http://localhost:11435' LOCAL_LLM_MODEL='llama3.2:3b' \
   VISION_MODEL='moondream' OLLAMA_TIMEOUT_MS='90000' PORT=3001 npx next dev -p 3001
   ```
2. Verify on `:3001`. DB migrations apply to the shared Postgres, so both servers see them.
3. Apply schema changes via `docker exec -i travel-bot-db-1 psql -U elango -d travelbot` **and** mirror them in `db/init.sql` (idempotent `ADD COLUMN IF NOT EXISTS` / `CREATE TABLE IF NOT EXISTS`) for fresh installs.
4. Ship to `:3000` with `docker compose build app && docker compose up -d app`.
5. If a route unexpectedly 404s on the dev server, the `.next` cache is stale — `rm -rf .next` and restart.

## Architecture

The whole product is an **agent loop** driven by one HTTP endpoint and persisted to Postgres.

- **`src/app/api/travel-tick/route.js`** is the engine. `GET` = one autonomous step; `POST` = interactive actions (`coffee`, `bus`, `vote`). Each step: pick/keep a destination → micro-step toward it → narrate → persist a new `bot_state` row. Night → rest branch (also runs memory consolidation); energy ≤ 0 → exhausted branch.
- **Episodic memory IS the `bot_state` table** — an append-only log. The newest row is current state; the last N rows are the feed/path. Everything (mood, beat, observation, story_source) is recorded per row.
- **`src/lib/agent/` is the loop's brain** (specs live as shared artifacts; this is the code):
  - `signals.js` (REACT) — score real-world signals (weather/time/arrival/energy) by relevance×novelty×salience×shareability; pick ≤1 "beat" above a threshold, with cooldown so most ticks stay calm.
  - `director.js` (DECIDE) — pure/deterministic; turns the beat + state into an intent `{ mood, beat, route, spend }`. Routes to `eyes` only on high-score beats.
  - `organs.js` (model router) — the warm `narrate()` Voice organ + the cold `eyes()` vision organ; `narrate` is shaped by the intent and grounded in the eyes' observation.
  - `memory.js` (REMEMBER) — `consolidate()` (the nightly "sleep pass": episodes → diary + semantic facts + refreshed `people` profiles, with bond decay) and `recallForChat()` (hot-path: pull a viewer's profile + relevant facts; flags returning / "missed").
- **`src/lib/` services** are all keyless + degrade gracefully: `journey.js` (geo math, `formatLocation`, anchor cities), `explore.js` (Overpass POI discovery + LLM route choice), `context.js` (IST time-of-day + Open-Meteo weather), `media.js` (Wikipedia/OSM imagery), `ollama.js` (LLM client), `supporters.js`, `push.js` (Web Push), `db.js` (pg pool), `trace.js` (model-call observability).
- **Frontend** `src/app/page.js` is one client component that polls `/api/state` (15s) and `/api/chat` (7s); components in `src/components/` (TravelMap, Scrapbook, Diary, ModelLog, Leaderboard, Soundscape).

### Data flow per tick
`getLatestState()` → time/weather → choose target (vote > LLM > nearest) → `stepToward` → `gatherSignals`→`pickBeat`→`decide` → `eyes?` → `narrate` → `insertState` → detached `prebuildNextStory` (speculative next-tick cache) → on rest, detached `consolidate`.

## Models & the LLM client

- **Voice/text** = `llama3.2:3b` (`LOCAL_LLM_MODEL`); **vision/eyes** = `moondream` (`VISION_MODEL`); `qwen2.5:3b` is kept as a fallback.
- `generateFromOllama()` uses **`/api/chat`** (model-agnostic chat template — do NOT go back to raw ChatML, which is Qwen-only) and **never throws**: on timeout / non-OK / empty it returns the exact `fallback` string passed in. `describeImage()` is the vision call and returns `null` on failure (eyes degrades silently).
- CPU-only inference is **slow (~25–50s)** and sometimes times out into the fallback. This is expected. The product is designed around it: movement/stats are LLM-independent; user actions use **optimistic UI** (instant feedback before the LLM resolves); ticks pre-generate the next story during the idle window.

### Observability (model vs fallback)
Because the model silently falls back, provenance is tracked everywhere:
- `lib/trace.js` records every call to `model_calls` (`kind`, `model`, `source: model|fallback`, `ms`, preview) + a `[model] …` console line. Pass a `kind` to `generateFromOllama` to label calls (`story`, `chat`, `diary`, `destination`, `coffee`, `bus`, `vision`, …).
- Each dispatch stores `bot_state.story_source` (`'model'|'fallback'`, derived by `srcOf(text, fallback)`); the feed card shows a ✨ live / ↩︎ template badge.
- See it via the **🧠 Models** UI panel or `GET /api/model-log`.

## Gotchas

- **Model pulls inside Docker**: the Ollama container needs `dns: [1.1.1.1, 8.8.8.8]` + IPv6 disabled (in `docker-compose.yml`) — the embedded DNS times out on the Cloudflare R2 blob host and IPv6 is drop-prone over the Docker Desktop vpnkit network. A partial/EOF'd pull can leave a **corrupt blob** that "completes" but fails to load (`tensor … exceeds file size`); purge `blobs/*-partial*` and re-pull clean.
- **`formatLocation(landmark, city)`** dedupes when the landmark already names the city (avoid `"…near Madurai, Madurai"`). Use it for any location label.
- **Graceful degradation is a feature, not an afterthought** — every external call (Overpass, Open-Meteo, Wikipedia, Ollama, push, DB) must have a fallback so a tick never fails.
- **Schema changes** must land in both the live DB and `db/init.sql`. `insertState()` in travel-tick has a fixed column list — extend it when adding `bot_state` columns.

## Environment

`.env` configures Docker (committed; contains the demo `CRON_SECRET_TOKEN` + VAPID keys). `.env.local` overrides for `npm run dev`. Both `.env` and `*.local` are gitignored. Key vars: `DATABASE_URL`, `LOCAL_LLM_ENDPOINT`, `LOCAL_LLM_MODEL`, `VISION_MODEL`, `OLLAMA_TIMEOUT_MS`, `CRON_SECRET_TOKEN`, `TICK_INTERVAL_SECONDS`, VAPID keys.

## Conventions

- JS + App Router; API routes are `runtime = "nodejs"`, `dynamic = "force-dynamic"`.
- UI is Tailwind; the visual system is slate ground + emerald accent + a functional palette (amber/sky/rose/indigo/violet), `rounded-xl/2xl` cards with `ring-1 ring-black/5`, day/night gradient theming. New surfaces should match it.
- Commit only when asked; mirror DB changes into `db/init.sql`.
