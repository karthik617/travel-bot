// REACT — the emergent-events layer (Architecture Spec 03).
//
// Turns REAL signals around Elango (weather, time of day, arrival) into scored
// candidate "beats", then picks at most one per tick. The whole point is pacing:
// most ticks stay calm and a beat only fires when its story score clears a
// threshold — so a storm or a festival lands as a distinct moment, not noise.
//
// Authenticity guardrail: every signal here traces to real data the tick already
// fetched (Open-Meteo weather, IST clock, arrival state). Nothing is invented.

// Beat kinds (full taxonomy lives in spec 03). This slice fires the two cheap,
// hot/warm ones (reaction, mood) plus stakes when he's genuinely in trouble;
// detour and quest are recognised by the type but reserved for a later pass.
export const BEAT_KINDS = ["reaction", "mood", "detour", "quest", "stakes"];

// Fire a beat only when the best candidate clears this. Tuned so ordinary
// walking ticks stay quiet (ambient narration) and only notable conditions speak up.
const STORY_THRESHOLD = 0.45;

const clamp01 = (n) => Math.max(0, Math.min(1, n));

/**
 * Gather candidate signals from the real context this tick already has.
 *
 * @param {Object} ctx
 * @param {{tempC:number|null, label:string, emoji:string, summary:string}} ctx.weather
 * @param {{partOfDay:string, hour:number}} ctx.time
 * @param {boolean} ctx.arrived         - did he just reach his target?
 * @param {number}  ctx.energy
 * @param {string}  ctx.place
 * @returns {Array<{kind:string, source:string, reason:string, scoreParts:object, storyScore:number}>}
 */
export function gatherSignals({ weather, time, arrived, energy, place }) {
  const signals = [];
  const label = (weather?.label || "").toLowerCase();
  const temp = typeof weather?.tempC === "number" ? weather.tempC : null;

  const add = (kind, source, reason, parts) => {
    const { relevance, novelty = 1, salience, shareability } = parts;
    const storyScore = clamp01(relevance) * clamp01(novelty) * clamp01(salience) * clamp01(shareability);
    signals.push({ kind, source, reason, scoreParts: parts, storyScore: Number(storyScore.toFixed(3)) });
  };

  // --- Weather signals (the most reliable mood-mover) ---------------------
  if (/thunder|storm/.test(label)) {
    add("stakes", "weather", `a thunderstorm over ${place}`, { relevance: 1, salience: 0.95, shareability: 0.9 });
  } else if (/heavy rain|violent/.test(label)) {
    add("reaction", "weather", `heavy rain hammering down near ${place}`, { relevance: 1, salience: 0.8, shareability: 0.8 });
  } else if (/rain|drizzle|shower/.test(label)) {
    add("reaction", "weather", `rain setting in over ${place}`, { relevance: 0.9, salience: 0.6, shareability: 0.6 });
  } else if (temp !== null && temp >= 38) {
    add("mood", "weather", `a punishing ${temp}°C heat`, { relevance: 1, salience: 0.75, shareability: 0.55 });
  } else if (/fog/.test(label)) {
    add("reaction", "weather", `thick fog rolling across ${place}`, { relevance: 0.85, salience: 0.6, shareability: 0.65 });
  }

  // --- Time-of-day signals (quieter, ambient texture) ---------------------
  if (time?.partOfDay === "evening" && /clear|cloud/.test(label)) {
    add("mood", "sky", `golden-hour light over ${place}`, { relevance: 0.7, salience: 0.5, shareability: 0.6 });
  }

  // --- State + arrival signals -------------------------------------------
  if (arrived) {
    add("reaction", "arrival", `just arrived at ${place}`, { relevance: 1, salience: 0.6, shareability: 0.55 });
  }
  if (energy <= 20) {
    add("stakes", "energy", `running on fumes (${energy}%) near ${place}`, { relevance: 1, salience: 0.8, shareability: 0.7 });
  }

  return signals;
}

/**
 * Pick at most ONE beat for this tick: the highest-scoring candidate that clears
 * the threshold AND isn't a repeat of the last beat kind (cooldown / novelty).
 * Returns null on a calm tick — which is most of them, by design.
 *
 * @param {Array} signals          - from gatherSignals()
 * @param {string|null} lastBeatKind - the kind fired on the previous episode
 * @returns {{kind:string, source:string, reason:string, storyScore:number}|null}
 */
export function pickBeat(signals, lastBeatKind = null) {
  if (!signals || signals.length === 0) return null;

  const ranked = signals
    .map((s) => {
      // Cooldown: a beat kind that just fired is heavily penalised so we don't
      // narrate "it's raining" three ticks in a row.
      const novelty = s.kind === lastBeatKind ? 0.4 : 1;
      return { ...s, effectiveScore: s.storyScore * novelty };
    })
    .sort((a, b) => b.effectiveScore - a.effectiveScore);

  const top = ranked[0];
  if (!top || top.effectiveScore < STORY_THRESHOLD) return null;
  return { kind: top.kind, source: top.source, reason: top.reason, storyScore: top.storyScore };
}
