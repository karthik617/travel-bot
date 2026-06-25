"use client";

import { useCallback, useEffect, useState } from "react";
import { Share2, Loader2, MapPin, Images } from "lucide-react";
import { formatLocation } from "@/lib/journey";
import { ModalShell, ModalCloseButton } from "@/components/Diary";

const FD = "var(--font-display)";
const FM = "var(--font-mono)";

// Deterministic warm gradient per card when there's no photo (so the grid still
// reads like a scrapbook of places rather than empty tiles).
const FALLBACK_GRADIENTS = [
  "radial-gradient(90px 60px at 70% 28%, rgba(222,154,18,.6), transparent 70%), linear-gradient(160deg,#e8c98f,#c98a3e 55%,#8a4f2a)",
  "linear-gradient(160deg,#bfe0c2,#5da66a 55%,#2f7a4a)",
  "radial-gradient(90px 56px at 76% 24%,rgba(222,154,18,.55),transparent 70%),linear-gradient(180deg,#e7d7a6,#9fc06f 52%,#3f8f5e)",
  "linear-gradient(180deg,#fbe7c6,#9fc7cf 50%,#2e7e86)",
  "linear-gradient(160deg,#cdbad9,#8a6fae 55%,#4a3e74)",
  "radial-gradient(90px 56px at 74% 26%,rgba(222,154,18,.55),transparent 70%),linear-gradient(180deg,#e9d49a,#caa15a 50%,#6f5a2e)",
];

/**
 * A scrapbook of named places Elango has visited. Each postcard can be shared
 * via the Web Share API (mobile) or copied to the clipboard (desktop).
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

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const share = async (card) => {
    const text = `🎒 Elango the AI backpacker just visited ${formatLocation(card.landmark_name, card.current_city)}!\n"${card.story}"\nFollow his live journey across Tamil Nadu 👇`;
    const url = typeof window !== "undefined" ? window.location.href : "";
    try {
      if (navigator.share) await navigator.share({ title: "Elango's Journey", text, url });
      else {
        await navigator.clipboard.writeText(`${text}\n${url}`);
        onToast?.("Postcard copied to clipboard! 📋");
      }
    } catch {
      /* cancelled */
    }
  };

  if (!open) return null;

  return (
    <ModalShell onClose={onClose} label="Elango's travel scrapbook" width={900}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "18px 20px", borderBottom: "2px solid var(--ink)", background: "var(--paper-2)" }}>
        <Images className="h-[22px] w-[22px]" style={{ color: "var(--elango)" }} />
        <h2 style={{ fontFamily: FD, fontWeight: 800, fontSize: 22, letterSpacing: "-.01em", margin: 0 }}>Elango&apos;s Scrapbook</h2>
        {postcards.length > 0 && (
          <span style={{ fontFamily: FM, fontSize: 11, letterSpacing: ".1em", background: "var(--elango-tint)", border: "1.5px solid var(--elango)", borderRadius: 6, padding: "4px 9px", color: "var(--elango)" }}>
            {postcards.length} PLACES
          </span>
        )}
        <span style={{ flex: 1 }} />
        <ModalCloseButton onClose={onClose} label="Close scrapbook" />
      </div>

      <div className="scroll-thin" style={{ flex: 1, overflowY: "auto", padding: 20 }}>
        {loading && (
          <div style={{ display: "flex", alignItems: "center", justifyContent: "center", padding: "60px 0", color: "var(--ink-soft)" }}>
            <Loader2 className="mr-2 h-5 w-5 animate-spin" /> Loading postcards…
          </div>
        )}

        {!loading && postcards.length === 0 && (
          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "60px 0", textAlign: "center" }}>
            <div style={{ display: "flex", height: 64, width: 64, alignItems: "center", justifyContent: "center", borderRadius: 16, background: "var(--elango-tint)", border: "2px solid var(--elango)" }}>
              <Images className="h-7 w-7" style={{ color: "var(--elango)" }} />
            </div>
            <p style={{ margin: 0, fontSize: 14, fontWeight: 700, color: "var(--ink)" }}>No postcards yet</p>
            <p style={{ margin: 0, maxWidth: 340, fontSize: 14, color: "var(--ink-soft)" }}>
              Every time Elango reaches a named landmark, a postcard lands here — photo, weather and his note from the road. Keep him moving with a coffee or a bus! ☕🚌
            </p>
          </div>
        )}

        {!loading && postcards.length > 0 && (
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill,minmax(232px,1fr))", gap: 16 }}>
            {postcards.map((card, i) => (
              <figure key={card.id} style={{ margin: 0, border: "2px solid var(--ink)", borderRadius: 11, boxShadow: "4px 4px 0 var(--line-2)", overflow: "hidden", display: "flex", flexDirection: "column" }}>
                <div style={{ position: "relative", height: 130, borderBottom: "2px solid var(--ink)", background: FALLBACK_GRADIENTS[i % FALLBACK_GRADIENTS.length] }}>
                  {card.image_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={card.image_url}
                      alt={card.landmark_name}
                      loading="lazy"
                      onError={(e) => {
                        e.currentTarget.style.display = "none";
                      }}
                      style={{ position: "absolute", inset: 0, width: "100%", height: "100%", objectFit: "cover" }}
                    />
                  )}
                  {card.weather && (
                    <span style={{ position: "absolute", left: 9, top: 9, background: "rgba(20,22,18,.72)", borderRadius: 6, padding: "4px 8px", color: "#F1EBDD", fontFamily: FM, fontSize: 9.5 }}>
                      {card.weather}
                    </span>
                  )}
                </div>
                <figcaption style={{ padding: "13px 14px", display: "flex", flexDirection: "column", flex: 1 }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, color: "var(--elango)" }}>
                    <MapPin className="h-3.5 w-3.5" />
                    <span style={{ fontFamily: FM, fontSize: 10, letterSpacing: ".08em", color: "var(--ink-soft)", textTransform: "uppercase" }}>{card.current_city}</span>
                  </div>
                  <h3 style={{ fontFamily: FD, fontWeight: 700, fontSize: 16, lineHeight: 1.15, margin: "7px 0 6px" }}>{card.landmark_name}</h3>
                  <p style={{ margin: "0 0 12px", flex: 1, fontSize: 13, lineHeight: 1.5, color: "var(--ink-2)", display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>{card.story}</p>
                  <button
                    onClick={() => share(card)}
                    style={{ width: "100%", display: "inline-flex", alignItems: "center", justifyContent: "center", gap: 7, background: "var(--ink)", border: "2px solid var(--ink)", borderRadius: 7, padding: 8, cursor: "pointer", color: "var(--paper)", fontWeight: 700, fontSize: 12.5 }}
                  >
                    <Share2 className="h-3 w-3" /> Share postcard
                  </button>
                </figcaption>
              </figure>
            ))}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
