import { NextResponse } from "next/server";
import { getSupporterStats } from "@/lib/supporters";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/supporter?username=NAME → that viewer's relationship stats with
 * Elango (messages, coffees, buses, votes). Used to show their tier/badge.
 */
export async function GET(request) {
  const username = new URL(request.url).searchParams.get("username") || "";
  const stats = await getSupporterStats(username);
  return NextResponse.json({ ok: true, you: stats });
}
