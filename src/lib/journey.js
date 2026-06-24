// Geographic primitives for Elango's self-directed crawl across Tamil Nadu.
//
// Unlike the old fixed itinerary, the bot now chooses its own destinations (see
// explore.js). This module only provides the math: distance, the nearest known
// city (for labelling), and a bounded micro-step toward an arbitrary target.

// Known cities used for human-friendly location labels, as fallback exploration
// candidates, and as the hub junctions where a community vote can open.
export const ANCHOR_CITIES = [
  { city: "Chennai", lat: 13.0827, lon: 80.2707, isHub: true },
  { city: "Mahabalipuram", lat: 12.6269, lon: 80.1927, isHub: false },
  { city: "Pondicherry", lat: 11.9416, lon: 79.8083, isHub: true },
  { city: "Chidambaram", lat: 11.3993, lon: 79.6936, isHub: false },
  { city: "Kumbakonam", lat: 10.9602, lon: 79.3845, isHub: false },
  { city: "Thanjavur", lat: 10.787, lon: 79.1378, isHub: true },
  { city: "Tiruchirappalli", lat: 10.7905, lon: 78.7047, isHub: true },
  { city: "Madurai", lat: 9.9252, lon: 78.1198, isHub: true },
  { city: "Rameswaram", lat: 9.2876, lon: 79.3129, isHub: false },
  { city: "Kanyakumari", lat: 8.0883, lon: 77.5385, isHub: true },
  { city: "Ooty", lat: 11.4102, lon: 76.695, isHub: false },
  { city: "Coimbatore", lat: 11.0168, lon: 76.9558, isHub: true },
];

// How far Elango shuffles per tick (walking + the odd local bus hop), in degrees.
export const STEP_DEGREES = 0.05;
// Distance under which a target is considered "reached", in kilometres.
export const ARRIVAL_RADIUS_KM = 6;

const round5 = (n) => Number(n.toFixed(5));

// Generic "what's right here" descriptions used when Overpass finds no named
// place nearby. Kept varied so the feed doesn't read "a roadside viewpoint"
// every single tick, and prefixed consistently so isGenericSpot() can detect
// them (e.g. to skip a pointless Wikipedia image lookup).
const GENERIC_SPOTS = [
  "a roadside viewpoint",
  "a shady banyan tree",
  "a little tea stall",
  "a bend in the highway",
  "a quiet wayside shrine",
  "a village bus stop",
  "the edge of a paddy field",
  "a coconut-grove path",
];

/** True if `name` is one of our generic, unnamed fallback spots (not a real landmark). */
export function isGenericSpot(name) {
  if (!name) return true;
  return GENERIC_SPOTS.some((s) => name.toLowerCase().startsWith(s));
}

/**
 * Human-friendly "landmark, city" label that never repeats the city. When the
 * landmark already names the city (e.g. "a roadside viewpoint near Mahabalipuram"
 * or a landmark literally called "Mahabalipuram"), the city suffix is dropped so
 * we don't render "…near Mahabalipuram, Mahabalipuram".
 */
export function formatLocation(landmark, city) {
  const l = (landmark ?? "").trim();
  const c = (city ?? "").trim();
  if (!l) return c;
  if (!c) return l;
  if (l.toLowerCase().includes(c.toLowerCase())) return l;
  return `${l}, ${c}`;
}

/** Great-circle distance between two lat/lon points, in kilometres. */
export function haversineKm(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const R = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** The known city nearest to a position, with its distance. */
export function nearestCity(lat, lon) {
  let best = ANCHOR_CITIES[0];
  let bestDist = Infinity;
  for (const c of ANCHOR_CITIES) {
    const d = haversineKm(lat, lon, c.lat, c.lon);
    if (d < bestDist) {
      bestDist = d;
      best = c;
    }
  }
  return { ...best, distanceKm: Number(bestDist.toFixed(1)) };
}

/**
 * Take one bounded micro-step from a position toward a target coordinate.
 * Snaps exactly onto the target once within ARRIVAL_RADIUS_KM.
 *
 * @returns {{ lat:number, lon:number, arrived:boolean, stepKm:number, distanceRemainingKm:number }}
 */
export function stepToward(fromLat, fromLon, targetLat, targetLon) {
  const distKm = haversineKm(fromLat, fromLon, targetLat, targetLon);

  if (distKm <= ARRIVAL_RADIUS_KM) {
    return {
      lat: round5(targetLat),
      lon: round5(targetLon),
      arrived: true,
      stepKm: Number(distKm.toFixed(2)),
      distanceRemainingKm: 0,
    };
  }

  const dLat = targetLat - fromLat;
  const dLon = targetLon - fromLon;
  const mag = Math.sqrt(dLat * dLat + dLon * dLon) || 1;
  const nextLat = fromLat + (dLat / mag) * STEP_DEGREES;
  const nextLon = fromLon + (dLon / mag) * STEP_DEGREES;
  const stepKm = haversineKm(fromLat, fromLon, nextLat, nextLon);

  return {
    lat: round5(nextLat),
    lon: round5(nextLon),
    arrived: false,
    stepKm: Number(stepKm.toFixed(2)),
    distanceRemainingKm: Number((distKm - stepKm).toFixed(1)),
  };
}

/**
 * Query the public Overpass API for a named tourism node within ~3km of the
 * current spot — i.e. "what is right here". Resilient: any timeout / network
 * error / empty result yields a graceful per-city fallback.
 *
 * @returns {Promise<string>}
 */
export async function fetchNearbyLandmark(lat, lon, city, timeoutMs = 20000) {
  // Seed the generic pick on the coordinates so it's deterministic per spot but
  // varies as Elango moves — avoids the feed repeating one phrase forever.
  const seed = Math.abs(Math.round((lat + lon) * 1000));
  const fallback = `${GENERIC_SPOTS[seed % GENERIC_SPOTS.length]} near ${city}`;
  const query = `[out:json][timeout:15];node(around:3000,${lat},${lon})[tourism];out 30;`;
  const url = `https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return fallback;

    const data = await res.json();
    const named = (data?.elements ?? []).filter(
      (el) => el?.tags?.name && typeof el.tags.name === "string"
    );
    if (named.length === 0) return fallback;

    const idx = Math.abs(Math.round((lat + lon) * 1000)) % named.length;
    return named[idx].tags.name;
  } catch (err) {
    console.warn(`[overpass] Landmark lookup failed (${err?.name || "error"}): ${err?.message}`);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
