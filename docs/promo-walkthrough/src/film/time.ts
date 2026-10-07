export const FPS = 30;
export const DURATION = 90;
export const WIDTH = 1920;
export const HEIGHT = 1080;

export type SceneId =
  | "intro"
  | "browser"
  | "spaces"
  | "shared"
  | "files"
  | "agents"
  | "sync"
  | "close";

export type Scene = {
  id: SceneId;
  start: number;
  end: number;
  name: string;
  title: string;
  subtitle?: string;
  /** A representative moment for the storyboard contact sheet. */
  still: number;
};

// Personal and shared Spaces split their 25 seconds evenly at 29.5s.
export const scenes: Scene[] = [
  { id: "intro", start: 0, end: 7, name: "Introduction", title: "Misty", subtitle: "Browser · Spaces · Files · Agents · Sync", still: 5.2 },
  { id: "browser", start: 7, end: 17, name: "Browser", title: "Browser", still: 15.6 },
  { id: "spaces", start: 17, end: 29.5, name: "Personal Spaces", title: "Spaces", subtitle: "Notes, tasks, and files", still: 19.6 },
  { id: "shared", start: 29.5, end: 42, name: "Collaboration", title: "Shared spaces", still: 33.4 },
  { id: "files", start: 42, end: 54, name: "File manager", title: "Files", subtitle: "Local drives and connected computers", still: 51.6 },
  { id: "agents", start: 54, end: 66, name: "Agents", title: "Agents", still: 64.4 },
  { id: "sync", start: 66, end: 84, name: "Sync and handoff", title: "Session sync", subtitle: "Continue on another computer", still: 81.2 },
  { id: "close", start: 84, end: 90, name: "Close", title: "Misty", subtitle: "Try the beta", still: 87.5 },
];

export const sceneAt = (t: number) =>
  scenes.find((scene) => t >= scene.start && t < scene.end) ?? scenes[scenes.length - 1];

export const clamp = (value: number, min = 0, max = 1) => Math.min(max, Math.max(min, value));
/** 0 → 1 over [start, start + duration]. */
export const linear = (t: number, start: number, duration: number) =>
  duration <= 0 ? (t >= start ? 1 : 0) : clamp((t - start) / duration);
export const easeOut = (x: number) => 1 - Math.pow(1 - clamp(x), 3);
export const easeInOut = (x: number) => {
  const v = clamp(x);
  return v < 0.5 ? 4 * v * v * v : 1 - Math.pow(-2 * v + 2, 3) / 2;
};
export const ramp = (t: number, start: number, duration: number) =>
  easeInOut(linear(t, start, duration));
export const rise = (t: number, start: number, duration: number) =>
  easeOut(linear(t, start, duration));
export const lerp = (a: number, b: number, k: number) => a + (b - a) * k;
/** Fade in at `start`, hold, fade out ending at `end`. */
export const window01 = (t: number, start: number, end: number, fade = 0.4) =>
  Math.min(linear(t, start, fade), 1 - linear(t, end - fade, fade));
export const between = (t: number, start: number, end: number) => t >= start && t < end;

/** Characters typed at a steady human pace; returns the visible prefix. */
export function typed(text: string, t: number, start: number, cps = 16) {
  if (t < start) return "";
  return text.slice(0, Math.min(text.length, Math.floor((t - start) * cps)));
}
export const typingEnd = (text: string, start: number, cps = 16) => start + text.length / cps;
