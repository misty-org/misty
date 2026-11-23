export type NightLightMode = "off" | "on" | "scheduled";

interface NightLightSchedule {
  startAt: string;
  endAt: string;
}
const defaultNightLightSchedule: NightLightSchedule = { startAt: "21:00", endAt: "07:00" };
const defaultNightLightWarmth = 0.5;

export function validClockTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function minutes(value: string): number {
  const [hours, mins] = value.split(":").map(Number);
  return hours * 60 + mins;
}

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
  return start < end ? at >= start && at < end : at >= start || at < end;
}

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

const warmest = [255, 138, 48];

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

export function applyNightLight(tint: string | null): void {
  const root = document.documentElement;
  if (tint) {
    root.style.setProperty("--misty-night-light", tint);
    root.dataset.nightLight = "true";
  } else {
    root.style.removeProperty("--misty-night-light");
    delete root.dataset.nightLight;
  }
}
