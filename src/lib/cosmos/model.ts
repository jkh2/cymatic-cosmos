export type Track = {
  id: number;
  rhythm: number;
  active: boolean;
  note: string;
  volume: number;
  color: string;
  path: number;
};

export type Preset = {
  name: string;
  version: string;
  created: string;
  settings: {
    tempo: number;
    voiceInfluence: number;
    prayerMode: boolean;
    tracks: Track[];
  };
};

export const PATHS = [
  { id: 0, name: "Figure-8" },
  { id: 1, name: "Horizontal" },
  { id: 2, name: "Vertical" },
  { id: 3, name: "Infinity" },
  { id: 4, name: "Spiral" },
  { id: 5, name: "Rose" },
] as const;

export const NOTES = [
  "G3",
  "A3",
  "B3",
  "C4",
  "D4",
  "E4",
  "F4",
  "G4",
  "A4",
  "B4",
  "C5",
  "D5",
  "E5",
  "F5",
] as const;

export const ORIGINAL_COLORS = [
  "#ff6b6b",
  "#4ecdc4",
  "#45b7d1",
  "#96ceb4",
  "#ffd93d",
  "#ff9ff3",
  "#a8e6cf",
  "#ffaaa5",
  "#ff8b94",
  "#b4a7d6",
  "#d4a574",
  "#85dcb0",
];

export const SACRED_COLORS = [
  "#ffd700",
  "#ffa500",
  "#87ceeb",
  "#dda0dd",
  "#f0e68c",
  "#add8e6",
  "#daa520",
  "#cd853f",
  "#b0c4de",
  "#dda0dd",
  "#f5deb3",
  "#98fb98",
];

export const PRESET_KEY = "cymaticPresets";

export function createTracks(): Track[] {
  return [
    { id: 1, rhythm: 4, active: true, note: "C4", volume: 0.25, color: ORIGINAL_COLORS[0], path: 0 },
    { id: 2, rhythm: 3, active: true, note: "E4", volume: 0.25, color: ORIGINAL_COLORS[1], path: 1 },
    { id: 3, rhythm: 5, active: true, note: "G4", volume: 0.25, color: ORIGINAL_COLORS[2], path: 2 },
    { id: 4, rhythm: 7, active: true, note: "B4", volume: 0.25, color: ORIGINAL_COLORS[3], path: 3 },
    { id: 5, rhythm: 6, active: false, note: "D5", volume: 0.2, color: ORIGINAL_COLORS[4], path: 0 },
    { id: 6, rhythm: 8, active: false, note: "F4", volume: 0.2, color: ORIGINAL_COLORS[5], path: 1 },
    { id: 7, rhythm: 9, active: false, note: "A4", volume: 0.2, color: ORIGINAL_COLORS[6], path: 2 },
    { id: 8, rhythm: 11, active: false, note: "C5", volume: 0.2, color: ORIGINAL_COLORS[7], path: 3 },
    { id: 9, rhythm: 2, active: false, note: "G3", volume: 0.3, color: ORIGINAL_COLORS[8], path: 4 },
    { id: 10, rhythm: 13, active: false, note: "E5", volume: 0.15, color: ORIGINAL_COLORS[9], path: 5 },
    { id: 11, rhythm: 10, active: false, note: "D4", volume: 0.2, color: ORIGINAL_COLORS[10], path: 4 },
    { id: 12, rhythm: 12, active: false, note: "F5", volume: 0.15, color: ORIGINAL_COLORS[11], path: 5 },
  ];
}

/** Original parametric curves, in the 800×600 score they were drawn on. */
export function pointOnPath(progress: number, pathIndex: number) {
  const cx = 400;
  const cy = 300;
  const w = 300;
  const h = 150;
  const t = progress;
  switch (pathIndex % 6) {
    case 0:
      return { x: cx + w * Math.sin(t * Math.PI * 2), y: cy + h * Math.sin(t * Math.PI * 4) };
    case 1:
      return { x: cx + w * Math.sin(t * Math.PI * 2), y: cy + h * 0.6 * Math.sin(t * Math.PI * 2) };
    case 2:
      return { x: cx + w * 0.7 * Math.sin(t * Math.PI * 2), y: cy + h * Math.sin(t * Math.PI * 4) };
    case 3:
      return {
        x: cx + (w * Math.cos(t * Math.PI * 2)) / (1 + Math.sin(t * Math.PI * 2) ** 2),
        y: cy + (h * Math.sin(t * Math.PI * 2) * Math.cos(t * Math.PI * 2)) / (1 + Math.sin(t * Math.PI * 2) ** 2),
      };
    case 4:
      return {
        x: cx + w * 0.8 * Math.sin(t * Math.PI * 6) * (0.3 + 0.7 * Math.sin(t * Math.PI * 2)),
        y: cy + h * 0.8 * Math.cos(t * Math.PI * 6) * (0.3 + 0.7 * Math.sin(t * Math.PI * 2)),
      };
    default:
      return {
        x: cx + w * 0.9 * Math.sin(3 * t * Math.PI * 2) * Math.cos(t * Math.PI * 2),
        y: cy + h * 0.9 * Math.sin(3 * t * Math.PI * 2) * Math.sin(t * Math.PI * 2),
      };
  }
}

const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiToNote(midi: number) {
  const n = Math.round(midi);
  const name = NAMES[((n % 12) + 12) % 12];
  const oct = Math.floor(n / 12) - 1;
  return `${name}${oct}`;
}

export function isPreset(value: unknown): value is Preset {
  if (!value || typeof value !== "object") return false;
  const settings = (value as Preset).settings;
  return !!settings && typeof settings.tempo === "number" && Array.isArray(settings.tracks);
}
