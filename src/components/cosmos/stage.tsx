import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { ear, listenForPrayer, sampleEar, triggerNote } from "@/lib/cosmos/audio";
import { pointOnPath } from "@/lib/cosmos/model";
import { useCosmos } from "@/lib/cosmos/store";
import { FluidEngine, type FluidParams } from "@/lib/fluid/engine";

const SPAN = 4.8;

let grab: (() => void) | null = null;

export function captureCosmos() {
  grab?.();
}

function place(x: number, y: number, index: number, target: THREE.Vector3) {
  const elev = (index - 5.5) * 0.1;
  const spin = index * 0.46;
  const y1 = y * Math.cos(elev);
  const z1 = y * Math.sin(elev);
  const cs = Math.cos(spin);
  const sn = Math.sin(spin);
  return target.set(x * cs + z1 * sn, y1, -x * sn + z1 * cs);
}

class OrbitCurve extends THREE.Curve<THREE.Vector3> {
  constructor(
    private pathIndex: number,
    private trackIndex: number,
  ) {
    super();
  }
  override getPoint(t: number, optionalTarget = new THREE.Vector3()) {
    const p = pointOnPath(t, this.pathIndex);
    const x = ((p.x - 400) / 300) * SPAN;
    const y = ((p.y - 300) / 150) * SPAN * 0.5;
    return place(x, y, this.trackIndex, optionalTarget);
  }
}

