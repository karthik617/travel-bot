#!/usr/bin/env node
// Local-dev ticker: drives Elango's journey when you're running `npm run dev`
// (the Docker `ticker` service only runs as part of `docker compose up`).
//
// Usage:
//   node scripts/ticker.mjs                 # loop forever, interval from env
//   node scripts/ticker.mjs --once          # advance a single step and exit
//   node scripts/ticker.mjs --interval=30   # loop every 30 seconds
//   node scripts/ticker.mjs --url=http://localhost:3000
//
// Reads CRON_SECRET_TOKEN and TICK_INTERVAL_SECONDS from .env.local then .env
// so it stays in sync with the rest of the app — no extra config needed.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Minimal .env parser: returns a flat key→value object (no overrides of real env). */
function readEnvFile(name) {
  try {
    const text = readFileSync(join(root, name), "utf8");
    const out = {};
    for (const line of text.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      out[trimmed.slice(0, eq).trim()] = trimmed.slice(eq + 1).trim();
    }
    return out;
  } catch {
    return {};
  }
}

// Precedence: real process env > .env.local > .env (matches Next.js dev).
const fileEnv = { ...readEnvFile(".env"), ...readEnvFile(".env.local") };
const env = (key, fallback) => process.env[key] ?? fileEnv[key] ?? fallback;

// CLI args
const args = process.argv.slice(2);
const has = (flag) => args.includes(flag);
const val = (prefix, fallback) => {
  const hit = args.find((a) => a.startsWith(prefix));
  return hit ? hit.slice(prefix.length) : fallback;
};

const baseUrl = val("--url=", env("TICK_URL", "http://localhost:3000")).replace(/\/$/, "");
const token = env("CRON_SECRET_TOKEN", "");
const once = has("--once");
const intervalSec = Number(val("--interval=", env("TICK_INTERVAL_SECONDS", "600")));

const headers = token ? { Authorization: `Bearer ${token}` } : {};

async function tick() {
  const stamp = new Date().toLocaleTimeString();
  try {
    const res = await fetch(`${baseUrl}/api/travel-tick`, { headers });
    const data = await res.json();
    if (data?.ok && data.state) {
      const s = data.state;
      console.log(
        `[${stamp}] → ${s.current_city} (${s.lat}, ${s.lon}) · energy ${s.energy}% · ₹${s.wallet} · ${data.distance_remaining_km}km to go`
      );
    } else {
      console.warn(`[${stamp}] tick returned: ${JSON.stringify(data)}`);
    }
  } catch (err) {
    console.error(`[${stamp}] tick failed: ${err?.message} (is the app running at ${baseUrl}?)`);
  }
}

if (once) {
  await tick();
  process.exit(0);
}

console.log(
  `Ticker started → ${baseUrl}/api/travel-tick every ${intervalSec}s` +
    (token ? " (authenticated)" : " (no token)")
);
await tick();
setInterval(tick, intervalSec * 1000);
