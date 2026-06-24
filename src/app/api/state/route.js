import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET → everything the dashboard needs in one round trip:
 *   - state: newest bot_state row
 *   - feed:  last 8 rows (timeline, newest first)
 *   - path:  up to 120 recent coordinates (chronological) for the map trail
 *   - vote:  the active poll, if any
 *   - stats: cumulative trip statistics
 *
 * The browser never talks to Postgres directly. On any DB error it returns
 * empty values (HTTP 200) so the UI degrades gracefully.
 */
export async function GET() {
  try {
    const [feedRes, pathRes, voteRes, statsRes, lastVoteRes, milestoneRes] = await Promise.all([
      query("SELECT * FROM bot_state ORDER BY id DESC LIMIT 8"),
      query("SELECT lat, lon FROM bot_state ORDER BY id DESC LIMIT 120"),
      query("SELECT * FROM active_votes WHERE is_active = TRUE ORDER BY id DESC LIMIT 1"),
      query(
        `SELECT
           COUNT(*)::int                         AS ticks,
           COUNT(DISTINCT current_city)::int     AS cities,
           COALESCE(MAX(trip_distance_km), 0)    AS distance_km,
           MIN(created_at)                        AS started_at
         FROM bot_state`
      ),
      // Most recent resolved poll → the "Last Fork" ghost card between votes.
      query("SELECT * FROM active_votes WHERE is_active = FALSE ORDER BY id DESC LIMIT 1"),
      // Freshest funded-arrival trophy (last 30 min) → celebratory share banner.
      query(
        "SELECT * FROM milestone_cards WHERE created_at > NOW() - INTERVAL '30 minutes' ORDER BY id DESC LIMIT 1"
      ),
    ]);

    const feed = feedRes.rows;
    const path = pathRes.rows
      .slice()
      .reverse()
      .map((r) => [Number(r.lat), Number(r.lon)]);

    const s = statsRes.rows[0] ?? {};
    const startedAt = s.started_at ? new Date(s.started_at) : null;
    const daysOnRoad = startedAt
      ? Math.max(1, Math.ceil((Date.now() - startedAt.getTime()) / (24 * 60 * 60 * 1000)))
      : 1;

    return NextResponse.json({
      ok: true,
      state: feed.length > 0 ? feed[0] : null,
      feed,
      path,
      vote: voteRes.rows.length > 0 ? voteRes.rows[0] : null,
      lastVote: lastVoteRes.rows.length > 0 ? lastVoteRes.rows[0] : null,
      milestone: milestoneRes.rows.length > 0 ? milestoneRes.rows[0] : null,
      stats: {
        ticks: s.ticks ?? 0,
        cities: s.cities ?? 0,
        distanceKm: Math.round(Number(s.distance_km ?? 0)),
        daysOnRoad,
      },
    });
  } catch (err) {
    console.error(`[state] Failed to load state: ${err?.message}`);
    return NextResponse.json({
      ok: true,
      state: null,
      feed: [],
      path: [],
      vote: null,
      lastVote: null,
      milestone: null,
      stats: { ticks: 0, cities: 0, distanceKm: 0, daysOnRoad: 1 },
    });
  }
}
