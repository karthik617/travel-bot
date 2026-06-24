import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET → the top contributors ranked by total support actions (coffees + bus
 * funds + votes). Powers the "Top Supporters" leaderboard.
 */
export async function GET() {
  try {
    // The leaderboard ranks by ALL interactions (free + paid) — its authentic
    // community weight stays intact and is never pay-to-win. Patrons (real-money
    // supporters) get a separate, parallel gratitude signal.
    const [leadersRes, patronsRes] = await Promise.all([
      query(
        `SELECT username,
                COUNT(*) FILTER (WHERE action = 'coffee')::int AS coffees,
                COUNT(*) FILTER (WHERE action = 'bus')::int    AS buses,
                COUNT(*) FILTER (WHERE action = 'vote')::int   AS votes,
                COUNT(*)::int                                  AS total
           FROM supporters
          GROUP BY username
          ORDER BY total DESC, MIN(created_at) ASC
          LIMIT 10`
      ),
      query(
        `SELECT username, COUNT(*)::int AS gifts
           FROM supporters
          WHERE paid = TRUE
          GROUP BY username
          ORDER BY gifts DESC, MIN(created_at) ASC
          LIMIT 8`
      ),
    ]);
    return NextResponse.json({ ok: true, leaders: leadersRes.rows, patrons: patronsRes.rows });
  } catch (err) {
    console.error(`[leaderboard] failed: ${err?.message}`);
    return NextResponse.json({ ok: true, leaders: [], patrons: [] });
  }
}
