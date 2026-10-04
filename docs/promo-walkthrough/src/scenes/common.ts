import { groupName, sites, type SiteId } from "../data/project";
import type { CamKey, Move } from "../film/motion";
import type { AppState, Tab } from "../film/state";

export const DESKTOP = { w: 1440, h: 900 };
export const LAPTOP = { w: 1280, h: 800, x: 1960, y: 150 };

const site = (id: SiteId, grouped = false): Tab => ({ id, kind: "site", title: sites[id].title, site: id, grouped });

export const tabs = {
  staging: site("staging"),
  cms: site("cms"),
  images: site("images"),
  newTab: { id: "checklist", kind: "site", title: "New tab" } as Tab,
  checklist: site("checklist"),
  personal: { id: "space", kind: "space", title: "Personal" } as Tab,
  team: { id: "space", kind: "space", title: "Website launch" } as Tab,
  files: { id: "files", kind: "explorer", title: "Files" } as Tab,
  transfers: { id: "transfers", kind: "transfers", title: "Transfers" } as Tab,
  agents: { id: "agents", kind: "agents", title: "Agents" } as Tab,
};

/** Tabs once the research tabs are grouped, plus the destinations visited so far. */
export function groupedTabs(...extra: Tab[]): Tab[] {
  return [tabs.staging, tabs.cms, { ...tabs.images, grouped: true }, { ...tabs.checklist, grouped: true }, ...extra];
}
export const group = { name: groupName, reveal: 1 };

export function base(partial: Partial<AppState>): AppState {
  return { device: "desktop", rail: "browser", tabs: [], active: "staging", ...partial };
}

/** Index of the last threshold reached, for stepping through discrete UI states. */
export function step(t: number, times: number[]) {
  let index = -1;
  for (const time of times) if (t >= time) index++;
  return index;
}

export type SceneScript = {
  moves: Move[];
  cams: CamKey[];
  /** Typing spans for the soundtrack: start, characters, characters per second. */
  typing: { start: number; chars: number; cps: number }[];
  /** Short confirmation tones: transfer finished, reply arrived, workspace restored. */
  chimes: number[];
  /** Single key presses such as Return. */
  keys?: number[];
};

export const wide = (t: number, zoom = 1.12): CamKey => ({ t, at: [DESKTOP.w / 2, DESKTOP.h / 2], zoom });
