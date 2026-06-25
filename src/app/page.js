"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Coffee,
  Bus,
  Send,
  Zap,
  MapPin,
  Radio,
  Vote as VoteIcon,
  Loader2,
  Footprints,
  Building2,
  CalendarDays,
  Activity,
  AlertTriangle,
  HeartHandshake,
  Images,
  Bell,
  BellOff,
  BookOpen,
  Cpu,
  Sun,
  Moon,
  Eye,
  Map as MapIcon,
  Share2,
  Compass,
  Sparkles,
} from "lucide-react";
import Scrapbook from "@/components/Scrapbook";
import Diary from "@/components/Diary";
import ModelLog from "@/components/ModelLog";
import Leaderboard from "@/components/Leaderboard";
import Soundscape from "@/components/Soundscape";
import { formatLocation, haversineKm } from "@/lib/journey";

// Leaflet touches `window`, so the map must never render on the server.
const TravelMap = dynamic(() => import("@/components/TravelMap"), {
  ssr: false,
  loading: () => (
    <div
      className="flex h-full w-full items-center justify-center"
      style={{ color: "var(--ink-soft)", fontFamily: "var(--font-mono)", fontSize: 13 }}
    >
      <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading live map…
    </div>
  ),
});

const STATE_POLL_MS = 15000;
const CHAT_POLL_MS = 7000;

// The overarching quest: walk the length of Tamil Nadu, Chennai → Kanyakumari.
const JOURNEY = {
  start: { city: "Chennai", lat: 13.0827, lon: 80.2707 },
  end: { city: "Kanyakumari", lat: 8.0883, lon: 77.5385 },
};
const JOURNEY_TOTAL_KM = haversineKm(
  JOURNEY.start.lat,
  JOURNEY.start.lon,
  JOURNEY.end.lat,
  JOURNEY.end.lon
);

/** Fraction (0–100) of the Chennai→Kanyakumari quest done, by straight-line distance. */
function journeyProgress(lat, lon) {
  if (typeof lat !== "number" || typeof lon !== "number")
    return { pct: 0, remainingKm: Math.round(JOURNEY_TOTAL_KM) };
  const remaining = haversineKm(lat, lon, JOURNEY.end.lat, JOURNEY.end.lon);
  const pct = Math.max(0, Math.min(100, Math.round((1 - remaining / JOURNEY_TOTAL_KM) * 100)));
  return { pct, remainingKm: Math.round(remaining) };
}

// ---- Pure helpers (module scope) -----------------------------------------

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

function istParts(nowMs) {
  const d = new Date(nowMs + IST_OFFSET_MS);
  return { h: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds() };
}

/** Time-of-day label, matching the redesign spec. */
function todLabel(h) {
  if (h < 5) return "Night";
  if (h < 12) return "Morning";
  if (h < 16) return "Afternoon";
  if (h < 19) return "Evening";
  if (h < 21) return "Dusk";
  return "Night";
}

/** Coarse part-of-day the procedural Soundscape understands. */
function partOfDay(h) {
  if (h >= 19 || h < 5) return "night";
  if (h < 12) return "morning";
  if (h < 16) return "afternoon";
  return "evening";
}

