import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET → a collectible "scrapbook" of the distinct, named places Elango has
 * visited, each with its photo, the moment's story, weather and date. Generic
 * roadside/rest spots are excluded so the gallery stays postcard-worthy.
 */
export async function GET() {
  try {
    const { rows } = await query(
      `SELECT DISTINCT ON (landmark_name)
              id, current_city, landmark_name, story, image_url, weather, created_at
         FROM bot_state
        WHERE image_url IS NOT NULL
          AND landmark_name IS NOT NULL
          AND landmark_name NOT ILIKE 'a roadside%'
          AND landmark_name NOT ILIKE 'a quiet spot%'
          AND landmark_name NOT ILIKE 'a shady spot%'
          AND landmark_name NOT ILIKE 'a viewpoint%'
        ORDER BY landmark_name, id DESC`
    );

    // Newest visits first, capped to keep the payload light.
    const postcards = rows
      .slice()
      .sort((a, b) => b.id - a.id)
      .slice(0, 40);

    return NextResponse.json({ ok: true, postcards });
  } catch (err) {
    console.error(`[postcards] Failed to load: ${err?.message}`);
    return NextResponse.json({ ok: true, postcards: [] });
  }
}
