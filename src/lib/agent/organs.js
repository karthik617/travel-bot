// ORGANS — the tiered model router (Architecture Spec 01).
//
// Each faculty is an "organ" on a latency lane. This slice implements the WARM
// Voice organ (narration), built so the hot path never depends on it: callers
// pass a deterministic `fallback`, and if the model is slow/unreachable the
// fallback stands in. Cold organs (eyes/hands) are declared for the future.
//
// The Voice prompt is SHAPED BY THE DIRECTOR'S INTENT (mood + beat), which is the
// whole reason narration stops being generic: a "stakes" beat in a storm reads
// differently from a calm evening stroll.

import { generateFromOllama, describeImage } from "@/lib/ollama";

const ELANGO_SYS =
  "You are an enthusiastic, warm Indian backpacker named Elango exploring Tamil Nadu. You never break character and you never sound like an AI robot.";

/** Fetch a remote image and return raw base64 (no data: prefix), or null. */
async function fetchImageBase64(url, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.length === 0 || buf.length > 6_000_000) return null; // skip empty / huge
    return buf.toString("base64");
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Tier registry — documents which organ runs on which lane (spec 01). Only
// `voice` is wired in this slice; the rest are placeholders for later passes.
export const ORGANS = {
  voice: { tier: "warm" },
  eyes: { tier: "cold" }, // VLM reaction to a real photo — future
  hands: { tier: "cold" }, // postcard image-gen — future
  dreams: { tier: "coldx" }, // milestone video — future
};

/**
 * COLD organ (eyes): ask the local VLM what's actually in the photo of this spot.
 * Returns a short observation or null. Skips OSM static-map fallbacks (no scene
 * to describe) and degrades silently if the model is missing/slow.
 *
 * @param {string} imageUrl
 * @param {string} place
 * @returns {Promise<string|null>}
 */
export async function eyes(imageUrl, place) {
  if (!imageUrl || /staticmap|openstreetmap/i.test(imageUrl)) return null;
  const b64 = await fetchImageBase64(imageUrl);
  if (!b64) return null;
  return describeImage({
    imageBase64: b64,
    prompt: `This is a real photo from ${place} in Tamil Nadu. In ONE short, concrete sentence, describe only what is actually visible in it.`,
    fallback: null,
    timeoutMs: 60000,
  });
}

/**
 * WARM organ: narrate the current moment, coloured by the Director's mood + beat,
 * and grounded in the eyes' observation when one is available.
 *
 * @param {Object} args
 * @param {{mood:string, beat:(object|null)}} args.intent
 * @param {string} args.place
 * @param {{partOfDay:string, clock:string, mealHint:string, vibe:string}} args.time
 * @param {{summary:string, emoji:string}} args.weather
 * @param {string} args.arrivedLine
 * @param {string} [args.observation] - what the eyes organ saw, if anything
 * @param {string} args.fallback   - deterministic text used if the model fails
 * @returns {Promise<string>}
 */
export async function narrate({ intent, place, time, weather, arrivedLine, observation, fallback }) {
  const beatLine = beatInstruction(intent.beat, place, weather);
  const seenLine = observation ? `You can actually see: ${observation} Work that real detail in. ` : "";

  const user =
    `${arrivedLine} It's ${time.partOfDay} (${time.clock}) in Tamil Nadu and the weather is ${weather.summary}. ` +
    `Right now you feel ${intent.mood}. ${beatLine} ${seenLine}` +
    `Write two fresh, vivid, first-person sentences true to THIS spot and that feeling — what you see, hear or smell. ` +
    `Let the mood colour the words. Vary your imagery; don't reuse stock phrases. Sound like a real person, never an AI.`;

  return generateFromOllama({
    system: ELANGO_SYS,
    user,
    fallback,
    temperature: 0.85,
  });
}

/** Turn the chosen beat into a concrete narration instruction (or a calm default). */
function beatInstruction(beat, place, weather) {
  if (!beat) return "Nothing dramatic is happening — just narrate the quiet moment honestly.";
  switch (beat.kind) {
    case "stakes":
      return `Something's wrong: ${beat.reason}. Convey the trouble and that you could use a hand, without melodrama.`;
    case "reaction":
      return `React in the moment to this: ${beat.reason}.`;
    case "mood":
      return `Let this set the tone: ${beat.reason}.`;
    default:
      return `React to: ${beat.reason}.`;
  }
}
