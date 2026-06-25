"use client";

import { useCallback, useEffect, useState } from "react";
import { Loader2, Cpu, Check, RotateCcw } from "lucide-react";
import { ModalShell, ModalCloseButton } from "@/components/Diary";

const FM = "var(--font-mono)";
const FD = "var(--font-display)";

/**
 * Observability panel: recent local-model calls, showing for each whether the
 * REAL model answered or the deterministic FALLBACK kicked in, the call kind,
 * the model, and how long it took.
 */
export default function ModelLog({ open, onClose }) {
  const [calls, setCalls] = useState([]);
  const [summary, setSummary] = useState({});
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/model-log", { cache: "no-store" });
      const json = await res.json();
      if (json?.ok) {
        setCalls(json.calls ?? []);
        setSummary(json.summary ?? {});
      }
    } catch {
      /* ignore */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    load();
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [open, load]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const fmtMs = (ms) => (ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${ms}ms`);
  const ago = (iso) => {
    const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
    if (s < 60) return `${s}s`;
    if (s < 3600) return `${Math.round(s / 60)}m`;
    return `${Math.round(s / 3600)}h`;
  };

  if (!open) return null;

  const total = summary.total ?? 0;
  const modelN = summary.model ?? 0;
  const fallbackN = summary.fallback ?? 0;
  const modelPct = total ? Math.round((modelN / total) * 100) : 0;

  return (
    <ModalShell onClose={onClose} label="Model activity" width={740}>
      <div style={{ padding: "18px 20px", borderBottom: "2px solid var(--ink)", background: "var(--paper-2)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <Cpu className="h-[22px] w-[22px]" style={{ color: "var(--teal)" }} />
          <h2 style={{ fontFamily: FD, fontWeight: 800, fontSize: 22, letterSpacing: "-.01em", margin: 0 }}>Model Activity</h2>
          <span style={{ flex: 1 }} />
          <ModalCloseButton onClose={onClose} label="Close model activity" />
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: 13, flexWrap: "wrap" }}>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--alive-tint)", border: "1.5px solid var(--alive)", borderRadius: 6, padding: "4px 9px", fontFamily: FM, fontWeight: 700, fontSize: 11, color: "var(--alive-ink)" }}>
            <Check className="h-3 w-3" /> model {modelN}
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, background: "var(--marigold-tint)", border: "1.5px solid var(--marigold)", borderRadius: 6, padding: "4px 9px", fontFamily: FM, fontWeight: 700, fontSize: 11, color: "var(--ink)" }}>
            <RotateCcw className="h-3 w-3" /> fallback {fallbackN}
          </span>
          {total > 0 && (
            <span style={{ fontFamily: FM, fontSize: 11, color: "var(--ink-soft)" }}>
              {modelPct}% real-model · avg {fmtMs(summary.avg_model_ms ?? 0)} · last 24h
            </span>
          )}
        </div>
      </div>

      <div className="scroll-thin" style={{ flex: 1, overflowY: "auto", padding: "14px 18px 18px" }}>
        {loading && calls.length === 0 && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 0", color: "var(--ink-soft)" }}>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading model calls…
          </div>
        )}

        {!loading && calls.length === 0 && (
          <p style={{ padding: "60px 0", textAlign: "center", fontSize: 14, color: "var(--ink-soft)" }}>
            No model calls recorded yet — they appear here as Elango thinks, chats and narrates.
          </p>
        )}

        {calls.map((c, i) => {
          const isModel = c.source === "model";
          return (
            <div
              key={c.id}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 11,
                padding: "12px 4px",
                borderBottom: i === calls.length - 1 ? "none" : "1.5px solid var(--line)",
              }}
            >
              <span
                style={{
                  fontFamily: FM,
                  fontWeight: 700,
                  fontSize: 9.5,
                  letterSpacing: ".1em",
                  background: isModel ? "var(--alive-tint)" : "var(--marigold-tint)",
                  border: `1.5px solid ${isModel ? "var(--alive)" : "var(--marigold)"}`,
                  borderRadius: 5,
                  padding: "3px 7px",
                  color: isModel ? "var(--alive-ink)" : "var(--ink)",
                  flex: "none",
                }}
              >
                {isModel ? "MODEL" : "FALLBACK"}
              </span>
              <span style={{ fontWeight: 700, fontSize: 13.5, flex: "none" }}>{c.kind}</span>
              <span style={{ fontFamily: FM, fontSize: 11, color: "var(--ink-soft)", flex: "none" }}>
                {c.model} · {fmtMs(c.ms)}
              </span>
              {c.preview && (
                <span style={{ fontFamily: FM, fontSize: 12, fontStyle: "italic", color: "var(--ink-soft)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1, minWidth: 40 }}>
                  {c.preview}
                </span>
              )}
              <span style={{ fontFamily: FM, fontSize: 10.5, color: "var(--ink-soft)", flex: "none", marginLeft: "auto" }}>{ago(c.created_at)}</span>
            </div>
          );
        })}
      </div>
    </ModalShell>
  );
}
