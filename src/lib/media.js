// Imagery for the journey feed. Tries a real Wikipedia photo of the landmark
// (or its city), and falls back to a static OpenStreetMap snapshot of the exact
// coordinates. Both are keyless. Always returns a usable URL string.

import { isGenericSpot } from "@/lib/journey";

const WIKI_UA = "ElangoTravelBot/1.0 (autonomous travel demo)";

/** Build a keyless static OSM map image URL centred on a coordinate. */
function staticMapUrl(lat, lon) {
  return (
    "https://staticmap.openstreetmap.de/staticmap.php" +
    `?center=${lat},${lon}&zoom=13&size=600x320&maptype=mapnik` +
    `&markers=${lat},${lon},lightblue1`
  );
}

/**
 * Look up a representative photo for a title via the Wikipedia REST summary API.
 * @returns {Promise<string|null>} An image URL, or null if none/disambiguation.
 */
async function wikipediaImage(title, timeoutMs = 7000) {
  if (!title) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(
      title
    )}`;
    const res = await fetch(url, {
      headers: { "User-Agent": WIKI_UA, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!res.ok) return null;

    const data = await res.json();
    if (data?.type === "disambiguation") return null;
    return data?.thumbnail?.source || data?.originalimage?.source || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Resolve the best available image for Elango's current spot:
 *   1. Wikipedia photo of the landmark
 *   2. Wikipedia photo of the city
 *   3. Static OSM map snapshot of the coordinates (always works)
 *
 * @returns {Promise<string>} A usable image URL.
 */
export async function fetchLandmarkImage(landmark, city, lat, lon) {
  const cleanedLandmark = isGenericSpot(landmark) ? null : landmark;

  const photo =
    (await wikipediaImage(cleanedLandmark)) ||
    (await wikipediaImage(city)) ||
    null;

  return photo || staticMapUrl(lat, lon);
}
