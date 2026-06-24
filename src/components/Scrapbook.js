"use client";

import { useCallback, useEffect, useState } from "react";
import { X, Share2, Loader2, MapPin, Images } from "lucide-react";
import { formatLocation } from "@/lib/journey";

/**
 * A modal scrapbook of the named places Elango has visited. Each postcard can
 * be shared via the Web Share API (mobile) or copied to the clipboard (desktop).
 *
 * @param {{ open:boolean, onClose:()=>void, onToast:(msg:string)=>void }} props
 */
export default function Scrapbook({ open, onClose, onToast }) {
  const [postcards, setPostcards] = useState([]);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/postcards", { cache: "no-store" });
      const json = await res.json();
      if (json?.ok) setPostcards(json.postcards ?? []);
    } catch {
      /* ignore */
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

  const share = async (card) => {
    const text =
      `🎒 Elango the AI backpacker just visited ${formatLocation(card.landmark_name, card.current_city)}!\n` +
      `"${card.story}"\n` +
      `Follow his live journey across Tamil Nadu 👇`;
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share) {
        await navigator.share({ title: "Elango's Journey", text, url });
      } else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        onToast?.("Postcard copied to clipboard! 📋");
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
      aria-label="Elango's travel scrapbook"
    >
      <div
        className="flex max-h-[85vh] w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-100 p-4">
          <h2 className="flex items-center gap-2 text-lg font-bold text-slate-900">
            📔 Elango&apos;s Scrapbook
            {postcards.length > 0 && (
              <span className="rounded-full bg-emerald-50 px-2 py-0.5 text-xs font-semibold text-emerald-700">
                {postcards.length} places
              </span>
            )}
          </h2>
          <button
            onClick={onClose}
            aria-label="Close scrapbook"
            className="rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="scroll-thin flex-1 overflow-y-auto p-4">
          {loading && (
            <div className="flex items-center justify-center py-16 text-slate-400">
              <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading postcards…
            </div>
          )}

          {!loading && postcards.length === 0 && (
            <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-violet-50 ring-1 ring-violet-100">
                <Images className="h-7 w-7 text-violet-500" />
              </div>
              <p className="text-sm font-semibold text-slate-700">No postcards yet</p>
              <p className="max-w-xs text-sm text-slate-400">
                Every time Elango reaches a named landmark, a postcard lands here — photo,
                weather and his note from the road. Keep him moving with a coffee or a bus! ☕🚌
              </p>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {[0, 1, 2].map((i) => (
                  <div
                    key={i}
                    className="flex h-16 w-20 items-center justify-center rounded-lg border border-dashed border-slate-200 text-slate-300"
                  >
                    <MapPin className="h-5 w-5" />
                  </div>
                ))}
              </div>
            </div>
          )}

          {!loading && postcards.length > 0 && (
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {postcards.map((card) => (
                <figure
                  key={card.id}
                  className="group flex flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md"
                >
                  <div className="relative h-36 w-full overflow-hidden bg-slate-100">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={card.image_url}
                      alt={card.landmark_name}
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-105"
                    />
                    {card.weather && (
                      <span className="absolute right-2 top-2 rounded-full bg-black/45 px-2 py-0.5 text-[11px] font-medium text-white">
                        {card.weather}
                      </span>
                    )}
                  </div>
                  <figcaption className="flex flex-1 flex-col p-3">
                    <p className="flex items-center gap-1 text-sm font-bold text-slate-900">
                      <MapPin className="h-3.5 w-3.5 text-emerald-600" />
                      {card.landmark_name}
                    </p>
                    <p className="text-xs text-slate-500">{card.current_city}</p>
                    <p className="mt-1.5 line-clamp-3 flex-1 text-xs leading-relaxed text-slate-600">
                      {card.story}
                    </p>
                    <button
                      onClick={() => share(card)}
                      className="mt-3 inline-flex items-center justify-center gap-1.5 rounded-lg bg-slate-900 px-3 py-1.5 text-xs font-semibold text-white transition hover:bg-slate-700 active:scale-95"
                    >
                      <Share2 className="h-3.5 w-3.5" /> Share postcard
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
