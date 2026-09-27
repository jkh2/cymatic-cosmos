import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Camera,
  Droplets,
  Mountain,
  Palette,
  Square,
  RotateCw,
  Mic,
  MicOff,
  Pause,
  Play,
  SlidersHorizontal,
  SunMedium,
  Wind,
} from "lucide-react";
import { captureCosmos } from "@/components/cosmos/stage";
import { ear } from "@/lib/cosmos/audio";
import { NOTES, PATHS, PRESET_KEY, isPreset, type Preset } from "@/lib/cosmos/model";
import { readPresets, useCosmos } from "@/lib/cosmos/store";

function Chip({
  pressed,
  label,
  onClick,
  children,
}: {
  pressed?: boolean;
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={pressed}
      onClick={onClick}
      className={`inline-flex h-10 shrink-0 items-center gap-2 rounded-full border px-3 text-sm font-medium ${
        pressed
          ? "border-gold/80 bg-gold/90 text-void"
          : "border-white/10 bg-white/[0.04] text-ink hover:border-gold/60"
      }`}
    >
      {children}
    </button>
  );
}

/** A ring that swells with your voice, so you can see the mic is hearing you. */
function MicMeter() {
  const ref = useRef<HTMLSpanElement>(null);
  useEffect(() => {
    let raf = 0;
    const tick = () => {
      const el = ref.current;
      if (el) {
        const v = Math.min(1, ear.smoothed * 1.6);
        el.style.transform = `scale(${1 + v * 1.4})`;
        el.style.opacity = String(0.15 + v * 0.85);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);
  return <span ref={ref} aria-hidden className="absolute -inset-1.5 rounded-full border-2 border-void/70" />;
}

function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: Array<{ value: T; text: string; icon: ReactNode; hint: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className="flex h-10 shrink-0 items-center rounded-full border border-white/10 bg-white/[0.04] p-0.5"
    >
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            aria-label={o.hint}
            title={o.hint}
            onClick={() => onChange(o.value)}
            className={`inline-flex h-full items-center gap-1.5 rounded-full px-3 text-sm font-medium transition-colors ${
              on ? "bg-gold/90 text-void" : "text-mist hover:text-ink"
            }`}
          >
            {o.icon}
            <span className="hidden sm:inline">{o.text}</span>
          </button>
        );
      })}
    </div>
  );
}

