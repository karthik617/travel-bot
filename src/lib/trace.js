// Observability for local-model calls. Every generate/vision call records whether
// the real model answered or the deterministic fallback was used, how long it
// took, and what it was for — so we can see, after the fact, how much the model
// is actually shaping the journey vs. how often it times out into templates.
//
// Recording is best-effort and fire-and-forget: it never blocks or breaks a call.

import { query } from "@/lib/db";

/**
 * @param {Object} t
 * @param {string} t.kind     - what the call was for: story|chat|diary|coffee|bus|destination|vision…
 * @param {string} t.model    - the model name used
 * @param {"model"|"fallback"} t.source - did the model answer, or did we fall back?
 * @param {number} t.ms       - wall-clock latency
 * @param {boolean} [t.ok]
 * @param {string} [t.preview] - first chars of the output (trimmed for storage)
 */
export function recordModelCall({ kind, model, source, ms, ok = true, preview = "" }) {
  // Always leave a greppable line in the container logs.
  console.log(
    `[model] kind=${kind} model=${model} source=${source.toUpperCase()} ms=${ms} chars=${(preview || "").length}`
  );
  // Persist (non-blocking) for the in-app Model Activity panel.
  query(
    `INSERT INTO model_calls (kind, model, source, ms, ok, preview)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [String(kind).slice(0, 30), String(model).slice(0, 60), source, Math.round(ms) || 0, !!ok, String(preview || "").slice(0, 240)]
  ).catch(() => {
    /* tracing must never break the request */
  });
}
