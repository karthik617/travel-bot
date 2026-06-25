import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { generateFromOllama } from "@/lib/ollama";
import {
  ANCHOR_CITIES,
  ARRIVAL_RADIUS_KM,
  haversineKm,
  nearestCity,
  stepToward,
  fetchNearbyLandmark,
  formatLocation,
} from "@/lib/journey";
import { discoverCandidates, chooseNextDestination } from "@/lib/explore";
import { getTimeContext, fetchWeather } from "@/lib/context";
import { gatherSignals, pickBeat } from "@/lib/agent/signals";
import { decide } from "@/lib/agent/director";
import { narrate, eyes } from "@/lib/agent/organs";
import { consolidate } from "@/lib/agent/memory";
import { fetchLandmarkImage } from "@/lib/media";
import { logSupport } from "@/lib/supporters";
import { sendPushToAll } from "@/lib/push";

// External services (Postgres + Overpass + Ollama + Open-Meteo + Wikipedia) can
// be slow, so keep this on the Node.js runtime and never cache it.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ENERGY_DECAY = 5;
const WALLET_DECAY = 40;
const REST_RECOVERY = 8;
const EXHAUSTED_RECOVERY = 3;
const COFFEE_ENERGY = 15;
const COFFEE_COST = 30;

// Coffee is the most-bought action, so a single hardcoded line read as broken by
// the third purchase. These rotate by row id (and interpolate the live place) so
// it never repeats consecutively even when the LLM times out.
const COFFEE_FALLBACKS = [
  (p) => `Elango ducks into a tiny roadside kadai near ${p} and knocks back a frothy, piping-hot filter coffee. ☕ Energy restored — back on the road with a spring in his step!`,
  (p) => `A steel tumbler of filter kaapi, pulled high and foamy, lands in Elango's hands at ${p}. He grins, sips, and feels the tiredness melt away. ☕✨`,
  (p) => `Best ten rupees all day — a kadai near ${p} pours Elango a strong degree coffee. The caffeine hits and suddenly the road ahead looks a whole lot friendlier. ☕`,
  (p) => `Elango wraps both hands around a hot filter coffee at ${p}, the aroma cutting through the air. One long sip and he's recharged and ready. ☕🙏`,
  (p) => `Frothy, milky, and dangerously strong — the filter coffee at ${p} does its magic. Elango exhales, stretches, and gets his legs back under him. ☕`,
  (p) => `Someone bought Elango a coffee! He toasts the kind stranger with a steel tumbler near ${p} and feels his energy come roaring back. ☕💚`,
  (p) => `The kadai-amma near ${p} hands Elango a tumbler of decoction so good he closes his eyes for a second. Refreshed, he shoulders his bag again. ☕`,
  (p) => `Hot filter coffee at ${p}, poured from a height into a frothy crown. Elango downs it in three happy gulps and shakes off the fatigue. ☕😌`,
];

const ELANGO_SYS =
  "You are an enthusiastic, warm Indian backpacker named Elango exploring Tamil Nadu. You never break character and you never sound like an AI robot.";

const clampEnergy = (n) => Math.max(0, Math.min(100, Math.round(n)));
const clampWallet = (n) => Math.max(0, Math.round(n));

// generateFromOllama returns the exact `fallback` string when the model didn't
// answer, so identity against the fallback tells us this dispatch's provenance.
const srcOf = (text, fallback) => (text === fallback ? "fallback" : "model");

/** Insert a fully-populated bot_state row and return it. */
async function insertState(r) {
  const { rows } = await query(
    `INSERT INTO bot_state
       (lat, lon, current_city, landmark_name, story, energy, wallet,
        image_url, weather, time_of_day, activity,
        target_name, target_lat, target_lon, trip_distance_km, mood, beat, observation, story_source)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
     RETURNING *`,
    [
      r.lat,
      r.lon,
      r.current_city,
      r.landmark_name,
      r.story,
      r.energy,
      r.wallet,
      r.image_url ?? null,
      r.weather ?? null,
      r.time_of_day ?? null,
      r.activity ?? null,
      r.target_name ?? null,
      r.target_lat ?? null,
      r.target_lon ?? null,
      r.trip_distance_km ?? 0,
      r.mood ?? null,
      r.beat ?? null,
      r.observation ?? null,
      r.story_source ?? null,
    ]
  );
  return rows[0];
}

