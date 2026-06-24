# 🎒 Elango — Autonomous AI Travel Backpacker (Tamil Nadu Engine)

A real-time, ambient travel dashboard following **Elango**, an autonomous AI
backpacker crawling across Tamil Nadu. Fully self-hosted — no external SaaS:

- **Next.js 14** (App Router, standalone output) + **Tailwind CSS**
- **PostgreSQL** (local, via Docker) as the state machine — accessed with `pg`
- **React-Leaflet** + OpenStreetMap raster tiles (no API key)
- **Overpass API** for nearby landmark discovery
- **Local Qwen-2.5** via **Ollama** for story + chat generation
- **Docker Compose** orchestrates the database, the app, and an autonomous ticker

---

## Quick start (Docker — runs everything, single command)

The whole stack — database, **Ollama**, the model download, the app, and the
autonomous ticker — is self-contained. No host Ollama, no manual model pull:

```bash
docker compose up --build
```

That's the only command. On first run it will:

- Start Postgres and initialise its schema + seed from `db/init.sql`.
- Start the `ollama` service and, via the one-shot `ollama-pull` service,
  download the model in `LOCAL_LLM_MODEL` (`qwen2.5:7b`, ~4.7GB) into the
  `ollama` named volume — so it's only downloaded once.
- Start the `app` service **after** the model is ready, serving the dashboard
  at <http://localhost:3005> (host port; the container itself listens on 3000).
- Start the `ticker`, which advances Elango every `TICK_INTERVAL_SECONDS`
  (`.env`, default 600s) once the app is healthy.

The app reaches the model at `http://ollama:11434` over the Compose network.

> **Performance note:** Ollama runs **CPU-only** by default. `qwen2.5:7b` is
> slow on CPU, so Elango's stories often fall back to the built-in (still
> coherent) template text — movement, exploration, votes and chat all work
> regardless. If you have an NVIDIA GPU, uncomment the `deploy:` GPU block on
> the `ollama` service in `docker-compose.yml` (needs the NVIDIA Container
> Toolkit) for fast, fully LLM-generated stories.

To stop (data is preserved in the `pgdata` volume):

```bash
docker compose down
```

To wipe the database and re-seed from scratch:

```bash
docker compose down -v
```

---

## Local development (`npm run dev`)

Run just the database in Docker, and the app on your machine:

```bash
docker compose up -d db        # Postgres on localhost:5432
npm install
npm run dev                    # http://localhost:3000
```

`.env.local` points `DATABASE_URL` at `localhost:5432` and Ollama at
`localhost:11434`. Advance the journey manually:

```bash
curl -H "Authorization: Bearer <CRON_SECRET_TOKEN>" http://localhost:3000/api/travel-tick
```

(If `CRON_SECRET_TOKEN` is blank the endpoint is open and no header is needed.)

---

## Environment files

| File | Purpose |
|------|---------|
| `.env` | Docker Compose substitution + container runtime (Postgres creds, model name, ticker interval). |
| `.env.local` | Local `npm run dev` overrides (`DATABASE_URL` → localhost). |

Key variables:

```env
# .env (Docker)
POSTGRES_USER=elango
POSTGRES_PASSWORD=elango_secret
POSTGRES_DB=travelbot
LOCAL_LLM_ENDPOINT=http://ollama:11434   # in-stack Ollama service
LOCAL_LLM_MODEL=qwen2.5:7b               # auto-pulled by the ollama-pull service
CRON_SECRET_TOKEN=...
TICK_INTERVAL_SECONDS=600

# .env.local (local dev)
DATABASE_URL=postgres://elango:elango_secret@localhost:5432/travelbot
LOCAL_LLM_ENDPOINT=http://localhost:11434
```

> The Overpass and Ollama calls both have timeouts and graceful fallback text,
> so the site stays coherent even if either service is slow or down.

---

## Database schema

Created automatically by `db/init.sql` on first container start. To apply it to
an existing database manually:

```bash
psql "$DATABASE_URL" -f db/init.sql
```

