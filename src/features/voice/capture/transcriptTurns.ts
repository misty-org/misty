import type { Turn } from "@audeeo/core";
import type { VoiceTurn } from "./captureApi";

/**
 * The label a speaker is saved under: the microphone is the person ("You"),
 * other voices are numbered as the provider tells them apart.
 */
export function speakerLabel(key: string) {
  if (key === "you" || key.startsWith("you:")) return "You";
  const id = key.slice(key.indexOf(":") + 1);
  return id && id !== "?" ? `Speaker ${id}` : "Speaker";
}

/** Live turns as they are saved: confirmed or not, empty ones dropped. */
export function savedTurns(turns: Turn[]): VoiceTurn[] {
  return turns
    .filter((turn) => turn.text.trim())
    .map((turn) => ({
      speaker: speakerLabel(turn.speaker),
      channel: turn.channel,
      start: turn.startMs / 1000,
      end: Math.max(turn.endMs, turn.startMs) / 1000,
      text: turn.text.trim(),
    }));
}

/** The speakers in order of first appearance, for the lanes and renaming. */
export function speakersOf(turns: VoiceTurn[]) {
  return [...new Set(turns.map((turn) => turn.speaker))];
}
