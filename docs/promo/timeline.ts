export const FPS = 30;
export const DURATION = 90;
export const WIDTH = 1920;
export const HEIGHT = 1080;
export const scenes = [
  {
    start: 0,
    end: 7,
    id: "intro",
    title: "Misty",
    subtitle: "Browser · Spaces · Files · Agents · Sync",
    still: 4.8,
  },
  { start: 7, end: 17, id: "browser", title: "Browser", subtitle: "", still: 15.5 },
  {
    start: 17,
    end: 30,
    id: "spaces",
    title: "Spaces",
    subtitle: "Notes, tasks, and files",
    still: 21.6,
  },
  { start: 30, end: 42, id: "shared", title: "Shared spaces", subtitle: "", still: 34.2 },
  {
    start: 42,
    end: 54,
    id: "files",
    title: "Files",
    subtitle: "Local drives and connected computers",
    still: 51.5,
  },
  { start: 54, end: 66, id: "agents", title: "Agents", subtitle: "", still: 63.2 },
  {
    start: 66,
    end: 84,
    id: "sync",
    title: "Session sync",
    subtitle: "Continue on another computer",
    still: 80.5,
  },
  { start: 84, end: 90, id: "close", title: "Misty", subtitle: "Try the beta", still: 87.5 },
] as const;
export type Scene = (typeof scenes)[number];
export const clamp = (x: number) => Math.min(1, Math.max(0, x));
export const ease = (x: number) => {
  const v = clamp(x);
  return 1 - Math.pow(1 - v, 3);
};
export const progress = (time: number, start: number, duration: number) =>
  ease((time - start) / duration);
export const linear = (time: number, start: number, duration: number) =>
  clamp((time - start) / duration);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const sceneAt = (t: number) =>
  scenes.find((s) => t >= s.start && t < s.end) ?? scenes[scenes.length - 1];
export const typed = (value: string, t: number, start: number, duration: number) =>
  value.slice(0, Math.floor(value.length * linear(t, start, duration)));
export const clickTimes = [
  8.7, 10.4, 12.25, 14.1, 18.2, 22.5, 26.2, 31.6, 36.2, 39.3, 43.7, 46, 48.3, 55.5, 58.3, 70.2,
  75.5, 81.2,
];
