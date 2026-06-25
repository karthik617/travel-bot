"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Share2, Loader2, BookOpen } from "lucide-react";

/**
 * A modal of Elango's diary — the nightly recaps the memory consolidation pass
 * writes "in his sleep" (Architecture Spec 02). Each entry is shareable, making
 * the diary a re-engagement + virality surface.
 *
 * @param {{ open:boolean, onClose:()=>void, onToast:(msg:string)=>void }} props
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
      /* ignore — empty state renders */
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) load();
  }, [open, load]);

  // Close on Escape for accessibility.
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
      return new Date(d).toLocaleDateString("en-IN", {
        weekday: "long",
        day: "numeric",
        month: "long",
      });
    } catch {
      return d;
    }
  };

  const share = async (entry) => {
    const text =
      `📔 From Elango's diary — ${fmtDay(entry.day)}:\n` +
      `"${entry.text}"\n` +
      `Follow his live journey across Tamil Nadu 👇`;
    const url = typeof window !== "undefined" ? window.location.origin : "";
    try {
      if (navigator.share) {
        await navigator.share({ title: "Elango's Diary", text, url });
      } else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        onToast?.("Diary entry copied to clipboard! 📋");
      }
    } catch {
      /* user cancelled share — ignore */
    }
  };

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[1000] flex items-center justify-center bg-slate-900/60 p-4 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Elango's diary"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl bg-slate-50 shadow-2xl ring-1 ring-black/10"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 p-4">
          <h2 className="flex items-center gap-2 font-serif text-xl font-bold text-slate-900">
            📔 Elango&apos;s Diary
            {entries.length > 0 && (
              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs font-semibold text-amber-700">
                {entries.length} {entries.length === 1 ? "night" : "nights"}
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close diary"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Opening the diary…
            </div>
          )}

          {!loading && entries.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-amber-50 ring-1 ring-amber-100">
                <BookOpen className="h-7 w-7 text-amber-500" />
              </div>
              <p className="text-sm font-semibold text-slate-700">The diary is empty for now</p>
              <p className="max-w-xs text-sm text-slate-400">
                Each night as Elango rests, he writes up the day&apos;s wanderings here. Check
                back after his first night on the road. 🌙
              </p>
            </div>
          )}

          {!loading && entries.length > 0 && (
            <ol className="space-y-4">
              {entries.map((entry, i) => (
                <li
                  key={entry.id}
                  className="rounded-xl border border-slate-200 bg-gradient-to-br from-amber-50/60 to-white p-4"
                >
                  <div className="mb-1.5 flex items-center justify-between gap-2">
                    <p className="text-xs font-bold uppercase tracking-wide text-amber-700">
                      {i === 0 ? "Latest · " : ""}
                      {fmtDay(entry.day)}
                    </p>
                    <button
                      onClick={() => share(entry)}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-xs font-medium text-slate-500 transition hover:bg-amber-100/60 hover:text-amber-800"
                    >
                      <Share2 className="h-3.5 w-3.5" /> Share
                    </button>
                  </div>
                  <p className="whitespace-pre-line text-sm leading-relaxed text-slate-700">
                    {entry.text}
                  </p>
                </li>
              ))}
            </ol>
          )}
        </div>
      </div>
    </div>
  );
}
