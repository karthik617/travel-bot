"use client";

import { useEffect, useRef, useState } from "react";
import { Volume2, VolumeX } from "lucide-react";

/**
 * A fully procedural ambient soundscape (no audio files). A low drone pad plays
 * continuously; a scheduler layers time-of-day textures (morning birds + temple
 * bells, daytime calm, evening warmth, night crickets) and a rain bed when the
 * weather is wet. Audio only starts on a user gesture (browser autoplay policy).
 *
 * @param {{ partOfDay?: string, weather?: string }} props
 */
export default function Soundscape({ partOfDay = "afternoon", weather = "" }) {
  const [on, setOn] = useState(false);

  const ctxRef = useRef(null);
  const masterRef = useRef(null);
  const rainGainRef = useRef(null);
  const longNodesRef = useRef([]);
  const schedRef = useRef(null);
  const partRef = useRef(partOfDay);
  const weatherRef = useRef(weather);

  useEffect(() => {
    partRef.current = partOfDay;
  }, [partOfDay]);

  // Fade the rain bed in/out as the weather changes.
  useEffect(() => {
    weatherRef.current = weather;
    const wet = /rain|drizzle|shower|thunder/i.test(weather);
    const ctx = ctxRef.current;
    if (rainGainRef.current && ctx) {
      rainGainRef.current.gain.setTargetAtTime(wet ? 0.09 : 0.0, ctx.currentTime, 2);
    }
  }, [weather]);

  // ---- one-shot sound generators ----
  const bell = (ctx, dest, t) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.value = 620 + Math.random() * 260;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.11, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.6);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + 2.7);
  };

  const cricket = (ctx, dest, t) => {
    const base = 4200 + Math.random() * 700;
    for (let i = 0; i < 3; i += 1) {
      const tt = t + i * 0.06;
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = base;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.exponentialRampToValueAtTime(0.04, tt + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, tt + 0.04);
      o.connect(g);
      g.connect(dest);
      o.start(tt);
      o.stop(tt + 0.05);
    }
  };

  const bird = (ctx, dest, t) => {
    const o = ctx.createOscillator();
    o.type = "sine";
    o.frequency.setValueAtTime(1800, t);
    o.frequency.exponentialRampToValueAtTime(2600, t + 0.12);
    o.frequency.exponentialRampToValueAtTime(2000, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
    o.connect(g);
    g.connect(dest);
    o.start(t);
    o.stop(t + 0.3);
  };

  const tick = (ctx, dest) => {
    const part = partRef.current;
    const t = ctx.currentTime + 0.02;
    const r = Math.random();
    if (part === "night") {
      if (r < 0.85) cricket(ctx, dest, t);
      if (r > 0.97) bird(ctx, dest, t); // distant owl-ish call
    } else if (part === "morning") {
      if (r < 0.3) bird(ctx, dest, t);
      if (r < 0.08) bell(ctx, dest, t);
    } else if (part === "evening") {
      if (r < 0.18) bird(ctx, dest, t);
      if (r < 0.06) bell(ctx, dest, t);
    } else {
      if (r < 0.12) bird(ctx, dest, t);
    }
  };

  const start = () => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    ctxRef.current = ctx;

    const master = ctx.createGain();
    master.gain.value = 0.0001;
    master.connect(ctx.destination);
    master.gain.setTargetAtTime(0.13, ctx.currentTime, 1.5);
    masterRef.current = master;

    // Low drone pad: two detuned oscillators through a lowpass, with a slow LFO.
    const padGain = ctx.createGain();
    padGain.gain.value = 0.08;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 480;
    padGain.connect(lp);
    lp.connect(master);

    const o1 = ctx.createOscillator();
    o1.type = "sine";
    o1.frequency.value = 110;
    const o2 = ctx.createOscillator();
    o2.type = "sine";
    o2.frequency.value = 165;
    o2.detune.value = 7;
    o1.connect(padGain);
    o2.connect(padGain);
    o1.start();
    o2.start();

    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.04;
    lfo.connect(lfoGain);
    lfoGain.connect(padGain.gain);
    lfo.start();

    // Rain bed: looping white noise through a lowpass, gain driven by weather.
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i += 1) data[i] = Math.random() * 2 - 1;
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const rainLp = ctx.createBiquadFilter();
    rainLp.type = "lowpass";
    rainLp.frequency.value = 2200;
    const rainGain = ctx.createGain();
    rainGain.gain.value = /rain|drizzle|shower|thunder/i.test(weatherRef.current) ? 0.09 : 0.0;
    noise.connect(rainLp);
    rainLp.connect(rainGain);
    rainGain.connect(master);
    noise.start();
    rainGainRef.current = rainGain;

    longNodesRef.current = [o1, o2, lfo, noise];
    schedRef.current = setInterval(() => tick(ctx, master), 900);
    setOn(true);
  };

  const stop = () => {
    if (schedRef.current) clearInterval(schedRef.current);
    schedRef.current = null;
    const ctx = ctxRef.current;
    const master = masterRef.current;
    if (master && ctx) master.gain.setTargetAtTime(0.0001, ctx.currentTime, 0.4);
    const nodes = longNodesRef.current;
    longNodesRef.current = [];
    setTimeout(() => {
      nodes.forEach((n) => {
        try {
          n.stop();
        } catch {
          /* already stopped */
        }
      });
      try {
        ctx?.close();
      } catch {
        /* ignore */
      }
      ctxRef.current = null;
      rainGainRef.current = null;
      masterRef.current = null;
    }, 600);
    setOn(false);
  };

  // Clean up audio if the component unmounts while playing.
  useEffect(
    () => () => {
      if (schedRef.current) clearInterval(schedRef.current);
      try {
        ctxRef.current?.close();
      } catch {
        /* ignore */
      }
    },
    []
  );

  return (
    <button
      onClick={() => (on ? stop() : start())}
      title={on ? "Mute ambient sounds" : "Play ambient sounds"}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        background: on ? "var(--teal)" : "transparent",
        border: on ? "1.5px solid var(--teal)" : "1.5px solid var(--line-2)",
        borderRadius: 7,
        padding: "7px 12px",
        cursor: "pointer",
        fontSize: 13,
        fontWeight: on ? 700 : 400,
        color: on ? "#fff" : "var(--ink-2)",
        whiteSpace: "nowrap",
        flex: "none",
      }}
    >
      {on ? <Volume2 className="h-3.5 w-3.5" /> : <VolumeX className="h-3.5 w-3.5" />}
      {on ? "Sound on" : "Ambience"}
    </button>
  );
}
