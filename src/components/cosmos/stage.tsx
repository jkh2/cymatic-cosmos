import { useEffect, useRef, useState } from "react";
import { ear, listenForPrayer, sampleEar, triggerNote } from "@/lib/cosmos/audio";
import { noteToMidi, pointOnPath, type Track } from "@/lib/cosmos/model";
import { useCosmos } from "@/lib/cosmos/store";
import { FluidEngine, type FluidParams, type Glow } from "@/lib/fluid/engine";

type RGB = [number, number, number];

let grab: (() => void) | null = null;

export function captureCosmos() {
  grab?.();
}

/** One CSS inch. The stir brush reaches about two of them. */
const CSS_INCH = 96;
const STIR_REACH = 2 * CSS_INCH;

/** Center-gate hit radius and re-arm distance, in score pixels. */
const HIT_RADIUS = 14;
/** Chladni plate radius for notes, and the smaller voice plate, in score pixels. */
const PLATE = 170;
/** How many plate radii a note's figure reaches before fading into the field. */
const NOTE_SPREAD = 2.6;
const VOICE_PLATE = 150;
const REARM = 96;

function hexRgb(hex: string): RGB {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function hslRgb(h: number, sat: number, l: number): RGB {
  const a = sat * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h * 12) % 12;
    return l - a * Math.max(Math.min(k - 3, 9 - k, 1), -1);
  };
  return [f(0), f(8), f(4)];
}

function closestToCenter(x0: number, y0: number, x1: number, y1: number) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 1e-8) t = Math.max(0, Math.min(1, ((400 - x0) * dx + (300 - y0) * dy) / len2));
  return Math.hypot(x0 + dx * t - 400, y0 + dy * t - 300);
}

/** Chladni mode for a note: pitch class picks the figure, octave adds a ring. */
const MODES: Array<[number, number]> = [
  [1, 3], [2, 3], [1, 4], [2, 5], [3, 4], [1, 5], [3, 5], [2, 7], [4, 5], [3, 7], [1, 6], [4, 7],
];
function modeFor(note: string) {
  const midi = noteToMidi(note);
  const [a, b] = MODES[((midi % 12) + 12) % 12];
  const lift = Math.max(0, Math.min(2, Math.floor(midi / 12) - 4));
  return { n: a + lift, m: b + lift, sign: midi % 2 === 0 ? 1 : -1 };
}

/**
 * Where the 800×600 score sits on screen. Landscape keeps the original
 * orientation; a tall phone turns the score upright so it fills the glass.
 */
function layoutFor(w: number, h: number) {
  const portrait = h > w * 1.15;
  const topPad = portrait ? 96 : 104;
  const bottomPad = portrait ? 150 : 96;
  const availH = Math.max(120, h - topPad - bottomPad);
  const s = portrait ? Math.min((w - 24) / 640, availH / 820) : Math.min((w - 48) / 820, availH / 620);
  const cx = w / 2;
  const cy = topPad + availH / 2;
  return { w, h, s, cx, cy, portrait };
}
type Layout = ReturnType<typeof layoutFor>;

function toScreen(L: Layout, x: number, y: number) {
  if (L.portrait) return { x: L.cx + (y - 300) * L.s, y: L.cy + (x - 400) * L.s };
  return { x: L.cx + (x - 400) * L.s, y: L.cy + (y - 300) * L.s };
}

function fluidParams(medium: "smoke" | "ink", prayer: boolean, fade: number, width: number): FluidParams {
  const quality = width < 760 ? "low" : "medium";
  if (medium === "ink") {
    return {
      dissipation: 0.1 + fade * 0.9,
      velocityDissipation: 0.35,
      vorticity: 14,
      buoyancy: 0,
      ambient: 7,
      swirl: 10,
      motion: 1,
      maxVelocity: 150,
      exposure: 1.05,
      view: "dye",
      quality,
    };
  }
  return {
    dissipation: 0.25 + fade * 1.6,
    velocityDissipation: prayer ? 0.55 : 0.7,
    vorticity: prayer ? 5 : 7,
    buoyancy: prayer ? 3 : 7,
    ambient: prayer ? 7 : 10,
    swirl: prayer ? 16 : 10,
    motion: 1,
    maxVelocity: 150,
    exposure: 1.0,
    view: "dye",
    quality,
  };
}

interface OrbState {
  sig: string;
  prev: { x: number; y: number } | null;
  prevScreen: { x: number; y: number } | null;
  armed: boolean;
  flash: number;
  pos: { x: number; y: number };
}

