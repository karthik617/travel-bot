// REMEMBER — the consolidation "sleep pass" + recall (Architecture Spec 02).
//
// Episodic memory is the append-only bot_state log. Once per night (when Elango
// rests) this pass distils the day's episodes into:
//   • a diary entry (the day's recap — shareable, and a re-engagement hook)
//   • semantic facts (places he saw, what he felt) for later recall
//   • refreshed people profiles (bond + a short summary), so he remembers viewers
//
// Recall is cheap and runs on the hot path: pull the speaker's profile + a few
// relevant facts and hand them to the Voice organ. The expensive thinking (the
// LLM summary) happens once, at night, for everyone — not per chat.

import { query } from "@/lib/db";
import { generateFromOllama } from "@/lib/ollama";

// Bond ladder mirrors the UI supporter tiers, derived from total interactions.
function bondFor(total) {
  if (total >= 30) return "legend";
  if (total >= 15) return "patron";
  if (total >= 5) return "regular";
  if (total >= 1) return "friend";
  return "newcomer";
}

// A viewer unseen this long gets the warm "machan, it's been ages!" greeting.
const MISSED_AFTER_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

/** Highest episode id already folded into memory (so we only consolidate the new ones). */
async function lastConsolidatedId() {
  try {
    const { rows } = await query("SELECT COALESCE(MAX(source_to), 0) AS n FROM diary_entries");
    return rows[0]?.n ?? 0;
  } catch {
    return 0;
  }
}

/**
 * The sleep pass. Idempotent-ish: only consolidates episodes newer than the last
 * diary entry, so calling it twice in one night is a no-op the second time.
 * @returns {Promise<{ok:boolean, diary?:string, facts?:number, people?:number, reason?:string}>}
 */