/**
 * Names of places Elango has been to or aimed at across the last `limit` rows,
 * used to steer exploration toward fresh ground instead of doubling back.
 */
async function getRecentlyVisited(limit = 25) {
  const { rows } = await query(
    "SELECT target_name, current_city, landmark_name FROM bot_state ORDER BY id DESC LIMIT $1",
    [limit]
  );
  const names = new Set();
  for (const r of rows) {
    if (r.target_name) names.add(r.target_name);
    if (r.current_city) names.add(r.current_city);
    if (r.landmark_name) names.add(r.landmark_name);
  }
  return [...names];
}

/** Whole days since the journey began (≥1), for milestone "Day X" labels. */
async function getDaysOnRoad() {
  try {
    const { rows } = await query("SELECT MIN(created_at) AS started FROM bot_state");
    const started = rows[0]?.started ? new Date(rows[0].started) : null;
    if (!started) return 1;
    return Math.max(1, Math.ceil((Date.now() - started.getTime()) / (24 * 60 * 60 * 1000)));
  } catch {
    return 1;
  }
}

/** Newest state row, seeding Chennai if the journey is empty. */
async function getLatestState() {
  const { rows } = await query("SELECT * FROM bot_state ORDER BY id DESC LIMIT 1");
  if (rows.length > 0) return rows[0];

  const start = ANCHOR_CITIES[0];
  return insertState({
    lat: start.lat,
    lon: start.lon,
    current_city: start.city,
    landmark_name: "Marina Beach",
    story:
      "Elango just laced up his boots on the breezy Marina sands in Chennai, the smell of fresh sundal drifting over from a vendor's cart. The Tamil Nadu road trip begins!",
    energy: 100,
    wallet: 2000,
    time_of_day: getTimeContext().partOfDay,
    activity: "walking",
    trip_distance_km: 0,
  });
}

function isAuthorized(request) {
  const secret = process.env.CRON_SECRET_TOKEN;
  if (!secret) return true;
  const auth = request.headers.get("authorization") || "";
  if (auth === `Bearer ${secret}`) return true;
  return new URL(request.url).searchParams.get("token") === secret;
}

const voteTitle = (c) =>
  c.kind && c.distanceKm
    ? `Head to ${c.name} (${c.kind}, ${c.distanceKm}km)`
    : `Head to ${c.name}`;

/**
 * On reaching a hub, open a "fork in the road" vote between two REAL onward
 * destinations (so the winning option's coordinates can actually steer him).
 */
async function maybeOpenVote(cityName, lat, lon) {
  try {
    const { rows: existing } = await query(
      "SELECT id FROM active_votes WHERE is_active = TRUE LIMIT 1"
    );
    if (existing.length > 0) return;

    const recent = await getRecentlyVisited();
    const candidates = await discoverCandidates(lat, lon, recent);

    let optA;
    let optB;
    if (candidates.length >= 2) {
      // Closest vs farthest fresh option for a meaningful contrast.
      optA = candidates[0];
      optB = candidates[candidates.length - 1];
      if (optA.name === optB.name) optB = candidates[1] ?? optB;
    } else {
      const hub = ANCHOR_CITIES.find((w) => w.city === cityName) || nearestCity(lat, lon);
      optA = { name: `Coastal route past ${cityName}`, lat: hub.lat + 0.3, lon: hub.lon + 0.3 };
      optB = { name: `Inland route past ${cityName}`, lat: hub.lat - 0.3, lon: hub.lon - 0.3 };
    }

    const expires = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    await query(
      `INSERT INTO active_votes
         (option_a_title, option_a_lat, option_a_lon,
          option_b_title, option_b_lat, option_b_lon, is_active, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,TRUE,$7)`,
      [voteTitle(optA), optA.lat, optA.lon, voteTitle(optB), optB.lat, optB.lon, expires]
    );

    // A fork in the road is the most community-building moment — alert subscribers.
    await sendPushToAll({
      title: `🗳️ Elango reached a fork at ${cityName}!`,
      body: `Help decide: ${optA.name} or ${optB.name}? Cast your vote.`,
      tag: "elango-vote",
      url: "/",
    });
  } catch (err) {
    console.warn(`[travel-tick] Could not open vote: ${err?.message}`);
  }
}

