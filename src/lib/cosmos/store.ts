import { create } from "zustand";
import { ear, ensureAudio, releaseVoices, startMic, stopMic } from "./audio";
import {
  ORIGINAL_COLORS,
  PRESET_KEY,
  SACRED_COLORS,
  createTracks,
  isPreset,
  type Preset,
  type Track,
} from "./model";

export type MediumName = "smoke" | "ink";

let colorMemory: string[] | null = null;
let noticeTimer: ReturnType<typeof setTimeout> | undefined;
let arming = false;

export const useCosmos = create<{
  playing: boolean;
  tempo: number;
  voice: number;
  mic: boolean;
  micError: string | null;
  prayer: boolean;
  medium: MediumName;
  curl: boolean;
  fade: number;
  tracks: Track[];
  panelOpen: boolean;
  notice: string | null;
  setTempo: (n: number) => void;
  setVoice: (n: number) => void;
  togglePlay: () => Promise<void>;
  toggleMic: () => Promise<void>;
  togglePrayer: () => void;
  toggleMedium: () => void;
  toggleCurl: () => void;
  setFade: (n: number) => void;
  togglePanel: () => void;
  updateTrack: (id: number, patch: Partial<Track>) => void;
  setEnsemble: (mode: "quartet" | "all") => void;
  savePreset: (name: string) => void;
  loadPreset: (preset: Preset) => void;
  flash: (message: string) => void;
}>((set, get) => ({
  playing: false,
  tempo: 96,
  voice: 0.8,
  mic: false,
  micError: null,
  prayer: false,
  medium: "smoke",
  curl: false,
  fade: 0.45,
  tracks: createTracks(),
  panelOpen: false,
  notice: null,
  setTempo: (tempo) => set({ tempo }),
  setVoice: (voice) => set({ voice }),
  togglePlay: async () => {
    if (arming) return;
    if (get().playing) {
      releaseVoices();
      set({ playing: false });
      return;
    }
    arming = true;
    try {
      await ensureAudio();
      set({ playing: true, micError: null });
    } catch {
      set({ notice: "The browser held the sound back." });
    } finally {
      arming = false;
    }
  },
  toggleMic: async () => {
    if (get().mic) {
      stopMic();
      set({ mic: false });
      return;
    }
    try {
      await startMic();
      set({ mic: true, micError: null });
    } catch {
      set({ mic: false, micError: "Microphone stayed closed." });
    }
  },
  togglePrayer: () => {
    const s = get();
    if (!s.prayer) {
      colorMemory = s.tracks.map((t) => t.color);
      set({
        prayer: true,
        tempo: s.tempo > 60 ? 40 : s.tempo,
        tracks: s.tracks.map((t, i) => ({ ...t, color: SACRED_COLORS[i] ?? t.color })),
      });
      return;
    }
    const restore = colorMemory;
    colorMemory = null;
    set({
      prayer: false,
      tracks: s.tracks.map((t, i) => ({ ...t, color: restore?.[i] ?? ORIGINAL_COLORS[i] ?? t.color })),
    });
  },
  toggleMedium: () => set((s) => ({ medium: s.medium === "smoke" ? "ink" : "smoke" })),
  toggleCurl: () => set((s) => ({ curl: !s.curl })),
  setFade: (fade) => set({ fade }),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  updateTrack: (id, patch) =>
    set((s) => ({
      tracks: s.tracks.map((t) => (t.id === id ? { ...t, ...patch } : t)),
    })),
  setEnsemble: (mode) =>
    set((s) => ({
      tracks: s.tracks.map((t) => ({ ...t, active: mode === "all" ? true : t.id <= 4 })),
    })),
  flash: (message) => {
    if (noticeTimer) clearTimeout(noticeTimer);
    set({ notice: message });
    noticeTimer = setTimeout(() => set({ notice: null }), 3200);
  },
  savePreset: (name) => {
    const s = get();
    const preset: Preset = {
      name,
      version: "1.0",
      created: new Date().toISOString(),
      settings: {
        tempo: s.tempo,
        voiceInfluence: s.voice,
        prayerMode: s.prayer,
        tracks: s.tracks.map((t) => ({ ...t })),
      },
    };
    const saved = readPresets();
    saved.unshift(preset);
    localStorage.setItem(PRESET_KEY, JSON.stringify(saved.slice(0, 10)));
    const blob = new Blob([JSON.stringify(preset, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.download = `${name.replace(/[^a-z0-9]+/gi, "-").toLowerCase() || "preset"}.json`;
    link.href = URL.createObjectURL(blob);
    link.click();
    URL.revokeObjectURL(link.href);
    get().flash(`Saved “${name}”.`);
  },
  loadPreset: (preset) => {
    if (!isPreset(preset)) {
      get().flash("That file is not a cosmos preset.");
      return;
    }
    colorMemory = null;
    set({
      tempo: preset.settings.tempo || 96,
      voice: preset.settings.voiceInfluence ?? 0.8,
      prayer: !!preset.settings.prayerMode,
      tracks: createTracks().map((track) => {
        const saved = preset.settings.tracks.find((t) => t.id === track.id);
        return saved ? { ...track, ...saved, id: track.id } : track;
      }),
    });
    get().flash(`Loaded “${preset.name}”.`);
  },
}));

export function readPresets(): Preset[] {
  try {
    const raw = JSON.parse(localStorage.getItem(PRESET_KEY) || "[]") as unknown;
    return Array.isArray(raw) ? raw.filter(isPreset) : [];
  } catch {
    return [];
  }
}

export function voiceLevel() {
  return ear.smoothed;
}
