import { useEffect, useState, type ReactNode } from "react";
import {
  Camera,
  Droplets,
  Eye,
  Mic,
  MicOff,
  Move3d,
  Pause,
  Play,
  SlidersHorizontal,
  SunMedium,
  Wind,
} from "lucide-react";
import { captureCosmos } from "@/components/cosmos/stage";
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
      className={`inline-flex h-11 items-center gap-2 rounded-full border px-3 text-sm font-medium md:px-4 ${
        pressed
          ? "border-gold bg-gold text-void"
          : "border-line bg-panel/80 text-ink hover:border-gold"
      }`}
    >
      {children}
    </button>
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
  const looking = useCosmos((s) => s.looking);
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
  const toggleLooking = useCosmos((s) => s.toggleLooking);
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
      <header
        data-chrome
        className="pointer-events-auto absolute inset-x-0 top-0 flex flex-col gap-3 bg-gradient-to-b from-void via-void/85 to-transparent p-4 pb-10 md:p-6 md:pb-12"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="font-display text-2xl font-medium tracking-tight text-ink md:text-3xl">
              Cymatic <em className="text-gold italic">Cosmos</em>
            </h1>
            <p className="text-sm text-mist">James Keith Harwood II</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip pressed={playing} label={playing ? "Pause" : "Play"} onClick={() => void togglePlay()}>
              {playing ? <Pause size={18} /> : <Play size={18} />}
              <span className="hidden sm:inline">{playing ? "Pause" : "Play"}</span>
            </Chip>
            <Chip pressed={mic} label={mic ? "Stop microphone" : "Listen"} onClick={() => void toggleMic()}>
              {mic ? <MicOff size={18} /> : <Mic size={18} />}
              <span className="hidden sm:inline">{mic ? "Listening" : "Listen"}</span>
            </Chip>
            <Chip pressed={prayer} label="Prayer" onClick={togglePrayer}>
              <SunMedium size={18} />
              <span className="hidden sm:inline">Prayer</span>
            </Chip>
            <Chip label="Capture" onClick={captureCosmos}>
              <Camera size={18} />
              <span className="hidden md:inline">Capture</span>
            </Chip>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-mist">
            Tempo
            <input
              type="range"
              min={20}
              max={200}
              value={tempo}
              onChange={(e) => setTempo(Number(e.target.value))}
              className="w-28 md:w-36"
            />
            <span className="w-10 text-ink">{tempo}</span>
          </label>
          <label className="flex items-center gap-2 text-sm text-mist">
            Voice
            <input
              type="range"
              min={0}
              max={2}
              step={0.1}
              value={voice}
              onChange={(e) => setVoice(Number(e.target.value))}
              className="w-24 md:w-32"
            />
          </label>
          <Chip pressed={medium === "smoke"} label="Smoke or ink" onClick={toggleMedium}>
            {medium === "smoke" ? <Wind size={18} /> : <Droplets size={18} />}
            <span>{medium === "smoke" ? "Smoke" : "Ink"}</span>
          </Chip>
          <Chip pressed={curl} label="Curl view" onClick={toggleCurl}>
            <Eye size={18} />
            <span className="hidden sm:inline">{curl ? "Curl" : "Dye"}</span>
          </Chip>
          <Chip pressed={looking} label="Turn the sphere" onClick={toggleLooking}>
            <Move3d size={18} />
            <span className="hidden sm:inline">{looking ? "Turning" : "Stir"}</span>
          </Chip>
          <Chip pressed={panelOpen} label="Voices" onClick={togglePanel}>
            <SlidersHorizontal size={18} />
            <span>Voices</span>
          </Chip>
        </div>
        <p className="max-w-xl text-sm text-mist">
          {looking
            ? "Drag to turn the armillary. Scroll to move closer."
            : "Drag the dark to stir the smoke. The orbits leave their own trails."}
          {micError ? ` ${micError}` : ""}
          {notice ? ` ${notice}` : ""}
        </p>
      </header>
      {!playing ? (
        <button
          type="button"
          data-chrome
          onClick={() => void togglePlay()}
          className="play-flash pointer-events-auto absolute top-[46%] left-1/2 z-20 h-14 -translate-x-1/2 rounded-full border border-gold/70 bg-void/85 px-6 font-display text-xl text-gold"
        >
          Press play to begin
        </button>
      ) : null}

      {panelOpen ? (
        <aside
          data-chrome
          className="pointer-events-auto absolute inset-x-4 bottom-4 z-20 max-h-80 overflow-y-auto rounded-2xl border border-line bg-panel/85 p-4 backdrop-blur-md md:inset-x-auto md:top-36 md:right-4 md:bottom-4 md:w-96 md:max-h-none"
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
