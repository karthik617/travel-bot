"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import dynamic from "next/dynamic";
import {
  Coffee,
  Bus,
  Send,
  Zap,
  Wallet,
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
} from "lucide-react";
import Scrapbook from "@/components/Scrapbook";
import Diary from "@/components/Diary";
import Leaderboard from "@/components/Leaderboard";
import Soundscape from "@/components/Soundscape";
import { formatLocation, haversineKm } from "@/lib/journey";

// Leaflet touches `window`, so the map must never render on the server.
const TravelMap = dynamic(() => import("@/components/TravelMap"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center bg-sky-100 text-slate-500">
      <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading live map…
    </div>
  ),
});

const STATE_POLL_MS = 15000;
const CHAT_POLL_MS = 7000;

// The overarching quest: walk the length of Tamil Nadu, Chennai → Kanyakumari.
// Gives the wander a destiny and a shareable ending.
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

/** Fraction (0–1) of the Chennai→Kanyakumari quest completed, by straight-line distance. */
function journeyProgress(lat, lon) {
  if (typeof lat !== "number" || typeof lon !== "number") return { pct: 0, remainingKm: Math.round(JOURNEY_TOTAL_KM) };
  const remaining = haversineKm(lat, lon, JOURNEY.end.lat, JOURNEY.end.lon);
  const pct = Math.max(0, Math.min(100, Math.round((1 - remaining / JOURNEY_TOTAL_KM) * 100)));
  return { pct, remainingKm: Math.round(remaining) };
}

// ---- Pure helpers (module scope) -----------------------------------------

const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** Current India time parts from a UTC epoch. */
function istParts(nowMs) {
  const d = new Date(nowMs + IST_OFFSET_MS);
  return { h: d.getUTCHours(), m: d.getUTCMinutes(), s: d.getUTCSeconds() };
}

/** Compact "time since" label for feed posts, e.g. "just now", "4 min ago". */
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

/** "2h 14m left" style countdown to an ISO deadline; null once past. */
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

/** Day/night visual theme driven by the live India hour. */
function dayTheme(h) {
  if (h >= 21 || h < 5) {
    return {
      key: "night",
      gradient: "from-slate-900 via-indigo-950 to-slate-900",
      heading: "text-white",
      sub: "text-slate-300",
      emoji: "🌙",
      label: "Night",
    };
  }
  if (h < 11) {
    return {
      key: "morning",
      gradient: "from-amber-100 via-sky-100 to-sky-200",
      heading: "text-slate-900",
      sub: "text-slate-600",
      emoji: "🌅",
      label: "Morning",
    };
  }
  if (h < 16) {
    return {
      key: "afternoon",
      gradient: "from-sky-200 via-sky-100 to-blue-100",
      heading: "text-slate-900",
      sub: "text-slate-600",
      emoji: "☀️",
      label: "Afternoon",
    };
  }
  return {
    key: "evening",
    gradient: "from-orange-200 via-rose-200 to-indigo-300",
    heading: "text-slate-900",
    sub: "text-slate-700",
    emoji: "🌆",
    label: "Evening",
  };
}

const ACTIVITY_BADGE = {
  walking: { emoji: "🚶", label: "Walking" },
  eating: { emoji: "🍽️", label: "Eating" },
  exploring: { emoji: "🧭", label: "Exploring" },
  resting: { emoji: "😴", label: "Resting" },
  exhausted: { emoji: "🥵", label: "Exhausted" },
};

// Instant "warmup" replies shown the moment a message is sent, keyed to what
// Elango is doing, so the chat never sits silent during the 25-50s LLM call.
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

// Short human phrase for the hero card's live situation line.
const MOOD_PHRASE = {
  walking: "trekking down the road",
  eating: "stopping for a bite",
  exploring: "exploring the area",
  resting: "resting for the night",
  exhausted: "collapsed and needs a coffee",
};

const EMPTY_YOU = { messages: 0, coffees: 0, buses: 0, votes: 0, total: 0 };