Tables: `bot_state` (location + energy/wallet state machine), `active_votes`
(the "fork in the road" polls), `live_chat` (follower messages + Elango's replies).

---

## File map

| File | Role |
|------|------|
| `src/app/api/travel-tick/route.js` | Autonomous tick (`GET`) + actions & voting (`POST`) |
| `src/app/api/chat/route.js` | Elango's live chat replies (`POST`) + history (`GET`) |
| `src/app/api/state/route.js` | Single read endpoint for the dashboard (state + feed + path + vote + stats) |
| `src/app/api/postcards/route.js` | Scrapbook: distinct named places visited |
| `src/app/api/supporter/route.js` | A viewer's relationship stats with Elango |
| `src/app/api/presence/route.js` | Live viewer-count heartbeat |
| `src/app/api/leaderboard/route.js` | Top contributors ranking |
| `src/app/api/push/subscribe/route.js` | Web Push: VAPID key (GET) + save/remove subscription |
| `src/components/Leaderboard.js` | Top Supporters card |
| `src/components/Soundscape.js` | Procedural Web Audio ambience |
| `src/lib/push.js` | web-push (VAPID) fan-out helper |
| `public/sw.js` | Service worker for push notifications |
| `src/components/TravelMap.js` | Client-only Leaflet live map (manual init, SSR disabled, Strict-Mode safe) |
| `src/components/Scrapbook.js` | Postcard gallery modal + share |
| `src/app/page.js` | Dashboard: map / feed + controls + vote / chat, plus rescue banner, tiers, clock, viewers |
| `src/lib/db.js` | Pooled Postgres (`pg`) client + `query()` helper |
| `src/lib/ollama.js` | ChatML Ollama client with timeout + fallback |
| `src/lib/journey.js` | Anchor cities, geo-step math, Overpass landmark lookup |
| `src/lib/explore.js` | Self-direction: discover nearby POIs + LLM picks next stop (avoids recent) |
| `src/lib/context.js` | IST time-of-day + Open-Meteo weather |
| `src/lib/media.js` | Wikipedia photo → static-map fallback |
| `src/lib/supporters.js` | Per-viewer memory: log support + build chat memory |
| `scripts/ticker.mjs` | Local-dev ticker (drives the journey outside Docker) |
| `db/init.sql` | Schema + seed (auto-run by the Postgres container) |
| `Dockerfile` / `docker-compose.yml` | Standalone app image + db + ticker orchestration |
```

---

## Engagement features

- **Self-exploring** — at each stop the local LLM picks the next destination from real nearby POIs (Overpass), biased away from recently-visited places (autonomous tick *and* the bus button).
- **Time & weather aware** — IST time-of-day drives meals, a night-rest cycle, and a day/night UI theme; live weather comes from Open-Meteo.
- **Photos & scrapbook** — each stop pulls a Wikipedia photo (static-map fallback); the Scrapbook modal collects every named place with a shareable postcard.
- **Elango remembers you** — chat replies recognise returning viewers and reference the coffees / bus rides / votes they've contributed; a gamified tier badge (Newcomer → Legend) reflects their support.
- **Rescue-me stakes** — energy/wallet decay each tick; low resources raise a "he needs you" banner, and at 0 energy Elango is *exhausted* and can't move until a viewer sends a coffee.
- **Live & ambient** — viewer count, a live IST clock, a "synced Xs ago" indicator, an animated map trail, count-up stats, and a tab-title alert when he moves while your tab is hidden.
- **Votes steer the route** — hub polls offer two real onward destinations; once a poll gets a vote (or expires) the winner's coordinates become Elango's next target, overriding his autonomous choice. He never stalls if nobody votes.
- **Contributor leaderboard** — a Top Supporters ranking (coffees + bus funds + votes) that highlights you.
- **Desktop notifications** — opt-in "Notify me" toggle fires a browser notification when Elango reaches a new town (fires while the tab is open/backgrounded).
- **Closed-tab push** — a service worker + Web Push (VAPID) delivers town-arrival alerts even when the tab is closed. Requires HTTPS in production (works on `localhost`). Keys live in `.env` (`NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT`).
- **Ambient soundscape** — an opt-in, fully procedural Web Audio bed (no audio files): a soft drone plus time-of-day textures (morning birds + temple bells, daytime calm, evening warmth, night crickets) and a rain layer when the weather is wet.
# travel-bot
