import { createDeviceSetting } from "@/shared/lib/deviceSetting";

/**
 * Whether this computer shows the person (their cursor and face) to others in a live session. It
 * is read when a session is joined, so a change applies from the next one.
 */
export const useShowInLive = createDeviceSetting<boolean>({
  scope: "live-show-me",
  defaults: true,
  normalize: (stored) => stored !== false,
});

/** The tones a cursor may wear, the design system's own (`--color-tone-*`); "auto" is the person's own. */
export const cursorTones = ["blue", "green", "orange", "violet", "pink", "amber", "teal"] as const;
export type CursorTone = (typeof cursorTones)[number];

/** Which tone this person's cursor wears in live sessions; read when a session is joined. */
export const useCursorTone = createDeviceSetting<CursorTone | "auto">({
  scope: "live-cursor-tone",
  defaults: "auto",
  normalize: (stored) =>
    typeof stored === "string" && (cursorTones as readonly string[]).includes(stored)
      ? (stored as CursorTone)
      : "auto",
});