function hexRgb(hex: string): [number, number, number] {
  const n = Number.parseInt(hex.replace("#", ""), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function glowTexture() {
  const c = document.createElement("canvas");
  c.width = 128;
  c.height = 128;
  const g = c.getContext("2d");
  if (!g) return new THREE.CanvasTexture(c);
  const grd = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grd.addColorStop(0, "rgba(255,255,255,1)");
  grd.addColorStop(0.22, "rgba(255,255,255,0.55)");
  grd.addColorStop(0.55, "rgba(255,255,255,0.08)");
  grd.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function toUV(canvas: HTMLCanvasElement, clientX: number, clientY: number) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (clientX - rect.left) / Math.max(rect.width, 1),
    y: 1 - (clientY - rect.top) / Math.max(rect.height, 1),
  };
}

function fluidParams(medium: "smoke" | "ink", prayer: boolean, width: number): FluidParams {
  const quality = width < 760 ? "low" : "medium";
  if (medium === "ink") {
    return {
      viscosity: 0,
      dissipation: prayer ? 0.03 : 0.05,
      velocityDissipation: 0.09,
      vorticity: 16,
      buoyancy: 0,
      splatForce: 3400,
      splatRadius: 0.34,
      idleFlow: 0.05,
      stretchForce: 0,
      motion: 1,
      paused: false,
      view: "dye",
      quality,
    };
  }
  return {
    viscosity: 0,
    dissipation: prayer ? 0.18 : 0.28,
    velocityDissipation: 0.18,
    vorticity: 6,
    buoyancy: prayer ? 0.4 : 1.2,
    splatForce: 1800,
    splatRadius: 0.32,
    idleFlow: 1.5,
    stretchForce: 0,
    motion: 1,
    paused: false,
    view: "dye",
    quality,
  };
}

function closestOnSegment(x0: number, y0: number, x1: number, y1: number) {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  let t = 0;
  if (len2 > 1e-8) t = Math.max(0, Math.min(1, ((400 - x0) * dx + (300 - y0) * dy) / len2));
  return Math.hypot(x0 + dx * t - 400, y0 + dy * t - 300);
}

export function Stage() {
  const fluidRef = useRef<HTMLCanvasElement>(null);
  const threeRef = useRef<HTMLCanvasElement>(null);
  const [failed, setFailed] = useState<string | null>(null);

  useEffect(() => {
    const fluidCanvas = fluidRef.current;
    const threeCanvas = threeRef.current;
    if (!fluidCanvas || !threeCanvas) return;

    let engine: FluidEngine;
    try {
      engine = new FluidEngine(fluidCanvas, fluidParams("smoke", false, fluidCanvas.clientWidth || 1200));
    } catch (err) {
      setFailed(err instanceof Error ? err.message : "The smoke field could not start.");
      return;
    }

    const renderer = new THREE.WebGLRenderer({
      canvas: threeCanvas,
      alpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
      powerPreference: "high-performance",
    });
    renderer.setClearColor(0x000000, 0);
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.NoToneMapping;

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 80);
    const scratch = new THREE.Vector3();
    const ndc = new THREE.Vector3();
    const tex = glowTexture();

    const ringGeo = new THREE.TorusGeometry(SPAN, 0.012, 8, 160);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xd4b06a,
      transparent: true,
      opacity: 0.28,
      toneMapped: false,
    });
    for (const tilt of [0, Math.PI / 3, -Math.PI / 5]) {
      const ring = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = Math.PI / 2;
      ring.rotation.y = tilt;
      scene.add(ring);
    }

    const orbits = new THREE.Group();
    scene.add(orbits);
    let orbitSig = "";
    const orbitTrash: Array<THREE.BufferGeometry | THREE.Material> = [];

    const orbs = Array.from({ length: 12 }, () => {
      const mesh = new THREE.Mesh(
        new THREE.SphereGeometry(0.11, 18, 14),
        new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }),
      );
      const halo = new THREE.Sprite(
        new THREE.SpriteMaterial({
          map: tex,
          color: 0xffffff,
          transparent: true,
          blending: THREE.AdditiveBlending,
          depthWrite: false,
          toneMapped: false,
        }),
      );
      halo.scale.set(0.85, 0.85, 1);
      mesh.add(halo);
      scene.add(mesh);
      return { mesh, halo };
    });

    const core = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: tex,
        color: 0xd7e6ff,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        toneMapped: false,
      }),
    );
    core.scale.set(1.4, 1.4, 1);
    scene.add(core);

    let yaw = 0.4;
    let pitch = 0.38;
    let dist = 12.2;
    let lookDrag = false;
    let lastX = 0;
    let lastY = 0;
    const pointers = new Map<number, { x: number; y: number; color: [number, number, number] }>();
    const prevUv: Array<{ x: number; y: number } | null> = Array.from({ length: 12 }, () => null);
    const inside = Array.from({ length: 12 }, () => false);
    const prevScore = Array.from({ length: 12 }, () => null as { x: number; y: number } | null);
    let playTime = 0;
    let frame = 0;
    let alive = true;
    let colorCursor = 0;

    const resize = () => {
      const w = fluidCanvas.clientWidth;
      const h = fluidCanvas.clientHeight;
      if (w < 2 || h < 2) return;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.75));
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(fluidCanvas.parentElement ?? fluidCanvas);

    const applyCamera = () => {
      camera.position.set(
        Math.sin(yaw) * Math.cos(pitch) * dist,
        Math.sin(pitch) * dist,
        Math.cos(yaw) * Math.cos(pitch) * dist,
      );
      camera.lookAt(0, 0.15, 0);
    };

    const onDown = (e: PointerEvent) => {
      if ((e.target as HTMLElement).closest("[data-chrome]")) return;
      if (useCosmos.getState().looking) {
        lookDrag = true;
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      const uv = toUV(fluidCanvas, e.clientX, e.clientY);
      const tracks = useCosmos.getState().tracks.filter((t) => t.active);
      const hex = tracks[colorCursor % Math.max(tracks.length, 1)]?.color ?? "#4ecdc4";
      colorCursor += 1;
      pointers.set(e.pointerId, { ...uv, color: hexRgb(hex) });
    };
    const onMove = (e: PointerEvent) => {
      if (lookDrag) {
        yaw -= (e.clientX - lastX) * 0.005;
        pitch = Math.min(1.05, Math.max(-0.2, pitch + (e.clientY - lastY) * 0.004));
        lastX = e.clientX;
        lastY = e.clientY;
        return;
      }
      const prev = pointers.get(e.pointerId);
      if (!prev) return;
      const uv = toUV(fluidCanvas, e.clientX, e.clientY);
      engine.splat(uv.x, uv.y, uv.x - prev.x, uv.y - prev.y, prev.color);
      pointers.set(e.pointerId, { ...uv, color: prev.color });
    };
    const onUp = (e: PointerEvent) => {
      lookDrag = false;
      pointers.delete(e.pointerId);
    };
    const onWheel = (e: WheelEvent) => {
      if ((e.target as HTMLElement).closest("[data-chrome]")) return;
      e.preventDefault();
      dist = Math.min(18, Math.max(7, dist + e.deltaY * 0.006));
    };

    fluidCanvas.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    fluidCanvas.addEventListener("wheel", onWheel, { passive: false });

    const rebuildOrbits = () => {
      const tracks = useCosmos.getState().tracks;
      const sig = tracks.map((t) => `${t.active ? 1 : 0}${t.path}${t.color}`).join("|");
      if (sig === orbitSig) return;
      orbitSig = sig;
      for (const child of orbits.children) {
        const mesh = child as THREE.Mesh;
        mesh.geometry.dispose();
        (mesh.material as THREE.Material).dispose();
      }
      orbits.clear();
      tracks.forEach((track, index) => {
        if (!track.active) return;
        const geo = new THREE.TubeGeometry(new OrbitCurve(track.path, index), 150, 0.03, 5, false);
        const mat = new THREE.MeshBasicMaterial({
          color: track.color,
          transparent: true,
          opacity: 0.55,
          toneMapped: false,
        });
        orbits.add(new THREE.Mesh(geo, mat));
        orbitTrash.push(geo, mat);
      });
    };

    const loop = (now: number) => {
      if (!alive) return;
      const dt = Math.min(0.033, frame ? (now - frame) / 1000 : 0.016);
      frame = now;
      sampleEar();
      const state = useCosmos.getState();
      const params = fluidParams(state.medium, state.prayer, fluidCanvas.clientWidth || 1200);
      params.view = state.curl ? "vorticity" : "dye";
      params.motion = state.tempo / 96;
      engine.setParams(params);
      if (!lookDrag && state.playing) yaw += (state.prayer ? 0.08 : 0.12) * dt;
      applyCamera();
      rebuildOrbits();

      if (state.playing) playTime += dt;
      state.tracks.forEach((track, index) => {
        const orb = orbs[index];
        if (!orb) return;
        if (!track.active) {
          orb.mesh.visible = false;
          prevUv[index] = null;
          prevScore[index] = null;
          inside[index] = false;
          return;
        }
        const period = (60 / Math.max(state.tempo, 1)) * track.rhythm;
        const progress = (index * 0.137 + playTime / period) % 1;
        const p = pointOnPath(progress, track.path);
        const x = ((p.x - 400) / 300) * SPAN;
        const y = ((p.y - 300) / 150) * SPAN * 0.5;
        place(x, y, index, scratch);
        orb.mesh.visible = true;
        orb.mesh.position.copy(scratch);
        (orb.mesh.material as THREE.MeshBasicMaterial).color.set(track.color);
        orb.halo.material.color.set(track.color);
        ndc.copy(scratch).project(camera);
        const uv = { x: ndc.x * 0.5 + 0.5, y: ndc.y * 0.5 + 0.5 };
        const prev = prevUv[index];
        if (
          state.playing &&
          prev &&
          ndc.z < 1 &&
          uv.x > 0.02 &&
          uv.x < 0.98 &&
          uv.y > 0.02 &&
          uv.y < 0.98
        ) {
          const rgb = hexRgb(track.color);
          engine.splat(uv.x, uv.y, (uv.x - prev.x) * 0.1, (uv.y - prev.y) * 0.1, rgb, 0.08);
          engine.vortex(uv.x, uv.y, (index % 2 === 0 ? 1 : -1) * 10 * dt, 0.055);
        }
        prevUv[index] = uv;
        const prevPoint = prevScore[index];
        const distCenter = Math.hypot(p.x - 400, p.y - 300);
        const approach = prevPoint ? closestOnSegment(prevPoint.x, prevPoint.y, p.x, p.y) : distCenter;
        prevScore[index] = { x: p.x, y: p.y };
        const crossing = approach <= 48;
        if (state.playing && crossing && !inside[index]) {
          triggerNote(track.note, track.volume + 0.15, index * 0.015);
        }
        if (distCenter > 96) inside[index] = false;
        else if (crossing) inside[index] = true;
      });

      if (ear.smoothed > 0.045) {
        const amp = ear.smoothed * state.voice;
        engine.vortex(0.5, 0.5, 26 * amp, 0.07 + amp * 0.04);
        engine.splat(0.5, 0.5, 0, amp * 0.015, [0.85, 0.9, 1.1], amp * 0.35);
      }
      if (state.prayer) listenForPrayer();

      const pulse = 1.05 + (state.playing ? ear.smoothed * 1.4 + Math.sin(playTime * 1.4) * 0.08 : 0);
      core.scale.setScalar(pulse);
      engine.step(dt);
      renderer.render(scene, camera);
      requestAnimationFrame(loop);
    };
    const raf = requestAnimationFrame(loop);

    grab = () => {
      const shot = document.createElement("canvas");
      shot.width = fluidCanvas.width;
      shot.height = fluidCanvas.height;
      const ctx = shot.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(fluidCanvas, 0, 0);
      ctx.drawImage(threeCanvas, 0, 0, shot.width, shot.height);
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
      fluidCanvas.removeEventListener("wheel", onWheel);
      engine.destroy();
      for (const item of orbitTrash) item.dispose();
      ringGeo.dispose();
      ringMat.dispose();
      tex.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <>
      <canvas
        ref={fluidRef}
        className="absolute inset-0 size-full touch-none"
        aria-label="Smoke field stirred by the orbits. Drag to add ink."
      />
      <canvas ref={threeRef} className="pointer-events-none absolute inset-0 size-full" />
      {failed ? (
        <p className="absolute inset-x-0 bottom-24 z-20 px-6 text-center text-sm text-gold">{failed}</p>
      ) : null}
    </>
  );
}
