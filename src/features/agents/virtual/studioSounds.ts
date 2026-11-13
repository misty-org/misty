import { useEffect, useRef } from "react";
import { resolveSetting, useDevicePreferences, useSettingsStore } from "@/features/settings";

/**
 * The studio's sounds: a soft chime when an agent needs its person, a short rising ding when a run
 * finishes, a low note when one fails, and footsteps while the person walks. They are made on the
 * spot with Web Audio, so there are no sound files, and are off unless the person turns them on
 * (Settings → Agents, or the dock); the choice belongs to this computer.
 */

const SOUND_SETTING = "agents.studio_sounds";

/** Whether studio sounds are on, as this computer's settings say. */
export function useStudioSoundsOn(): boolean {
  return useDevicePreferences((store) =>
    Boolean(store.state && resolveSetting(store.state, SOUND_SETTING).value),
  );
}

export function setStudioSounds(on: boolean) {
  useSettingsStore.getState().updateSetting("agent", "studio_sounds", on);
}

let context: AudioContext | null = null;
function audio(): AudioContext | null {
  if (typeof window === "undefined" || !("AudioContext" in window)) return null;
  context ??= new AudioContext();
  if (context.state === "suspended") void context.resume().catch(() => undefined);
  return context;
}

/** One soft note: a sine that swells in and dies away, starting `delay` seconds from now. */
function note(frequency: number, delay: number, length: number, loudness: number) {
  const out = audio();
  if (!out) return;
  const start = out.currentTime + delay;
  const tone = out.createOscillator();
  const level = out.createGain();
  tone.type = "sine";
  tone.frequency.setValueAtTime(frequency, start);
  level.gain.setValueAtTime(0, start);
  level.gain.linearRampToValueAtTime(loudness, start + 0.015);
  level.gain.exponentialRampToValueAtTime(0.0001, start + length);
  tone.connect(level).connect(out.destination);
  tone.start(start);
  tone.stop(start + length + 0.05);
}

export const studioSounds = {
  /** An agent needs its person. */
  needsYou: () => {
    note(784, 0, 0.5, 0.08);
    note(1175, 0.14, 0.7, 0.07);
  },
  /** A run finished. */
  done: () => {
    note(659, 0, 0.3, 0.06);
    note(880, 0.09, 0.3, 0.06);
    note(1319, 0.18, 0.55, 0.05);
  },
  /** A run failed. */
  failed: () => {
    note(392, 0, 0.45, 0.07);
    note(294, 0.16, 0.6, 0.07);
  },
  /** One footstep: a short, muffled knock. */
  step: () => note(150 + Math.random() * 40, 0, 0.09, 0.05),
};

/**
 * Plays the studio's cues as agents change: once when one comes to need its person, and once when
 * a run it was watched doing finishes or fails. What was already so when the studio opened stays
 * quiet.
 */
export function useStudioCues(
  on: boolean,
  agents: readonly { id: string; state: string; outcome?: string }[],
) {
  const known = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const now = new Map(agents.map((item) => [item.id, `${item.state}:${item.outcome ?? ""}`]));
    const before = known.current;
    known.current = now;
    if (!on || !before) return;
    for (const item of agents) {
      const was = before.get(item.id);
      if (was === undefined || was === now.get(item.id)) continue;
      if (item.state === "needs-you" && !was.startsWith("needs-you")) studioSounds.needsYou();
      else if (item.outcome === "done" && !was.endsWith(":done")) studioSounds.done();
      else if (item.outcome === "failed" && !was.endsWith(":failed")) studioSounds.failed();
    }
  }, [on, agents]);
}