function relativeTime(iso, nowMs) {
  if (!iso || !nowMs) return "";
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const sec = Math.max(0, Math.round((nowMs - then) / 1000));
  if (sec < 45) return "just now";
  const min = Math.round(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.round(min / 60);
  if (hr < 24) return `${hr}h ago`;
  return `${Math.round(hr / 24)}d ago`;
}

function countdown(iso, nowMs) {
  if (!iso || !nowMs) return null;
  const ms = new Date(iso).getTime() - nowMs;
  if (ms <= 0) return "closing…";
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}m left`;
  const s = Math.floor((ms % 60000) / 1000);
  return m > 0 ? `${m}m ${s}s left` : `${s}s left`;
}

const ACTIVITY_BADGE = {
  walking: { label: "Walking" },
  eating: { label: "Eating" },
  exploring: { label: "Exploring" },
  resting: { label: "Resting" },
  exhausted: { label: "Exhausted" },
};

const WARMUP = {
  walking: ["One sec — catching my breath on the road… 🚶", "Walking and texting, gimme a tick! 😄"],
  eating: ["Mmf — mid-bite, machan, one sec! 🍽️", "Hang on, finishing this mouthful… 😋"],
  exploring: ["Ooh hang on, taking this all in… 🧭", "One sec, soaking up the view! 👀"],
  resting: ["Mmm… half-dozing, gimme a moment 😴", "Resting my legs — be right with you 🌙"],
  exhausted: ["Phew… catching my breath, one sec 🥵", "So tired, machan… hang on 😮‍💨"],
};
function warmupReply(activity, id) {
  const a = WARMUP[activity] || WARMUP.walking;
  return a[Math.abs(id ?? 0) % a.length];
}

const MOOD_PHRASE = {
  walking: "trekking down the road",
  eating: "stopping for a bite",
  exploring: "exploring the area",
  resting: "resting for the night",
  exhausted: "collapsed and needs a coffee",
};

const EMPTY_YOU = { messages: 0, coffees: 0, buses: 0, votes: 0, total: 0 };

function supporterTier(total) {
  if (total >= 30) return { label: "Legend" };
  if (total >= 15) return { label: "Patron" };
  if (total >= 5) return { label: "Regular" };
  if (total >= 1) return { label: "Friend" };
  return { label: "Newcomer" };
}

function getSessionId() {
  try {
    let id = window.localStorage.getItem("elango-session");
    if (!id) {
      id = window.crypto?.randomUUID?.() || `s_${String(Math.random()).slice(2)}${Date.now()}`;
      window.localStorage.setItem("elango-session", id);
    }
    return id;
  } catch {
    return undefined;
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

async function subscribeToPush() {
  try {
    if (!("serviceWorker" in navigator) || !("PushManager" in window)) return;
    const reg = await navigator.serviceWorker.register("/sw.js");
    const keyRes = await fetch("/api/push/subscribe");
    const { publicKey } = await keyRes.json();
    if (!publicKey) return;
    const existing = await reg.pushManager.getSubscription();
    const sub =
      existing ||
      (await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(publicKey),
      }));
    await fetch("/api/push/subscribe", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sub),
    });
  } catch (err) {
    console.warn(`[push] subscribe failed: ${err?.message}`);
  }
}

async function unsubscribeFromPush() {
  try {
    if (!("serviceWorker" in navigator)) return;
    const reg = await navigator.serviceWorker.getRegistration();
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await fetch("/api/push/subscribe", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ endpoint: sub.endpoint }),
      });
      await sub.unsubscribe();
    }
  } catch {
    /* ignore */
  }
}

/** Animate a number toward `target` whenever it changes. */
function useCountUp(target, duration = 700) {
  const [display, setDisplay] = useState(target ?? 0);
  const fromRef = useRef(target ?? 0);

  useEffect(() => {
    const from = fromRef.current;
    const to = target ?? 0;
    if (from === to) return undefined;
    let raf;
    const start = performance.now();
    const animate = (t) => {
      const p = Math.min(1, (t - start) / duration);
      const eased = 1 - (1 - p) ** 3;
      setDisplay(Math.round(from + (to - from) * eased));
      if (p < 1) raf = requestAnimationFrame(animate);
      else fromRef.current = to;
    };
    raf = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(raf);
  }, [target, duration]);

  return display;
}

// ---- Shared style fragments ----------------------------------------------

const FD = "var(--font-display)";
const FM = "var(--font-mono)";

/** Neo-brutalist card: ink border + hard offset shadow. */
const card = (shadow = "6px 6px 0 var(--ink)", radius = 13) => ({
  background: "var(--card)",
  border: "2px solid var(--ink)",
  borderRadius: radius,
  boxShadow: shadow,
  overflow: "hidden",
});

const NOISE_BG =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='140' height='140'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.85' numOctaves='2' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)'/%3E%3C/svg%3E\")";

/** A small "live" pulsing dot, colored by an accent var. */
function LiveDot({ color = "var(--alive)", size = 9 }) {
  return (
    <span style={{ position: "relative", display: "inline-flex", width: size, height: size }}>
      <span
        style={{
          position: "absolute",
          inset: 0,
          borderRadius: "50%",
          background: color,
          animation: "alivePulse 2.2s ease-out infinite",
        }}
      />
      <span
        style={{
          position: "relative",
          width: size,
          height: size,
          borderRadius: "50%",
          background: color,
          animation: "aliveDot 2.2s ease-in-out infinite",
        }}
      />
    </span>
  );
}

/** The little TN backpack chip used as Elango's mascot mark. */
function BackpackMark({ w = 32, h = 40, headerH = 14, shadow = "3px 3px 0 var(--ink)", label = true }) {
  return (
    <span
      style={{
        position: "relative",
        display: "inline-flex",
        flexDirection: "column",
        width: w,
        height: h,
        borderRadius: `${w / 2}px ${w / 2}px 5px 5px`,
        background: "var(--card)",
        border: "2px solid var(--ink)",
        overflow: "hidden",
        boxShadow: shadow,
        flex: "none",
      }}
    >
      <span style={{ height: headerH, background: "var(--alive)", borderBottom: "2px solid var(--ink)" }} />
      {label && (
        <span
          style={{
            flex: 1,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: FM,
            fontWeight: 700,
            fontSize: Math.max(8, Math.round(h / 4)),
          }}
        >
          TN
        </span>
      )}
    </span>
  );
}

/** A weather/time gradient for feed + map banners (fallback when no photo). */
function bannerBackground(weather = "", night = false) {
  const wet = /rain|drizzle|shower|thunder/i.test(weather);
  if (night)
    return "radial-gradient(160px 95px at 80% 24%, rgba(70,169,154,.4), transparent 72%), linear-gradient(180deg,#0e1a2a 0%,#16322f 60%,#0b1714 100%)";
  if (wet)
    return "radial-gradient(160px 95px at 80% 24%, rgba(120,140,150,.5), transparent 72%), linear-gradient(180deg,#cdd6cf 0%,#9fb3ab 52%,#5d7a72 100%)";
  return "radial-gradient(160px 95px at 80% 24%, rgba(222,154,18,.55), transparent 72%), linear-gradient(180deg, var(--sky) 0%, var(--teal-tint) 52%, var(--teal) 53%, #155a56 100%)";
}

// ---- Small UI atoms -------------------------------------------------------

function RailButton({ onClick, active, icon, children, title }) {
  return (
    <button
      onClick={onClick}
      title={title}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        background: active ? "var(--ink)" : "var(--card)",
        color: active ? "var(--paper)" : "var(--ink)",
        border: "1.5px solid var(--ink)",
        boxShadow: "2px 2px 0 var(--ink)",
        borderRadius: 7,
        padding: "7px 12px",
        cursor: "pointer",
        fontWeight: 600,
        fontSize: 13,
        whiteSpace: "nowrap",
        flex: "none",
      }}
    >
      {icon}
      {children}
    </button>
  );
}

function StatCard({ icon, label, value, accent, big, since }) {
  if (big) {
    return (
      <div style={{ ...card("4px 4px 0 var(--ink)", 11), flex: "2 1 240px", display: "flex", flexDirection: "column" }}>
        <div
          style={{
            height: 34,
            background: "var(--alive)",
            borderBottom: "2px solid var(--ink)",
            display: "flex",
            alignItems: "center",
            padding: "0 16px",
          }}
        >
          <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 11, letterSpacing: ".2em", color: "#fff" }}>
            {label}
          </span>
        </div>
        <div style={{ padding: "14px 16px 16px", display: "flex", alignItems: "baseline", gap: 10 }}>
          <span style={{ fontFamily: FD, fontWeight: 800, fontSize: "clamp(40px,5vw,54px)", lineHeight: 0.85, letterSpacing: "-.03em" }}>
            {value}
          </span>
          <span style={{ fontFamily: FM, fontSize: 13, letterSpacing: ".2em", color: "var(--ink-soft)" }}>KM</span>
          <span style={{ flex: 1 }} />
          {since && <span style={{ fontFamily: FM, fontSize: 10.5, color: "var(--alive-ink)" }}>{since}</span>}
        </div>
      </div>
    );
  }
  return (
    <div
      style={{
        ...card("4px 4px 0 var(--line-2)", 11),
        flex: "1 1 140px",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        justifyContent: "space-between",
        minHeight: 104,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span style={{ fontFamily: FM, fontSize: 10.5, letterSpacing: ".16em", color: "var(--ink-soft)" }}>{label}</span>
        <span style={{ color: accent, display: "inline-flex" }}>{icon}</span>
      </div>
      <span style={{ fontFamily: FD, fontWeight: 800, fontSize: "clamp(34px,3.6vw,44px)", lineHeight: 0.9, letterSpacing: "-.02em" }}>
        {value}
      </span>
    </div>
  );
}

export default function Home() {
  const [state, setState] = useState(null);
  const [feed, setFeed] = useState([]);
  const [path, setPath] = useState([]);
  const [vote, setVote] = useState(null);
  const [lastVote, setLastVote] = useState(null);
  const [milestone, setMilestone] = useState(null);
  const [dismissedMilestone, setDismissedMilestone] = useState(0);
  const [stats, setStats] = useState({ ticks: 0, cities: 0, distanceKm: 0, daysOnRoad: 1 });
  const [messages, setMessages] = useState([]);

  const [username, setUsername] = useState("");
  const [draft, setDraft] = useState("");
  const [you, setYou] = useState(EMPTY_YOU);
  const [remembered, setRemembered] = useState(false);

  const [actionBusy, setActionBusy] = useState("");
  const [chatBusy, setChatBusy] = useState(false);

  // "Make it real" demand-capture (no charge yet — payments coming soon).
  const [intentOpen, setIntentOpen] = useState(false);
  const [intentEmail, setIntentEmail] = useState("");
  const [intentSent, setIntentSent] = useState(false);

  // null until mount → server and first client render agree (no hydration mismatch).
  const [nowMs, setNowMs] = useState(null);
  const [scrapbookOpen, setScrapbookOpen] = useState(false);
  const [diaryOpen, setDiaryOpen] = useState(false);
  const [modelLogOpen, setModelLogOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [viewers, setViewers] = useState(1);
  const [unseen, setUnseen] = useState(0);
  const [lastSyncMs, setLastSyncMs] = useState(null);
  const [lbKey, setLbKey] = useState(0);
  const [notifyOn, setNotifyOn] = useState(false);
  const [themeMode, setThemeMode] = useState(null); // null = auto (by IST hour)

  const chatEndRef = useRef(null);
  const lastIdRef = useRef(null);
  const lastCityRef = useRef(null);
  const notifyOnRef = useRef(false);

  const notify = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3200);
  }, []);

  const toggleNotify = async () => {
    if (notifyOn) {
      setNotifyOn(false);
      try {
        window.localStorage.setItem("elango-notify", "0");
      } catch {
        /* ignore */
      }
      unsubscribeFromPush();
      notify("🔕 Notifications off");
      return;
    }
    if (typeof Notification === "undefined") {
      notify("Notifications aren't supported in this browser");
      return;
    }
    let perm = Notification.permission;
    if (perm === "default") {
      try {
        perm = await Notification.requestPermission();
      } catch {
        /* ignore */
      }
    }
    if (perm === "granted") {
      setNotifyOn(true);
      try {
        window.localStorage.setItem("elango-notify", "1");
      } catch {
        /* ignore */
      }
      subscribeToPush();
      notify("🔔 You'll be alerted when Elango reaches a new town");
    } else {
      notify("Notifications are blocked — enable them in your browser settings");
    }
  };

  // ----- Data loaders -----------------------------------------------------

  const loadState = useCallback(async () => {
    try {
      const res = await fetch("/api/state", { cache: "no-store" });
      const json = await res.json();
      if (!json?.ok) return;
      if (json.state) {
        setState(json.state);
        if (
          lastIdRef.current !== null &&
          json.state.id !== lastIdRef.current &&
          typeof document !== "undefined" &&
          document.hidden
        ) {
          setUnseen((u) => u + 1);
        }
        lastIdRef.current = json.state.id;

        const city = json.state.current_city;
        if (
          notifyOnRef.current &&
          lastCityRef.current &&
          city &&
          city !== lastCityRef.current &&
          typeof Notification !== "undefined" &&
          Notification.permission === "granted"
        ) {
          try {
            new Notification(`🎒 Elango reached ${city}!`, {
              body: (json.state.story || "").slice(0, 140),
              tag: "elango-move",
            });
          } catch {
            /* ignore */
          }
        }
        lastCityRef.current = city;
      }
      if (Array.isArray(json.feed)) setFeed(json.feed);
      if (Array.isArray(json.path)) setPath(json.path);
      if (json.stats) setStats(json.stats);
      setVote(json.vote ?? null);
      setLastVote(json.lastVote ?? null);
      setMilestone(json.milestone ?? null);
      setLastSyncMs(Date.now());
    } catch (err) {
      console.warn(`[ui] Could not load state: ${err?.message}`);
    }
  }, []);

  const heartbeat = useCallback(async () => {
    try {
      let id = window.localStorage.getItem("elango-client");
      if (!id) {
        id = window.crypto?.randomUUID?.() || String(Math.random()).slice(2);
        window.localStorage.setItem("elango-client", id);
      }
      const res = await fetch("/api/presence", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: id }),
      });
      const json = await res.json();
      if (json?.ok) setViewers(json.viewers);
    } catch {
      /* ignore */
    }
  }, []);

  const loadChat = useCallback(async () => {
    try {
      const res = await fetch("/api/chat", { cache: "no-store" });
      const json = await res.json();
      if (json?.ok) setMessages(json.messages ?? []);
    } catch (err) {
      console.warn(`[ui] Could not load chat: ${err?.message}`);
    }
  }, []);

  const loadSupporter = useCallback(async (handle) => {
    const name = (handle ?? "").trim();
    if (!name) {
      setYou(EMPTY_YOU);
      return;
    }
    try {
      const res = await fetch(`/api/supporter?username=${encodeURIComponent(name)}`, {
        cache: "no-store",
      });
      const json = await res.json();
      if (json?.ok && json.you) setYou(json.you);
    } catch {
      /* ignore */
    }
  }, []);

  // ----- Lifecycle --------------------------------------------------------

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem("elango-handle");
      if (saved) setUsername(saved);
    } catch {
      /* ignore */
    }

    loadState();
    loadChat();
    setNowMs(Date.now());
    heartbeat();

    const stateTimer = setInterval(loadState, STATE_POLL_MS);
    const chatTimer = setInterval(loadChat, CHAT_POLL_MS);
    const clockTimer = setInterval(() => setNowMs(Date.now()), 1000);
    const presenceTimer = setInterval(heartbeat, 30000);

    return () => {
      clearInterval(stateTimer);
      clearInterval(chatTimer);
      clearInterval(clockTimer);
      clearInterval(presenceTimer);
    };
  }, [loadState, loadChat, heartbeat]);

  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = unseen > 0 ? `(${unseen}) 🎒 Elango moved!` : "🎒 Elango — Live from Tamil Nadu";
  }, [unseen]);

  useEffect(() => {
    const onVis = () => {
      if (typeof document !== "undefined" && !document.hidden) setUnseen(0);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  useEffect(() => {
    notifyOnRef.current = notifyOn;
  }, [notifyOn]);

  useEffect(() => {
    try {
      if (
        window.localStorage.getItem("elango-notify") === "1" &&
        typeof Notification !== "undefined" &&
        Notification.permission === "granted"
      ) {
        setNotifyOn(true);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, chatBusy]);

  useEffect(() => {
    const t = setTimeout(() => loadSupporter(username), 700);
    return () => clearTimeout(t);
  }, [username, loadSupporter]);

  // ----- Derived (time, theme) -------------------------------------------

  const hasTime = nowMs !== null;
  const { h, m, s } = hasTime ? istParts(nowMs) : { h: 12, m: 0, s: 0 };
  const autoNight = h >= 19 || h < 6;
  const night = themeMode === null ? autoNight : themeMode === "night";

  // Apply the theme to <html> so fixed overlays + modals inherit the tokens.
  // Before the clock is known (and with no manual override) we leave the
  // no-flash script's value untouched to avoid a day→night flicker.
  useEffect(() => {
    if (typeof document === "undefined") return;
    if (!hasTime && themeMode === null) return;
    document.documentElement.dataset.theme = night ? "night" : "day";
  }, [night, hasTime, themeMode]);

  const clock = hasTime
    ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : "--:--:--";
  const tod = todLabel(h);
  const syncedAgo = hasTime && lastSyncMs ? Math.max(0, Math.round((nowMs - lastSyncMs) / 1000)) : null;

  // ----- Actions ----------------------------------------------------------

  const runAction = async (action) => {
    setActionBusy(action);
    const optimisticId = -Date.now();
    const base = {
      id: optimisticId,
      landmark_name: state?.landmark_name,
      current_city: state?.current_city,
      weather: state?.weather,
      image_url: null,
      created_at: new Date().toISOString(),
      _pending: true,
    };
    if (action === "coffee") {
      setState((s2) =>
        s2
          ? {
              ...s2,
              energy: Math.min(100, (s2.energy ?? 0) + 15),
              wallet: Math.max(0, (s2.wallet ?? 0) - 30),
              activity: "eating",
            }
          : s2
      );
      setFeed((f) => [{ ...base, activity: "eating", story: "☕ Pouring a hot filter coffee for Elango…" }, ...f]);
      notify("☕ Elango perks up — coffee on the way!");
    } else if (action === "bus") {
      setFeed((f) => [{ ...base, activity: "walking", story: "🚌 Flagging down a local bus to somewhere new…" }, ...f]);
      notify("🚌 Elango's hopping on a bus!");
    }

    try {
      const res = await fetch("/api/travel-tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, username: username.trim() || undefined, sessionId: getSessionId() }),
      });
      const json = await res.json();
      if (json?.ok && json.state) setState(json.state);
      await loadState();
      loadSupporter(username);
      setLbKey((k) => k + 1);
    } catch (err) {
      console.warn(`[ui] Action '${action}' failed: ${err?.message}`);
      setFeed((f) => f.filter((r) => r.id !== optimisticId));
      await loadState();
    } finally {
      setActionBusy("");
    }
  };

  const castVote = async (option) => {
    if (!vote) return;
    setActionBusy(`vote-${option}`);
    setVote((prev) =>
      prev
        ? {
            ...prev,
            option_a_count: prev.option_a_count + (option === "a" ? 1 : 0),
            option_b_count: prev.option_b_count + (option === "b" ? 1 : 0),
          }
        : prev
    );
    try {
      await fetch("/api/travel-tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "vote",
          voteId: vote.id,
          option,
          username: username.trim() || undefined,
          sessionId: getSessionId(),
        }),
      });
      await loadState();
      loadSupporter(username);
      setLbKey((k) => k + 1);
    } catch (err) {
      console.warn(`[ui] Vote failed: ${err?.message}`);
      await loadState();
    } finally {
      setActionBusy("");
    }
  };

  const submitIntent = async (e) => {
    e.preventDefault();
    try {
      await fetch("/api/support-intent", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionId: getSessionId(),
          username: username.trim() || undefined,
          kind: "general",
          email: intentEmail.trim() || undefined,
        }),
      });
    } catch {
      /* best-effort */
    }
    setIntentSent(true);
    notify("💛 Thanks — you're on the list!");
  };

  const shareMilestone = async (mc) => {
    const text = `🎉 ${mc.handle} just sent Elango the AI backpacker to ${mc.city} — Day ${mc.day} of his walk across Tamil Nadu! Follow him live 👇`;
    const url = typeof window !== "undefined" ? window.location.origin : "";
    try {
      if (navigator.share) await navigator.share({ title: "Elango's Journey", text, url });
      else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        notify("Milestone copied — share Elango's journey! 📋");
      }
    } catch {
      /* cancelled */
    }
  };

  const sendChat = async (e) => {
    e.preventDefault();
    const message = draft.trim();
    if (!message || chatBusy) return;
    const handle = username.trim() || "Traveller";
    try {
      window.localStorage.setItem("elango-handle", handle);
    } catch {
      /* ignore */
    }
    setChatBusy(true);
    setDraft("");
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username: handle, message, sessionId: getSessionId() }),
      });
      const json = await res.json();
      if (json?.ok && json.entry) {
        setMessages((prev) => [...prev, json.entry]);
        if (json.you) setYou(json.you);
        if (json.returning) {
          setRemembered(true);
          setTimeout(() => setRemembered(false), 6000);
        }
      }
    } catch (err) {
      console.warn(`[ui] Chat send failed: ${err?.message}`);
    } finally {
      setChatBusy(false);
    }
  };

  // ----- Derived (domain) -------------------------------------------------

  const energy = state?.energy ?? 0;
  const wallet = state?.wallet ?? 0;
  const city = state?.current_city ?? "Tamil Nadu";
  const landmark = state?.landmark_name ?? "";
  const weather = state?.weather ?? "";
  const activityLabel = (ACTIVITY_BADGE[state?.activity] ?? ACTIVITY_BADGE.walking).label;

  const animEnergy = useCountUp(energy);
  const animDistance = useCountUp(stats.distanceKm);

  const energyHealthy = animEnergy >= 30;
  const energyAccent = energyHealthy ? "var(--alive)" : "var(--elango)";
  const energyInk = energyHealthy ? "var(--alive-ink)" : "var(--elango)";

  const totalVotes = (vote?.option_a_count ?? 0) + (vote?.option_b_count ?? 0) || 0;
  const pctA = totalVotes ? Math.round(((vote?.option_a_count ?? 0) / totalVotes) * 100) : 50;
  const pctB = 100 - (totalVotes ? pctA : 50);
  const voteThreshold = vote?.minimum_votes ?? 3;
  const voteTimeLeft = vote ? countdown(vote.expires_at, nowMs) : null;

  let lastForkSummary = null;
  if (lastVote) {
    const la = lastVote.option_a_count ?? 0;
    const lb = lastVote.option_b_count ?? 0;
    const total = la + lb;
    const winnerTitle = la >= lb ? lastVote.option_a_title : lastVote.option_b_title;
    const winPct = total ? Math.round((Math.max(la, lb) / total) * 100) : 50;
    lastForkSummary = { winnerTitle, winPct, total };
  }
  const showMilestone = milestone && milestone.id !== dismissedMilestone;
  const tier = supporterTier(you.total);

  let rescue = null;
  if (state) {
    if (state.activity === "exhausted" || energy <= 0) {
      rescue = {
        level: "critical",
        msg: `Elango has collapsed from exhaustion near ${city}! He can't take another step until someone sends energy.`,
        action: "coffee",
        label: "Send a coffee ☕",
      };
    } else if (energy <= 25) {
      rescue = { level: "warn", msg: `Elango is running on fumes (${energy}%) near ${city} — keep him going?`, action: "coffee", label: "Buy filter coffee ☕" };
    } else if (wallet <= 150) {
      rescue = { level: "warn", msg: `Elango is nearly broke (₹${wallet}) — fund a bus before he's stranded.`, action: "bus", label: "Fund a local bus 🚌" };
    }
  }

  const moodPhrase = MOOD_PHRASE[state?.activity] ?? "out on the road";
  const journey = journeyProgress(state?.lat, state?.lon);
  const hasCoords = typeof state?.lat === "number" && typeof state?.lon === "number";

  const featured = feed[0] ?? null;
  const restFeed = feed.slice(1);

  // ===== Render =============================================================

  return (
    <div style={{ minHeight: "100vh", background: "var(--paper)", color: "var(--ink)", position: "relative", overflowX: "hidden" }}>
      {/* grain overlay */}
      <div
        aria-hidden="true"
        style={{
          position: "fixed",
          inset: 0,
          pointerEvents: "none",
          zIndex: 80,
          opacity: 0.045,
          mixBlendMode: "multiply",
          backgroundImage: NOISE_BG,
        }}
      />

      {/* ===== HEADER ===== */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          background: "color-mix(in srgb, var(--paper) 88%, transparent)",
          backdropFilter: "blur(10px)",
          borderBottom: "1.5px solid var(--line-2)",
        }}
      >
        <div
          style={{
            maxWidth: 1320,
            margin: "0 auto",
            padding: "12px clamp(14px,3vw,28px)",
            display: "flex",
            alignItems: "center",
            gap: 14,
            flexWrap: "wrap",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 11 }}>
            <span style={{ position: "relative", display: "inline-flex" }}>
              <BackpackMark />
              <span
                style={{
                  position: "absolute",
                  top: -3,
                  right: -3,
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: "var(--elango)",
                  border: "2px solid var(--paper)",
                }}
              />
            </span>
            <div style={{ lineHeight: 1 }}>
              <div style={{ fontFamily: FD, fontWeight: 800, fontSize: 18, letterSpacing: "-.01em" }}>ELANGO</div>
              <div style={{ fontFamily: FM, fontSize: 9, letterSpacing: ".2em", color: "var(--ink-soft)", marginTop: 3 }}>
                LIVE · TAMIL NADU
              </div>
            </div>
          </div>
          <div style={{ flex: 1, minWidth: 20 }} />
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontFamily: FM, fontSize: 11.5, color: "var(--ink-soft)" }}>
            <LiveDot size={8} />
            <span style={{ color: "var(--ink)", fontWeight: 700 }} className="tabular-nums">
              {clock}
            </span>
            <span style={{ opacity: 0.55 }}>IST</span>
          </div>
          <button
            onClick={() => setThemeMode(night ? "day" : "night")}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              background: "var(--card)",
              border: "2px solid var(--ink)",
              boxShadow: "3px 3px 0 var(--ink)",
              borderRadius: 999,
              padding: "7px 13px 7px 11px",
              cursor: "pointer",
              fontFamily: FM,
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: ".08em",
              color: "var(--ink)",
            }}
          >
            {night ? (
              <Moon className="h-4 w-4" style={{ color: "var(--teal)" }} fill="currentColor" />
            ) : (
              <Sun className="h-4 w-4" style={{ color: "var(--marigold)" }} />
            )}
            {night ? "NIGHT" : "DAY"}
          </button>
        </div>

        {/* utility rail */}
        <div style={{ borderTop: "1.5px solid var(--line)" }}>
          <div
            style={{
              maxWidth: 1320,
              margin: "0 auto",
              padding: "9px clamp(14px,3vw,28px)",
              display: "flex",
              alignItems: "center",
              gap: 9,
              overflowX: "auto",
            }}
          >
            <RailButton onClick={() => setScrapbookOpen(true)} icon={<Images className="h-4 w-4" />}>
              Scrapbook
            </RailButton>
            <RailButton onClick={() => setDiaryOpen(true)} icon={<BookOpen className="h-4 w-4" />}>
              Diary
            </RailButton>
            <RailButton onClick={() => setModelLogOpen(true)} icon={<Cpu className="h-4 w-4" />} title="Live model vs fallback provenance">
              Models
            </RailButton>
            <span style={{ flex: 1, minWidth: 8 }} />
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                border: "1.5px solid var(--line-2)",
                borderRadius: 7,
                padding: "7px 12px",
                fontFamily: FM,
                fontSize: 11,
                color: "var(--ink-soft)",
                whiteSpace: "nowrap",
                flex: "none",
              }}
            >
              <Eye className="h-3.5 w-3.5" />
              {viewers} WATCHING
            </span>
            <button
              onClick={toggleNotify}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                background: notifyOn ? "var(--alive)" : "transparent",
                border: notifyOn ? "1.5px solid var(--alive)" : "1.5px solid var(--line-2)",
                borderRadius: 7,
                padding: "7px 12px",
                cursor: "pointer",
                fontSize: 13,
                fontWeight: notifyOn ? 700 : 400,
                color: notifyOn ? "#fff" : "var(--ink-2)",
                whiteSpace: "nowrap",
                flex: "none",
              }}
            >
              {notifyOn ? <Bell className="h-3.5 w-3.5" /> : <BellOff className="h-3.5 w-3.5" />}
              {notifyOn ? "Alerts on" : "Notify me"}
            </button>
            <Soundscape partOfDay={partOfDay(h)} weather={weather} />
          </div>
        </div>
      </header>

      <main style={{ maxWidth: 1320, margin: "0 auto", padding: "clamp(16px,2.4vw,26px) clamp(14px,3vw,28px) 40px" }}>
        {/* ===== HERO BOARD ===== */}
        <div style={card()}>
          <div
            style={{
              position: "relative",
              background: "linear-gradient(180deg,var(--sky),transparent)",
              borderBottom: "2px solid var(--ink)",
              padding: "12px clamp(16px,2.4vw,24px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              gap: 12,
              flexWrap: "wrap",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
              <LiveDot color="var(--elango)" />
              <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 12, letterSpacing: ".14em" }}>
                LIVE · DAY {stats.daysOnRoad}
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
              {night ? (
                <Moon className="h-4 w-4" style={{ color: "var(--teal)" }} fill="currentColor" />
              ) : (
                <Sun className="h-[18px] w-[18px]" style={{ color: "var(--marigold)" }} />
              )}
              <span style={{ fontFamily: FM, fontSize: 12, color: "var(--ink)" }}>
                {tod} · <span className="tabular-nums">{clock}</span> IST
              </span>
            </div>
          </div>

          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit,minmax(300px,1fr))",
              gap: "clamp(20px,3vw,34px)",
              padding: "clamp(18px,2.6vw,26px) clamp(16px,2.4vw,24px)",
            }}
          >
            {/* identity + status */}
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
                <BackpackMark w={46} h={58} headerH={19} shadow="4px 4px 0 var(--ink)" />
                <div>
                  <h1 style={{ fontFamily: FD, fontWeight: 800, fontSize: "clamp(36px,4.6vw,50px)", lineHeight: 0.9, letterSpacing: "-.02em", margin: 0 }}>
                    Elango
                  </h1>
                  <div style={{ fontSize: 15, color: "var(--ink-2)", marginTop: 4, fontWeight: 500 }}>Live from Tamil Nadu</div>
                </div>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 20, color: "var(--ink)" }}>
                <MapPin className="h-[18px] w-[18px]" style={{ color: "var(--elango)" }} />
                <span style={{ fontSize: 16, fontWeight: 600 }}>{formatLocation(landmark, city)}</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 11 }}>
                <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--alive)", boxShadow: "0 0 0 3px var(--alive-tint)" }} />
                <span style={{ fontFamily: FM, fontSize: 11.5, color: "var(--ink-soft)" }}>
                  {syncedAgo !== null ? `synced ${syncedAgo}s ago` : "syncing…"}
                  {hasCoords ? ` · ${state.lat.toFixed(2)}°N ${state.lon.toFixed(2)}°E` : ""}
                </span>
              </div>
              <div style={{ display: "flex", gap: 8, marginTop: 18, flexWrap: "wrap" }}>
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 7,
                    background: "var(--alive-tint)",
                    border: "1.5px solid var(--alive)",
                    borderRadius: 7,
                    padding: "7px 12px",
                    color: "var(--alive-ink)",
                    fontWeight: 700,
                    fontSize: 12.5,
                  }}
                >
                  <Compass className="h-[15px] w-[15px]" />
                  {activityLabel.toUpperCase()}
                </span>
                {weather && (
                  <span
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 7,
                      background: "var(--card)",
                      border: "1.5px solid var(--line-2)",
                      borderRadius: 7,
                      padding: "7px 12px",
                      fontFamily: FM,
                      fontSize: 12,
                      color: "var(--ink)",
                    }}
                  >
                    {weather}
                  </span>
                )}
              </div>
            </div>

            {/* destination board */}
            <div style={{ display: "flex", flexDirection: "column", justifyContent: "center", minWidth: 0 }}>
              <div style={{ fontFamily: FM, fontSize: 10.5, letterSpacing: ".2em", color: "var(--ink-soft)", marginBottom: 9 }}>
                DESTINATION BOARD
              </div>
              <div
                style={{
                  background: "var(--ink)",
                  borderRadius: 8,
                  padding: "14px 16px",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 10,
                }}
              >
                <span style={{ fontFamily: FM, fontWeight: 700, fontSize: "clamp(12px,1.4vw,15px)", letterSpacing: ".04em", color: "var(--paper)" }}>
                  {JOURNEY.start.city.toUpperCase()}
                </span>
                <span style={{ flex: 1, display: "flex", alignItems: "center", color: "var(--marigold)", minWidth: 24 }}>
                  <span
                    style={{
                      flex: 1,
                      height: 2,
                      background: "repeating-linear-gradient(90deg,var(--marigold) 0 5px,transparent 5px 9px)",
                    }}
                  />
                  <span style={{ marginLeft: 4 }}>→</span>
                </span>
                <span style={{ fontFamily: FM, fontWeight: 700, fontSize: "clamp(12px,1.4vw,15px)", letterSpacing: ".04em", color: "var(--marigold)" }}>
                  {JOURNEY.end.city.toUpperCase()}
                </span>
              </div>
              <div style={{ position: "relative", margin: "22px 4px 0", height: 3, background: "var(--line-2)", borderRadius: 2 }}>
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    height: 3,
                    width: `${journey.pct}%`,
                    borderRadius: 2,
                    background: "repeating-linear-gradient(90deg,var(--alive) 0 6px,transparent 6px 12px)",
                    animation: "march 1s linear infinite",
                    transition: "width .7s cubic-bezier(.2,.8,.2,1)",
                  }}
                />
                <span style={{ position: "absolute", left: 0, top: "50%", transform: "translate(-50%,-50%)", width: 9, height: 9, borderRadius: "50%", background: "var(--alive)", border: "2px solid var(--card)" }} />
                <span
                  style={{
                    position: "absolute",
                    left: `${journey.pct}%`,
                    top: "50%",
                    transform: "translate(-50%,-50%)",
                    transition: "left .7s cubic-bezier(.2,.8,.2,1)",
                  }}
                >
                  <BackpackMark w={16} h={20} headerH={7} shadow="2px 2px 0 var(--ink)" label={false} />
                </span>
                <span style={{ position: "absolute", right: 0, top: "50%", width: 7, height: 7, background: "var(--ink)", transform: "translate(50%,-50%) rotate(45deg)" }} />
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", marginTop: 14, fontFamily: FM, fontSize: 11.5, color: "var(--ink-soft)" }}>
                <span>
                  <span style={{ color: "var(--alive-ink)", fontWeight: 700 }}>{journey.pct}%</span> walked
                </span>
                <span>
                  <span style={{ color: "var(--ink)", fontWeight: 700 }}>{journey.remainingKm} KM</span> to go
                </span>
              </div>
            </div>
          </div>

          {/* energy footer */}
          <div
            style={{
              background: "var(--paper-2)",
              borderTop: "2px solid var(--ink)",
              padding: "16px clamp(16px,2.4vw,24px)",
              display: "flex",
              alignItems: "center",
              gap: "clamp(16px,2.5vw,26px)",
              flexWrap: "wrap",
            }}
          >
            <div style={{ flex: 1, minWidth: 200 }}>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 9, gap: 10 }}>
                <span style={{ display: "inline-flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <Zap className="h-4 w-4" style={{ color: "var(--elango)" }} fill="currentColor" />
                  <span style={{ fontFamily: FM, fontSize: 11, letterSpacing: ".16em", color: "var(--ink)" }}>ENERGY</span>
                  <span
                    style={{
                      fontWeight: 700,
                      fontSize: 11,
                      letterSpacing: ".04em",
                      color: energyInk,
                      animation: energyHealthy ? "none" : "blink 1.4s ease-in-out infinite",
                    }}
                  >
                    · {energyHealthy ? "FRESH LEGS" : "RUNNING ON FUMES"}
                  </span>
                </span>
                <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 15, color: energyInk }} className="tabular-nums">
                  {animEnergy}%
                </span>
              </div>
              <div style={{ position: "relative", height: 18, borderRadius: 6, background: "var(--card)", border: "2px solid var(--ink)", overflow: "hidden" }}>
                <div
                  style={{
                    position: "absolute",
                    left: 0,
                    top: 0,
                    bottom: 0,
                    width: `${animEnergy}%`,
                    background: energyAccent,
                    backgroundImage: "repeating-linear-gradient(45deg,rgba(255,255,255,.22) 0 5px,transparent 5px 10px)",
                    transition: "width .7s cubic-bezier(.2,.8,.2,1),background .4s",
                  }}
                />
              </div>
            </div>
            <button
              onClick={() => runAction("coffee")}
              disabled={actionBusy !== ""}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 9,
                background: "var(--marigold)",
                border: "2px solid var(--ink)",
                boxShadow: "3px 3px 0 var(--ink)",
                borderRadius: 8,
                padding: "11px 17px",
                cursor: actionBusy !== "" ? "not-allowed" : "pointer",
                opacity: actionBusy !== "" ? 0.6 : 1,
                fontWeight: 700,
                fontSize: 14,
                color: "var(--ink)",
                flex: "none",
              }}
            >
              {actionBusy === "coffee" ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : <Coffee className="h-[18px] w-[18px]" />}
              Buy filter coffee
            </button>
          </div>
        </div>

        {/* ===== STATS ===== */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 14 }}>
          <StatCard big label="WALKED" value={animDistance} since={`SINCE ${JOURNEY.start.city.toUpperCase()}`} />
          <StatCard label="TOWNS" value={stats.cities} accent="var(--teal)" icon={<Building2 className="h-[19px] w-[19px]" />} />
          <StatCard label="DAY" value={stats.daysOnRoad} accent="var(--marigold)" icon={<CalendarDays className="h-[19px] w-[19px]" />} />
          <StatCard label="STOPS" value={stats.ticks} accent="var(--elango)" icon={<Activity className="h-[19px] w-[19px]" />} />
        </div>

        {/* ===== SUPPORT STUBS ===== */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 14, marginTop: 14 }}>
          <SupportStub
            kind="PROVISION"
            accent="var(--marigold)"
            tint="var(--marigold-tint)"
            icon={<Coffee className="h-5 w-5" />}
            title="Filter coffee"
            body="Buy Elango a steel tumbler — he perks up and walks further."
            big="+18%"
            small="ENERGY"
            cta="₹40 · Buy"
            ctaColor="var(--ink)"
            ctaBg="var(--marigold)"
            onClick={() => runAction("coffee")}
            busy={actionBusy === "coffee"}
          />
          <SupportStub
            kind="PASSAGE"
            accent="var(--teal)"
            tint="var(--teal-tint)"
            icon={<Bus className="h-5 w-5" />}
            title="Local bus"
            body="Fund a fare and skip him ahead a leg when the road runs long."
            big="+1"
            small="LEG"
            cta="₹120 · Fund"
            ctaColor="#fff"
            ctaBg="var(--teal)"
            onClick={() => runAction("bus")}
            busy={actionBusy === "bus"}
          />
          <button
            onClick={() => setIntentOpen((v) => !v)}
            style={{
              flex: "1 1 200px",
              display: "flex",
              alignItems: "center",
              gap: 13,
              border: "2px dashed var(--line-2)",
              borderRadius: 11,
              padding: "14px 18px",
              background: "transparent",
              cursor: "pointer",
              textAlign: "left",
              color: "var(--ink)",
            }}
          >
            <HeartHandshake className="h-5 w-5" style={{ color: "var(--elango)" }} />
            <span style={{ flex: 1, minWidth: 0 }}>
              <span style={{ display: "block", fontWeight: 700, fontSize: 14 }}>Back Elango for real</span>
              <span style={{ display: "block", fontSize: 12, color: "var(--ink-soft)" }}>Real-money support</span>
            </span>
            <span
              style={{
                transform: "rotate(-4deg)",
                border: "1.5px solid var(--elango)",
                borderRadius: 6,
                padding: "5px 9px",
                fontFamily: FM,
                fontWeight: 700,
                fontSize: 9.5,
                letterSpacing: ".1em",
                color: "var(--elango)",
                whiteSpace: "nowrap",
              }}
            >
              SOON
            </span>
          </button>
        </div>

        {/* "Make it real" demand-capture panel */}
        {(intentOpen || intentSent) && (
          <div
            className="animate-fade-in"
            style={{ ...card("4px 4px 0 var(--line-2)", 11), marginTop: 14, padding: "16px 18px", background: "var(--marigold-tint)" }}
          >
            {intentSent ? (
              <p style={{ margin: 0, fontSize: 14, color: "var(--ink)" }}>
                💛 Thank you! We&apos;ll ping you the moment real support goes live.
              </p>
            ) : (
              <form onSubmit={submitIntent} style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                <p style={{ margin: 0, fontSize: 13, color: "var(--ink-2)" }}>
                  Real tips are coming soon. Leave an email (optional) and we&apos;ll let you know.
                </p>
                <div style={{ display: "flex", gap: 9 }}>
                  <input
                    type="email"
                    value={intentEmail}
                    onChange={(e) => setIntentEmail(e.target.value)}
                    placeholder="you@email.com (optional)"
                    style={{
                      flex: 1,
                      minWidth: 0,
                      background: "var(--card)",
                      border: "1.5px solid var(--ink)",
                      borderRadius: 8,
                      padding: "10px 13px",
                      fontSize: 14,
                      color: "var(--ink)",
                      outline: "none",
                    }}
                  />
                  <button
                    type="submit"
                    style={{
                      background: "var(--marigold)",
                      border: "2px solid var(--ink)",
                      boxShadow: "2px 2px 0 var(--ink)",
                      borderRadius: 8,
                      padding: "8px 16px",
                      cursor: "pointer",
                      fontWeight: 700,
                      fontSize: 13,
                      color: "var(--ink)",
                    }}
                  >
                    I&apos;m in
                  </button>
                </div>
              </form>
            )}
          </div>
        )}

        {/* Rescue banner */}
        {rescue && (
          <div
            className="animate-fade-in"
            style={{
              ...card(rescue.level === "critical" ? "5px 5px 0 var(--elango)" : "5px 5px 0 var(--marigold)", 11),
              marginTop: 14,
              padding: "16px 18px",
              background: rescue.level === "critical" ? "var(--elango-tint)" : "var(--marigold-tint)",
              borderColor: rescue.level === "critical" ? "var(--elango)" : "var(--marigold)",
              display: "flex",
              gap: 12,
              alignItems: "center",
              justifyContent: "space-between",
              flexWrap: "wrap",
            }}
          >
            <p style={{ margin: 0, display: "flex", gap: 10, alignItems: "center", fontWeight: 700, fontSize: 14, color: "var(--ink)" }}>
              <AlertTriangle className={`h-5 w-5 shrink-0 ${rescue.level === "critical" ? "animate-pulse" : ""}`} style={{ color: rescue.level === "critical" ? "var(--elango)" : "var(--marigold)" }} />
              {rescue.msg}
            </p>
            <button
              onClick={() => runAction(rescue.action)}
              disabled={actionBusy !== ""}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 8,
                background: rescue.level === "critical" ? "var(--elango)" : "var(--marigold)",
                color: rescue.level === "critical" ? "#fff" : "var(--ink)",
                border: "2px solid var(--ink)",
                boxShadow: "3px 3px 0 var(--ink)",
                borderRadius: 8,
                padding: "10px 16px",
                cursor: actionBusy !== "" ? "not-allowed" : "pointer",
                opacity: actionBusy !== "" ? 0.6 : 1,
                fontWeight: 700,
                fontSize: 13,
                flex: "none",
              }}
            >
              {actionBusy === rescue.action ? <Loader2 className="h-4 w-4 animate-spin" /> : <HeartHandshake className="h-4 w-4" />}
              {rescue.label}
            </button>
          </div>
        )}

        {/* ===== MAIN GRID ===== */}
        <div style={{ display: "flex", flexWrap: "wrap", gap: 16, marginTop: 16, alignItems: "flex-start" }}>
          {/* MAP */}
          <div style={{ ...card("5px 5px 0 var(--ink)"), flex: "2.1 1 0", minWidth: 262 }}>
            <div style={{ padding: "12px 16px", borderBottom: "2px solid var(--ink)", display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: FD, fontWeight: 700, fontSize: 15 }}>
                <MapIcon className="h-[17px] w-[17px]" style={{ color: "var(--alive)" }} /> LIVE MAP
              </span>
              <span style={{ fontFamily: FM, fontSize: 10, color: "var(--ink-soft)" }}>OSM · LEAFLET</span>
            </div>
            <div style={{ position: "relative", height: "clamp(380px,46vw,500px)" }}>
              <TravelMap lat={state?.lat} lon={state?.lon} city={city} landmark={landmark} path={path} />
              <div
                style={{
                  position: "absolute",
                  left: 11,
                  bottom: 11,
                  zIndex: 500,
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                  background: "color-mix(in srgb,var(--card) 88%,transparent)",
                  border: "1px solid var(--line-2)",
                  borderRadius: 6,
                  padding: "5px 9px",
                  fontFamily: FM,
                  fontSize: 10,
                  color: "var(--ink)",
                  pointerEvents: "none",
                }}
              >
                <span style={{ width: 6, height: 6, borderRadius: "50%", background: "var(--alive)" }} />
                ELANGO · {journey.remainingKm} KM TO {JOURNEY.end.city.toUpperCase()}
              </div>
            </div>
          </div>

          {/* CENTER: feed + supporters */}
          <div style={{ flex: "2.4 1 0", minWidth: 282, display: "flex", flexDirection: "column", gap: 16 }}>
            {/* Milestone */}
            {showMilestone && (
              <div className="animate-fade-in" style={{ ...card("5px 5px 0 var(--marigold)"), background: "var(--marigold-tint)" }}>
                {milestone.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={milestone.image_url}
                    alt={milestone.city}
                    style={{ height: 112, width: "100%", objectFit: "cover", borderBottom: "2px solid var(--ink)" }}
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                )}
                <div style={{ padding: "14px 16px" }}>
                  <p style={{ margin: 0, fontFamily: FM, fontSize: 10.5, fontWeight: 700, letterSpacing: ".1em", color: "var(--marigold)" }}>
                    🎉 MILESTONE UNLOCKED
                  </p>
                  <p style={{ margin: "6px 0 0", fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>
                    {milestone.handle} sent Elango to {milestone.city}!
                    <span style={{ fontWeight: 400, color: "var(--ink-soft)" }}> · Day {milestone.day}</span>
                  </p>
                  <div style={{ marginTop: 12, display: "flex", gap: 9 }}>
                    <button
                      onClick={() => shareMilestone(milestone)}
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        gap: 6,
                        background: "var(--marigold)",
                        border: "2px solid var(--ink)",
                        boxShadow: "2px 2px 0 var(--ink)",
                        borderRadius: 7,
                        padding: "7px 12px",
                        cursor: "pointer",
                        fontWeight: 700,
                        fontSize: 12.5,
                        color: "var(--ink)",
                      }}
                    >
                      <Share2 className="h-3.5 w-3.5" /> Share this moment
                    </button>
                    <button
                      onClick={() => setDismissedMilestone(milestone.id)}
                      style={{ borderRadius: 7, padding: "7px 12px", border: "none", background: "transparent", cursor: "pointer", fontWeight: 600, fontSize: 12.5, color: "var(--ink-soft)" }}
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Vote / Fork in the road */}
            {vote && (
              <div style={{ ...card("5px 5px 0 var(--line-2)"), padding: "16px 18px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 10, marginBottom: 12 }}>
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 8, fontFamily: FD, fontWeight: 700, fontSize: 15 }}>
                    <VoteIcon className="h-4 w-4" style={{ color: "var(--teal)" }} /> Fork in the Road
                  </span>
                  {voteTimeLeft && (
                    <span style={{ fontFamily: FM, fontSize: 10.5, fontWeight: 700, color: "var(--teal)", border: "1.5px solid var(--teal)", borderRadius: 6, padding: "4px 8px" }}>
                      ⏳ {voteTimeLeft}
                    </span>
                  )}
                </div>
                {totalVotes < voteThreshold && (
                  <p style={{ margin: "0 0 9px", fontSize: 12, color: "var(--ink-soft)" }}>
                    {totalVotes}/{voteThreshold} votes — needs {voteThreshold - totalVotes} more to steer Elango.
                  </p>
                )}
                <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
                  {[
                    { key: "a", title: vote.option_a_title, count: vote.option_a_count, pct: pctA },
                    { key: "b", title: vote.option_b_title, count: vote.option_b_count, pct: pctB },
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => castVote(opt.key)}
                      disabled={actionBusy.startsWith("vote")}
                      style={{
                        position: "relative",
                        width: "100%",
                        overflow: "hidden",
                        borderRadius: 8,
                        border: "1.5px solid var(--ink)",
                        background: "var(--card)",
                        padding: "11px 13px",
                        textAlign: "left",
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ position: "absolute", inset: 0, left: 0, width: `${opt.pct}%`, background: "var(--teal-tint)", transition: "width .5s" }} />
                      <span style={{ position: "relative", display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
                        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ink)" }}>{opt.title}</span>
                        <span style={{ fontFamily: FM, fontSize: 12, fontWeight: 700, color: "var(--teal)" }}>
                          {opt.pct}% · {opt.count}
                        </span>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!vote && lastForkSummary && (
              <div style={{ ...card("4px 4px 0 var(--line-2)", 11), padding: "13px 16px" }}>
                <p style={{ margin: 0, display: "inline-flex", alignItems: "center", gap: 7, fontFamily: FM, fontSize: 10.5, fontWeight: 700, letterSpacing: ".12em", color: "var(--ink-soft)" }}>
                  <VoteIcon className="h-3.5 w-3.5" /> LAST FORK
                </p>
                <p style={{ margin: "6px 0 0", fontSize: 14, color: "var(--ink-2)" }}>
                  <span style={{ fontWeight: 700, color: "var(--teal)" }}>{lastForkSummary.winnerTitle}</span> won
                  {lastForkSummary.total > 0 ? ` with ${lastForkSummary.winPct}% of ${lastForkSummary.total} votes` : " by default"} — Elango listened. 🎒
                </p>
              </div>
            )}

            {/* Journey feed */}
            <div style={card("5px 5px 0 var(--ink)")}>
              <div style={{ padding: "11px 16px", borderBottom: "2px solid var(--ink)", display: "flex", alignItems: "center", gap: 8 }}>
                <Radio className="h-4 w-4" style={{ color: "var(--alive)" }} />
                <span style={{ fontFamily: FD, fontWeight: 700, fontSize: 14, letterSpacing: ".02em" }}>JOURNEY FEED</span>
              </div>

              {/* featured (newest) dispatch */}
              {featured ? (
                <>
                  <div
                    style={{
                      position: "relative",
                      height: "clamp(180px,24vw,240px)",
                      borderBottom: "2px solid var(--ink)",
                      background: featured.image_url ? "var(--paper-2)" : bannerBackground(featured.weather, night),
                      overflow: "hidden",
                    }}
                  >
                    {featured.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={featured.image_url}
                        alt={featured.landmark_name || featured.current_city}
                        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                      />
                    )}
                    {featured.weather && (
                      <div style={{ position: "absolute", left: 14, top: 14, display: "inline-flex", alignItems: "center", gap: 7, background: "rgba(20,22,18,.72)", borderRadius: 7, padding: "6px 10px", color: "#F1EBDD", fontFamily: FM, fontSize: 11 }}>
                        {featured.weather}
                      </div>
                    )}
                    {relativeTime(featured.created_at, nowMs) && (
                      <div style={{ position: "absolute", right: 14, top: 14, background: "rgba(20,22,18,.72)", borderRadius: 7, padding: "6px 10px", color: "#F1EBDD", fontFamily: FM, fontSize: 11, textTransform: "uppercase" }}>
                        {relativeTime(featured.created_at, nowMs)}
                      </div>
                    )}
                  </div>
                  <div style={{ padding: "18px 20px" }}>
                    <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
                      <MapPin className="h-[19px] w-[19px]" style={{ color: "var(--elango)", marginTop: 3, flex: "none" }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <h3 style={{ fontFamily: FD, fontWeight: 700, fontSize: 20, lineHeight: 1.12, margin: 0 }}>
                          {formatLocation(featured.landmark_name, featured.current_city)}
                        </h3>
                        <div style={{ fontFamily: FM, fontSize: 11, letterSpacing: ".1em", color: "var(--ink-soft)", marginTop: 4, textTransform: "uppercase" }}>
                          {featured.current_city} · STOP {stats.ticks}
                        </div>
                      </div>
                    </div>
                    <p style={{ fontSize: 16.5, lineHeight: 1.62, color: "var(--ink-2)", margin: "15px 0 0" }}>{featured.story}</p>
                    <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 18, paddingTop: 15, borderTop: "1.5px solid var(--line)", flexWrap: "wrap" }}>
                      {featured.story_source && (
                        <span
                          title={featured.story_source === "model" ? "Written live by the local model" : "Model timed out — template used"}
                          style={{
                            display: "inline-flex",
                            alignItems: "center",
                            gap: 7,
                            background: featured.story_source === "model" ? "var(--alive-tint)" : "var(--marigold-tint)",
                            border: `1.5px solid ${featured.story_source === "model" ? "var(--alive)" : "var(--marigold)"}`,
                            borderRadius: 7,
                            padding: "5px 10px",
                            color: featured.story_source === "model" ? "var(--alive-ink)" : "var(--ink)",
                            fontFamily: FM,
                            fontWeight: 700,
                            fontSize: 10.5,
                            letterSpacing: ".08em",
                          }}
                        >
                          <Sparkles className="h-3 w-3" />
                          {featured.story_source === "model" ? "LIVE MODEL" : "TEMPLATE"}
                        </span>
                      )}
                      <span style={{ fontFamily: FM, fontSize: 11, color: "var(--ink-soft)" }}>{ACTIVITY_BADGE[featured.activity]?.label ?? "On the road"}</span>
                    </div>
                  </div>
                </>
              ) : (
                <p style={{ padding: "28px 20px", margin: 0, fontSize: 14, color: "var(--ink-soft)" }}>Waiting for Elango&apos;s first dispatch…</p>
              )}

              {/* timeline of earlier dispatches */}
              {restFeed.length > 0 && (
                <ul className="scroll-thin" style={{ listStyle: "none", margin: 0, padding: "4px 16px 16px", display: "flex", flexDirection: "column", gap: 12, maxHeight: 360, overflowY: "auto", borderTop: "1.5px solid var(--line)" }}>
                  {restFeed.map((row) => (
                    <li
                      key={row.id}
                      className="animate-fade-in"
                      style={{
                        border: "1.5px solid var(--line-2)",
                        borderRadius: 10,
                        padding: "12px 14px",
                        background: row._pending ? "var(--marigold-tint)" : "var(--card)",
                        animation: row._pending ? "blink 1.4s ease-in-out infinite" : undefined,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                        <span style={{ fontFamily: FM, fontSize: 10.5, fontWeight: 700, letterSpacing: ".06em", color: "var(--alive-ink)", textTransform: "uppercase" }}>
                          {formatLocation(row.landmark_name, row.current_city)}
                        </span>
                        {row.weather && <span style={{ fontFamily: FM, fontSize: 10, color: "var(--ink-soft)" }}>· {row.weather}</span>}
                        {relativeTime(row.created_at, nowMs) && (
                          <span style={{ marginLeft: "auto", fontFamily: FM, fontSize: 10, color: "var(--ink-soft)" }}>{relativeTime(row.created_at, nowMs)}</span>
                        )}
                      </div>
                      <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: "var(--ink-2)" }}>{row.story}</p>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {/* Top supporters */}
            <Leaderboard me={username} refreshKey={lbKey} />
          </div>

          {/* CHAT */}
          <div style={{ ...card("5px 5px 0 var(--ink)"), flex: "1.5 1 0", minWidth: 266, display: "flex", flexDirection: "column" }}>
            <div style={{ padding: "13px 16px", borderBottom: "2px solid var(--ink)", display: "flex", alignItems: "center", gap: 11 }}>
              <span style={{ display: "inline-flex", alignItems: "flex-end", gap: 2, color: "var(--alive)" }}>
                <span style={{ width: 3, height: 7, background: "currentColor", borderRadius: 1 }} />
                <span style={{ width: 3, height: 11, background: "currentColor", borderRadius: 1 }} />
                <span style={{ width: 3, height: 15, background: "currentColor", borderRadius: 1 }} />
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontFamily: FD, fontWeight: 700, fontSize: 15, lineHeight: 1 }}>
                  WALKIE-TALKIE <span style={{ fontFamily: FM, fontSize: 11, color: "var(--ink-soft)", fontWeight: 400 }}>· CH-2</span>
                </div>
                <div style={{ fontSize: 11.5, color: "var(--ink-soft)", marginTop: 3 }}>
                  {remembered ? <span style={{ color: "var(--alive-ink)", fontWeight: 600 }}>💚 Elango remembers you!</span> : "Talk to Elango — he replies live"}
                </div>
              </div>
              <span
                title={`☕ ${you.coffees} · 🚌 ${you.buses} · 🗳️ ${you.votes} · 💬 ${you.messages}`}
                style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--marigold-tint)", border: "1.5px solid var(--marigold)", borderRadius: 6, padding: "5px 9px", transform: "rotate(-3deg)", fontFamily: FM, fontWeight: 700, fontSize: 10, letterSpacing: ".08em", color: "var(--ink)" }}
              >
                {tier.label.toUpperCase()}
              </span>
            </div>

            <div className="scroll-thin" style={{ background: "var(--paper-2)", padding: "16px 14px", display: "flex", flexDirection: "column", gap: 13, height: "clamp(300px,42vh,420px)", overflowY: "auto", overflowX: "hidden" }}>
              {messages.length === 0 && !chatBusy && <p style={{ fontSize: 14, color: "var(--ink-soft)", margin: 0 }}>Be the first to say hi 👋</p>}
              {messages.map((msg) => (
                <div key={msg.id} className="animate-fade-in" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  {/* viewer message (right) */}
                  <div style={{ textAlign: "right" }}>
                    <div style={{ fontFamily: FM, fontSize: 10, letterSpacing: ".1em", color: "var(--ink-soft)", margin: "0 2px 4px 0" }}>{msg.username}</div>
                    <div style={{ display: "inline-block", maxWidth: "84%", background: "var(--card)", color: "var(--ink)", border: "1.5px solid var(--ink)", borderRadius: "12px 12px 3px 12px", padding: "10px 13px", fontSize: 14.5, lineHeight: 1.45, textAlign: "left" }}>
                      {msg.message}
                    </div>
                  </div>
                  {/* elango reply (left) */}
                  {msg.reply ? (
                    <ElangoBubble>{msg.reply}</ElangoBubble>
                  ) : (
                    msg.reply_pending && (
                      <ElangoBubble italic>
                        {warmupReply(state?.activity, msg.id)}
                        <TypingDots />
                      </ElangoBubble>
                    )
                  )}
                </div>
              ))}
              {chatBusy && (
                <div className="animate-fade-in" style={{ textAlign: "left" }}>
                  <div style={{ display: "inline-block", background: "var(--alive)", border: "1.5px solid var(--ink)", borderRadius: "12px 12px 12px 3px", padding: "12px 14px", lineHeight: 0 }}>
                    <Dot delay="0s" />
                    <Dot delay=".2s" />
                    <Dot delay=".4s" />
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            <form onSubmit={sendChat} style={{ padding: "12px 14px", borderTop: "2px solid var(--ink)", display: "flex", flexDirection: "column", gap: 9 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, background: "var(--paper-2)", border: "1.5px solid var(--line-2)", borderRadius: 7, padding: "4px 10px", alignSelf: "flex-start" }}>
                <span style={{ fontFamily: FM, fontSize: 10, letterSpacing: ".12em", color: "var(--ink-soft)" }}>AS</span>
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Wanderer"
                  maxLength={100}
                  style={{ background: "transparent", border: "none", outline: "none", fontWeight: 600, fontSize: 13, color: "var(--ink)", width: 110 }}
                />
              </div>
              <div style={{ display: "flex", gap: 9, alignItems: "center" }}>
                <input
                  type="text"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  placeholder="Message Elango…"
                  maxLength={500}
                  style={{ flex: 1, minWidth: 0, background: "var(--paper)", border: "1.5px solid var(--ink)", borderRadius: 8, padding: "11px 13px", fontSize: 14, color: "var(--ink)", outline: "none" }}
                />
                <button
                  type="submit"
                  disabled={chatBusy || !draft.trim()}
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 44,
                    height: 44,
                    background: "var(--alive)",
                    border: "2px solid var(--ink)",
                    boxShadow: "3px 3px 0 var(--ink)",
                    borderRadius: 8,
                    cursor: chatBusy || !draft.trim() ? "not-allowed" : "pointer",
                    opacity: chatBusy || !draft.trim() ? 0.6 : 1,
                    flex: "none",
                    color: "#fff",
                  }}
                >
                  {chatBusy ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
                </button>
              </div>
            </form>
          </div>
        </div>
      </main>

      {/* ===== FOOTER ===== */}
      <footer style={{ borderTop: "1.5px solid var(--line-2)", background: "var(--paper-2)" }}>
        <div style={{ maxWidth: 1320, margin: "0 auto", padding: "24px clamp(14px,3vw,28px)", display: "flex", flexWrap: "wrap", gap: 12, alignItems: "center", justifyContent: "space-between" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 9, fontFamily: FM, fontSize: 11, color: "var(--ink-soft)" }}>
            <span style={{ width: 7, height: 7, borderRadius: "50%", background: "var(--alive)" }} />
            ELANGO · ROADSIDE LEDGER
          </div>
          <div style={{ fontFamily: FM, fontSize: 10.5, letterSpacing: ".03em", color: "var(--ink-soft)" }}>
            Autonomous AI backpacker · OpenStreetMap + Overpass · Open-Meteo · Wikipedia · Local Llama
          </div>
        </div>
      </footer>

      {/* Modals */}
      <Scrapbook open={scrapbookOpen} onClose={() => setScrapbookOpen(false)} onToast={notify} />
      <Diary open={diaryOpen} onClose={() => setDiaryOpen(false)} onToast={notify} />
      <ModelLog open={modelLogOpen} onClose={() => setModelLogOpen(false)} />

      {/* Toast */}
      {toast && (
        <div style={{ position: "fixed", left: "50%", bottom: 26, transform: "translateX(-50%)", zIndex: 120, pointerEvents: "none" }}>
          <div
            style={{
              background: "var(--ink)",
              color: "var(--paper)",
              border: "2px solid var(--ink)",
              borderLeft: "6px solid var(--alive)",
              boxShadow: "4px 4px 0 rgba(0,0,0,.25)",
              borderRadius: 9,
              padding: "11px 16px",
              fontWeight: 600,
              fontSize: 14,
              animation: "toastIn .35s cubic-bezier(.2,.8,.2,1)",
            }}
          >
            {toast}
          </div>
        </div>
      )}
    </div>
  );
}

// ---- Component-local atoms ------------------------------------------------

function SupportStub({ kind, accent, tint, icon, title, body, big, small, cta, ctaColor, ctaBg, onClick, busy }) {
  return (
    <div style={{ ...card("5px 5px 0 var(--ink)", 11), flex: "1 1 320px", position: "relative", display: "flex" }}>
      <div style={{ flex: 1, padding: "18px 20px", minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, color: accent }}>
          {icon}
          <span style={{ fontFamily: FM, fontSize: 10.5, letterSpacing: ".16em", color: "var(--ink-soft)" }}>{kind}</span>
        </div>
        <h3 style={{ fontFamily: FD, fontWeight: 800, fontSize: 22, letterSpacing: "-.01em", margin: "10px 0 5px" }}>{title}</h3>
        <p style={{ fontSize: 13.5, lineHeight: 1.45, color: "var(--ink-2)", margin: 0 }}>{body}</p>
      </div>
      <div
        style={{
          position: "relative",
          width: 130,
          flex: "none",
          background: tint,
          borderLeft: "2px dashed var(--ink)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: 2,
          padding: "14px 8px",
        }}
      >
        <span style={{ position: "absolute", left: -11, top: -11, width: 20, height: 20, borderRadius: "50%", background: "var(--paper)" }} />
        <span style={{ position: "absolute", left: -11, bottom: -11, width: 20, height: 20, borderRadius: "50%", background: "var(--paper)" }} />
        <div style={{ fontFamily: FD, fontWeight: 800, fontSize: 30, lineHeight: 0.9, color: "var(--ink)" }}>{big}</div>
        <div style={{ fontFamily: FM, fontSize: 9.5, letterSpacing: ".16em", color: "var(--ink-soft)" }}>{small}</div>
        <button
          onClick={onClick}
          disabled={busy}
          style={{
            marginTop: 10,
            background: ctaBg,
            border: "2px solid var(--ink)",
            boxShadow: "2px 2px 0 var(--ink)",
            borderRadius: 7,
            padding: "8px 12px",
            cursor: busy ? "not-allowed" : "pointer",
            opacity: busy ? 0.6 : 1,
            fontWeight: 700,
            fontSize: 12.5,
            color: ctaColor,
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
          }}
        >
          {busy && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
          {cta}
        </button>
      </div>
    </div>
  );
}

function ElangoBubble({ children, italic }) {
  return (
    <div style={{ textAlign: "left" }}>
      <div style={{ margin: "0 0 4px 2px", display: "flex", alignItems: "center", gap: 6 }}>
        <BackpackMark w={13} h={15} headerH={5} shadow="none" label={false} />
        <span style={{ fontFamily: FM, fontSize: 10, letterSpacing: ".1em", color: "var(--alive-ink)" }}>ELANGO</span>
      </div>
      <div
        style={{
          display: "inline-block",
          maxWidth: "84%",
          background: "var(--alive)",
          color: "#fff",
          border: "1.5px solid var(--ink)",
          borderRadius: "12px 12px 12px 3px",
          padding: "10px 13px",
          fontSize: 14.5,
          lineHeight: 1.45,
          textAlign: "left",
          fontStyle: italic ? "italic" : "normal",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function Dot({ delay }) {
  return (
    <span
      style={{
        display: "inline-block",
        width: 6,
        height: 6,
        borderRadius: "50%",
        background: "#fff",
        marginLeft: delay === "0s" ? 0 : 4,
        animation: `typingDot 1.1s ease-in-out ${delay} infinite`,
      }}
    />
  );
}

function TypingDots() {
  return (
    <span style={{ display: "block", marginTop: 6, lineHeight: 0 }}>
      <Dot delay="0s" />
      <Dot delay=".2s" />
      <Dot delay=".4s" />
    </span>
  );
}
