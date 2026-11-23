import type { HearingSession } from "@/features/voice";
import type { DisplayCapture } from "./protocol";

export interface HeardTurn {
  session?: HearingSession;
  said: string[];
  error?: string;
}

export const turnInput = "voice";

export const stopHearing = (hearing: Promise<HeardTurn> | undefined) =>
  void hearing?.then((turn) => turn.session?.stop()).catch(() => undefined);

export const heardText = (said: string[]) => said.join(" ").replace(/\s+/g, " ").trim();

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
