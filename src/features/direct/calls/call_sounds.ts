import { speakerSink, type SpeakerSink } from "./speaker_sink";

type Note = { hz: number; at: number; length: number; volume?: number };

const sounds = {
  join: [
    { hz: 523.25, at: 0, length: 0.22 },
    { hz: 659.25, at: 0.13, length: 0.24 },
    { hz: 783.99, at: 0.26, length: 0.55 },
  ],
  leave: [
    { hz: 783.99, at: 0, length: 0.22 },
    { hz: 659.25, at: 0.13, length: 0.24 },
    { hz: 523.25, at: 0.26, length: 0.6 },
  ],
  personJoined: [
    { hz: 659.25, at: 0, length: 0.2, volume: 0.75 },
    { hz: 880, at: 0.13, length: 0.45, volume: 0.75 },
  ],
  personLeft: [
    { hz: 880, at: 0, length: 0.2, volume: 0.75 },
    { hz: 659.25, at: 0.13, length: 0.5, volume: 0.75 },
  ],
  mute: [{ hz: 392, at: 0, length: 0.12, volume: 0.55 }],
  unmute: [{ hz: 587.33, at: 0, length: 0.12, volume: 0.55 }],
  ring: [
    { hz: 880, at: 0, length: 0.16 },
    { hz: 1046.5, at: 0.18, length: 0.16 },
    { hz: 880, at: 0.5, length: 0.16 },
    { hz: 1046.5, at: 0.68, length: 0.16 },
  ],
  ringback: [{ hz: 440, at: 0, length: 0.9, volume: 0.35 }],
} satisfies Record<string, Note[]>;

export type CallSound = keyof typeof sounds;

const LOUDNESS = 0.3;

let output: (SpeakerSink & { context: AudioContext }) | null = null;

function open() {
  if (typeof AudioContext === "undefined") return null;
  if (!output) {
    const context = new AudioContext();
    output = { context, ...speakerSink(context) };
  }
  output.wake();
  return output;
}

export function playCallSound(sound: CallSound) {
  const sink = open();
  if (!sink) return;
  const { context, destination } = sink;
  const start = context.currentTime + 0.01;
  for (const note of sounds[sound] as Note[]) {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = note.hz;
    const at = start + note.at;
    const peak = LOUDNESS * (note.volume ?? 1);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.02);
    gain.gain.setValueAtTime(peak, at + Math.min(0.08, note.length / 3));
    gain.gain.exponentialRampToValueAtTime(0.0001, at + note.length);
    oscillator.connect(gain).connect(destination);
    oscillator.start(at);
    oscillator.stop(at + note.length + 0.02);
  }
}

export function loopCallSound(sound: "ring" | "ringback"): () => void {
  playCallSound(sound);
  const timer = window.setInterval(() => playCallSound(sound), sound === "ring" ? 2_500 : 3_000);
  return () => window.clearInterval(timer);
}
