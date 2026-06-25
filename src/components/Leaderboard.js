"use client";

import { useCallback, useEffect, useState } from "react";
import { Trophy } from "lucide-react";

const FD = "var(--font-display)";
const FM = "var(--font-mono)";
const MEDAL_BG = ["var(--marigold)", "var(--line-2)", "var(--elango-tint)"];

/**
 * "Top Supporters" board, styled into the Roadside Ledger system. Polls
 * periodically and highlights the current viewer's row. `me` is the viewer's
 * handle; `refreshKey` bumps to force an immediate refresh after a contribution.
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
    <div
      style={{
        background: "var(--card)",
        border: "2px solid var(--ink)",
        borderRadius: 13,
        boxShadow: "5px 5px 0 var(--line-2)",
        padding: "16px 18px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 13 }}>
        <Trophy className="h-[18px] w-[18px]" style={{ color: "var(--marigold)" }} />
        <span style={{ fontFamily: FD, fontWeight: 700, fontSize: 15 }}>TOP SUPPORTERS</span>
      </div>

      {leaders.length === 0 ? (
        <p style={{ margin: 0, fontSize: 14, color: "var(--ink-soft)" }}>
          No supporters yet — buy Elango a coffee to claim the top spot! ☕
        </p>
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 9 }}>
          {leaders.slice(0, 5).map((row, i) => {
            const isMe = row.username.toLowerCase() === mine;
            return (
              <div
                key={row.username}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 12,
                  padding: "10px 12px",
                  borderRadius: 8,
                  border: isMe ? "1.5px solid var(--alive)" : "1.5px solid var(--line-2)",
                  background: isMe ? "var(--alive-tint)" : "transparent",
                }}
              >
                <span
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: "50%",
                    background: i < 3 ? MEDAL_BG[i] : "var(--card)",
                    border: "1.5px solid var(--ink)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontFamily: FM,
                    fontWeight: 700,
                    fontSize: 12,
                    flex: "none",
                  }}
                >
                  {i + 1}
                </span>
                <span
                  title={`☕ ${row.coffees} · 🚌 ${row.buses} · 🗳️ ${row.votes}`}
                  style={{ flex: 1, minWidth: 0, fontWeight: 600, fontSize: 14.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
                >
                  {row.username}
                  {isMe && <span style={{ color: "var(--alive-ink)", fontWeight: 700, fontSize: 12.5 }}> (you)</span>}
                </span>
                <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 13 }}>{row.total} pts</span>
              </div>
            );
          })}
        </div>
      )}

      {patrons.length > 0 && (
        <div style={{ marginTop: 16, borderRadius: 10, border: "1.5px solid var(--marigold)", background: "var(--marigold-tint)", padding: 12 }}>
          <p style={{ margin: "0 0 8px", fontFamily: FM, fontSize: 10.5, fontWeight: 700, letterSpacing: ".1em", color: "var(--ink)" }}>
            ☕ JOURNEY PATRONS
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 7 }}>
            {patrons.map((p) => (
              <span
                key={p.username}
                title={`${p.gifts} real-money gift${p.gifts > 1 ? "s" : ""} — thank you!`}
                style={{ display: "inline-flex", alignItems: "center", gap: 5, background: "var(--card)", border: "1.5px solid var(--marigold)", borderRadius: 999, padding: "3px 10px", fontSize: 12.5, fontWeight: 600, color: "var(--ink)" }}
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
