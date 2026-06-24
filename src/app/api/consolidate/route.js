import { NextResponse } from "next/server";
import { consolidate } from "@/lib/agent/memory";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Same shared secret that protects the travel-tick cron endpoint. */
function isAuthorized(request) {
  const secret = process.env.CRON_SECRET_TOKEN;
  if (!secret) return true;
  const auth = request.headers.get("authorization") || "";
  if (auth === `Bearer ${secret}`) return true;
  return new URL(request.url).searchParams.get("token") === secret;
}

/**
 * POST/GET → run the memory "sleep pass": distil recent episodes into a diary +
 * semantic facts and refresh people profiles. Safe to call repeatedly (only
 * consolidates episodes newer than the last diary entry). Normally fired once a
 * night from the rest tick, but exposed here for manual runs and verification.
 */
async function run(request) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  const result = await consolidate();
  return NextResponse.json(result, { status: result.ok ? 200 : 500 });
}

export const GET = run;
export const POST = run;
