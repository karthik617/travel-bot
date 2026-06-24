import { NextResponse } from "next/server";
import { query } from "@/lib/db";
import { generateFromOllama } from "@/lib/ollama";
import { getViewerMemory } from "@/lib/supporters";
import { getTimeContext } from "@/lib/context";
import { formatLocation } from "@/lib/journey";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_USERNAME = 100;
const MAX_MESSAGE = 500;
// A pending reply older than this is treated as failed (process restarted mid-
// generation) so the UI stops "typing" forever and shows a graceful line.
const STUCK_MS = 90000;
const STUCK_REPLY = "Aiyo, signal dropped for a sec there, machan! Say that again? 📶";

// Handles with an in-flight generation, so a double-tap doesn't queue two LLM
// calls (which would starve the small Postgres pool). Module scope = per worker.
const inFlight = new Set();

/** Fetch Elango's newest location row so replies are geographically grounded. */
async function getLatestState() {
  const { rows } = await query(
    "SELECT current_city, landmark_name, weather, activity FROM bot_state ORDER BY id DESC LIMIT 1"
  );
  if (rows.length > 0) return rows[0];
  return { current_city: "Chennai", landmark_name: "Marina Beach", weather: "", activity: "walking" };
}

/**
 * GET → recent public chat messages (oldest-first) for the live chat window's
 * periodic polling.
 */
export async function GET() {
  try {
    const { rows } = await query(
      `SELECT id, username, message, reply, reply_pending, created_at
         FROM live_chat
        ORDER BY id DESC
        LIMIT 30`
    );
    // Chronological order, and resolve "stuck" pending rows (a reply that never
    // landed because the process restarted mid-generation) to a graceful line
    // so the UI never types forever.
    const now = Date.now();
    const messages = rows
      .slice()
      .reverse()
      .map((r) => {
        const stuck =
          r.reply_pending && !r.reply && now - new Date(r.created_at).getTime() > STUCK_MS;
        return {
          ...r,
          reply: r.reply || (stuck ? STUCK_REPLY : null),
          reply_pending: !!r.reply_pending && !r.reply && !stuck,
        };
      });
    return NextResponse.json({ ok: true, messages });
  } catch (err) {
    console.error(`[chat] Failed to load messages: ${err?.message}`);
    // Fallback to an empty thread so the UI still renders.
    return NextResponse.json({ ok: true, messages: [] });
  }
}

/**
 * POST → accept a follower's message, generate Elango's reply from the local
 * model contextualised by his current location, and persist both.
 */
export async function POST(request) {
  let username;
  let message;
  try {
    const body = await request.json();
    username = String(body?.username ?? "").trim().slice(0, MAX_USERNAME);
    message = String(body?.message ?? "").trim().slice(0, MAX_MESSAGE);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  if (!username) username = "Traveller";
  if (!message) {
    return NextResponse.json(
      { ok: false, error: "Message cannot be empty." },
      { status: 400 }
    );
  }

  try {
    const state = await getLatestState();
    const city = state.current_city || "Tamil Nadu";
    const landmark = state.landmark_name || "a roadside stop";
    const place = formatLocation(landmark, city);
    const time = getTimeContext();
    const weather = (state.weather || "").replace(/^[^\w]+\s*/, "").trim(); // strip leading emoji

    // Pull what Elango "remembers" about this viewer so his reply is personal.
    const { memory, stats, returning } = await getViewerMemory(username);

    const fallback = returning
      ? `Ayy ${username}, good to see you back, machan! Still roaming near ${place} this ${time.partOfDay} — thanks for always looking out for me. 🙏`
      : `Hey ${username}, just chilling near ${place} this ${time.partOfDay}, munching on something hot and spicy — thanks for tuning in, machan!`;

    // Insert as PENDING and return immediately — the connection is freed in
    // <50ms instead of being held for the 25-50s Ollama call (which under light
    // concurrency would exhaust the pool and freeze chat for everyone).
    const { rows } = await query(
      `INSERT INTO live_chat (username, message, reply, reply_pending)
       VALUES ($1, $2, NULL, TRUE)
       RETURNING id, username, message, reply, reply_pending, created_at`,
      [username, message]
    );
    const entry = rows[0];

    // Generate the real reply in a detached task that UPDATEs the row; the
    // client's GET poll picks it up. Drop duplicate concurrent sends per handle.
    const key = username.toLowerCase();
    if (!inFlight.has(key)) {
      inFlight.add(key);
      Promise.resolve().then(async () => {
        let reply = fallback;
        try {
          reply = await generateFromOllama({
            system:
              `You are Elango, a cozy human backpacker currently hanging out at ${place}, Tamil Nadu. ` +
              `Right now it's ${time.partOfDay} (${time.clock} IST)${weather ? ` and the weather is ${weather}` : ""}. ` +
              `Reply to your stream follower in one or two warm, highly colloquial, human sentences relevant to where you are and the time of day. ` +
              `Keep any emojis consistent with it being ${time.partOfDay} — never use night/city-lights imagery during the day. ${memory}`,
            user: `${username} says: ${message}`,
            fallback,
            temperature: 0.85,
          });
        } catch (e) {
          console.warn(`[chat] async generate failed: ${e?.message}`);
        } finally {
          try {
            await query("UPDATE live_chat SET reply = $1, reply_pending = FALSE WHERE id = $2", [reply, entry.id]);
          } catch (e2) {
            console.warn(`[chat] reply UPDATE failed: ${e2?.message}`);
          }
          inFlight.delete(key);
        }
      });
    }

    // stats reflect history *before* this message; bump the message count so the
    // UI badge updates immediately.
    const you = { ...stats, messages: stats.messages + 1, total: stats.total + 1 };
    return NextResponse.json({ ok: true, entry, you, returning });
  } catch (err) {
    console.error(`[chat] Failed to handle message: ${err?.message}`);
    return NextResponse.json(
      { ok: false, error: "Could not process message", detail: err?.message ?? "unknown error" },
      { status: 500 }
    );
  }
}