export async function consolidate() {
  try {
    const since = await lastConsolidatedId();
    const { rows: eps } = await query(
      `SELECT id, current_city, landmark_name, story, mood, beat, weather
         FROM bot_state
        WHERE id > $1 AND activity NOT IN ('resting')
        ORDER BY id ASC`,
      [since]
    );
    if (eps.length === 0) return { ok: true, reason: "nothing new to consolidate" };

    const maxId = eps[eps.length - 1].id;
    const cities = [...new Set(eps.map((e) => e.current_city).filter(Boolean))];
    const beats = [...new Set(eps.map((e) => e.beat).filter(Boolean))];

    // --- Diary: one cheap LLM call summarising the stretch (with a safe fallback) ---
    const bullets = eps
      .slice(-8)
      .map((e) => `- ${e.landmark_name || e.current_city}${e.beat ? ` [${e.beat}]` : ""}: ${(e.story || "").slice(0, 100)}`)
      .join("\n");
    const rawDiary = await generateFromOllama({
      system:
        "You are Elango, an Indian backpacker keeping a travel diary. Write a warm, first-person recap of your day in 2-3 sentences. Write ONLY the diary entry itself — no preamble, no headings, no bullet list.",
      user: `Here are today's moments:\n${bullets}\n\nNow write today's diary entry.`,
      fallback: `Wandered through ${cities.slice(0, 3).join(", ") || "the road"} today${beats.length ? `, and what a day — ${beats.join(", ")}` : ""}. Tired feet, full heart. 🎒`,
      temperature: 0.8,
    });
    // Strip any echoed prompt scaffolding the small model may prepend.
    const diary = rawDiary
      .replace(/^\s*(here are\s+)?today'?s moments:?\s*/i, "")
      .replace(/^\s*(diary entry|today'?s entry):?\s*/i, "")
      .trim();

    await query(
      "INSERT INTO diary_entries (day, text, source_to) VALUES (CURRENT_DATE, $1, $2)",
      [diary, maxId]
    );

    // --- Semantic facts: the diary as a high-salience 'self' fact, plus one
    //     'place' fact per city visited. Deterministic = robust on a small model. ---
    let factCount = 0;
    await query(
      "INSERT INTO semantic_facts (subject, subject_key, text, salience, source_to) VALUES ('self', NULL, $1, 0.8, $2)",
      [diary, maxId]
    );
    factCount += 1;
    for (const city of cities) {
      const ep = eps.find((e) => e.current_city === city && e.landmark_name);
      const text = ep
        ? `Passed through ${city} — ${ep.landmark_name}.`
        : `Passed through ${city}.`;
      await query(
        "INSERT INTO semantic_facts (subject, subject_key, text, salience, source_to) VALUES ('place', $1, $2, 0.5, $3)",
        [city, text, maxId]
      );
      factCount += 1;
    }

    // --- People: refresh every viewer's profile from their full history --------
    const peopleCount = await refreshPeople();

    return { ok: true, diary, facts: factCount, people: peopleCount, episodes: eps.length };
  } catch (err) {
    console.error(`[memory] consolidate failed: ${err?.message}`);
    return { ok: false, reason: err?.message ?? "error" };
  }
}

/** Rebuild the people table from supporters + live_chat (deeds, bond, last seen). */
async function refreshPeople() {
  const { rows } = await query(
    `WITH acts AS (
       SELECT lower(username) AS h, max(username) AS handle,
              count(*) FILTER (WHERE action='coffee')::int AS coffees,
              count(*) FILTER (WHERE action='bus')::int    AS buses,
              count(*) FILTER (WHERE action='vote')::int   AS votes,
              max(session_id) AS session_id,
              min(created_at) AS first_seen, max(created_at) AS last_seen
         FROM supporters GROUP BY lower(username)
     ), chats AS (
       SELECT lower(username) AS h, max(username) AS handle, count(*)::int AS chats,
              min(created_at) AS first_seen, max(created_at) AS last_seen
         FROM live_chat GROUP BY lower(username)
     )
     SELECT COALESCE(a.handle, c.handle) AS handle,
            a.session_id,
            COALESCE(a.coffees,0) AS coffees, COALESCE(a.buses,0) AS buses,
            COALESCE(a.votes,0) AS votes, COALESCE(c.chats,0) AS chats,
            LEAST(a.first_seen, c.first_seen) AS first_seen,
            GREATEST(a.last_seen, c.last_seen) AS last_seen
       FROM acts a FULL OUTER JOIN chats c ON a.h = c.h`
  );

  let n = 0;
  for (const r of rows) {
    if (!r.handle) continue;
    const total = (r.coffees || 0) + (r.buses || 0) + (r.votes || 0) + (r.chats || 0);
    const bond = bondFor(total);
    const helps = [];
    if (r.coffees) helps.push(`${r.coffees} coffee${r.coffees > 1 ? "s" : ""}`);
    if (r.buses) helps.push(`${r.buses} bus ride${r.buses > 1 ? "s" : ""}`);
    if (r.votes) helps.push(`${r.votes} route vote${r.votes > 1 ? "s" : ""}`);
    const summary = helps.length
      ? `Has backed you with ${helps.join(", ")}; chatted ${r.chats || 0}×.`
      : `Has chatted with you ${r.chats || 0}×.`;
    const deeds = JSON.stringify({ coffees: r.coffees, buses: r.buses, votes: r.votes, chats: r.chats });

    await query(
      `INSERT INTO people (handle, session_id, bond, summary, deeds, first_seen, last_seen, updated_at)
       VALUES ($1,$2,$3,$4,$5::jsonb,$6,$7,NOW())
       ON CONFLICT (handle) DO UPDATE SET
         session_id = COALESCE(EXCLUDED.session_id, people.session_id),
         bond = EXCLUDED.bond, summary = EXCLUDED.summary, deeds = EXCLUDED.deeds,
         first_seen = LEAST(people.first_seen, EXCLUDED.first_seen),
         last_seen = GREATEST(people.last_seen, EXCLUDED.last_seen),
         updated_at = NOW()`,
      [r.handle, r.session_id ?? null, bond, summary, deeds, r.first_seen, r.last_seen]
    );
    n += 1;
  }
  return n;
}

/**
 * Hot-path recall for the chat: the speaker's relationship profile + a few
 * relevant semantic facts (about the current city, plus the latest diary).
 * @returns {Promise<{memory:string, returning:boolean, missed:boolean, bond:string}>}
 */
export async function recallForChat(handle, city) {
  const name = String(handle || "").trim();
  const out = { memory: "", returning: false, missed: false, bond: "newcomer" };
  if (!name) return out;

  try {
    const [{ rows: pr }, { rows: placeFacts }, { rows: selfFacts }] = await Promise.all([
      query("SELECT * FROM people WHERE lower(handle) = lower($1) LIMIT 1", [name]),
      query(
        "SELECT text FROM semantic_facts WHERE subject='place' AND lower(subject_key)=lower($1) ORDER BY id DESC LIMIT 1",
        [city || ""]
      ),
      query("SELECT text FROM semantic_facts WHERE subject='self' ORDER BY id DESC LIMIT 1"),
    ]);

    const parts = [];
    const person = pr[0];
    if (person) {
      out.returning = true;
      out.bond = person.bond || "newcomer";
      const absent = person.last_seen ? Date.now() - new Date(person.last_seen).getTime() : 0;
      out.missed = absent > MISSED_AFTER_MS;
      parts.push(`You know ${name} well — they're a ${out.bond}. ${person.summary || ""}`.trim());
      if (out.missed) {
        const days = Math.round(absent / (24 * 60 * 60 * 1000));
        parts.push(`You haven't heard from them in about ${days} day${days === 1 ? "" : "s"} — greet them like a missed friend.`);
      }
    } else {
      parts.push(`${name} is new to you — welcome them warmly by name.`);
    }
    if (selfFacts[0]?.text) parts.push(`Recently in your journey: ${selfFacts[0].text}`);
    if (placeFacts[0]?.text) parts.push(`About here: ${placeFacts[0].text}`);

    out.memory = parts.join(" ");
    return out;
  } catch (err) {
    console.warn(`[memory] recall failed: ${err?.message}`);
    return out;
  }
}