interface Ring {
  t: number;
  color: string;
}

interface Label {
  t: number;
  text: string;
  color: string;
}

interface Imprint {
  t: number;
  glow: Omit<Glow, "x" | "y" | "radius" | "intensity">;
}

export function Stage() {
  const fluidRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const fluidCanvas = fluidRef.current;
    const overlay = overlayRef.current;
    if (!fluidCanvas || !overlay) return;
    const ctx = overlay.getContext("2d");
    if (!ctx) return;

    let engine: FluidEngine;
    try {
      const s0 = useCosmos.getState();
      engine = new FluidEngine(fluidCanvas, fluidParams(s0.medium, s0.prayer, s0.fade, fluidCanvas.clientWidth || 1200));
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "The smoke field could not start.");
      return;
    }

    let L = layoutFor(window.innerWidth, window.innerHeight);
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    const pathsLayer = document.createElement("canvas");
    let pathsSig = "";

    const resize = () => {
      const w = overlay.clientWidth;
      const h = overlay.clientHeight;
      if (w < 2 || h < 2) return;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      overlay.width = Math.round(w * dpr);
      overlay.height = Math.round(h * dpr);
      pathsLayer.width = overlay.width;
      pathsLayer.height = overlay.height;
      L = layoutFor(w, h);
      pathsSig = "";
      const c = toScreen(L, 400, 300);
      engine.center = [c.x / w, 1 - c.y / h];
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(overlay);

    const uvOf = (p: { x: number; y: number }) => ({ x: p.x / L.w, y: 1 - p.y / L.h });

    // A soft first breath of smoke, dim enough that empty dye stays black.
    const seed = () => {
      const c = engine.center;
      const sig = 0.07;
      engine.splat(c[0] - 0.22, c[1] + 0.05, 0.05, 0.02, [0.05, 0.3, 0.33], sig);
      engine.splat(c[0] + 0.24, c[1] - 0.06, -0.05, 0.02, [0.4, 0.18, 0.04], sig);
      engine.splat(c[0] + 0.02, c[1] - 0.24, 0.0, 0.04, [0.3, 0.24, 0.08], sig * 0.8);
    };
    seed();

    const orbs: OrbState[] = Array.from({ length: 12 }, () => ({
      sig: "",
      prev: null,
      prevScreen: null,
      armed: true,
      flash: 0,
      pos: { x: 400, y: 300 },
    }));
    const rings: Ring[] = [];
    const labels: Label[] = [];
    const imprints: Imprint[] = [];
    let beats = 0;
    let wasPlaying = false;
    let clock = 0;
    let last = 0;
    let alive = true;
    let gateFlash = 0;
    let voiceImprintAt = 0;
    let strum = 0;

    // ---- stirring --------------------------------------------------------
    const pointers = new Map<number, { x: number; y: number; t: number; color: RGB }>();
    let colorCursor = 0;
    const stirColor = (): RGB => {
      const tracks = useCosmos.getState().tracks.filter((t) => t.active);
      const hex = tracks[colorCursor % Math.max(tracks.length, 1)]?.color ?? "#4ecdc4";
      colorCursor += 1;
      return hexRgb(hex);
    };
    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("[data-chrome]")) return;
      const color = stirColor();
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), color });
      // A touch alone leaves a two-inch bloom, even without dragging.
      const sigma = STIR_REACH / 1.4 / L.h;
      engine.splat(e.clientX / L.w, 1 - e.clientY / L.h, 0, 0, [color[0] * 0.7, color[1] * 0.7, color[2] * 0.7], sigma);
    };
    const onMove = (e: PointerEvent) => {
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const now = performance.now();
      const dt = Math.max(0.008, (now - prev.t) / 1000);
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (Math.hypot(dx, dy) < 1.5) return;
      const sigma = STIR_REACH / 1.4 / L.h;
      const k = 0.9;
      // Ink follows distance dragged, not event rate, so a long stir paints
      // a ribbon instead of flooding the field.
      const ink = 0.3 * Math.min(1, Math.hypot(dx, dy) / (STIR_REACH * 0.35));
      engine.splat(
        e.clientX / L.w,
        1 - e.clientY / L.h,
        (dx / L.w / dt) * k,
        (-dy / L.h / dt) * k,
        [prev.color[0] * ink, prev.color[1] * ink, prev.color[2] * ink],
        sigma,
      );
      pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, t: now, color: prev.color });
    };
    const onUp = (e: PointerEvent) => {
      pointers.delete(e.pointerId);
    };
    fluidCanvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    // ---- drawing ---------------------------------------------------------
    const drawPaths = (tracks: Track[]) => {
      const sig = `${L.w}x${L.h}|` + tracks.map((t) => `${t.active ? 1 : 0}${t.path}${t.color}`).join("|");
      if (sig === pathsSig) return;
      pathsSig = sig;
      const g = pathsLayer.getContext("2d");
      if (!g) return;
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, pathsLayer.width, pathsLayer.height);
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.globalCompositeOperation = "lighter";
      g.lineJoin = "round";
      for (const track of tracks) {
        if (!track.active) continue;
        g.beginPath();
        for (let i = 0; i <= 480; i++) {
          const p = pointOnPath(i / 480, track.path);
          const s = toScreen(L, p.x, p.y);
          if (i === 0) g.moveTo(s.x, s.y);
          else g.lineTo(s.x, s.y);
        }
        g.strokeStyle = track.color;
        g.globalAlpha = 0.07;
        g.lineWidth = 7;
        g.stroke();
        g.globalAlpha = 0.42;
        g.lineWidth = 1.15;
        g.stroke();
      }
      g.globalAlpha = 1;
    };

    const strokePath = (track: Track, alpha: number, width: number) => {
      ctx.beginPath();
      for (let i = 0; i <= 240; i++) {
        const p = pointOnPath(i / 240, track.path);
        const s = toScreen(L, p.x, p.y);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      }
      ctx.strokeStyle = track.color;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = width;
      ctx.stroke();
      ctx.globalAlpha = 1;
    };

    const drawOverlay = (tracks: Track[], playing: boolean) => {
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, overlay.width, overlay.height);
      drawPaths(tracks);
      ctx.drawImage(pathsLayer, 0, 0);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.globalCompositeOperation = "lighter";

      tracks.forEach((track, i) => {
        const o = orbs[i];
        if (track.active && o.flash > 0.02) strokePath(track, o.flash * 0.55, 1.6 + o.flash * 1.6);
      });

      const gate = toScreen(L, 400, 300);
      const breathe = ear.smoothed * 30;
      const gr = (12 + breathe) * Math.max(L.s, 0.6);
      ctx.strokeStyle = `rgba(255, 238, 205, ${0.3 + gateFlash * 0.5})`;
      ctx.lineWidth = 1 + gateFlash * 1.5;
      ctx.beginPath();
      ctx.arc(gate.x, gate.y, gr, 0, Math.PI * 2);
      ctx.stroke();
      for (let k = 0; k < 4; k++) {
        const a = (k * Math.PI) / 2 + Math.PI / 4;
        ctx.beginPath();
        ctx.moveTo(gate.x + Math.cos(a) * (gr + 4), gate.y + Math.sin(a) * (gr + 4));
        ctx.lineTo(gate.x + Math.cos(a) * (gr + 10), gate.y + Math.sin(a) * (gr + 10));
        ctx.stroke();
      }
      const core = ctx.createRadialGradient(gate.x, gate.y, 0, gate.x, gate.y, gr * 2.4);
      core.addColorStop(0, `rgba(255, 244, 222, ${0.18 + gateFlash * 0.5})`);
      core.addColorStop(1, "rgba(255, 244, 222, 0)");
      ctx.fillStyle = core;
      ctx.beginPath();
      ctx.arc(gate.x, gate.y, gr * 2.4, 0, Math.PI * 2);
      ctx.fill();

      for (const r of rings) {
        const k = Math.min(1, (clock - r.t) / 1.5);
        const ease = 1 - (1 - k) ** 3;
        ctx.strokeStyle = r.color;
        ctx.globalAlpha = (1 - k) * 0.75;
        ctx.lineWidth = 2.2 * (1 - k) + 0.4;
        ctx.beginPath();
        ctx.arc(gate.x, gate.y, (16 + ease * 230) * L.s, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;

      tracks.forEach((track, i) => {
        if (!track.active) return;
        const o = orbs[i];
        const s = toScreen(L, o.pos.x, o.pos.y);
        const scale = Math.max(L.s, 0.55);
        const glowR = (24 + o.flash * 26) * scale;
        const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, glowR);
        g.addColorStop(0, track.color);
        g.addColorStop(0.25, `${track.color}88`);
        g.addColorStop(1, `${track.color}00`);
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(s.x, s.y, glowR, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = `rgba(255,255,255,${0.75 + o.flash * 0.25})`;
        ctx.beginPath();
        ctx.arc(s.x, s.y, (3.2 + o.flash * 2) * scale, 0, Math.PI * 2);
        ctx.fill();
      });

      ctx.globalCompositeOperation = "source-over";
      ctx.textAlign = "center";
      ctx.font = "500 13px Outfit, system-ui, sans-serif";
      for (const lab of labels) {
        const k = Math.min(1, (clock - lab.t) / 1.4);
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.fillStyle = lab.color;
        ctx.fillText(lab.text, gate.x, gate.y - (34 + k * 26) * Math.max(L.s, 0.7));
      }
      ctx.globalAlpha = 1;
      void playing;
    };

    // ---- the instrument ---------------------------------------------------
    const sound = (track: Track, index: number, o: OrbState, velScreen: { x: number; y: number }) => {
      // Voices landing on the same frame are strummed a few ms apart, so
      // their attacks do not stack into one hard transient.
      triggerNote(track.note, track.volume + 0.12, strum * 0.012);
      strum += 1;
      o.flash = 1;
      gateFlash = Math.min(1, gateFlash + 0.7);
      rings.push({ t: clock, color: track.color });
      labels.push({ t: clock, text: track.note, color: track.color });
      if (rings.length > 16) rings.shift();
      if (labels.length > 8) labels.shift();

      const rgb = hexRgb(track.color);
      const gate = uvOf(toScreen(L, 400, 300));
      const mode = modeFor(track.note);
      const rotation = index * 0.2618;
      // The plate reaches out across the orbits, not just the gate.
      const plate = (PLATE * L.s) / L.h;
      engine.pattern({
        x: gate.x,
        y: gate.y,
        radius: plate,
        n: mode.n,
        m: mode.m,
        rotation,
        amount: 0.42 * mode.sign,
        color: rgb,
        spread: NOTE_SPREAD,
      });
      const speed = Math.hypot(velScreen.x, velScreen.y) || 1;
      engine.splat(
        gate.x,
        gate.y,
        (velScreen.x / L.w) * 0.35,
        (-velScreen.y / L.h) * 0.35,
        [rgb[0] * 0.6, rgb[1] * 0.6, rgb[2] * 0.6],
        (26 * L.s) / L.h,
      );
      void speed;
      // A soft outward breath carries the pressed figure into the field.
      for (let k = 0; k < 8; k++) {
        if (engine.splatRoom <= 2) break;
        const ang = rotation + (k / 8) * Math.PI * 2;
        const r0 = plate * 0.7;
        engine.splat(
          gate.x + (Math.cos(ang) * r0) / engine.aspect,
          gate.y + Math.sin(ang) * r0,
          (Math.cos(ang) * 0.55) / engine.aspect,
          Math.sin(ang) * 0.55,
          [0, 0, 0],
          plate * 0.4,
        );
      }
      imprints.push({ t: clock, glow: { rotation, n: mode.n, m: mode.m, sign: mode.sign, color: rgb } });
      if (imprints.length > 5) imprints.shift();
    };

    const loop = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.05, last ? (now - last) / 1000 : 0.016);
      last = now;
      clock += dt;
      strum = 0;
      sampleEar();
      const state = useCosmos.getState();
      const params = fluidParams(state.medium, state.prayer, state.fade, overlay.clientWidth || 1200);
      params.view = state.curl ? "vorticity" : "dye";
      params.motion = state.tempo / 96;
      engine.setParams(params);

      // Ambient emitters keep the smoke alive before and during play.
      const motion = Math.min(2.2, Math.max(0.3, state.tempo / 96));
      const c = engine.center;
      const a = clock * 0.07 * motion;
      const warm: RGB = state.prayer ? [0.55, 0.38, 0.08] : [0.55, 0.24, 0.05];
      const cool: RGB = state.prayer ? [0.1, 0.2, 0.55] : [0.05, 0.36, 0.4];
      const emit = (state.playing ? 0.012 : 0.02) * (dt * 60);
      const rE = 0.34;
      const e1 = { x: c[0] + Math.cos(a) * rE * 0.9 / engine.aspect * 1.6, y: c[1] + Math.sin(a) * rE * 0.8 };
      const e2 = { x: c[0] - Math.cos(a) * rE * 0.9 / engine.aspect * 1.6, y: c[1] - Math.sin(a) * rE * 0.8 };
      engine.splat(e1.x, e1.y, -Math.sin(a) * 0.05, Math.cos(a) * 0.05, [cool[0] * emit, cool[1] * emit, cool[2] * emit], 0.045);
      engine.splat(e2.x, e2.y, Math.sin(a) * 0.05, -Math.cos(a) * 0.05, [warm[0] * emit, warm[1] * emit, warm[2] * emit], 0.045);

      if (state.playing && !wasPlaying) {
        // Resume or first press: nothing jumps, and voices sitting on the
        // gate at the downbeat sound together.
        orbs.forEach((o) => {
          o.prev = null;
        });
      }
      wasPlaying = state.playing;
      if (state.playing) beats += (dt * state.tempo) / 60;

      const activeCount = state.tracks.filter((t) => t.active).length;
      const subMax = activeCount > 8 ? 2 : 3;

      state.tracks.forEach((track, index) => {
        const o = orbs[index];
        o.flash = Math.max(0, o.flash - dt * 2.2);
        if (!track.active) {
          o.prev = null;
          o.prevScreen = null;
          o.sig = "";
          return;
        }
        const sig = `${track.path}|${track.rhythm}`;
        const progress = (beats / Math.max(track.rhythm, 1)) % 1;
        const p = pointOnPath(progress, track.path);
        o.pos = p;
        const screen = toScreen(L, p.x, p.y);
        const distCenter = Math.hypot(p.x - 400, p.y - 300);

        if (sig !== o.sig) {
          // A changed path must not read as a jump across the gate.
          o.sig = sig;
          o.prev = { ...p };
          o.prevScreen = screen;
          o.armed = distCenter > REARM;
          return;
        }
        if (!state.playing) {
          o.prevScreen = screen;
          return;
        }

        const prev = o.prev ?? p;
        const prevScreen = o.prevScreen ?? screen;
        const velScreen = { x: (screen.x - prevScreen.x) / dt, y: (screen.y - prevScreen.y) / dt };
        const approach = closestToCenter(prev.x, prev.y, p.x, p.y);
        if (o.armed && approach <= HIT_RADIUS) {
          o.armed = false;
          sound(track, index, o, velScreen);
        }
        if (distCenter > REARM) o.armed = true;

        // The orb is the dye source: a thin comet of its own color.
        const moved = Math.hypot(screen.x - prevScreen.x, screen.y - prevScreen.y);
        const sigmaPx = 9 * Math.max(L.s, 0.6);
        const steps = Math.max(1, Math.min(subMax, Math.ceil(moved / (sigmaPx * 1.2))));
        const rgb = hexRgb(track.color);
        const amount = (0.22 * (dt * 60)) / steps;
        const wake = 0.22;
        for (let k = 1; k <= steps; k++) {
          if (engine.splatRoom <= 4) break;
          const f = k / steps;
          const sx = prevScreen.x + (screen.x - prevScreen.x) * f;
          const sy = prevScreen.y + (screen.y - prevScreen.y) * f;
          engine.splat(
            sx / L.w,
            1 - sy / L.h,
            (velScreen.x / L.w) * wake,
            (-velScreen.y / L.h) * wake,
            [rgb[0] * amount, rgb[1] * amount, rgb[2] * amount],
            sigmaPx / L.h,
          );
        }
        o.prev = { ...p };
        o.prevScreen = screen;
      });

      // Voice: a breathing swirl at the gate, and the sung pitch drawn as a plate.
      const gateUv = uvOf(toScreen(L, 400, 300));
      const plateR = (PLATE * L.s) / L.h;
      const voiceR = (VOICE_PLATE * L.s) / L.h;
      const glows: Glow[] = [];
      const amp = ear.smoothed * state.voice;
      if (ear.listening && amp > 0.035) {
        // Your pitch picks the color: the twelve notes walk the color wheel.
        let voiceRgb: RGB = [0.72, 0.82, 1.0];
        let midi = -1;
        if (ear.pitch > 0) {
          midi = Math.round(12 * Math.log2(ear.pitch / 440) + 69);
          voiceRgb = hslRgb((((midi % 12) + 12) % 12) / 12, 0.75, 0.6);
        }
        if (state.prayer) voiceRgb = [voiceRgb[0] * 0.4 + 0.6, voiceRgb[1] * 0.4 + 0.45, voiceRgb[2] * 0.4 + 0.12];

        // Ten jets ring the center, one per voice band from low to high. The
        // shape of the sound decides which jets blow; loudness decides how hard.
        const jets = ear.bands.length;
        const spin = clock * 0.35;
        for (let k = 0; k < jets; k++) {
          const band = ear.bands[k];
          const push = band * amp;
          if (push < 0.02 || engine.splatRoom <= 1) continue;
          const ang = spin + (k / jets) * Math.PI * 2;
          const dx = Math.cos(ang);
          const dy = Math.sin(ang);
          const r0 = voiceR * 0.3;
          const speed = 0.35 + push * 2.2;
          const ink = Math.min(0.5, push * 0.55);
          engine.splat(
            gateUv.x + (dx * r0) / engine.aspect,
            gateUv.y + dy * r0,
            (dx * speed) / engine.aspect,
            dy * speed,
            [voiceRgb[0] * ink, voiceRgb[1] * ink, voiceRgb[2] * ink],
            voiceR * (0.12 + push * 0.12),
          );
        }
        // A soft glow of breath at the very center.
        const core = Math.min(0.3, amp * 0.25);
        engine.splat(gateUv.x, gateUv.y, 0, 0, [voiceRgb[0] * core, voiceRgb[1] * core, voiceRgb[2] * core], voiceR * 0.22);

        if (midi >= 0) {
          const [ma, mb] = MODES[((midi % 12) + 12) % 12];
          const lift = Math.max(0, Math.min(2, Math.floor(midi / 12) - 3));
          const vg: Glow = {
            x: gateUv.x,
            y: gateUv.y,
            radius: voiceR * 1.6,
            rotation: 0,
            n: ma + lift,
            m: mb + lift,
            sign: midi % 2 === 0 ? 1 : -1,
            intensity: Math.min(0.9, amp * 2),
            color: voiceRgb,
          };
          glows.push(vg);
          if (clock - voiceImprintAt > 0.35 && amp > 0.08) {
            voiceImprintAt = clock;
            engine.pattern({ ...vg, amount: 0.3 * vg.sign, radius: vg.radius });
          }
        }
      }
      if (state.prayer) listenForPrayer();

      for (let i = imprints.length - 1; i >= 0; i--) {
        const age = clock - imprints[i].t;
        if (age > 2.2) {
          imprints.splice(i, 1);
          continue;
        }
        const k = age / 2.2;
        glows.push({
          ...imprints[i].glow,
          x: gateUv.x,
          y: gateUv.y,
          radius: plateR,
          spread: NOTE_SPREAD * (0.6 + k * 0.9),
          intensity: (1 - k) ** 2 * 0.9,
        });
      }
      engine.setGlows(glows);

      while (rings.length && clock - rings[0].t > 1.6) rings.shift();
      while (labels.length && clock - labels[0].t > 1.5) labels.shift();
      gateFlash = Math.max(0, gateFlash - dt * 2.5);

      engine.step(dt);
      drawOverlay(state.tracks, state.playing);
      requestAnimationFrame(loop);
    };
    const raf = requestAnimationFrame(loop);

    grab = () => {
      const shot = document.createElement("canvas");
      shot.width = fluidCanvas.width;
      shot.height = fluidCanvas.height;
      const g = shot.getContext("2d");
      if (!g) return;
      g.drawImage(fluidCanvas, 0, 0);
      g.drawImage(overlay, 0, 0, shot.width, shot.height);
      shot.toBlob((blob) => {
        if (!blob) return;
        const link = document.createElement("a");
        link.download = `cymatic-cosmos-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.png`;
        link.href = URL.createObjectURL(blob);
        link.click();
        URL.revokeObjectURL(link.href);
      });
    };

    return () => {
      alive = false;
      cancelAnimationFrame(raf);
      grab = null;
      observer.disconnect();
      fluidCanvas.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      engine.destroy();
    };
  }, []);

  return (
    <>
      <canvas
        ref={fluidRef}
        className="absolute inset-0 size-full touch-none"
        aria-label="Smoke field. Drag to stir; the orbits leave their own colored trails."
      />
      <canvas ref={overlayRef} className="pointer-events-none absolute inset-0 size-full" />
      {failed ? (
        <p className="absolute inset-x-0 bottom-24 z-20 px-6 text-center text-sm text-gold">{failed}</p>
      ) : null}
    </>
  );
}
