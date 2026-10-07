import { agentsApp, agentsScript } from "../scenes/agents";
import { browserApp, browserScript } from "../scenes/browser";
import { DESKTOP, LAPTOP, type SceneScript } from "../scenes/common";
import { filesApp, filesScript } from "../scenes/files";
import { spacesApp, spacesScript } from "../scenes/spaces";
import { bezelOpacity, desktopDim, desktopSync, laptopSync, S, syncScript } from "../scenes/sync";
import type { CamKey, Move } from "./motion";
import type { AppState } from "./state";
import { ramp, rise, window01 } from "./time";

export type Placement = {
  id: "desktop" | "laptop";
  state: AppState;
  x: number;
  y: number;
  w: number;
  h: number;
  opacity: number;
  dim: number;
};

export const scripts: SceneScript[] = [browserScript, spacesScript, filesScript, agentsScript, syncScript];

/** The cursor leaves the frame between computers and during the comparison. */
const teleports: Move[] = [{ at: 72.95, to: "laptop:content", dur: 0, anchor: { x: 0.55, y: 0.6 } }];
export const moves: Move[] = [...scripts.flatMap((script) => script.moves), ...teleports].sort((a, b) => a.at - b.at);
export const cams: CamKey[] = scripts.flatMap((script) => script.cams).sort((a, b) => a.t - b.t);
const hidden: [number, number][] = [
  [0, 7.15],
  [S.pullOut + 0.1, 72.95],
  [S.compareIn - 0.05, S.compareOut + 0.05],
  [84, 91],
];
export const cursorVisible = (t: number) => !hidden.some(([a, b]) => t >= a && t < b);

function desktopState(t: number): AppState {
  if (t < 17) return browserApp(t);
  if (t < 42) return spacesApp(t);
  if (t < 54) return filesApp(t);
  if (t < 66) return agentsApp(t);
  return desktopSync(t);
}

export function placements(t: number): Placement[] {
  const intro = rise(t, 3.3, 1.4);
  const list: Placement[] = [
    {
      id: "desktop",
      state: desktopState(t),
      x: 0,
      y: 90 * (1 - intro),
      ...DESKTOP,
      opacity: intro,
      dim: t >= 66 ? desktopDim(t) : 0,
    },
  ];
  if (t >= 69.5) list.push({ id: "laptop", state: laptopSync(t), x: LAPTOP.x, y: LAPTOP.y, w: LAPTOP.w, h: LAPTOP.h, opacity: 1, dim: 0 });
  return list;
}

export type Callout = { target: string; at: number; text: string; opacity: number; dx: number; dy: number };

export function frameExtras(t: number) {
  return {
    bezels: t >= 66 ? bezelOpacity(t) : 0,
    compare: window01(t, S.compareIn, S.compareOut, 0.35),
    logoIntro: window01(t, 0.25, 3.75, 0.8),
    logoClose: ramp(t, 84.7, 0.9) * (1 - ramp(t, 89.35, 0.6)),
    blackout: ramp(t, 84.0, 0.7),
    callouts: [
      {
        target: "desktop:files-studio-meta",
        at: 43.45,
        text: "Local network",
        opacity: window01(t, 43.75, 45.05, 0.25),
        dx: 150,
        dy: 0,
      },
    ] satisfies Callout[],
  };
}

/** The desktop as it was left, shown beside the laptop in the comparison. */
export const FROZEN = S.pullOut + 0.05;
const panel = (win: "desktop" | "laptop", fit: number, center: [number, number]): CamKey[] => [
  { t: S.compareIn, at: center, zoom: fit },
  { t: 78.75, at: center, zoom: fit },
  { t: 79.35, at: `${win}:tab-group`, zoom: 1.45, dx: 190, dy: 190 },
  { t: 79.95, at: `${win}:tab-group`, zoom: 1.45, dx: 190, dy: 190 },
  { t: 80.6, at: `${win}:contact-message`, zoom: 1.5, dx: -60, dy: -30 },
  { t: S.compareOut, at: `${win}:contact-message`, zoom: 1.5, dx: -60, dy: -30 },
];
export const compareCams = {
  desktop: panel("desktop", 860 / DESKTOP.w, [DESKTOP.w / 2, DESKTOP.h / 2]),
  laptop: panel("laptop", 860 / LAPTOP.w, [LAPTOP.w / 2, LAPTOP.h / 2]),
};
export const compareChips = [
  { label: "Same tabs", at: 79.3 },
  { label: "Same scroll position", at: 80.45 },
  { label: "Same form text", at: 80.75 },
];
