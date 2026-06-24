// DECIDE — the Director (Architecture Spec 01).
//
// The cheap "will" of the character. Each tick it reads the perceived context +
// the chosen beat and emits a structured INTENT: a mood, the beat to play, which
// organs to wake (route), and how much we're willing to spend on it. The intent
// is the seam everything downstream hangs off — the Voice organ narrates from it,
// and it's recorded on the episode so memory (spec 02) can recall it later.
//
// In this slice the Director is pure/deterministic (no model call) so it stays on
// the hot path. A future version can swap the body for a tiny-LLM call without
// changing this signature.

// Spend tiers map to the latency lanes in spec 01. The slice only ever invokes
// the warm Voice organ; cold/cold++ are emitted in the route for the future.
const SPEND = { calm: "hot", warm: "warm", rich: "cold" };

/**
 * @param {Object} input
 * @param {{partOfDay:string}} input.perceive
 * @param {{kind:string, reason:string}|null} input.beat  - from signals.pickBeat()
 * @param {number} input.energy
 * @param {number} input.wallet
 * @param {boolean} input.arrived
 * @returns {{mood:string, beat:(object|null), route:string[], spend:string, reason:string}}
 */
export function decide({ perceive, beat, energy, wallet, arrived }) {
  let mood = "content";
  let spend = SPEND.calm;
  const route = ["voice"]; // warm organ — always narrate

  // Mood is driven first by a fired beat, then by raw state, then by the clock.
  if (beat) {
    switch (beat.kind) {
      case "stakes":
        mood = energy <= 20 ? "weary" : "rattled";
        spend = SPEND.warm;
        break;
      case "reaction":
        mood = arrived ? "elated" : "alert";
        spend = SPEND.warm;
        break;
      case "mood":
        mood = /heat|punishing/.test(beat.reason) ? "sluggish" : "serene";
        spend = SPEND.warm;
        break;
      default:
        mood = "curious";
        spend = SPEND.warm;
    }
    // A genuinely shareable arrival/festival-grade beat would also wake the cold
    // organs (eyes/postcard). We emit the route now; invocation comes in a later pass.
    if (beat.storyScore >= 0.7) route.push("eyes");
  } else {
    // Calm tick — let raw state and time colour him, stay cheap.
    if (energy <= 25) mood = "tired";
    else if (wallet <= 150) mood = "anxious";
    else if (perceive?.partOfDay === "morning") mood = "fresh";
    else if (perceive?.partOfDay === "evening") mood = "wistful";
    else mood = "content";
  }

  return {
    mood,
    beat: beat || null,
    route,
    spend,
    reason: beat ? `beat:${beat.kind} (${beat.reason})` : `calm:${mood}`,
  };
}
