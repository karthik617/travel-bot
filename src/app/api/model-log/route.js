import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET → recent local-model calls + a model-vs-fallback summary, so you can see
 * how often the real model is actually answering (vs timing out into templates)
 * and how long it's taking. Degrades to empty on any DB error.
 */
export async function GET() {
  try {
    const [callsRes, summaryRes] = await Promise.all([
      query(
        "SELECT id, kind, model, source, ms, ok, preview, created_at FROM model_calls ORDER BY id DESC LIMIT 40"
      ),
      query(
        `SELECT
           COUNT(*)::int                                            AS total,
           COUNT(*) FILTER (WHERE source = 'model')::int            AS model,
           COUNT(*) FILTER (WHERE source = 'fallback')::int         AS fallback,
           COALESCE(ROUND(AVG(ms) FILTER (WHERE source = 'model'))::int, 0) AS avg_model_ms
         FROM model_calls
         WHERE created_at > NOW() - INTERVAL '24 hours'`
      ),
    ]);
    return NextResponse.json({ ok: true, calls: callsRes.rows, summary: summaryRes.rows[0] ?? {} });
  } catch (err) {
    console.error(`[model-log] failed: ${err?.message}`);
    return NextResponse.json({ ok: true, calls: [], summary: {} });
  }
}