export function Console() {
  const tempo = useCosmos((s) => s.tempo);
  const voice = useCosmos((s) => s.voice);
  const playing = useCosmos((s) => s.playing);
  const mic = useCosmos((s) => s.mic);
  const micError = useCosmos((s) => s.micError);
  const prayer = useCosmos((s) => s.prayer);
  const medium = useCosmos((s) => s.medium);
  const curl = useCosmos((s) => s.curl);
  const fade = useCosmos((s) => s.fade);
  const relief = useCosmos((s) => s.relief);
  const setRelief = useCosmos((s) => s.setRelief);
  const tracks = useCosmos((s) => s.tracks);
  const panelOpen = useCosmos((s) => s.panelOpen);
  const notice = useCosmos((s) => s.notice);
  const setTempo = useCosmos((s) => s.setTempo);
  const setVoice = useCosmos((s) => s.setVoice);
  const togglePlay = useCosmos((s) => s.togglePlay);
  const toggleMic = useCosmos((s) => s.toggleMic);
  const togglePrayer = useCosmos((s) => s.togglePrayer);
  const toggleMedium = useCosmos((s) => s.toggleMedium);
  const toggleCurl = useCosmos((s) => s.toggleCurl);
  const setFade = useCosmos((s) => s.setFade);
  const togglePanel = useCosmos((s) => s.togglePanel);
  const updateTrack = useCosmos((s) => s.updateTrack);
  const setEnsemble = useCosmos((s) => s.setEnsemble);
  const savePreset = useCosmos((s) => s.savePreset);
  const loadPreset = useCosmos((s) => s.loadPreset);
  const [name, setName] = useState("Quartet in smoke");
  const [presets, setPresets] = useState<Preset[]>([]);

  useEffect(() => {
    setPresets(readPresets());
  }, [notice]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "SELECT" || tag === "TEXTAREA") return;
      if (e.code === "Space") {
        e.preventDefault();
        void togglePlay();
      }
      if (e.key === "Escape") useCosmos.setState({ panelOpen: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay]);

  return (
    <div className="pointer-events-none absolute inset-0 z-10">
      <header data-chrome className="pointer-events-auto absolute top-0 left-0 p-4 md:p-6">
        <h1 className="font-display text-2xl font-medium tracking-tight text-ink md:text-3xl">
          Cymatic <em className="text-gold italic">Cosmos</em>
        </h1>
        <p className="text-xs text-mist md:text-sm">James Keith Harwood II</p>
      </header>
      <div data-chrome className="pointer-events-auto absolute top-4 right-4 md:top-6 md:right-6">
        <Chip label="Capture a picture" onClick={captureCosmos}>
          <Camera size={18} />
          <span className="hidden sm:inline">Capture</span>
        </Chip>
      </div>

      <p
        className={`absolute inset-x-0 bottom-[8.5rem] px-6 text-center text-xs text-mist transition-opacity duration-1000 sm:bottom-32 xl:bottom-24 ${
          playing && !micError && !notice ? "opacity-0" : "opacity-80"
        }`}
      >
        {micError ?? notice ?? "Drag anywhere to stir the smoke. Each orb sounds as it crosses the center."}
      </p>

      <nav
        data-chrome
        aria-label="Instrument controls"
        className="pointer-events-auto absolute inset-x-3 bottom-3 flex flex-wrap items-center justify-center gap-2 rounded-3xl border border-white/10 bg-black/45 p-2 backdrop-blur-md xl:inset-x-auto xl:left-1/2 xl:-translate-x-1/2 xl:flex-nowrap xl:rounded-full"
      >
        <Chip pressed={playing} label={playing ? "Pause" : "Play"} onClick={() => void togglePlay()}>
          {playing ? <Pause size={18} /> : <Play size={18} />}
          <span>{playing ? "Pause" : "Play"}</span>
        </Chip>
        <label className="flex h-10 shrink-0 items-center gap-2 px-2 text-sm text-mist">
          Tempo
          <input
            type="range"
            min={20}
            max={200}
            value={tempo}
            onChange={(e) => setTempo(Number(e.target.value))}
            className="w-20 md:w-28"
          />
          <span className="w-7 text-ink tabular-nums">{tempo}</span>
        </label>
        <label className="flex h-10 shrink-0 items-center gap-2 px-2 text-sm text-mist" title="How fast the smoke fades">
          Fade
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={fade}
            onChange={(e) => setFade(Number(e.target.value))}
            className="w-16 md:w-24"
          />
        </label>
        <Chip pressed={panelOpen} label="Voices" onClick={togglePanel}>
          <SlidersHorizontal size={18} />
          <span>Voices</span>
        </Chip>
        <Segmented
          label="Medium"
          value={medium}
          onChange={(v) => {
            if (v !== medium) toggleMedium();
          }}
          options={[
            { value: "smoke", text: "Smoke", icon: <Wind size={16} />, hint: "Smoke: rises and clears quickly" },
            { value: "ink", text: "Ink", icon: <Droplets size={16} />, hint: "Ink in water: no rise, lingers and curls" },
          ]}
        />
        <Segmented
          label="Depth"
          value={relief ? "relief" : "flat"}
          onChange={(v) => setRelief(v === "relief")}
          options={[
            { value: "flat", text: "Flat", icon: <Square size={16} />, hint: "Flat: looking straight down at the smoke" },
            {
              value: "relief",
              text: "Relief",
              icon: <Mountain size={16} />,
              hint: "Relief: bright smoke rises into glowing terrain you can orbit and zoom",
            },
          ]}
        />
        <Segmented
          label="View"
          value={curl ? "spin" : "color"}
          onChange={(v) => {
            if ((v === "spin") !== curl) toggleCurl();
          }}
          options={[
            { value: "color", text: "Color", icon: <Palette size={16} />, hint: "Color: the smoke itself" },
            {
              value: "spin",
              text: "Spin",
              icon: <RotateCw size={16} />,
              hint: "Spin map: how the fluid is turning. Amber turns counterclockwise, teal clockwise",
            },
          ]}
        />
        <Chip pressed={mic} label={mic ? "Turn microphone off" : "Turn microphone on: your voice moves the smoke"} onClick={() => void toggleMic()}>
          <span className="relative inline-flex">
            {mic ? <MicMeter /> : null}
            {mic ? <Mic size={18} /> : <MicOff size={18} />}
          </span>
          <span className="hidden sm:inline">{mic ? "Mic on" : "Mic"}</span>
        </Chip>
        <Chip pressed={prayer} label="Prayer" onClick={togglePrayer}>
          <SunMedium size={18} />
          <span className="hidden sm:inline">Prayer</span>
        </Chip>
      </nav>

      {!playing ? (
        <button
          type="button"
          data-chrome
          onClick={() => void togglePlay()}
          className="play-flash pointer-events-auto absolute top-[calc(50%+4.5rem)] left-1/2 z-20 h-12 -translate-x-1/2 rounded-full border border-gold/60 bg-black/60 px-6 font-display text-lg text-gold backdrop-blur-sm"
        >
          Press play to begin
        </button>
      ) : null}

      {panelOpen ? (
        <aside
          data-chrome
          className="pointer-events-auto absolute inset-x-3 top-20 bottom-36 z-20 overflow-y-auto rounded-2xl border border-white/10 bg-black/70 p-4 backdrop-blur-md md:inset-x-auto md:top-6 md:right-4 md:bottom-24 md:w-96"
        >
          <div className="mb-3 flex items-center justify-between gap-2">
            <h2 className="font-display text-xl text-ink">Twelve voices</h2>
            <div className="flex gap-2">
              <button type="button" className="h-11 rounded-full border border-line px-3 text-sm" onClick={() => setEnsemble("quartet")}>
                Quartet
              </button>
              <button type="button" className="h-11 rounded-full border border-line px-3 text-sm" onClick={() => setEnsemble("all")}>
                All
              </button>
            </div>
          </div>
          <label className="mb-2 flex items-center gap-3 text-sm text-mist">
            Voice influence
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={voice}
              onChange={(e) => setVoice(Number(e.target.value))}
              className="flex-1"
            />
          </label>
          <ul>
            {tracks.map((track) => (
              <li key={track.id} className="grid grid-cols-[2.75rem_1fr] gap-3 border-b border-line py-3">
                <button
                  type="button"
                  aria-pressed={track.active}
                  aria-label={track.active ? `Mute voice ${track.id}` : `Sound voice ${track.id}`}
                  onClick={() => updateTrack(track.id, { active: !track.active })}
                  className={`h-11 w-11 rounded-full border-2 ${track.active ? "border-ink" : "border-transparent opacity-40"}`}
                  style={{ backgroundColor: track.color }}
                />
                <div className="min-w-0">
                  <div className="mb-1 flex items-center justify-between text-sm">
                    <span>Voice {track.id}</span>
                    <span className="text-mist">
                      {track.rhythm}-cycle · {track.note}
                    </span>
                  </div>
                  <input
                    aria-label={`Rhythm for voice ${track.id}`}
                    type="range"
                    min={2}
                    max={16}
                    value={track.rhythm}
                    onChange={(e) => updateTrack(track.id, { rhythm: Number(e.target.value) })}
                    className="w-full"
                  />
                  <div className="mt-2 flex gap-2">
                    <select
                      aria-label={`Path for voice ${track.id}`}
                      value={track.path}
                      onChange={(e) => updateTrack(track.id, { path: Number(e.target.value) })}
                      className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-void px-2 text-sm text-ink"
                    >
                      {PATHS.map((path) => (
                        <option key={path.id} value={path.id}>
                          {path.name}
                        </option>
                      ))}
                    </select>
                    <select
                      aria-label={`Note for voice ${track.id}`}
                      value={track.note}
                      onChange={(e) => updateTrack(track.id, { note: e.target.value })}
                      className="h-11 rounded-lg border border-line bg-void px-2 text-sm text-ink"
                    >
                      {(NOTES as readonly string[]).includes(track.note) ? null : (
                        <option value={track.note}>{track.note}</option>
                      )}
                      {NOTES.map((note) => (
                        <option key={note} value={note}>
                          {note}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex flex-col gap-2">
            <label className="text-sm text-mist" htmlFor="preset-name">
              Preset
            </label>
            <div className="flex gap-2">
              <input
                id="preset-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="h-11 min-w-0 flex-1 rounded-lg border border-line bg-void px-3 text-sm text-ink"
              />
              <button
                type="button"
                className="h-11 rounded-full bg-gold px-4 text-sm font-medium text-void"
                onClick={() => {
                  savePreset(name.trim() || "Untitled");
                  setPresets(readPresets());
                }}
              >
                Save
              </button>
            </div>
            <label className="inline-flex h-11 cursor-pointer items-center justify-center rounded-full border border-line text-sm">
              Load file
              <input
                type="file"
                accept="application/json"
                className="sr-only"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (!file) return;
                  const reader = new FileReader();
                  reader.onload = () => {
                    try {
                      const parsed = JSON.parse(String(reader.result)) as unknown;
                      if (isPreset(parsed)) loadPreset(parsed);
                      else useCosmos.getState().flash("That file is not a cosmos preset.");
                    } catch {
                      useCosmos.getState().flash("Could not read that file.");
                    }
                  };
                  reader.readAsText(file);
                  e.target.value = "";
                }}
              />
            </label>
            {presets.slice(0, 6).map((preset) => (
              <button
                key={`${preset.name}-${preset.created}`}
                type="button"
                className="h-11 truncate rounded-lg border border-line px-3 text-left text-sm"
                onClick={() => loadPreset(preset)}
              >
                {preset.name}
              </button>
            ))}
          </div>
          <p className="sr-only">{PRESET_KEY}</p>
        </aside>
      ) : null}
    </div>
  );
}