/** Gamified relationship tier based on total interactions with Elango. */
function supporterTier(total) {
  if (total >= 30) return { label: "Legend", emoji: "👑", ring: "ring-amber-300", text: "text-amber-700", bg: "bg-amber-50" };
  if (total >= 15) return { label: "Patron", emoji: "🌟", ring: "ring-violet-300", text: "text-violet-700", bg: "bg-violet-50" };
  if (total >= 5) return { label: "Regular", emoji: "⭐", ring: "ring-emerald-300", text: "text-emerald-700", bg: "bg-emerald-50" };
  if (total >= 1) return { label: "Friend", emoji: "🤝", ring: "ring-sky-300", text: "text-sky-700", bg: "bg-sky-50" };
  return { label: "Newcomer", emoji: "👋", ring: "ring-slate-200", text: "text-slate-600", bg: "bg-slate-50" };
}

/** Stable per-browser id, minted once and persisted. Anchors support actions,
 *  vote dedup and (later) payment crediting to a durable identity even though
 *  there are no accounts. */
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

/** Convert a base64url VAPID key to the Uint8Array the Push API expects. */
function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i += 1) out[i] = raw.charCodeAt(i);
  return out;
}

/** Register the SW and subscribe to Web Push (best-effort; safe to no-op). */
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

  // Starts null so the server render and the first client render agree (no live
  // time → no hydration mismatch). Real time is set after mount in the effect.
  const [nowMs, setNowMs] = useState(null);
  const [scrapbookOpen, setScrapbookOpen] = useState(false);
  const [diaryOpen, setDiaryOpen] = useState(false);
  const [toast, setToast] = useState("");
  const [viewers, setViewers] = useState(1);
  const [unseen, setUnseen] = useState(0);
  const [lastSyncMs, setLastSyncMs] = useState(null);
  const [lbKey, setLbKey] = useState(0);
  const [notifyOn, setNotifyOn] = useState(false);

  const chatEndRef = useRef(null);
  const lastIdRef = useRef(null);
  const lastCityRef = useRef(null);
  const notifyOnRef = useRef(false);

  const notify = useCallback((msg) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3000);
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
      subscribeToPush(); // closed-tab push (best-effort)
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
        // If a new dispatch arrived while the tab is hidden, flag it for the title.
        if (
          lastIdRef.current !== null &&
          json.state.id !== lastIdRef.current &&
          typeof document !== "undefined" &&
          document.hidden
        ) {
          setUnseen((u) => u + 1);
        }
        lastIdRef.current = json.state.id;

        // Desktop notification when Elango reaches a new town.
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

    setNowMs(Date.now()); // first real time, only on the client after mount
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

  // Tab-title alert: badge the title when dispatches arrive while tab is hidden.
  useEffect(() => {
    if (typeof document === "undefined") return;
    document.title = unseen > 0 ? `(${unseen}) 🎒 Elango moved!` : "🎒 Elango — Live from Tamil Nadu";
  }, [unseen]);

  // Clear the unseen badge when the viewer returns to the tab.
  useEffect(() => {
    const onVis = () => {
      if (typeof document !== "undefined" && !document.hidden) setUnseen(0);
    };
    document.addEventListener("visibilitychange", onVis);
    return () => document.removeEventListener("visibilitychange", onVis);
  }, []);

  // Keep a ref mirror of notifyOn (so the stable loadState callback reads it),
  // and restore the saved preference on mount.
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

  // Refresh the viewer's tier/badge shortly after they settle on a handle.
  useEffect(() => {
    const t = setTimeout(() => loadSupporter(username), 700);
    return () => clearTimeout(t);
  }, [username, loadSupporter]);

  // ----- Actions ----------------------------------------------------------

  const runAction = async (action) => {
    setActionBusy(action);

    // Optimistic, sub-200ms feedback. The travel-tick POST awaits a 25-50s
    // Ollama generation, so without this the most common tap looks broken. We
    // bump the visible state + drop a temporary feed card immediately, then
    // reconcile with the authoritative server row when it resolves.
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
      setState((s) =>
        s
          ? {
              ...s,
              energy: Math.min(100, (s.energy ?? 0) + 15),
              wallet: Math.max(0, (s.wallet ?? 0) - 30),
              activity: "eating",
            }
          : s
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
      await loadState(); // authoritative refresh — replaces the optimistic card
      loadSupporter(username);
      setLbKey((k) => k + 1);
    } catch (err) {
      console.warn(`[ui] Action '${action}' failed: ${err?.message}`);
      setFeed((f) => f.filter((r) => r.id !== optimisticId)); // roll back on failure
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
      /* user cancelled — ignore */
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

  // ----- Derived ----------------------------------------------------------

  const energy = state?.energy ?? 0;
  const wallet = state?.wallet ?? 0;
  const city = state?.current_city ?? "Tamil Nadu";
  const landmark = state?.landmark_name ?? "";
  const weather = state?.weather ?? "";
  const activity = ACTIVITY_BADGE[state?.activity] ?? ACTIVITY_BADGE.walking;

  const animEnergy = useCountUp(energy);
  const animWallet = useCountUp(wallet);
  const animDistance = useCountUp(stats.distanceKm);

  const energyColor =
    energy > 60 ? "bg-emerald-500" : energy > 30 ? "bg-amber-500" : "bg-rose-500";

  // Before mount (nowMs === null) we render a stable placeholder + neutral
  // daytime theme so server HTML and first client HTML match exactly.
  const hasTime = nowMs !== null;
  const { h, m, s } = hasTime ? istParts(nowMs) : { h: 12, m: 0, s: 0 };
  const theme = dayTheme(h);
  const clock = hasTime
    ? `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`
    : "--:--:--";
  const syncedAgo = hasTime && lastSyncMs ? Math.max(0, Math.round((nowMs - lastSyncMs) / 1000)) : null;

  const totalVotes = (vote?.option_a_count ?? 0) + (vote?.option_b_count ?? 0) || 0;
  const pctA = totalVotes ? Math.round(((vote?.option_a_count ?? 0) / totalVotes) * 100) : 50;
  const pctB = 100 - (totalVotes ? pctA : 50);
  const voteThreshold = vote?.minimum_votes ?? 3;
  const voteTimeLeft = vote ? countdown(vote.expires_at, nowMs) : null;

  // "Last Fork" ghost card data: which side won the most recent resolved poll.
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

  const isResting = state?.activity === "resting";
  const tier = supporterTier(you.total);

  // Rescue stakes: surface a "he needs you" call-to-action when resources run low.
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
      rescue = {
        level: "warn",
        msg: `Elango is running on fumes (${energy}%) near ${city} — keep him going?`,
        action: "coffee",
        label: "Buy filter coffee ☕",
      };
    } else if (wallet <= 150) {
      rescue = {
        level: "warn",
        msg: `Elango is nearly broke (₹${wallet}) — fund a bus before he's stranded.`,
        action: "bus",
        label: "Fund a local bus 🚌",
      };
    }
  }

  // Single context-sensitive call-to-action for the hero card: steer to the
  // open vote, then to whatever rescue Elango needs, else nudge a bus.
  const scrollTo = (id) =>
    typeof document !== "undefined" &&
    document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "center" });
  let heroCta;
  if (vote) heroCta = { label: "🗳️ Vote on his route", onClick: () => scrollTo("vote") };
  else if (rescue) heroCta = { label: rescue.label, onClick: () => runAction(rescue.action) };
  else heroCta = { label: "🚌 Fund his next bus", onClick: () => runAction("bus") };

  const moodPhrase = MOOD_PHRASE[state?.activity] ?? "out on the road";
  const journey = journeyProgress(state?.lat, state?.lon);

  return (
    <main
      className={`min-h-screen bg-gradient-to-b ${theme.gradient} transition-colors duration-1000`}
    >
      <div className="mx-auto max-w-7xl px-4 py-6">
        {/* Hero status card — answers "what is this + how is he" in one glance,
            with a single context-sensitive CTA. */}
        {state && (
          <section className="mb-6 rounded-2xl bg-white/95 p-5 shadow-sm ring-1 ring-black/5">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-start gap-4">
                <div className="text-4xl leading-none sm:text-5xl">{activity.emoji}</div>
                <div>
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-emerald-600">
                    🔴 Live · Day {stats.daysOnRoad}
                  </p>
                  <h2 className="text-lg font-bold leading-tight text-slate-900 sm:text-xl">
                    Elango is an AI backpacker walking across Tamil Nadu
                  </h2>
                  <p className="mt-0.5 text-sm text-slate-600">
                    Right now he&apos;s {moodPhrase} at{" "}
                    <span className="font-medium text-slate-800">{formatLocation(landmark, city)}</span> —{" "}
                    {animEnergy}% energy{weather ? `, ${weather}` : ""}.
                  </p>
                </div>
              </div>
              <button
                onClick={heroCta.onClick}
                disabled={actionBusy !== ""}
                className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-emerald-600 px-5 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionBusy !== "" ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
                {heroCta.label}
              </button>
            </div>
            <div className="mt-4 h-2 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className={`h-full rounded-full transition-all duration-700 ${energyColor}`}
                style={{ width: `${animEnergy}%` }}
              />
            </div>
          </section>
        )}

        {/* Header */}
        <header className="mb-6 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <h1 className={`text-2xl font-bold tracking-tight md:text-3xl ${theme.heading}`}>
              🎒 Elango — Live from Tamil Nadu
            </h1>
            <p className={`mt-1 flex flex-wrap items-center gap-2 text-sm ${theme.sub}`}>
              <MapPin className="h-4 w-4" />
              {formatLocation(landmark, city)}
              {syncedAgo !== null && (
                <span className="inline-flex items-center gap-1 text-xs opacity-70">
                  · 🟢 synced {syncedAgo}s ago
                </span>
              )}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            {/* Scrapbook */}
            <button
              onClick={() => setScrapbookOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-white/90 px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-black/5 transition hover:bg-white active:scale-95"
            >
              <Images className="h-4 w-4 text-violet-600" /> Scrapbook
            </button>

            {/* Diary */}
            <button
              onClick={() => setDiaryOpen(true)}
              className="inline-flex items-center gap-2 rounded-lg bg-white/90 px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-black/5 transition hover:bg-white active:scale-95"
            >
              <BookOpen className="h-4 w-4 text-amber-600" /> Diary
            </button>

            {/* Live viewer count */}
            <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-black/5">
              👀 {viewers} watching
            </span>

            {/* Notification toggle */}
            <button
              onClick={toggleNotify}
              title={notifyOn ? "Notifications on" : "Notify me when Elango reaches a new town"}
              className={`inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-semibold shadow-sm ring-1 transition active:scale-95 ${
                notifyOn
                  ? "bg-emerald-600 text-white ring-emerald-600 hover:bg-emerald-700"
                  : "bg-white/90 text-slate-700 ring-black/5 hover:bg-white"
              }`}
            >
              {notifyOn ? <Bell className="h-4 w-4" /> : <BellOff className="h-4 w-4" />}
              {notifyOn ? "Alerts on" : "Notify me"}
            </button>

            {/* Ambient soundscape */}
            <Soundscape partOfDay={state?.time_of_day || theme.key} weather={weather} />

            {/* Live IST clock */}
            <span className="inline-flex items-center gap-2 rounded-lg bg-white/90 px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-black/5">
              {theme.emoji} <span className="tabular-nums">{clock}</span>
              <span className="text-slate-400">IST · {theme.label}</span>
            </span>

            {/* Status badge */}
            <span
              className={`inline-flex items-center gap-2 rounded-full px-3 py-1.5 text-sm font-semibold ring-1 ${
                isResting
                  ? "bg-indigo-50 text-indigo-700 ring-indigo-200"
                  : "bg-emerald-50 text-emerald-700 ring-emerald-200"
              }`}
            >
              <span className="relative flex h-2.5 w-2.5">
                <span
                  className={`absolute inline-flex h-full w-full animate-ping rounded-full opacity-75 ${
                    isResting ? "bg-indigo-400" : "bg-emerald-400"
                  }`}
                />
                <span
                  className={`relative inline-flex h-2.5 w-2.5 rounded-full ${
                    isResting ? "bg-indigo-500" : "bg-emerald-500"
                  }`}
                />
              </span>
              {activity.emoji} ELANGO IS {activity.label.toUpperCase()}
            </span>

            {/* Weather */}
            {weather && (
              <span className="inline-flex items-center gap-1.5 rounded-lg bg-white/90 px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-black/5">
                {weather}
              </span>
            )}

            {/* Wallet */}
            <span
              title="Elango's travel cash — spent on food, stays and bus tickets. Fund a coffee or bus to top him up."
              className="inline-flex items-center gap-2 rounded-lg bg-white/90 px-3 py-2 text-sm font-semibold text-slate-700 shadow-sm ring-1 ring-black/5"
            >
              <Wallet className="h-4 w-4 text-emerald-600" />₹{animWallet.toLocaleString("en-IN")}
              <span className="hidden text-[10px] font-normal uppercase tracking-wide text-slate-400 sm:inline">
                travel cash
              </span>
            </span>
          </div>
        </header>

        {/* Rescue banner — appears only when Elango needs help */}
        {rescue && (
          <div
            className={`animate-fade-in mb-6 flex flex-col items-start gap-3 rounded-2xl border p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between ${
              rescue.level === "critical"
                ? "border-rose-300 bg-rose-50"
                : "border-amber-300 bg-amber-50"
            }`}
          >
            <p
              className={`flex items-center gap-2.5 text-sm font-semibold ${
                rescue.level === "critical" ? "text-rose-700" : "text-amber-800"
              }`}
            >
              <AlertTriangle
                className={`h-5 w-5 shrink-0 ${rescue.level === "critical" ? "animate-pulse" : ""}`}
              />
              {rescue.msg}
            </p>
            <button
              onClick={() => runAction(rescue.action)}
              disabled={actionBusy !== ""}
              className={`inline-flex shrink-0 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-60 ${
                rescue.level === "critical"
                  ? "bg-rose-600 hover:bg-rose-700"
                  : "bg-amber-500 hover:bg-amber-600"
              }`}
            >
              {actionBusy === rescue.action ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <HeartHandshake className="h-4 w-4" />
              )}
              {rescue.label}
            </button>
          </div>
        )}

        {/* Energy + trip stats */}
        <div className="mb-6 grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="rounded-xl bg-white/95 p-4 shadow-sm ring-1 ring-black/5 lg:col-span-2">
            <div className="mb-2 flex items-center justify-between text-sm font-medium text-slate-600">
              <span className="inline-flex items-center gap-2">
                <Zap className="h-4 w-4 text-amber-500" /> Energy
              </span>
              <span className="tabular-nums">{animEnergy}%</span>
            </div>
            <div className="h-3 w-full overflow-hidden rounded-full bg-slate-200">
              <div
                className={`h-full rounded-full transition-all duration-700 ${energyColor}`}
                style={{ width: `${animEnergy}%` }}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 lg:grid-cols-2">
            <StatChip icon={<Footprints className="h-4 w-4" />} label="Walked" value={`${animDistance} km`} />
            <StatChip icon={<Building2 className="h-4 w-4" />} label="Towns" value={stats.cities} />
            <StatChip icon={<CalendarDays className="h-4 w-4" />} label="Day" value={stats.daysOnRoad} />
            <StatChip icon={<Activity className="h-4 w-4" />} label="Stops" value={stats.ticks} />
          </div>
        </div>

        {/* Responsive 3-column grid */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
          {/* LEFT: Map + journey progress */}
          <section className="lg:col-span-5">
            <div className="mb-3 rounded-2xl bg-white/95 p-3 shadow-sm ring-1 ring-black/5">
              <div className="mb-1.5 flex items-center justify-between text-xs font-semibold text-slate-600">
                <span>🏁 {JOURNEY.start.city}</span>
                <span className="text-emerald-700">
                  {journey.pct}% · {journey.remainingKm} km to go
                </span>
                <span>{JOURNEY.end.city} 🏖️</span>
              </div>
              <div className="relative h-2.5 w-full overflow-hidden rounded-full bg-slate-200">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-emerald-400 to-emerald-600 transition-all duration-700"
                  style={{ width: `${journey.pct}%` }}
                />
                <span
                  className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 text-sm transition-all duration-700"
                  style={{ left: `${journey.pct}%` }}
                  aria-hidden
                >
                  🎒
                </span>
              </div>
            </div>
            <div className="h-[420px] overflow-hidden rounded-2xl shadow-sm ring-1 ring-black/10 lg:h-[600px]">
              <TravelMap
                lat={state?.lat}
                lon={state?.lon}
                city={city}
                landmark={landmark}
                path={path}
              />
            </div>
          </section>

          {/* MIDDLE: Controls, Vote, Feed */}
          <section className="flex flex-col gap-6 lg:col-span-4">
            {/* Milestone trophy — appears the moment a funded bus lands Elango
                somewhere new; names the supporter and is one-tap shareable. */}
            {showMilestone && (
              <div className="animate-fade-in overflow-hidden rounded-2xl border border-amber-200 bg-gradient-to-br from-amber-50 to-rose-50 shadow-sm">
                {milestone.image_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={milestone.image_url}
                    alt={milestone.city}
                    className="h-28 w-full object-cover"
                    onError={(e) => {
                      e.currentTarget.style.display = "none";
                    }}
                  />
                )}
                <div className="p-4">
                  <p className="text-xs font-bold uppercase tracking-wide text-amber-700">🎉 Milestone unlocked</p>
                  <p className="mt-1 text-sm font-semibold text-slate-800">
                    {milestone.handle} sent Elango to {milestone.city}!
                    <span className="font-normal text-slate-500"> · Day {milestone.day}</span>
                  </p>
                  <div className="mt-3 flex gap-2">
                    <button
                      onClick={() => shareMilestone(milestone)}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-amber-600 active:scale-95"
                    >
                      <HeartHandshake className="h-3.5 w-3.5" /> Share this moment
                    </button>
                    <button
                      onClick={() => setDismissedMilestone(milestone.id)}
                      className="rounded-lg px-3 py-1.5 text-xs font-medium text-slate-500 transition hover:bg-white/60"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <button
                onClick={() => runAction("coffee")}
                disabled={actionBusy !== ""}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-amber-600 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionBusy === "coffee" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Coffee className="h-4 w-4" />
                )}
                Buy Filter Coffee
              </button>
              <button
                onClick={() => runAction("bus")}
                disabled={actionBusy !== ""}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-sky-600 px-4 py-3 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {actionBusy === "bus" ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Bus className="h-4 w-4" />
                )}
                Fund Local Bus
              </button>
            </div>

            {/* "Make it real" — free cheers stay primary above; this gauges
                willingness-to-pay and builds an email list before payments exist. */}
            <div className="rounded-xl border border-amber-200 bg-amber-50/50 px-3 py-2.5">
              {intentSent ? (
                <p className="text-sm text-amber-800">
                  💛 Thank you! We&apos;ll ping you the moment real support goes live.
                </p>
              ) : intentOpen ? (
                <form onSubmit={submitIntent} className="space-y-2">
                  <p className="text-xs text-amber-800">
                    Real tips are coming soon. Leave an email (optional) and we&apos;ll let you know.
                  </p>
                  <div className="flex gap-2">
                    <input
                      type="email"
                      value={intentEmail}
                      onChange={(e) => setIntentEmail(e.target.value)}
                      placeholder="you@email.com (optional)"
                      className="min-w-0 flex-1 rounded-lg border border-amber-200 px-3 py-1.5 text-sm outline-none focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                    />
                    <button
                      type="submit"
                      className="shrink-0 rounded-lg bg-amber-500 px-3 py-1.5 text-sm font-semibold text-white transition hover:bg-amber-600 active:scale-95"
                    >
                      I&apos;m in
                    </button>
                  </div>
                </form>
              ) : (
                <button
                  onClick={() => setIntentOpen(true)}
                  className="inline-flex items-center gap-1.5 text-sm font-medium text-amber-800 transition hover:text-amber-900"
                >
                  💛 Want to back Elango for real?{" "}
                  <span className="rounded-full bg-amber-200/70 px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide">
                    coming soon
                  </span>
                </button>
              )}
            </div>

            {vote && (
              <div id="vote" className="animate-fade-in scroll-mt-4 rounded-2xl border border-indigo-100 bg-indigo-50/80 p-4">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-indigo-700">
                    <VoteIcon className="h-4 w-4" /> Fork in the Road
                  </h2>
                  {voteTimeLeft && (
                    <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-indigo-600 ring-1 ring-indigo-200">
                      ⏳ {voteTimeLeft}
                    </span>
                  )}
                </div>
                {totalVotes < voteThreshold && (
                  <p className="mb-2 text-xs text-indigo-600/80">
                    {totalVotes}/{voteThreshold} votes — needs {voteThreshold - totalVotes} more to steer Elango.
                  </p>
                )}
                <div className="space-y-3">
                  {[
                    { key: "a", title: vote.option_a_title, count: vote.option_a_count, pct: pctA },
                    { key: "b", title: vote.option_b_title, count: vote.option_b_count, pct: pctB },
                  ].map((opt) => (
                    <button
                      key={opt.key}
                      onClick={() => castVote(opt.key)}
                      disabled={actionBusy.startsWith("vote")}
                      className="group relative w-full overflow-hidden rounded-xl border border-indigo-200 bg-white p-3 text-left transition hover:border-indigo-400 active:scale-[0.99] disabled:cursor-not-allowed"
                    >
                      <div
                        className="absolute inset-y-0 left-0 bg-indigo-100 transition-all duration-500"
                        style={{ width: `${opt.pct}%` }}
                      />
                      <div className="relative flex items-center justify-between gap-3">
                        <span className="text-sm font-medium text-slate-800">{opt.title}</span>
                        <span className="shrink-0 text-xs font-bold tabular-nums text-indigo-700">
                          {opt.pct}% · {opt.count}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Between votes, keep the community feature visible: show how the
                last fork resolved so the vote never feels like it vanished. */}
            {!vote && lastForkSummary && (
              <div className="animate-fade-in rounded-2xl border border-slate-200 bg-white/80 p-3">
                <p className="inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <VoteIcon className="h-3.5 w-3.5" /> Last fork
                </p>
                <p className="mt-1 text-sm text-slate-700">
                  <span className="font-semibold text-indigo-700">{lastForkSummary.winnerTitle}</span> won
                  {lastForkSummary.total > 0
                    ? ` with ${lastForkSummary.winPct}% of ${lastForkSummary.total} votes`
                    : " by default"}{" "}
                  — Elango listened. 🎒
                </p>
              </div>
            )}

            <div className="rounded-2xl bg-white/95 p-4 shadow-sm ring-1 ring-black/5">
              <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-700">
                <Radio className="h-4 w-4 text-emerald-600" /> Journey Feed
              </h2>
              <ul className="scroll-thin max-h-[460px] space-y-4 overflow-y-auto pr-1">
                {feed.length === 0 && (
                  <li className="text-sm text-slate-400">Waiting for Elango's first dispatch…</li>
                )}
                {feed.map((row) => (
                  <li
                    key={row.id}
                    className={`animate-fade-in overflow-hidden rounded-xl border bg-white ${
                      row._pending ? "border-amber-200 bg-amber-50/40 animate-pulse" : "border-slate-100"
                    }`}
                  >
                    {row.image_url && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={row.image_url}
                        alt={row.landmark_name || row.current_city}
                        loading="lazy"
                        onError={(e) => {
                          e.currentTarget.style.display = "none";
                        }}
                        className="h-32 w-full object-cover"
                      />
                    )}
                    <div className="p-3">
                      <div className="mb-1 flex flex-wrap items-center gap-2">
                        <span className="text-xs font-semibold text-emerald-700">
                          {formatLocation(row.landmark_name, row.current_city)}
                        </span>
                        {row.activity && ACTIVITY_BADGE[row.activity] && (
                          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-medium text-slate-600">
                            {ACTIVITY_BADGE[row.activity].emoji} {ACTIVITY_BADGE[row.activity].label}
                          </span>
                        )}
                        {row.weather && (
                          <span className="rounded-full bg-sky-50 px-2 py-0.5 text-[10px] font-medium text-sky-700">
                            {row.weather}
                          </span>
                        )}
                        {relativeTime(row.created_at, nowMs) && (
                          <span className="ml-auto text-[10px] font-medium text-slate-400">
                            {relativeTime(row.created_at, nowMs)}
                          </span>
                        )}
                      </div>
                      <p className="text-sm leading-relaxed text-slate-700">{row.story}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </div>

            <Leaderboard me={username} refreshKey={lbKey} />
          </section>

          {/* RIGHT: Live chat */}
          <section id="chat" className="scroll-mt-4 lg:col-span-3">
            <div className="flex h-[420px] flex-col rounded-2xl bg-white/95 shadow-sm ring-1 ring-black/5 lg:h-[640px]">
              <div className="border-b border-slate-100 p-4">
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-sm font-bold uppercase tracking-wide text-slate-700">
                    📻 Walkie-Talkie Chat
                  </h2>
                  <span
                    title={`☕ ${you.coffees} · 🚌 ${you.buses} · 🗳️ ${you.votes} · 💬 ${you.messages}`}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ${tier.bg} ${tier.text} ${tier.ring}`}
                  >
                    {tier.emoji} {tier.label}
                  </span>
                </div>
                <p className="mt-0.5 text-xs text-slate-400">
                  {remembered ? (
                    <span className="font-medium text-emerald-600">💚 Elango remembers you!</span>
                  ) : (
                    "Talk to Elango — he replies live."
                  )}
                </p>
              </div>

              <div className="scroll-thin flex-1 space-y-4 overflow-y-auto p-4">
                {messages.length === 0 && !chatBusy && (
                  <p className="text-sm text-slate-400">Be the first to say hi 👋</p>
                )}
                {messages.map((msg) => (
                  <div key={msg.id} className="animate-fade-in space-y-1">
                    <div className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-tr-sm bg-slate-100 px-3 py-2">
                      <p className="text-xs font-semibold text-slate-500">{msg.username}</p>
                      <p className="text-sm text-slate-800">{msg.message}</p>
                    </div>
                    {msg.reply ? (
                      <div className="w-fit max-w-[85%] rounded-2xl rounded-tl-sm bg-emerald-600 px-3 py-2 text-white">
                        <p className="text-xs font-semibold text-emerald-100">Elango 🎒</p>
                        <p className="text-sm">{msg.reply}</p>
                      </div>
                    ) : (
                      msg.reply_pending && (
                        <div className="w-fit max-w-[85%] rounded-2xl rounded-tl-sm bg-emerald-600 px-3 py-2 text-white">
                          <p className="text-xs font-semibold text-emerald-100">Elango 🎒</p>
                          <p className="text-sm italic opacity-90">{warmupReply(state?.activity, msg.id)}</p>
                          <p className="mt-1 flex gap-1">
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/80 [animation-delay:-0.3s]" />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/80 [animation-delay:-0.15s]" />
                            <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/80" />
                          </p>
                        </div>
                      )
                    )}
                  </div>
                ))}
                {chatBusy && (
                  <div className="animate-fade-in w-fit max-w-[85%] rounded-2xl rounded-tl-sm bg-emerald-600 px-3 py-2 text-white">
                    <p className="text-xs font-semibold text-emerald-100">Elango 🎒</p>
                    <p className="flex gap-1 py-1">
                      <span className="h-2 w-2 animate-bounce rounded-full bg-white/80 [animation-delay:-0.3s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-white/80 [animation-delay:-0.15s]" />
                      <span className="h-2 w-2 animate-bounce rounded-full bg-white/80" />
                    </p>
                  </div>
                )}
                <div ref={chatEndRef} />
              </div>

              <form onSubmit={sendChat} className="space-y-2 border-t border-slate-100 p-3">
                <input
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  placeholder="Your handle"
                  maxLength={100}
                  className="w-full rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={draft}
                    onChange={(e) => setDraft(e.target.value)}
                    placeholder="Message Elango…"
                    maxLength={500}
                    className="flex-1 rounded-lg border border-slate-200 px-3 py-2 text-sm outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-100"
                  />
                  <button
                    type="submit"
                    disabled={chatBusy || !draft.trim()}
                    className="inline-flex items-center justify-center rounded-lg bg-emerald-600 px-3 py-2 text-white transition hover:bg-emerald-700 active:scale-95 disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {chatBusy ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Send className="h-4 w-4" />
                    )}
                  </button>
                </div>
              </form>
            </div>
          </section>
        </div>

        <footer className={`mt-8 text-center text-xs ${theme.sub}`}>
          Autonomous AI backpacker · OpenStreetMap + Overpass · Open-Meteo · Wikipedia · Local Qwen
        </footer>
      </div>

      <Scrapbook open={scrapbookOpen} onClose={() => setScrapbookOpen(false)} onToast={notify} />
      <Diary open={diaryOpen} onClose={() => setDiaryOpen(false)} onToast={notify} />

      {/* Mobile-only quick jump to the chat (the marquee feature otherwise sits
          below the entire feed on small screens). */}
      <a
        href="#chat"
        className="animate-fade-in fixed bottom-5 right-5 z-[1090] inline-flex items-center gap-2 rounded-full bg-emerald-600 px-4 py-3 text-sm font-semibold text-white shadow-lg ring-1 ring-emerald-700/40 transition active:scale-95 lg:hidden"
      >
        <Radio className="h-4 w-4" /> Talk to Elango
      </a>

      {/* Toast */}
      {toast && (
        <div className="animate-fade-in fixed bottom-6 left-1/2 z-[1100] -translate-x-1/2 rounded-full bg-slate-900 px-5 py-2.5 text-sm font-medium text-white shadow-lg">
          {toast}
        </div>
      )}
    </main>
  );
}

/** Small labelled metric chip used in the trip-stats strip. */
function StatChip({ icon, label, value }) {
  return (
    <div className="flex items-center gap-2 rounded-xl bg-white/95 px-3 py-2 shadow-sm ring-1 ring-black/5">
      <span className="text-emerald-600">{icon}</span>
      <div className="leading-tight">
        <p className="text-[10px] uppercase tracking-wide text-slate-400">{label}</p>
        <p className="text-sm font-bold tabular-nums text-slate-800">{value}</p>
      </div>
    </div>
  );
}