/**
 * If a community poll is ready (has at least one vote, or has expired), resolve
 * it: pick the winning option and return its coordinates so it becomes Elango's
 * next destination. Returns null when no poll is ready (he keeps exploring).
 */
async function resolveVoteForTarget() {
  try {
    const { rows } = await query(
      "SELECT * FROM active_votes WHERE is_active = TRUE ORDER BY id DESC LIMIT 1"
    );
    if (rows.length === 0) return null;

    const v = rows[0];
    const a = v.option_a_count ?? 0;
    const b = v.option_b_count ?? 0;
    const total = a + b;
    const minVotes = v.minimum_votes ?? 3;
    const expired = new Date() >= new Date(v.expires_at);

    // Keep the poll open until it reaches a meaningful threshold (so a fork
    // isn't decided by a single early click) or until it times out.
    if (total < minVotes && !expired) return null;

    // Tie-break is a coin flip, not a silent "A always wins".
    const winnerOpt = a > b ? "a" : b > a ? "b" : Math.random() < 0.5 ? "a" : "b";
    const winner =
      winnerOpt === "a"
        ? { name: v.option_a_title, lat: v.option_a_lat, lon: v.option_a_lon }
        : { name: v.option_b_title, lat: v.option_b_lat, lon: v.option_b_lon };

    const resolvedBy = total >= minVotes ? "community" : "timeout";
    await query("UPDATE active_votes SET is_active = FALSE, resolved_by = $2 WHERE id = $1", [
      v.id,
      resolvedBy,
    ]);
    return winner;
  } catch (err) {
    console.warn(`[travel-tick] Could not resolve vote: ${err?.message}`);
    return null;
  }
}

/** Parse the speculative next-tick dispatch stashed (as JSON) on a row. */
function readPendingStory(row) {
  if (!row?.pending_story) return null;
  try {
    const c = JSON.parse(row.pending_story);
    if (c && typeof c.story === "string" && c.story.length > 0) return c;
  } catch {
    /* legacy/non-JSON value — ignore */
  }
  return null;
}

/**
 * Speculatively build the NEXT tick's full dispatch (story + landmark + weather
 * + image) for the predicted onward position and stash it on the just-inserted
 * row. Detached — never blocks the response. The next tick uses it ONLY if the
 * real step lands within 2km of this prediction and the target is unchanged, so
 * a diverged route always regenerates fresh rather than describing the wrong spot.
 */
async function prebuildNextStory(insertedRow, target, time) {
  try {
    const next = stepToward(insertedRow.lat, insertedRow.lon, target.lat, target.lon);
    if (next.arrived) return; // arrivals are special-cased; don't cache them
    const city = nearestCity(next.lat, next.lon).city;
    const landmark = await fetchNearbyLandmark(next.lat, next.lon, city);
    const [weather, image] = await Promise.all([
      fetchWeather(next.lat, next.lon),
      fetchLandmarkImage(landmark, city, next.lat, next.lon),
    ]);
    const place = formatLocation(landmark, city);
    const pregenFallback = `Strolling past ${place}. The ${time.partOfDay} air is ${weather.summary.toLowerCase()}. ${weather.emoji}`;
    const story = await generateFromOllama({
      system: ELANGO_SYS,
      user:
        `You're trekking toward ${target.name}, right now passing ${place}. It's ${time.partOfDay} in Tamil Nadu and the weather is ${weather.summary}. ` +
        `Write two fresh, vivid sentences about THIS exact spot right now — what you see, hear or smell. Vary your imagery; sound like a real person, never an AI.`,
      fallback: pregenFallback,
      kind: "pregen",
    });
    const payload = JSON.stringify({
      story,
      landmark,
      weather: `${weather.emoji} ${weather.summary}`,
      image,
      source: srcOf(story, pregenFallback),
    });
    await query(
      "UPDATE bot_state SET pending_story = $1, pending_lat = $2, pending_lon = $3 WHERE id = $4",
      [payload, next.lat, next.lon, insertedRow.id]
    );
  } catch (e) {
    console.warn(`[travel-tick] prebuild failed: ${e?.message}`);
  }
}

