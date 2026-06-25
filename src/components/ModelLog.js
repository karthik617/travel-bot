"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Loader2, Cpu } from "lucide-react";

/**
 * Observability panel: the most recent local-model calls, showing for each one
 * whether the REAL model answered or the deterministic FALLBACK kicked in, what
 * the call was for (kind), which model, and how long it took. Answers "is the
 * model actually driving this, or is it falling back?" at a glance.
 *
 * @param {{ open:boolean, onClose:()=>void }} props
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

  // Load on open, then poll while open so it feels live.
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
    if (s < 60) return `${s}s ago`;
    if (s < 3600) return `${Math.round(s / 60)}m ago`;
    return `${Math.round(s / 3600)}h ago`;
  };

  if (!open) return null;

  const total = summary.total ?? 0;
  const modelN = summary.model ?? 0;
  const fallbackN = summary.fallback ?? 0;
  const modelPct = total ? Math.round((modelN / total) * 100) : 0;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Model activity"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-2xl ring-1 ring-black/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-slate-100 p-4">
          <div className="flex items-center justify-between">
            <h2 className="flex items-center gap-2 font-serif text-xl font-bold text-slate-900">
              <Cpu className="h-5 w-5 text-emerald-600" /> Model Activity
            </h2>
            <button
              onClick={onClose}
              aria-label="Close model activity"
              className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
          {/* Summary: how much the real model is driving things (last 24h) */}
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
            <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-semibold text-emerald-700 ring-1 ring-emerald-200">
              ✅ model {modelN}
            </span>
            <span className="rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-700 ring-1 ring-amber-200">
              ↩︎ fallback {fallbackN}
            </span>
            {total > 0 && (
              <span className="text-slate-500">
                {modelPct}% real-model · avg {fmtMs(summary.avg_model_ms ?? 0)} · last 24h
              </span>
            )}
          </div>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto p-3">
          {loading && calls.length === 0 && (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading model calls…
            </div>
          )}

          {!loading && calls.length === 0 && (
            <p className="py-16 text-center text-sm text-slate-400">
              No model calls recorded yet — they appear here as Elango thinks, chats and narrates.
            </p>
          )}

          <ul className="space-y-1.5">
            {calls.map((c) => {
              const isModel = c.source === "model";
              return (
                <li
                  key={c.id}
                  className="flex items-start gap-3 rounded-lg border border-slate-100 bg-white px-3 py-2"
                >
                  <span
                    className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wide ${
                      isModel
                        ? "bg-emerald-100 text-emerald-700"
                        : "bg-amber-100 text-amber-700"
                    }`}
                  >
                    {isModel ? "model" : "fallback"}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                      <span className="font-semibold text-slate-800">{c.kind}</span>
                      <span className="text-slate-400">{c.model}</span>
                      <span className="tabular-nums text-slate-400">· {fmtMs(c.ms)}</span>
                      <span className="ml-auto text-slate-400">{ago(c.created_at)}</span>
                    </div>
                    {c.preview && (
                      <p className="mt-0.5 truncate text-xs italic text-slate-500">{c.preview}</p>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </div>
    </div>
  );
}
