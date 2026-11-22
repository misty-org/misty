import type { HearingSession } from "@/features/voice";
import type { DisplayCapture } from "./protocol";

/**
 * Hearing a spoken turn: one hearing session per turn, fed the turn's audio, what it heard, and
 * the line saved about what was on screen. The hearing model finds the language itself, so one
 * session hears the person in whatever they speak.
 */

/** A turn's hearing: its session once open, what it has heard so far in order, and why it failed. */
export interface HeardTurn {
  session?: HearingSession;
  said: string[];
  error?: string;
}

/** The name the turn's audio goes in under, the session's only input. */
export const turnInput = "voice";

/** Ends a turn's hearing without waiting on it, as when the turn is cut short. */
export const stopHearing = (hearing: Promise<HeardTurn> | undefined) =>
  void hearing?.then((turn) => turn.session?.stop()).catch(() => undefined);

/** Everything a turn heard, as one line. */
export const heardText = (said: string[]) => said.join(" ").replace(/\s+/g, " ").trim();

/**
 * What was on screen for a turn, in a line built from its captures (never by a model): the window
 * in front's app and title and the page or document it had open, and how many screens there were.
 */
export function screenNote(screens: DisplayCapture[]): string {
  const front = screens.find((screen) => screen.source === "desktop-window");
  const displays = screens.filter((screen) => screen.source === "desktop-display").length;
  const parts = [
    front?.app && front.title && front.title !== front.app
      ? `${front.app}: ${front.title}`
      : front?.app || front?.title || "",
    front?.document ?? "",
    displays > 1 ? `${displays} screens` : "",
  ].filter(Boolean);
  return parts.join(", ").slice(0, 400);
}
