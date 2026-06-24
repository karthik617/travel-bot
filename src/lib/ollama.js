// Thin, dependency-free client for a local Ollama daemon running Qwen-2.5.
//
// We deliberately hit the /api/generate endpoint with the exact payload wrapper
// from the plan ({ model, prompt, stream:false }) and feed it a *raw* ChatML
// prompt. Qwen-2.5 is trained on the ChatML template, so by emitting the
// <|im_start|>/<|im_end|> tokens ourselves (raw: true) we get full control over
// the system + user framing while still using the generate API.

const ENDPOINT = process.env.LOCAL_LLM_ENDPOINT || "http://localhost:11434";
const MODEL = process.env.LOCAL_LLM_MODEL || "qwen2.5:7b";
// Separate small vision model for the "eyes" organ (Architecture Spec 01, cold
// lane). Kept independent so the text model can change without affecting vision.
const VISION_MODEL = process.env.VISION_MODEL || "moondream";

// Default request timeout. On CPU-only Ollama a short story can take 30-50s, so
// allow this to be raised via env (e.g. OLLAMA_TIMEOUT_MS=90000 in Docker) to
// avoid aborting mid-generation and falling back to template text.
const DEFAULT_TIMEOUT_MS = Number(process.env.OLLAMA_TIMEOUT_MS) || 30000;

const IM_END = "<|im_end|>";

/**
 * Build a ChatML prompt string from a system + user pair.
 * @param {string} system - System persona / instructions.
 * @param {string} user - The user (or task) message.
 * @returns {string} A ChatML-formatted prompt ready for raw generation.
 */
export function buildChatML(system, user) {
  return (
    `<|im_start|>system\n${system}${IM_END}\n` +
    `<|im_start|>user\n${user}${IM_END}\n` +
    `<|im_start|>assistant\n`
  );
}

/**
 * Call the local Ollama model and return generated text.
 * Never throws: on any network error, timeout, or bad response it logs and
 * returns the provided fallback string so the site keeps functioning.
 *
 * @param {Object} opts
 * @param {string} opts.system - System persona.
 * @param {string} opts.user - User/task message.
 * @param {string} opts.fallback - String returned if the model is unreachable.
 * @param {number} [opts.timeoutMs] - Abort after this many ms (defaults to
 *   OLLAMA_TIMEOUT_MS env or 30000).
 * @param {number} [opts.temperature=0.8] - Sampling temperature.
 * @returns {Promise<string>} The model's reply, or the fallback.
 */
export async function generateFromOllama({
  system,
  user,
  fallback,
  timeoutMs = DEFAULT_TIMEOUT_MS,
  temperature = 0.8,
}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(`${ENDPOINT.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: MODEL,
        prompt: buildChatML(system, user),
        stream: false,
        raw: true,
        options: {
          temperature,
          stop: [IM_END],
          num_predict: 220,
        },
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      console.warn(`[ollama] Non-OK response (${res.status}); using fallback.`);
      return fallback;
    }

    const data = await res.json();
    const text = (data?.response ?? "").replace(/<\|im_end\|>/g, "").trim();
    return text.length > 0 ? text : fallback;
  } catch (err) {
    console.warn(`[ollama] Request failed (${err?.name || "error"}): ${err?.message}`);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Vision call for the "eyes" organ: ask the local VLM to describe a real image.
 * Never throws — returns `fallback` (default null) on any failure, so a missing
 * model or a slow CPU never breaks the tick.
 *
 * @param {Object} opts
 * @param {string} opts.imageBase64 - raw base64 (no data: prefix) of the image.
 * @param {string} opts.prompt
 * @param {*} [opts.fallback=null]
 * @param {number} [opts.timeoutMs=60000] - VLMs on CPU are slow; allow a wide window.
 * @returns {Promise<string|null>}
 */
export async function describeImage({ imageBase64, prompt, fallback = null, timeoutMs = 60000 }) {
  if (!imageBase64) return fallback;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(`${ENDPOINT.replace(/\/$/, "")}/api/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: VISION_MODEL,
        prompt,
        images: [imageBase64],
        stream: false,
        options: { temperature: 0.4, num_predict: 80 },
      }),
      signal: controller.signal,
    });
    if (!res.ok) {
      console.warn(`[ollama] vision non-OK (${res.status}); skipping.`);
      return fallback;
    }
    const data = await res.json();
    const text = (data?.response ?? "").trim();
    return text.length > 0 ? text : fallback;
  } catch (err) {
    console.warn(`[ollama] vision failed (${err?.name || "error"}): ${err?.message}`);
    return fallback;
  } finally {
    clearTimeout(timer);
  }
}
