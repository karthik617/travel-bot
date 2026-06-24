import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST { clientId } → record this viewer's heartbeat and return the count of
 * viewers active in the last 60 seconds. Stale rows are pruned opportunistically.
 */
export async function POST(request) {
  let clientId = "";
  try {
    clientId = String((await request.json())?.clientId ?? "").slice(0, 64);
  } catch {
    /* ignore malformed body */
  }

  try {
    if (clientId) {
      await query(
        `INSERT INTO presence (client_id, last_seen) VALUES ($1, NOW())
         ON CONFLICT (client_id) DO UPDATE SET last_seen = NOW()`,
        [clientId]
      );
      // Passive daily-active proxy (one row per client per day) — the cheapest
      // possible retention signal, feeding the Day-2 return North Star metric.
      await query(
        `INSERT INTO daily_active (session_id, day) VALUES ($1, CURRENT_DATE)
         ON CONFLICT (session_id, day) DO NOTHING`,
        [clientId]
      );
    }
    // Prune stale rows only ~5% of the time: at 30 viewers this was 60 DELETEs
    // a minute on a ~100-row table; the table self-heals fine at this cadence.
    if (Math.random() < 0.05) {
      await query("DELETE FROM presence WHERE last_seen < NOW() - INTERVAL '2 minutes'");
    }
    const { rows } = await query(
      "SELECT COUNT(*)::int AS n FROM presence WHERE last_seen > NOW() - INTERVAL '60 seconds'"
    );
    return NextResponse.json({ ok: true, viewers: Math.max(1, rows[0]?.n ?? 1) });
  } catch (err) {
    console.warn(`[presence] failed: ${err?.message}`);
    return NextResponse.json({ ok: true, viewers: 1 });
  }
}
