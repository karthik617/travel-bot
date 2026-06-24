import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const KINDS = new Set(["coffee", "bus", "general"]);

/**
 * POST → record a "I'd support Elango for real" intent before payments exist.
 * Captures optional email for the future "real support is live" re-engagement.
 * Everything is optional/best-effort; failures never block the UI.
 */
export async function POST(request) {
  let body;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const sessionId = body?.sessionId ? String(body.sessionId).slice(0, 64) : null;
  const username = body?.username ? String(body.username).trim().slice(0, 100) : null;
  const kind = KINDS.has(body?.kind) ? body.kind : "general";
  const emailRaw = body?.email ? String(body.email).trim().slice(0, 200) : null;
  // Light validation — store only if it looks like an email, else drop it.
  const email = emailRaw && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailRaw) ? emailRaw : null;

  try {
    await query(
      "INSERT INTO support_intents (session_id, username, kind, email) VALUES ($1, $2, $3, $4)",
      [sessionId, username, kind, email]
    );
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[support-intent] failed: ${err?.message}`);
    return NextResponse.json({ ok: false }, { status: 500 });
  }
}
