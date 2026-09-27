import { midiToNote } from "./model";

type ToneNS = typeof import("tone");

export const ear = {
  level: 0,
  smoothed: 0,
  /** Detected sung pitch in Hz, 0 when none is clear. */
  pitch: 0,
  freq: new Float32Array(32),
  /** Ten log-spaced voice bands, 90 Hz to 4 kHz, each 0..1. */
  bands: new Float32Array(10),
  listening: false,
};

let tone: ToneNS | null = null;
let started = false;
let starting: Promise<void> | null = null;
let lastHarmony = 0;
let stableMidi = -1;
let stableSince = 0;
let analyser: AnalyserNode | null = null;
let bins: Uint8Array | null = null;
let wave: Float32Array | null = null;
let stream: MediaStream | null = null;
let synth: InstanceType<ToneNS["PolySynth"]> | null = null;
let harmony: InstanceType<ToneNS["PolySynth"]> | null = null;

export function ensureAudio() {
  if (started) return Promise.resolve();
  starting ??= (async () => {
    tone = await import("tone");
    // A larger render buffer: the smoke keeps the GPU and main thread busy,
    // and the default "interactive" latency lets the audio thread underrun,
    // which is heard as clicks and pops.
    tone.setContext(new tone.Context({ latencyHint: "playback", lookAhead: 0.12 }));
    await tone.start();
    const comp = new tone.Compressor(-22, 3);
    const reverb = new tone.Reverb({ decay: 5, wet: 0.38 });
    const echo = new tone.FeedbackDelay({ delayTime: "8n.", feedback: 0.22, wet: 0.14 });
    const limiter = new tone.Limiter(-3);
    // A struck-glass voice: quick attack, long bloom, soft upper partials.
    // A 20ms attack still reads as a strike but no longer clicks on low notes.
    synth = new tone.PolySynth(tone.Synth, {
      oscillator: { type: "custom", partials: [1, 0.32, 0.12, 0.05] },
      envelope: { attack: 0.02, attackCurve: "sine", decay: 1.3, sustain: 0.06, release: 2.4, releaseCurve: "exponential" },
    });
    // Headroom so long releases are never cut off by voice stealing.
    synth.maxPolyphony = 64;
    synth.volume.value = -4;
    const soften = new tone.Filter({ frequency: 3600, type: "lowpass", rolloff: -12 });
    harmony = new tone.PolySynth(tone.Synth, {
      oscillator: { type: "sine" },
      envelope: { attack: 0.4, decay: 1.2, sustain: 0.55, release: 3.2 },
    });
    harmony.volume.value = -14;
    const dest = tone.getDestination();
    dest.volume.value = -6;
    synth.chain(soften, echo, comp, reverb, limiter, dest);
    harmony.chain(reverb);
    await reverb.ready;
    started = true;
  })();
  return starting;
}

export function triggerNote(note: string, velocity: number, delay = 0) {
  if (!synth || !tone) return;
  synth.triggerAttackRelease(note, "4n", tone.now() + 0.01 + delay, Math.min(Math.max(velocity, 0.12), 0.8));
}

export function releaseVoices() {
  synth?.releaseAll();
  harmony?.releaseAll();
}

/** Autocorrelation pitch: steadier than the loudest FFT bin on a human voice. */
function detectPitch(buf: Float32Array, sampleRate: number) {
  let rms = 0;
  for (let i = 0; i < buf.length; i++) rms += buf[i] * buf[i];
  rms = Math.sqrt(rms / buf.length);
  if (rms < 0.012) return 0;
  const minLag = Math.floor(sampleRate / 900);
  const maxLag = Math.floor(sampleRate / 70);
  let best = 0;
  let bestLag = -1;
  const n = buf.length - maxLag;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    let e1 = 0;
    let e2 = 0;
    for (let i = 0; i < n; i += 2) {
      const a = buf[i];
      const b = buf[i + lag];
      sum += a * b;
      e1 += a * a;
      e2 += b * b;
    }
    const r = sum / Math.sqrt(e1 * e2 + 1e-9);
    if (r > best) {
      best = r;
      bestLag = lag;
    }
  }
  if (best < 0.82 || bestLag < 0) return 0;
  return sampleRate / bestLag;
}

