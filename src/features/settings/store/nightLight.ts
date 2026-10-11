import { invoke } from "@tauri-apps/api/core";

/** The account's Night light setting: never, always, or between two local times. */
export type NightLightMode = "off" | "on" | "scheduled";

/** When a scheduled night light turns on and off, as local "HH:MM". */
export interface NightLightSchedule {
  startAt: string;
  endAt: string;
}
export const defaultNightLightSchedule: NightLightSchedule = { startAt: "21:00", endAt: "07:00" };
export const defaultNightLightWarmth = 0.5;

export function validClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function minutes(value: string): number {
  const [hours, mins] = value.split(":").map(Number);
  return hours * 60 + mins;
}

/** Whether the night light should be on at `now`. */
export function nightLightActive(
  mode: NightLightMode,
  schedule: NightLightSchedule,
  now = new Date(),
): boolean {
  if (mode !== "scheduled") return mode === "on";
  const start = minutes(
    validClockTime(schedule.startAt) ? schedule.startAt : defaultNightLightSchedule.startAt,
  );
  const end = minutes(
    validClockTime(schedule.endAt) ? schedule.endAt : defaultNightLightSchedule.endAt,
  );
  if (start === end) return false;
  const at = now.getHours() * 60 + now.getMinutes();
  // On from its start until its end, across midnight when needed.
  return start < end ? at >= start && at < end : at >= start || at < end;
}

/** Milliseconds until the schedule next turns the night light on or off, at least one minute. */
export function msUntilNextNightLightSwitch(
  schedule: NightLightSchedule,
  now = new Date(),
): number {
  const at = now.getHours() * 60 + now.getMinutes();
  const next = [schedule.startAt, schedule.endAt]
    .filter(validClockTime)
    .map((time) => (minutes(time) - at + 1440) % 1440 || 1440)
    .reduce((soonest, value) => Math.min(soonest, value), 1440);
  return Math.max(60_000, next * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds());
}

// Multiplied over the screen, this keeps reds, holds back green a little and
// blue the most. Full warmth; lower warmth mixes it toward white (no change).
const warmest = [255, 138, 48];

/** The multiply tint for a warmth between 0 and 1, as "#rrggbb". */
export function nightLightTint(warmth: number): string {
  const ratio = Number.isFinite(warmth)
    ? Math.min(1, Math.max(0, warmth))
    : defaultNightLightWarmth;
  return `#${warmest
    .map((channel) =>
      Math.round(255 + (channel - 255) * ratio)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
}

let pushed: string | null | undefined;

/**
 * Tints Misty's window and every open browser page; null turns it off. Native
 * pages sit above the app's own view, so they get the same layer injected.
 */
export function applyNightLight(tint: string | null): void {
  const root = document.documentElement;
  if (tint) {
    root.style.setProperty("--misty-night-light", tint);
    root.dataset.nightLight = "true";
  } else {
    root.style.removeProperty("--misty-night-light");
    delete root.dataset.nightLight;
  }
  if (pushed === tint) return;
  pushed = tint;
  void invoke<void>("browser_set_night_light", { tint }).catch(() => {
    pushed = undefined;
  });
}
