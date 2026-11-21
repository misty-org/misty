/**
 * A call's sounds, made here with Web Audio rather than shipped as files: a ring while someone
 * calls, a quieter ringback while this person waits for an answer, and short tones for joining and
 * leaving, someone else joining or leaving, and the microphone turning off and on. They are soft
 * sine tones with a quick fade, so none of them clicks or startles.
 */

type Note = { hz: number; at: number; length: number; volume?: number };

const sounds = {
  join: [
    { hz: 523.25, at: 0, length: 0.12 },
    { hz: 783.99, at: 0.1, length: 0.18 },
  ],
  leave: [
    { hz: 783.99, at: 0, length: 0.12 },
    { hz: 523.25, at: 0.1, length: 0.2 },
  ],
  personJoined: [
    { hz: 659.25, at: 0, length: 0.1, volume: 0.6 },
    { hz: 880, at: 0.08, length: 0.14, volume: 0.6 },
  ],
  personLeft: [
    { hz: 880, at: 0, length: 0.1, volume: 0.6 },
    { hz: 659.25, at: 0.08, length: 0.16, volume: 0.6 },
  ],
  mute: [{ hz: 392, at: 0, length: 0.09, volume: 0.5 }],
  unmute: [{ hz: 587.33, at: 0, length: 0.09, volume: 0.5 }],
  // One ring: two quick pairs, as a phone's; repeated until answered.
  ring: [
    { hz: 880, at: 0, length: 0.16 },
    { hz: 1046.5, at: 0.18, length: 0.16 },
    { hz: 880, at: 0.5, length: 0.16 },
    { hz: 1046.5, at: 0.68, length: 0.16 },
  ],
  // What the caller hears while it rings: one low, quiet tone.
  ringback: [{ hz: 440, at: 0, length: 0.9, volume: 0.35 }],
} satisfies Record<string, Note[]>;

export type CallSound = keyof typeof sounds;

const LOUDNESS = 0.18;
let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof AudioContext === "undefined") return null;
  context ??= new AudioContext();
  // A context made before the person touched the window starts suspended.
  if (context.state === "suspended") void context.resume().catch(() => undefined);
  return context;
}

/** Plays one of the call's sounds once. */
export function playCallSound(sound: CallSound) {
  const ctx = audio();
  if (!ctx) return;
  const start = ctx.currentTime + 0.01;
  for (const note of sounds[sound] as Note[]) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = "sine";
    oscillator.frequency.value = note.hz;
    const at = start + note.at;
    const peak = LOUDNESS * (note.volume ?? 1);
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(peak, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + note.length);
    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(at);
    oscillator.stop(at + note.length + 0.02);
  }
}

/**
 * Repeats a ring (or the ringback) every few seconds until the returned stop is called, starting
 * at once.
 */
export function loopCallSound(sound: "ring" | "ringback"): () => void {
  playCallSound(sound);
  const timer = window.setInterval(() => playCallSound(sound), sound === "ring" ? 2_500 : 3_000);
  return () => window.clearInterval(timer);
}
