import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET → Elango's diary: the nightly recaps produced by the memory consolidation
 * "sleep pass" (Architecture Spec 02), newest first. Degrades to an empty list
 * on any DB error so the UI still renders.
 */
export async function GET() {
  try {
    const { rows } = await query(
      "SELECT id, day, text, created_at FROM diary_entries ORDER BY id DESC LIMIT 30"
    );
    return NextResponse.json({ ok: true, entries: rows });
  } catch (err) {
    console.error(`[diary] failed: ${err?.message}`);
    return NextResponse.json({ ok: true, entries: [] });
  }
}
