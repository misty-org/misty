import type { Turn } from "../transcript/transcript";
import type { VoiceTurn } from "./capture_api";

export function speakerLabel(key: string) {
  if (key === "you" || key.startsWith("you:")) return "You";
  const id = key.slice(key.indexOf(":") + 1);
  return id && id !== "?" ? `Speaker ${id}` : "Speaker";
}

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

export function speakersOf(turns: VoiceTurn[]) {
  return [...new Set(turns.map((turn) => turn.speaker))];
}
