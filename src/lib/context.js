// Real-world context for Elango: India time-of-day awareness + live weather.
// Both are keyless and resilient — failures degrade to sensible defaults so the
// tick never blocks on them.

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000; // India Standard Time = UTC+5:30.

// Pools of meals and ambient details per part of day. Several options each so
// consecutive dispatches don't all reach for "banana leaf + tar roads" — a seed
// (e.g. the tick id) rotates through them, keeping the feed fresh and varied.
const MEALS = {
  morning: [
    "hot idli with coconut chutney",
    "a crispy dosa folded around spiced potato",
    "soft ghee pongal",
    "medu vada dunked in sambar",
    "steaming filter coffee and a banana",
  ],
  afternoon: [
    "a banana-leaf meals plate with sambar and rasam",
    "tangy lemon rice with fried papad",
    "curd rice cooled with mango pickle",
    "spicy Chettinad curry with parotta",
    "tamarind rice from a roadside stall",
  ],
  evening: [
    "crunchy molaga bajji and sundal",
    "a frosty glass of sugarcane juice",
    "hot mysore bonda",
    "masala tea with murukku",
    "roasted corn rubbed with chilli and lime",
  ],
  dinner: [
    "kothu parotta sizzling on a flat griddle",
    "idiyappam with coconut milk",
    "a banana-leaf plate of biryani",
    "dosa with spicy gunpowder podi",
  ],
  late: [
    "a last cup of tea before sleep",
    "warm turmeric milk",
    "leftover parotta wrapped in paper",
  ],
};

const VIBES = {
  morning: [
    "cool morning light and distant temple bells",
    "mist lifting off the fields as roosters call",
    "the first chai vendors firing up their stoves",
    "dew on the leaves and a soft golden glow",
  ],
  afternoon: [
    "bright midday heat and the buzz of cicadas",
    "the shade of a roadside neem tree",
    "the smell of warm earth and frying snacks",
    "kids cycling past and a temple gopuram in the distance",
  ],
  evening: [
    "golden-hour light and a cooling breeze",
    "long shadows and the glow of shop lights flickering on",
    "the sea-salt air drifting in from the coast",
    "flower vendors stringing jasmine for the evening",
  ],
  dinner: [
    "buzzing night-market lights and the smell of frying oil",
    "the clatter of a busy tiffin stall",
    "neon signs and the honk of evening traffic",
  ],
  late: [
    "quiet, starry skies and the hum of crickets",
    "shuttered shops and a lone streetlight",
    "the distant bark of dogs and a still, warm night",
  ],
};

const pick = (arr, seed) => arr[Math.abs(Math.trunc(seed)) % arr.length];

/**
 * Compute the current time-of-day in IST and what Elango would naturally be
 * doing then. No external call — derived from the server clock. A `seed`
 * (typically the latest tick id) rotates the meal/vibe so the feed stays varied
 * instead of repeating the same phrases every dispatch.
 *
 * @param {number} [seed=0] - Varies the meal/ambience picks between ticks.
 * @returns {{
 *   hour: number, clock: string, partOfDay: string, isNight: boolean,
 *   activity: string, mealHint: string, vibe: string
 * }}
 */
export function getTimeContext(seed = 0) {
  const istNow = new Date(Date.now() + IST_OFFSET_MS);
  const hour = istNow.getUTCHours();
  const minute = istNow.getUTCMinutes();
  const clock = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;

  let partOfDay;
  let activity;
  let bucket;

  if (hour >= 5 && hour < 11) {
    partOfDay = "morning";
    activity = hour < 9 ? "eating" : "walking";
    bucket = "morning";
  } else if (hour >= 11 && hour < 16) {
    partOfDay = "afternoon";
    activity = hour >= 12 && hour < 14 ? "eating" : "walking";
    bucket = "afternoon";
  } else if (hour >= 16 && hour < 20) {
    partOfDay = "evening";
    activity = "exploring";
    bucket = "evening";
  } else if (hour >= 20 && hour < 22) {
    partOfDay = "night";
    activity = "eating";
    bucket = "dinner";
  } else {
    partOfDay = "night";
    activity = "resting";
    bucket = "late";
  }

  return {
    hour,
    clock,
    partOfDay,
    isNight: activity === "resting",
    activity,
    mealHint: pick(MEALS[bucket], seed),
    vibe: pick(VIBES[bucket], seed + 3), // offset so meal & vibe don't move in lockstep
  };
}

// WMO weather codes (Open-Meteo) → human label + emoji.
const WEATHER_CODES = {
  0: ["clear skies", "☀️"],
  1: ["mostly clear", "🌤️"],
  2: ["partly cloudy", "⛅"],
  3: ["overcast", "☁️"],
  45: ["foggy", "🌫️"],
  48: ["icy fog", "🌫️"],
  51: ["light drizzle", "🌦️"],
  53: ["drizzle", "🌦️"],
  55: ["heavy drizzle", "🌧️"],
  61: ["light rain", "🌦️"],
  63: ["rain", "🌧️"],
  65: ["heavy rain", "🌧️"],
  66: ["freezing rain", "🌧️"],
  67: ["freezing rain", "🌧️"],
  71: ["light snow", "🌨️"],
  73: ["snow", "🌨️"],
  75: ["heavy snow", "❄️"],
  77: ["snow grains", "🌨️"],
  80: ["rain showers", "🌦️"],
  81: ["rain showers", "🌧️"],
  82: ["violent showers", "⛈️"],
  85: ["snow showers", "🌨️"],
  86: ["snow showers", "❄️"],
  95: ["thunderstorm", "⛈️"],
  96: ["thunderstorm + hail", "⛈️"],
  99: ["thunderstorm + hail", "⛈️"],
};

/**
 * Fetch current weather at a coordinate from the free, keyless Open-Meteo API.
 * Returns a compact object; on any failure returns a neutral fallback.
 *
 * @returns {Promise<{ tempC: number|null, label: string, emoji: string, summary: string }>}
 */
export async function fetchWeather(lat, lon, timeoutMs = 8000) {
  const fallback = { tempC: null, label: "pleasant", emoji: "🌤️", summary: "pleasant weather" };
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&current=temperature_2m,weather_code`;
    const res = await fetch(url, { signal: controller.signal });
    if (!res.ok) return fallback;

    const data = await res.json();
    const code = data?.current?.weather_code;
    const tempRaw = data?.current?.temperature_2m;
    const [label, emoji] = WEATHER_CODES[code] ?? ["clear", "🌤️"];
    const tempC = typeof tempRaw === "number" ? Math.round(tempRaw) : null;

    return {
      tempC,
      label,
      emoji,
      summary: tempC !== null ? `${tempC}°C, ${label}` : label,
    };
  } catch (err) {
    console.warn(`[weather] Lookup failed (${err?.name || "error"}): ${err?.message}`);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