const BAND_EDGES = Array.from({ length: 11 }, (_, i) => 90 * (4000 / 90) ** (i / 10));

/** Fast rise, slow fall: a voice meter that feels alive. */
function follow(prev: number, next: number) {
  return prev + (next - prev) * (next > prev ? 0.35 : 0.07);
}

export function sampleEar() {
  if (!analyser || !bins || !wave || !ear.listening) {
    ear.level *= 0.9;
    ear.smoothed *= 0.9;
    ear.bands.forEach((v, i) => (ear.bands[i] = v * 0.9));
    ear.pitch = 0;
    return;
  }
  // Loudness from RMS in decibels. Averaging raw FFT bins, as before, barely
  // moves for speech, which is why the mic seemed to do nothing.
  analyser.getFloatTimeDomainData(wave as Float32Array<ArrayBuffer>);
  let sq = 0;
  for (let i = 0; i < wave.length; i++) sq += wave[i] * wave[i];
  const db = 20 * Math.log10(Math.sqrt(sq / wave.length) + 1e-8);
  ear.level = Math.min(1, Math.max(0, (db + 58) / 40));
  ear.smoothed = follow(ear.smoothed, ear.level);

  analyser.getByteFrequencyData(bins as Uint8Array<ArrayBuffer>);
  const hzPerBin = analyser.context.sampleRate / analyser.fftSize;
  for (let b = 0; b < 10; b++) {
    const lo = Math.max(1, Math.floor(BAND_EDGES[b] / hzPerBin));
    const hi = Math.max(lo + 1, Math.ceil(BAND_EDGES[b + 1] / hzPerBin));
    let peak = 0;
    for (let i = lo; i < hi && i < bins.length; i++) peak = Math.max(peak, bins[i]);
    const v = Math.min(1, Math.max(0, (peak / 255 - 0.35) / 0.55));
    ear.bands[b] = follow(ear.bands[b], v);
  }
  for (let i = 0; i < 32; i++) {
    const bin = Math.floor((i / 32) * bins.length);
    ear.freq[i] = ear.freq[i] * 0.8 + (bins[bin] / 255) * 0.2;
  }
  const hz = detectPitch(wave, analyser.context.sampleRate);
  ear.pitch = hz > 0 ? (ear.pitch > 0 ? ear.pitch * 0.6 + hz * 0.4 : hz) : 0;
}

/** Prayer: when a sung pitch holds steady, answer it with root, fifth, octave. */
export function listenForPrayer() {
  if (!harmony || !tone || !ear.listening || ear.pitch <= 0) {
    stableMidi = -1;
    return;
  }
  const now = performance.now();
  const midi = Math.round(12 * Math.log2(ear.pitch / 440) + 69);
  if (midi !== stableMidi) {
    stableMidi = midi;
    stableSince = now;
    return;
  }
  if (now - stableSince < 280 || now - lastHarmony < 2200) return;
  lastHarmony = now;
  const intervals = [0, 7, 12, 19];
  intervals.forEach((iv, i) => {
    harmony?.triggerAttackRelease(midiToNote(midi + iv), "2n", tone!.now() + i * 0.12, 0.16 - i * 0.03);
  });
}

export async function startMic() {
  await ensureAudio();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: false, autoGainControl: false },
  });
  const raw = tone!.getContext().rawContext as AudioContext;
  const source = raw.createMediaStreamSource(stream);
  analyser = raw.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.3;
  bins = new Uint8Array(analyser.frequencyBinCount);
  wave = new Float32Array(analyser.fftSize);
  source.connect(analyser);
  ear.listening = true;
}

export function stopMic() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  analyser = null;
  bins = null;
  wave = null;
  ear.listening = false;
  ear.pitch = 0;
}
