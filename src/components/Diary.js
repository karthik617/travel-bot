"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Share2, Loader2, BookOpen } from "lucide-react";

const FD = "var(--font-display)";
const FM = "var(--font-mono)";

/** Shared modal shell for the Roadside Ledger panels. */
function ModalShell({ onClose, label, children, width = 760 }) {
  return (
    <div
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={label}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "rgba(16,18,14,.55)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(14px,4vh,48px) 16px",
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width,
          maxWidth: "100%",
          maxHeight: "88vh",
          display: "flex",
          flexDirection: "column",
          background: "var(--card)",
          border: "2px solid var(--ink)",
          borderRadius: 14,
          boxShadow: "9px 9px 0 rgba(0,0,0,.32)",
          animation: "modalIn .32s cubic-bezier(.2,.8,.2,1)",
          overflow: "hidden",
        }}
      >
        {children}
      </div>
    </div>
  );
}

export function ModalCloseButton({ onClose, label }) {
  return (
    <button
      onClick={onClose}
      aria-label={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 34,
        height: 34,
        background: "var(--card)",
        border: "2px solid var(--ink)",
        boxShadow: "2px 2px 0 var(--ink)",
        borderRadius: 8,
        cursor: "pointer",
        color: "var(--ink)",
        flex: "none",
      }}
    >
      <X className="h-[17px] w-[17px]" />
    </button>
  );
}

/**
 * Elango's diary — the nightly recaps the memory consolidation pass writes "in
 * his sleep". Each entry is shareable, making the diary a re-engagement surface.
 */
export default function Diary({ open, onClose, onToast }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/diary", { cache: "no-store" });
      const json = await res.json();
      if (json?.ok) setEntries(json.entries ?? []);
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const fmtDay = (d) => {
    try {
      return new Date(d).toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "long" }).toUpperCase();
    } catch {
      return d;
    }
  };

  const share = async (entry) => {
    const text = `📔 From Elango's diary — ${fmtDay(entry.day)}:\n"${entry.text}"\nFollow his live journey across Tamil Nadu 👇`;
    const url = typeof window !== "undefined" ? window.location.origin : "";
    try {
      if (navigator.share) await navigator.share({ title: "Elango's Diary", text, url });
      else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        onToast?.("Diary entry copied to clipboard! 📋");
      }
    } catch {
      /* cancelled */
    }
  };

  if (!open) return null;

  return (
    <ModalShell onClose={onClose} label="Elango's diary">
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 20px", borderBottom: "2px solid var(--ink)", background: "var(--paper-2)" }}>
        <BookOpen className="h-[22px] w-[22px]" style={{ color: "var(--marigold)" }} />
        <h2 style={{ fontFamily: FD, fontWeight: 800, fontSize: 22, letterSpacing: "-.01em", margin: 0 }}>Elango&apos;s Diary</h2>
        {entries.length > 0 && (
          <span style={{ fontFamily: FM, fontSize: 11, letterSpacing: ".1em", background: "var(--marigold-tint)", border: "1.5px solid var(--marigold)", borderRadius: 6, padding: "4px 9px", color: "var(--ink)" }}>
            {entries.length} {entries.length === 1 ? "NIGHT" : "NIGHTS"}
          </span>
        )}
        <span style={{ flex: 1 }} />
        <ModalCloseButton onClose={onClose} label="Close diary" />
      </div>

      <div className="scroll-thin" style={{ flex: 1, overflowY: "auto", padding: 20, display: "flex", flexDirection: "column", gap: 14 }}>
        {loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 0", color: "var(--ink-soft)" }}>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Opening the diary…
          </div>
        )}

        {!loading && entries.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "60px 0", textAlign: "center" }}>
            <div style={{ display: "flex", height: 64, width: 64, alignItems: "center", justifyContent: "center", borderRadius: 16, background: "var(--marigold-tint)", border: "2px solid var(--marigold)" }}>
              <BookOpen className="h-7 w-7" style={{ color: "var(--marigold)" }} />
            </div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>The diary is empty for now</p>
            <p style={{ margin: 0, maxWidth: 320, fontSize: 14, color: "var(--ink-soft)" }}>
              Each night as Elango rests, he writes up the day&apos;s wanderings here. Check back after his first night on the road. 🌙
            </p>
          </div>
        )}

        {!loading &&
          entries.map((entry, i) => {
            const latest = i === 0;
            return (
              <div
                key={entry.id}
                style={{
                  border: latest ? "2px solid var(--alive)" : "1.5px solid var(--line-2)",
                  borderRadius: 11,
                  padding: "18px 20px",
                  background: latest ? "var(--alive-tint)" : "transparent",
                }}
              >
                <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 11 }}>
                  <span style={{ fontFamily: FM, fontWeight: 700, fontSize: 11, letterSpacing: ".1em", color: latest ? "var(--alive-ink)" : "var(--elango)" }}>
                    {latest ? "LATEST · " : ""}
                    {fmtDay(entry.day)}
                  </span>
                  <span style={{ flex: 1 }} />
                  <button
                    onClick={() => share(entry)}
                    style={{
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      background: "transparent",
                      border: `1.5px solid ${latest ? "var(--alive)" : "var(--line-2)"}`,
                      borderRadius: 6,
                      padding: "5px 10px",
                      cursor: "pointer",
                      fontFamily: FM,
                      fontWeight: 700,
                      fontSize: 10.5,
                      color: latest ? "var(--alive-ink)" : "var(--ink-soft)",
                    }}
                  >
                    <Share2 className="h-3 w-3" /> SHARE
                  </button>
                </div>
                <p style={{ margin: 0, fontSize: 16, lineHeight: 1.6, color: latest ? "var(--ink)" : "var(--ink-2)", whiteSpace: "pre-line" }}>{entry.text}</p>
              </div>
            );
          })}
      </div>
    </ModalShell>
  );
}

export { ModalShell };
