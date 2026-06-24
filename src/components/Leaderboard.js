"use client";

import { useCallback, useEffect, useState } from "react";
import { Trophy } from "lucide-react";

const MEDALS = ["🥇", "🥈", "🥉"];

/**
 * Compact "Top Supporters" leaderboard. Polls periodically and highlights the
 * current viewer's row. `me` is the viewer's handle; `refreshKey` bumps to force
 * an immediate refresh after the viewer contributes.
 */
export default function Leaderboard({ me = "", refreshKey = 0 }) {
  const [leaders, setLeaders] = useState([]);
  const [patrons, setPatrons] = useState([]);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/leaderboard", { cache: "no-store" });
      const json = await res.json();
      if (json?.ok) {
        setLeaders(json.leaders ?? []);
        setPatrons(json.patrons ?? []);
      }
    } catch {
      /* ignore */
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(load, 30000);
    return () => clearInterval(t);
  }, [load, refreshKey]);

  const mine = me.trim().toLowerCase();

  return (
    <div className="rounded-2xl bg-white/95 p-4 shadow-sm ring-1 ring-black/5">
      <h2 className="mb-3 inline-flex items-center gap-2 text-sm font-bold uppercase tracking-wide text-slate-700">
        <Trophy className="h-4 w-4 text-amber-500" /> Top Supporters
      </h2>

      {leaders.length === 0 ? (
        <p className="text-sm text-slate-400">
          No supporters yet — buy Elango a coffee to claim the top spot! ☕
        </p>
      ) : (
        <ol className="space-y-1.5">
          {leaders.slice(0, 5).map((row, i) => {
            const isMe = row.username.toLowerCase() === mine;
            return (
              <li
                key={row.username}
                className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm ${
                  isMe ? "bg-emerald-50 ring-1 ring-emerald-200" : ""
                }`}
              >
                <span className="flex min-w-0 items-center gap-2">
                  <span className="w-5 shrink-0 text-center">{MEDALS[i] ?? `${i + 1}`}</span>
                  <span className={`truncate font-medium ${isMe ? "text-emerald-700" : "text-slate-700"}`}>
                    {row.username}
                    {isMe && <span className="ml-1 text-xs text-emerald-500">(you)</span>}
                  </span>
                </span>
                <span
                  className="shrink-0 text-xs tabular-nums text-slate-400"
                  title={`☕ ${row.coffees} · 🚌 ${row.buses} · 🗳️ ${row.votes}`}
                >
                  {row.total} pts
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {/* Patron gratitude ribbon — a SEPARATE signal from the ranking above, so
          paying never buys a leaderboard spot. Dormant until real-money tips exist. */}
      {patrons.length > 0 && (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/60 p-3">
          <p className="mb-1.5 inline-flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wide text-amber-700">
            ☕ Journey patrons
          </p>
          <div className="flex flex-wrap gap-1.5">
            {patrons.map((p) => (
              <span
                key={p.username}
                title={`${p.gifts} real-money gift${p.gifts > 1 ? "s" : ""} — thank you!`}
                className="inline-flex items-center gap-1 rounded-full bg-white px-2 py-0.5 text-xs font-medium text-amber-800 ring-1 ring-amber-200"
              >
                💛 {p.username}
              </span>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
