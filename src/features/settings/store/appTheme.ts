import { useAppThemeStore, type ResolvedAppTheme } from "./useAppThemeStore";

/** The account's Theme setting; "system" follows the OS appearance, "scheduled" the clock. */
export type AppThemeMode = "system" | "scheduled" | ResolvedAppTheme;

/** When light and dark begin for the "scheduled" theme, as local "HH:MM". */
export interface ThemeSchedule {
  lightAt: string;
  darkAt: string;
}
export const defaultThemeSchedule: ThemeSchedule = { lightAt: "07:00", darkAt: "19:00" };

export function validThemeTime(value: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function minutes(value: string): number {
  const [hours, mins] = value.split(":").map(Number);
  return hours * 60 + mins;
}

/** The theme the schedule calls for at `now`. */
export function scheduledTheme(schedule: ThemeSchedule, now = new Date()): ResolvedAppTheme {
  const light = minutes(
    validThemeTime(schedule.lightAt) ? schedule.lightAt : defaultThemeSchedule.lightAt,
  );
  const dark = minutes(
    validThemeTime(schedule.darkAt) ? schedule.darkAt : defaultThemeSchedule.darkAt,
  );
  const at = now.getHours() * 60 + now.getMinutes();
  if (light === dark) return "dark";
  // Light runs from its start until dark starts, across midnight when needed.
  const inLight = light < dark ? at >= light && at < dark : at >= light || at < dark;
  return inLight ? "light" : "dark";
}

/** Milliseconds until the schedule next switches, at least one minute. */
export function msUntilNextThemeSwitch(schedule: ThemeSchedule, now = new Date()): number {
  const at = now.getHours() * 60 + now.getMinutes();
  const next = [schedule.lightAt, schedule.darkAt]
    .filter(validThemeTime)
    .map((time) => (minutes(time) - at + 1440) % 1440 || 1440)
    .reduce((soonest, value) => Math.min(soonest, value), 1440);
  return Math.max(60_000, next * 60_000 - now.getSeconds() * 1000 - now.getMilliseconds());
}
export type AppThemeTokens = {
  background: string;
  surface: string;
  surfaceRaised: string;
  surfaceHover: string;
  border: string;
  borderStrong: string;
  text: string;
  textMuted: string;
  textSubtle: string;
  primary: string;
  primaryContrast: string;
  accent: string;
  focus: string;
  selection: string;
  success: string;
  warning: string;
  danger: string;
  info: string;
  shadow: string;
};
export type AppThemeSnapshot = {
  themeId: string;
  mode: ResolvedAppTheme;
  tokens: AppThemeTokens;
};
type BaseThemeTokens = Pick<
  AppThemeTokens,
  | "background"
  | "surface"
  | "text"
  | "textMuted"
  | "accent"
  | "selection"
  | "success"
  | "warning"
  | "danger"
>;

export const appThemeChangedEvent = "misty://app-theme-changed";

// The approved black, white and gray palette. Danger keeps a muted red so
// destructive actions stay recognizable without relying on color alone.
const palettes: Record<ResolvedAppTheme, BaseThemeTokens> = {
  dark: {
    background: "#131313",
    surface: "#161616",
    text: "#E0E0E0",
    textMuted: "#8C8C8C",
    accent: "#D8D8D8",
    selection: "#3E3E3E",
    success: "#D8D8D8",
    warning: "#B4B4B4",
    danger: "#D89C8A",
  },
  light: {
    background: "#F6F6F6",
    surface: "#EEEEEE",
    text: "#1F1F1F",
    textMuted: "#6B6B6B",
    accent: "#2B2B2B",
    selection: "#D9D9D9",
    success: "#2B2B2B",
    warning: "#4F4F4F",
    danger: "#9A4E45",
  },
};

// Browser tab chrome keeps its own slightly lifted tones in each mode.
const tabChrome: Record<ResolvedAppTheme, Record<string, string>> = {
  dark: {
    "--workspace-tab-surface-top": "#222222",
    "--workspace-tab-surface": "#1C1C1C",
    "--workspace-tab-text": "#C5C5C5",
    "--workspace-tab-muted": "#ABABAB",
  },
  light: {
    "--workspace-tab-surface-top": "#FFFFFF",
    "--workspace-tab-surface": "#FAFAFA",
    "--workspace-tab-text": "#2B2B2B",
    "--workspace-tab-muted": "#5F5F5F",
  },
};

let current = snapshotFor("dark");

export function appThemeSnapshot(): AppThemeSnapshot {
  return current;
}

export function resolveAppTheme(
  mode: AppThemeMode,
  schedule: ThemeSchedule = defaultThemeSchedule,
): ResolvedAppTheme {
  if (mode === "scheduled") return scheduledTheme(schedule);
  if (mode !== "system") return mode;
  return window.matchMedia?.("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/** Applies the resolved palette to the document and tells native chrome to follow. */
export function applyAppTheme(
  mode: AppThemeMode,
  schedule: ThemeSchedule = defaultThemeSchedule,
): AppThemeSnapshot {
  const resolved = resolveAppTheme(mode, schedule);
  const changed = current.mode !== resolved;
  current = snapshotFor(resolved);
  applySnapshot(current);
  if (changed) window.dispatchEvent(new Event(appThemeChangedEvent));
  return current;
}

function snapshotFor(mode: ResolvedAppTheme): AppThemeSnapshot {
  const base = palettes[mode];
  const light = mode === "light";
  return {
    themeId: `misty-${mode}`,
    mode,
    tokens: {
      ...base,
      surfaceRaised: mix(base.surface, base.text, light ? 0.04 : 0.025),
      surfaceHover: mix(base.surface, base.text, light ? 0.1 : 0.09),
      border: mix(base.background, base.text, light ? 0.14 : 0.09),
      borderStrong: mix(base.background, base.text, light ? 0.25 : 0.2),
      textSubtle: mix(base.background, base.textMuted, 0.78),
      primary: base.selection,
      primaryContrast: base.text,
      focus: base.text,
      info: base.accent,
      shadow: light ? "rgba(0, 0, 0, .14)" : "rgba(0, 0, 0, .48)",
    },
  };
}

function applySnapshot(snapshot: AppThemeSnapshot): void {
  const root = document.documentElement;
  const { tokens } = snapshot;
  const light = snapshot.mode === "light";
  root.dataset.theme = snapshot.mode;
  root.dataset.themeMode = snapshot.mode;
  root.dataset.mistyTheme = snapshot.themeId;
  root.classList.toggle("dark", !light);
  root.style.colorScheme = snapshot.mode;
  const cssTokens: Record<string, string> = {
    "--misty-theme-workspace": mix(tokens.background, "#000000", light ? 0.02 : 0.18),
    "--misty-theme-bg": tokens.background,
    "--misty-theme-sidebar": tokens.surface,
    "--misty-theme-card": tokens.surfaceRaised,
    "--misty-theme-border": tokens.border,
    "--misty-theme-hover": tokens.surfaceHover,
    "--misty-theme-active": tokens.selection,
    "--misty-theme-text": tokens.text,
    "--misty-theme-text-bright": mix(tokens.text, light ? "#000000" : "#FFFFFF", 0.08),
    "--misty-theme-text-muted": tokens.textMuted,
    "--misty-theme-danger": tokens.danger,
  };
  for (const [name, value] of Object.entries({ ...cssTokens, ...tabChrome[snapshot.mode] }))
    root.style.setProperty(name, value);
  useAppThemeStore.getState().setResolvedTheme(snapshot.mode);
}

function mix(first: string, second: string, weight: number): string {
  const ratio = Math.min(1, Math.max(0, weight));
  const channels = [1, 3, 5].map((index) => {
    const start = Number.parseInt(first.slice(index, index + 2), 16);
    const end = Number.parseInt(second.slice(index, index + 2), 16);
    return Math.round(start + (end - start) * ratio)
      .toString(16)
      .padStart(2, "0");
  });
  return `#${channels.join("")}`.toUpperCase();
}
