// Elango's self-direction: discover real nearby places, then let the local LLM
// decide where to wander next. Everything degrades gracefully — if Overpass or
// Ollama are down, he still picks a sensible onward destination.

import { ANCHOR_CITIES, haversineKm } from "@/lib/journey";
import { generateFromOllama } from "@/lib/ollama";

// Candidates are sought in this band around the current position (km).
const MIN_KM = 8;
const MAX_KM = 70;
const MAX_CANDIDATES = 6;

// Tags we treat as "worth visiting", mapped to a friendly kind label.
function kindOf(tags) {
  if (!tags) return null;
  if (tags.historic) return tags.historic.replace(/_/g, " ");
  if (tags.tourism && ["attraction", "viewpoint", "museum", "artwork", "gallery"].includes(tags.tourism)) {
    return tags.tourism.replace(/_/g, " ");
  }
  if (tags.natural && ["beach", "peak", "waterfall"].includes(tags.natural)) {
    return tags.natural;
  }
  return null;
}

/**
 * Discover candidate destinations around a coordinate via Overpass. Falls back
 * to the nearest anchor cities when Overpass is empty or unreachable.
 *
 * @param {number} lat
 * @param {number} lon
 * @param {string[]} [avoidNames] - Names to exclude (e.g. just-visited spots).
 * @returns {Promise<Array<{name:string, lat:number, lon:number, kind:string, distanceKm:number}>>}
 */
export async function discoverCandidates(lat, lon, avoidNames = [], timeoutMs = 22000) {
  const avoid = new Set(avoidNames.filter(Boolean).map((n) => n.toLowerCase()));

  // Prefer places Elango hasn't been to recently, but never return empty just
  // because everything nearby is "stale" — fall back to the full set so he
  // always has somewhere to go rather than freezing in place.
  const selectFresh = (items) => {
    const sorted = items.slice().sort((a, b) => a.distanceKm - b.distanceKm);
    const fresh = sorted.filter((i) => !avoid.has(i.name.toLowerCase()));
    const pool = fresh.length > 0 ? fresh : sorted;

    // Spread across the distance band so the LLM sees both near and far options.
    const stride = Math.max(1, Math.floor(pool.length / MAX_CANDIDATES));
    const out = [];
    for (let i = 0; i < pool.length && out.length < MAX_CANDIDATES; i += stride) {
      out.push(pool[i]);
    }
    return out;
  };

  const anchorsInRange = ANCHOR_CITIES.map((c) => ({
    name: c.city,
    lat: c.lat,
    lon: c.lon,
    kind: "town",
    distanceKm: Number(haversineKm(lat, lon, c.lat, c.lon).toFixed(1)),
  })).filter((c) => c.distanceKm >= MIN_KM && c.distanceKm <= 250);

  const anchorFallback = selectFresh(anchorsInRange);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const r = MAX_KM * 1000;
    const query =
      `[out:json][timeout:18];(` +
      `node(around:${r},${lat},${lon})[tourism];` +
      `node(around:${r},${lat},${lon})[historic];` +
      `node(around:${r},${lat},${lon})[natural=beach];` +
      `);out 80;`;
    const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

    const res = await fetch(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return anchorFallback;

    const data = await res.json();
    const seen = new Set();
    const found = [];

    for (const el of data?.elements ?? []) {
      const name = el?.tags?.name;
      const kind = kindOf(el?.tags);
      if (!name || !kind || typeof el.lat !== "number") continue;

      const key = name.toLowerCase();
      if (seen.has(key)) continue; // de-dupe by name only; freshness handled below

      const distanceKm = Number(haversineKm(lat, lon, el.lat, el.lon).toFixed(1));
      if (distanceKm < MIN_KM || distanceKm > MAX_KM) continue;

      seen.add(key);
      found.push({ name, lat: el.lat, lon: el.lon, kind, distanceKm });
    }

    if (found.length === 0) return anchorFallback;

    const spread = selectFresh(found);
    return spread.length > 0 ? spread : anchorFallback;
  } catch (err) {
    console.warn(`[explore] Discovery failed (${err?.name || "error"}): ${err?.message}`);
    return anchorFallback;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Ask the local LLM to choose Elango's next destination from the candidate list,
 * factoring in time of day, energy and wallet. Falls back deterministically
 * (varying by tick) if the model is unreachable or returns garbage.
 *
 * @param {Array} candidates
 * @param {Object} ctx - { partOfDay, clock, energy, wallet, city, tickId }
 * @returns {Promise<{name:string, lat:number, lon:number, kind:string, distanceKm:number, reasoned:boolean}>}
 */
export async function chooseNextDestination(candidates, ctx) {
  if (!candidates || candidates.length === 0) return null;

  // Deterministic-but-varying fallback so repeated failures don't loop forever.
  const fallbackIndex = Math.abs(Number(ctx?.tickId ?? 0)) % candidates.length;
  const fallback = { ...candidates[fallbackIndex], reasoned: false };

  const list = candidates
    .map((c, i) => `${i + 1}. ${c.name} (${c.kind}, ${c.distanceKm}km away)`)
    .join("\n");

  const raw = await generateFromOllama({
    system:
      "You are Elango, a curious, free-spirited Indian backpacker exploring Tamil Nadu on foot and by local bus. You decide your own route based on your mood, the time of day, and your energy.",
    user:
      `It's ${ctx.partOfDay} (around ${ctx.clock}). You're near ${ctx.city}. ` +
      `Energy ${ctx.energy}% and wallet ₹${ctx.wallet}.\n\n` +
      `Pick where to wander next from these nearby places:\n${list}\n\n` +
      `Reply with ONLY the number of your choice.`,
    fallback: "",
    timeoutMs: 20000,
    temperature: 0.7,
  });

  const match = String(raw).match(/\d+/);
  if (match) {
    const idx = Number(match[0]) - 1;
    if (idx >= 0 && idx < candidates.length) {
      return { ...candidates[idx], reasoned: true };
    }
  }
  return fallback;
}
