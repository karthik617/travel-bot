// Per-viewer relationship layer: records the help a viewer gives (coffees, bus
// funds, votes) and summarises their history so Elango can recognise and thank
// returning followers. All functions are resilient — failures never break a
// request, they just yield empty/neutral results.

import { query } from "@/lib/db";

const ACTIONS = new Set(["coffee", "bus", "vote"]);

const cleanName = (u) => String(u || "").trim().slice(0, 100);

/**
 * Record a support action for a named viewer. No-op for blank/unknown input.
 * @param {string} username
 * @param {"coffee"|"bus"|"vote"} action
 * @param {{ sessionId?: string|null, paid?: boolean }} [opts] - durable session
 *   anchor (for payment crediting / vote dedup) and whether real money was paid.
 */
export async function logSupport(username, action, { sessionId = null, paid = false } = {}) {
  const name = cleanName(username);
  if (!name || !ACTIONS.has(action)) return;
  try {
    await query(
      "INSERT INTO supporters (username, action, session_id, paid) VALUES ($1, $2, $3, $4)",
      [name, action, sessionId ? String(sessionId).slice(0, 64) : null, !!paid]
    );
  } catch (err) {
    console.warn(`[supporters] log failed: ${err?.message}`);
  }
}

/**
 * Aggregate a viewer's history across supporters + live_chat.
 * @returns {Promise<{messages:number, coffees:number, buses:number, votes:number, total:number, firstSeen:string|null}>}
 */
export async function getSupporterStats(username) {
  const name = cleanName(username);
  const empty = { messages: 0, coffees: 0, buses: 0, votes: 0, total: 0, firstSeen: null };
  if (!name) return empty;

  try {
    const [sup, msg] = await Promise.all([
      query(
        `SELECT action, COUNT(*)::int AS n, MIN(created_at) AS first
           FROM supporters WHERE lower(username) = lower($1) GROUP BY action`,
        [name]
      ),
      query(
        `SELECT COUNT(*)::int AS n, MIN(created_at) AS first
           FROM live_chat WHERE lower(username) = lower($1)`,
        [name]
      ),
    ]);

    let coffees = 0;
    let buses = 0;
    let votes = 0;
    let first = null;
    const earlier = (a, b) => (!a ? b : !b ? a : new Date(a) < new Date(b) ? a : b);

    for (const r of sup.rows) {
      if (r.action === "coffee") coffees = r.n;
      else if (r.action === "bus") buses = r.n;
      else if (r.action === "vote") votes = r.n;
      first = earlier(first, r.first);
    }

    const messages = msg.rows[0]?.n ?? 0;
    first = earlier(first, msg.rows[0]?.first);

    return { messages, coffees, buses, votes, total: coffees + buses + votes + messages, firstSeen: first };
  } catch (err) {
    console.warn(`[supporters] stats failed: ${err?.message}`);
    return empty;
  }
}

/**
 * Build a natural-language memory note about a viewer for the chat prompt, plus
 * return their stats and last prior message.
 * @returns {Promise<{ memory:string, stats:object, returning:boolean }>}
 */
export async function getViewerMemory(username) {
  const name = cleanName(username);
  const stats = await getSupporterStats(name);

  if (!name || stats.total === 0) {
    return {
      memory: `${name || "This viewer"} is messaging you for the very first time — welcome them warmly by name.`,
      stats,
      returning: false,
    };
  }

  let lastMessage = null;
  try {
    const { rows } = await query(
      `SELECT message FROM live_chat WHERE lower(username) = lower($1)
       ORDER BY id DESC LIMIT 1`,
      [name]
    );
    lastMessage = rows[0]?.message ?? null;
  } catch {
    /* ignore */
  }

  const helps = [];
  if (stats.coffees) helps.push(`${stats.coffees} filter coffee${stats.coffees > 1 ? "s" : ""}`);
  if (stats.buses) helps.push(`${stats.buses} bus ride${stats.buses > 1 ? "s" : ""}`);
  if (stats.votes) helps.push(`${stats.votes} route vote${stats.votes > 1 ? "s" : ""}`);

  const helpLine = helps.length
    ? `Over time they've supported you with ${helps.join(", ")}.`
    : `They've chatted with you ${stats.messages} time${stats.messages > 1 ? "s" : ""} before.`;
  const lastLine = lastMessage ? ` Earlier they said: "${lastMessage}".` : "";

  return {
    memory: `${name} is a returning follower you know well. ${helpLine}${lastLine} Greet them like an old friend, by name, and reference your shared history naturally.`,
    stats,
    returning: true,
  };
}