/**
 * GET → one autonomous step. At night Elango rests and recovers; by day he
 * (via the LLM) picks/keeps a destination, micro-steps toward it, and logs an
 * enriched dispatch (weather + photo + time-aware story).
 */
export async function GET(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const latest = await getLatestState();
    // Seed the meal/vibe rotation on the row id so each tick reads differently.
    const time = getTimeContext(latest.id ?? 0);
    const baseEnergy = latest.energy ?? 100;
    const baseWallet = latest.wallet ?? 2000;
    const tripBase = Number(latest.trip_distance_km ?? 0);
    const cityNow = nearestCity(latest.lat, latest.lon).city;

    // ---- Night: rest in place and recover energy --------------------------
    if (time.isNight) {
      const landmark = latest.landmark_name || `a quiet spot near ${cityNow}`;
      const [weather, image] = await Promise.all([
        fetchWeather(latest.lat, latest.lon),
        fetchLandmarkImage(landmark, cityNow, latest.lat, latest.lon),
      ]);

      const place = formatLocation(landmark, cityNow);
      const restFallback = `Elango unrolls his mat near ${place}; the night is ${weather.summary.toLowerCase()} and still. He yawns, finishes ${time.mealHint}, and drifts off under the stars. 😴`;
      const story = await generateFromOllama({
        system: ELANGO_SYS,
        user: `It's late night (${time.clock}) near ${place}, Tamil Nadu, and the weather is ${weather.summary}. You're winding down with ${time.mealHint} under ${time.vibe}. Describe settling in to rest for the night in two cozy, human sentences.`,
        fallback: restFallback,
        kind: "rest",
      });

      const inserted = await insertState({
        lat: latest.lat,
        lon: latest.lon,
        current_city: cityNow,
        landmark_name: landmark,
        story,
        image_url: image,
        weather: `${weather.emoji} ${weather.summary}`,
        time_of_day: time.partOfDay,
        activity: "resting",
        energy: clampEnergy(baseEnergy + REST_RECOVERY),
        wallet: clampWallet(baseWallet),
        target_name: latest.target_name,
        target_lat: latest.target_lat,
        target_lon: latest.target_lon,
        trip_distance_km: tripBase,
        story_source: srcOf(story, restFallback),
      });

      // He rests → his memory consolidates "in his sleep" (spec 02). Detached so
      // the tick returns now; self-guards to one real run per night.
      consolidate().catch(() => {});

      return NextResponse.json({ ok: true, state: inserted, resting: true });
    }

    // ---- Exhausted: out of energy, can't walk until a viewer helps --------
    if (baseEnergy <= 0) {
      const landmark = latest.landmark_name || `a shady spot near ${cityNow}`;
      const [weather, image] = await Promise.all([
        fetchWeather(latest.lat, latest.lon),
        fetchLandmarkImage(landmark, cityNow, latest.lat, latest.lon),
      ]);

      const place = formatLocation(landmark, cityNow);
      const exhFallback = `Aiyo, Elango is completely wiped out near ${place} — legs like jelly, can't take another step without a coffee! He flops into the shade and waits, hoping a kind soul sends some energy his way. ☕😮‍💨`;
      const story = await generateFromOllama({
        system: ELANGO_SYS,
        user: `Your energy is completely drained and you've slumped down near ${place}, Tamil Nadu, too exhausted to walk another step. It's ${time.partOfDay} and the weather is ${weather.summary}. Describe needing rest and hoping a kind viewer sends a coffee, in two weary but good-humoured sentences.`,
        fallback: exhFallback,
        kind: "exhausted",
      });

      const inserted = await insertState({
        lat: latest.lat,
        lon: latest.lon,
        current_city: cityNow,
        landmark_name: landmark,
        story,
        image_url: image,
        weather: `${weather.emoji} ${weather.summary}`,
        time_of_day: time.partOfDay,
        activity: "exhausted",
        energy: clampEnergy(baseEnergy + EXHAUSTED_RECOVERY),
        wallet: clampWallet(baseWallet),
        target_name: latest.target_name,
        target_lat: latest.target_lat,
        target_lon: latest.target_lon,
        trip_distance_km: tripBase,
        story_source: srcOf(story, exhFallback),
      });

      return NextResponse.json({ ok: true, state: inserted, exhausted: true });
    }

    // ---- Day: ensure a destination, then step toward it -------------------
    let target =
      latest.target_lat != null && latest.target_lon != null
        ? { name: latest.target_name, lat: latest.target_lat, lon: latest.target_lon }
        : null;

    const atTarget = target
      ? haversineKm(latest.lat, latest.lon, target.lat, target.lon) <= ARRIVAL_RADIUS_KM
      : true;

    let choseNewTarget = false;
    let steeredByVote = false;
    if (!target || atTarget) {
      // Community vote takes priority: if a poll is ready, the winner decides.
      const voteTarget = await resolveVoteForTarget();
      if (voteTarget) {
        target = voteTarget;
        choseNewTarget = true;
        steeredByVote = true;
      } else {
        const recentlyVisited = await getRecentlyVisited();
        const candidates = await discoverCandidates(latest.lat, latest.lon, recentlyVisited);
        const choice = await chooseNextDestination(candidates, {
          partOfDay: time.partOfDay,
          clock: time.clock,
          energy: baseEnergy,
          wallet: baseWallet,
          city: cityNow,
          tickId: latest.id,
        });
        if (choice) {
          target = { name: choice.name, lat: choice.lat, lon: choice.lon };
          choseNewTarget = true;
        }
      }
    }

    if (!target) {
      const nc = nearestCity(latest.lat, latest.lon);
      target = { name: nc.city, lat: nc.lat, lon: nc.lon };
    }

    const step = stepToward(latest.lat, latest.lon, target.lat, target.lon);
    const city = nearestCity(step.lat, step.lon).city;

    // Use last tick's speculative story ONLY when we're mid-route (no arrival,
    // no freshly chosen/voted target) and the real step landed within 2km of the
    // prediction — otherwise fall through to a fresh, blocking generation so the
    // feed never describes the wrong place.
    let cache = null;
    if (!step.arrived && !choseNewTarget && latest.pending_lat != null) {
      const drift = haversineKm(step.lat, step.lon, latest.pending_lat, latest.pending_lon);
      if (drift <= 2) cache = readPendingStory(latest);
    }

    let landmark;
    let weatherStr;
    let image;
    let story;
    let cacheHit = false;
    let mood = null;     // Director's mood for this episode (spec 01 → spec 02)
    let beatKind = null; // emergent beat that fired, if any (spec 03)
    let observation = null; // what the eyes organ saw, if it was woken (spec 01 cold)
    let storySource = null; // 'model' | 'fallback' for this dispatch

    if (cache) {
      ({ story, landmark, image } = cache);
      weatherStr = cache.weather;
      storySource = cache.source ?? null;
      cacheHit = true;
    } else {
      landmark = step.arrived ? target.name : await fetchNearbyLandmark(step.lat, step.lon, city);
      const [weather, img] = await Promise.all([
        fetchWeather(step.lat, step.lon),
        fetchLandmarkImage(landmark, city, step.lat, step.lon),
      ]);
      image = img;
      weatherStr = `${weather.emoji} ${weather.summary}`;
      const place = formatLocation(landmark, city);
      const arrivedLine = step.arrived
        ? `You've just arrived at ${place}.`
        : `You're trekking toward ${target.name}, right now passing ${place}.`;

      // ---- Agent loop: REACT → DECIDE → Voice ----------------------------
      // Score real signals (spec 03) into at most one beat; the Director turns it
      // into an intent (spec 01); the warm Voice organ narrates from that intent.
      const signals = gatherSignals({ weather, time, arrived: step.arrived, energy: baseEnergy, place });
      const beat = pickBeat(signals, latest.beat || null);
      const intent = decide({
        perceive: { partOfDay: time.partOfDay },
        beat,
        energy: baseEnergy,
        wallet: baseWallet,
        arrived: step.arrived,
      });
      mood = intent.mood;
      beatKind = beat?.kind ?? null;

      // COLD organ: on a genuinely notable moment the Director routes to "eyes" —
      // the VLM looks at the real photo so the narration is grounded in what's
      // actually there. Degrades silently (null) if the model is missing/slow.
      if (intent.route.includes("eyes")) {
        observation = await eyes(image, place);
      }

      const storyFallback = `${step.arrived ? `Finally made it to ${place}!` : `Strolling past ${place}.`} The ${time.partOfDay} air is ${weather.summary.toLowerCase()} and I'm feeling ${intent.mood}. ${weather.emoji}`;
      story = await narrate({
        intent,
        place,
        time,
        weather,
        arrivedLine,
        observation,
        fallback: storyFallback,
      });
      storySource = srcOf(story, storyFallback);
    }

    const tripDistance = Number((tripBase + step.stepKm).toFixed(1));
    const inserted = await insertState({
      lat: step.lat,
      lon: step.lon,
      current_city: city,
      landmark_name: landmark,
      story,
      image_url: image,
      weather: weatherStr,
      time_of_day: time.partOfDay,
      activity: time.activity,
      energy: clampEnergy(baseEnergy - ENERGY_DECAY),
      wallet: clampWallet(baseWallet - WALLET_DECAY),
      target_name: target.name,
      target_lat: target.lat,
      target_lon: target.lon,
      trip_distance_km: tripDistance,
      mood,
      beat: beatKind,
      observation,
      story_source: storySource,
    });

    // Observability for the pre-gen hit rate (best-effort).
    if (cacheHit) {
      query("UPDATE bot_state SET llm_cache_hit = TRUE WHERE id = $1", [inserted.id]).catch(() => {});
    }
    // Speculatively prepare the next tick's story during the idle window (detached).
    prebuildNextStory(inserted, target, time).catch(() => {});

    if (step.arrived) {
      const nc = nearestCity(step.lat, step.lon);
      if (nc.isHub && nc.distanceKm <= ARRIVAL_RADIUS_KM) {
        await maybeOpenVote(nc.city, step.lat, step.lon);
      }
    }

    // Reached a new town → push to subscribers (works even with the tab closed).
    if (city !== cityNow) {
      await sendPushToAll({
        title: `🎒 Elango reached ${city}!`,
        body: (story || "").slice(0, 140),
        tag: "elango-move",
        url: "/",
      });
    }

    return NextResponse.json({
      ok: true,
      state: inserted,
      target_city: target.name,
      distance_remaining_km: step.distanceRemainingKm,
      arrived: step.arrived,
      chose_new_target: choseNewTarget,
      steered_by_vote: steeredByVote,
      cache_hit: cacheHit,
      mood,
      beat: beatKind,
      observation,
    });
  } catch (err) {
    console.error(`[travel-tick] Tick failed: ${err?.message}`);
    return NextResponse.json(
      { ok: false, error: "Tick failed", detail: err?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}

/** Increment a poll option's tally. */
async function handleVote(body) {
  const voteId = Number(body?.voteId);
  const option = body?.option;
  if (!voteId || (option !== "a" && option !== "b")) {
    return NextResponse.json(
      { ok: false, error: "Provide a valid voteId and option ('a' or 'b')." },
      { status: 400 }
    );
  }
  const sessionId = body?.sessionId ? String(body.sessionId).slice(0, 64) : null;
  try {
    // One ballot per browser session per poll. If they've already voted, return
    // the current tally instead of double-counting.
    if (sessionId) {
      const ballot = await query(
        `INSERT INTO vote_ballots (vote_id, session_id, option) VALUES ($1, $2, $3)
         ON CONFLICT (vote_id, session_id) DO NOTHING RETURNING vote_id`,
        [voteId, sessionId, option]
      );
      if (ballot.rowCount === 0) {
        const { rows } = await query("SELECT * FROM active_votes WHERE id = $1", [voteId]);
        return NextResponse.json({ ok: true, vote: rows[0] ?? null, alreadyVoted: true });
      }
    }
    const column = option === "a" ? "option_a_count" : "option_b_count";
    const { rows } = await query(
      `UPDATE active_votes SET ${column} = ${column} + 1
       WHERE id = $1 AND is_active = TRUE RETURNING *`,
      [voteId]
    );
    if (rows.length === 0) {
      return NextResponse.json(
        { ok: false, error: "This poll is no longer active." },
        { status: 410 }
      );
    }
    await logSupport(body?.username, "vote", { sessionId });
    return NextResponse.json({ ok: true, vote: rows[0] });
  } catch (err) {
    console.error(`[travel-tick] Vote failed: ${err?.message}`);
    return NextResponse.json(
      { ok: false, error: "Vote failed", detail: err?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}

/**
 * POST → interactive actions.
 *   { action: "coffee" }                → +15% energy, -₹30, stays put.
 *   { action: "bus" }                   → instant jump to the next destination.
 *   { action: "vote", voteId, option }  → upvote a poll option.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }
  const action = body?.action;

  if (action !== "coffee" && action !== "bus" && action !== "vote") {
    return NextResponse.json(
      { ok: false, error: "Unknown action. Use 'coffee', 'bus', or 'vote'." },
      { status: 400 }
    );
  }

  if (action === "vote") return handleVote(body);

  const username = body?.username;

  try {
    const latest = await getLatestState();
    const time = getTimeContext(latest.id ?? 0);

    if (action === "coffee") {
      const place = formatLocation(latest.landmark_name, latest.current_city);
      const coffeeFallback = COFFEE_FALLBACKS[Math.abs(latest.id ?? 0) % COFFEE_FALLBACKS.length](place);
      const weatherText = (latest.weather || "").replace(/^[^\w]+\s*/, "").trim();
      const story = await generateFromOllama({
        system: ELANGO_SYS,
        user: `A kind viewer just bought you a hot South-Indian filter coffee while you're at ${place}, Tamil Nadu${weatherText ? ` (${weatherText})` : ""}. In two cheerful, grateful sentences, describe the lift it gives you and get back on the road. Vary your words; sound like a real person, not an AI.`,
        fallback: coffeeFallback,
        temperature: 0.85,
        kind: "coffee",
      });
      const inserted = await insertState({
        lat: latest.lat,
        lon: latest.lon,
        current_city: latest.current_city,
        landmark_name: latest.landmark_name,
        story,
        image_url: latest.image_url,
        weather: latest.weather,
        time_of_day: time.partOfDay,
        activity: "eating",
        energy: clampEnergy((latest.energy ?? 100) + COFFEE_ENERGY),
        wallet: clampWallet((latest.wallet ?? 0) - COFFEE_COST),
        target_name: latest.target_name,
        target_lat: latest.target_lat,
        target_lon: latest.target_lon,
        trip_distance_km: Number(latest.trip_distance_km ?? 0),
        story_source: srcOf(story, coffeeFallback),
      });
      await logSupport(username, "coffee", { sessionId: body?.sessionId });
      return NextResponse.json({ ok: true, action, state: inserted });
    }

    // action === "bus": skip ahead to a FRESH nearby destination, avoiding
    // recently-visited places. getRecentlyVisited already includes the current
    // target's name, so the bus jumps past wherever he was heading to somewhere
    // genuinely new rather than just completing the current leg.
    const recentlyVisited = await getRecentlyVisited();
    const candidates = await discoverCandidates(latest.lat, latest.lon, recentlyVisited);
    const choice = await chooseNextDestination(candidates, {
      partOfDay: time.partOfDay,
      clock: time.clock,
      energy: latest.energy ?? 100,
      wallet: latest.wallet ?? 0,
      city: nearestCity(latest.lat, latest.lon).city,
      tickId: latest.id,
    });
    const nc = nearestCity(latest.lat, latest.lon);
    const target = choice
      ? { name: choice.name, lat: choice.lat, lon: choice.lon }
      : { name: nc.city, lat: nc.lat, lon: nc.lon };

    const jumpKm = haversineKm(latest.lat, latest.lon, target.lat, target.lon);
    const city = nearestCity(target.lat, target.lon).city;
    const landmark = target.name || (await fetchNearbyLandmark(target.lat, target.lon, city));

    const [weather, image] = await Promise.all([
      fetchWeather(target.lat, target.lon),
      fetchLandmarkImage(landmark, city, target.lat, target.lon),
    ]);

    const place = formatLocation(landmark, city);
    const busFallback = `The rattling government bus drops Elango right by ${place}! The ${time.partOfDay} air is ${weather.summary.toLowerCase()} and thick with the smell of ${time.mealHint}. ${weather.emoji}`;
    const story = await generateFromOllama({
      system: ELANGO_SYS,
      user: `A generous stream follower just funded your local bus ticket, so you hopped off near ${place}, Tamil Nadu. It's ${time.partOfDay} (${time.clock}) and the weather is ${weather.summary}. Describe arriving here in two excited, conversational sentences with sensory details.`,
      fallback: busFallback,
      kind: "bus",
    });

    const inserted = await insertState({
      lat: Number(target.lat.toFixed(5)),
      lon: Number(target.lon.toFixed(5)),
      current_city: city,
      landmark_name: landmark,
      story,
      image_url: image,
      weather: `${weather.emoji} ${weather.summary}`,
      time_of_day: time.partOfDay,
      activity: "walking",
      energy: clampEnergy(latest.energy ?? 100),
      wallet: clampWallet(latest.wallet ?? 0),
      target_name: target.name,
      target_lat: target.lat,
      target_lon: target.lon,
      trip_distance_km: Number((Number(latest.trip_distance_km ?? 0) + jumpKm).toFixed(1)),
      story_source: srcOf(story, busFallback),
    });

    await logSupport(username, "bus", { sessionId: body?.sessionId });

    // The funded arrival is the peak-emotion moment → mint a shareable trophy
    // card crediting the supporter by name, surfaced to everyone via /api/state.
    let milestone = null;
    try {
      const day = await getDaysOnRoad();
      const { rows: mc } = await query(
        `INSERT INTO milestone_cards (handle, city, landmark, day, image_url, session_id)
         VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
        [username || "A kind stranger", city, landmark, day, image, body?.sessionId ?? null]
      );
      milestone = mc[0] ?? null;
    } catch (e) {
      console.warn(`[travel-tick] milestone insert failed: ${e?.message}`);
    }

    // A bus hop always lands in a new place → notify subscribers.
    if (city !== nearestCity(latest.lat, latest.lon).city) {
      await sendPushToAll({
        title: `🚌 Elango bussed to ${city}!`,
        body: (story || "").slice(0, 140),
        tag: "elango-move",
        url: "/",
      });
    }
    return NextResponse.json({ ok: true, action, state: inserted, milestone });
  } catch (err) {
    console.error(`[travel-tick] Action '${action}' failed: ${err?.message}`);
    return NextResponse.json(
      { ok: false, error: "Action failed", detail: err?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
