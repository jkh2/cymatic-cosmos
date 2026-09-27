import { midiToNote } from "./model";

type ToneNS = typeof import("tone");

export const ear = {
  level: 0,
  smoothed: 0,
  freq: new Float32Array(32),
  listening: false,
};

let tone: ToneNS | null = null;
let started = false;
let lastHarmony = 0;
let lastMidi = -999;
let analyser: AnalyserNode | null = null;
let bins: Uint8Array | null = null;
let stream: MediaStream | null = null;
let synth: InstanceType<ToneNS["PolySynth"]> | null = null;
let harmony: InstanceType<ToneNS["PolySynth"]> | null = null;

export async function ensureAudio() {
  if (started) return;
  tone = await import("tone");
  await tone.start();
  const filter = new tone.Filter(1000, "lowpass");
  const comp = new tone.Compressor(-20, 3);
  const reverb = new tone.Reverb(3);
  const delay = new tone.Delay(0.3);
  synth = new tone.PolySynth(tone.Synth, {
    envelope: { attack: 0.06, decay: 0.4, sustain: 0.25, release: 1.2 },
  });
  synth.maxPolyphony = 24;
  harmony = new tone.PolySynth(tone.Synth, {
    oscillator: { type: "sine" },
    envelope: { attack: 0.3, decay: 1, sustain: 0.6, release: 3 },
  });
  const dest = tone.getDestination();
  dest.volume.value = -8;
  synth.chain(filter, comp, reverb, dest);
  harmony.chain(delay, reverb);
  harmony.volume.value = -12;
  await reverb.ready;
  started = true;
}

export function triggerNote(note: string, velocity: number, delay = 0) {
  if (!synth || !tone) return;
  synth.triggerAttackRelease(
    note,
    "8n",
    tone.now() + 0.02 + delay,
    Math.min(Math.max(velocity, 0.12), 0.8),
  );
}

export function releaseVoices() {
  synth?.releaseAll();
  harmony?.releaseAll();
}

export function sampleEar() {
  if (!analyser || !bins || !ear.listening) {
    ear.level *= 0.9;
    ear.smoothed *= 0.9;
    return;
  }
  analyser.getByteFrequencyData(bins as Uint8Array<ArrayBuffer>);
  let sum = 0;
  for (let i = 0; i < bins.length; i++) sum += bins[i];
  ear.level = sum / bins.length / 255;
  ear.smoothed = ear.smoothed * 0.9 + ear.level * 0.1;
  for (let i = 0; i < 32; i++) {
    const bin = Math.floor((i / 32) * bins.length);
    ear.freq[i] = ear.freq[i] * 0.8 + (bins[bin] / 255) * 0.2;
  }
}

export function listenForPrayer() {
  if (!harmony || !tone || !bins || !analyser || !ear.listening) return;
  if (ear.level < 0.08) return;
  const nowMs = performance.now();
  if (nowMs - lastHarmony < 1100) return;
  let max = 0;
  let dom = 0;
  for (let i = 5; i < bins.length / 4; i++) {
    if (bins[i] > max) {
      max = bins[i];
      dom = i;
    }
  }
  if (max < 50) return;
  const freq = (dom * analyser.context.sampleRate) / analyser.fftSize;
  if (freq < 80 || freq > 800) return;
  const midi = Math.round(12 * Math.log2(freq / 440) + 69);
  if (Math.abs(midi - lastMidi) < 1 && nowMs - lastHarmony < 2400) return;
  lastHarmony = nowMs;
  lastMidi = midi;
  const intervals = [0, 7, 12, 19, 8];
  for (let i = 0; i < intervals.length; i++) {
    harmony.triggerAttackRelease(midiToNote(midi + intervals[i]), "2n", tone.now() + i * 0.1, 0.1 - i * 0.02);
  }
}

export async function startMic() {
  await ensureAudio();
  stream = await navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
  });
  const raw = tone!.getContext().rawContext as AudioContext;
  const source = raw.createMediaStreamSource(stream);
  analyser = raw.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.3;
  bins = new Uint8Array(analyser.frequencyBinCount);
  source.connect(analyser);
  ear.listening = true;
}

export function stopMic() {
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  analyser = null;
  bins = null;
  ear.listening = false;
}
