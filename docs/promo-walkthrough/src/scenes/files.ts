import type { AppState, FilesState } from "../film/state";
import { linear } from "../film/time";
import { base, group, groupedTabs, tabs, type SceneScript } from "./common";

const T = {
  open: 42.15,
  studio: 43.45,
  folder: 45.0,
  hero: 46.05,
  copy: 48.45,
  local: 49.15,
  paste: 49.85,
  transfers: 50.55,
  done: 52.7,
  back: 53.3,
};

function files(t: number): FilesState {
  if (t >= T.back) return { location: "documents-launch", pasted: true, highlightRow: "hero-photo.jpg" };
  if (t >= T.local)
    return { location: "documents-launch", menu: t >= T.paste && t < T.paste + 0.3 ? { highlight: "paste" } : undefined };
  if (t >= T.hero)
    return {
      location: "studio-launch",
      selected: "hero-photo.jpg",
      preview: true,
      menu: t >= T.copy && t < T.copy + 0.3 ? { highlight: "copy" } : undefined,
    };
  if (t >= T.folder) return { location: "studio-launch", highlightRow: "hero-photo.jpg" };
  if (t >= T.studio) return { location: "studio" };
  return { location: "home" };
}

export function filesApp(t: number): AppState {
  const visited = t >= T.transfers ? [tabs.files, tabs.transfers] : [tabs.files];
  const showTransfers = t >= T.transfers && t < T.back;
  return base({
    rail: showTransfers ? "transfers" : "explorer",
    group,
    tabs: groupedTabs(tabs.team, ...visited),
    active: showTransfers ? "transfers" : "files",
    files: { ...files(t), transfer: 0.06 + 0.94 * linear(t, T.transfers + 0.15, T.done - T.transfers - 0.15) },
  });
}

export const filesScript: SceneScript = {
  moves: [
    { at: T.open, to: "desktop:rail-explorer", click: true, dur: 0.45 },
    { at: T.studio, to: "desktop:files-studio", click: true, dur: 0.7, anchor: { x: 0.35, y: 0.5 } },
    { at: T.folder - 0.18, to: "desktop:file-Website launch", click: true, dur: 0.75, anchor: { x: 0.15, y: 0.5 } },
    { at: T.folder, to: "desktop:file-Website launch", click: true, dur: 0.05, anchor: { x: 0.15, y: 0.5 } },
    { at: T.hero, to: "desktop:file-hero-photo.jpg", click: true, dur: 0.5, anchor: { x: 0.15, y: 0.5 } },
    { at: T.copy, to: "desktop:files-copy", click: true, dur: 0.7 },
    { at: T.local, to: "desktop:files-qa-launch", click: true, dur: 0.55 },
    { at: T.paste, to: "desktop:files-paste", click: true, dur: 0.5 },
    { at: T.transfers, to: "desktop:rail-transfers", click: true, dur: 0.5 },
    { at: 51.6, to: "desktop:transfer-progress", dur: 0.9 },
    { at: T.back, to: "desktop:tab-files", click: true, dur: 0.55 },
  ],
  cams: [
    { t: 42.0, at: [860, 300], zoom: 1.4 },
    { t: 42.6, at: [700, 420], zoom: 1.25 },
    { t: 43.6, at: "desktop:files-studio", zoom: 2.05, dx: 160, dy: -40 },
    { t: 44.8, at: "desktop:files-studio", zoom: 2.05, dx: 160, dy: -40 },
    { t: 45.6, at: [800, 300], zoom: 1.45 },
    { t: 46.6, at: "desktop:files-preview", zoom: 1.65, dx: -220, dy: 20 },
    { t: 48.1, at: "desktop:files-preview", zoom: 1.65, dx: -220, dy: 20 },
    { t: 48.9, at: [620, 330], zoom: 1.32 },
    { t: 50.3, at: [620, 330], zoom: 1.32 },
    { t: 51.0, at: [640, 250], zoom: 1.55 },
    { t: 53.0, at: [640, 250], zoom: 1.55 },
    { t: 53.7, at: [760, 300], zoom: 1.4 },
  ],
  typing: [],
  chimes: [T.done],
};

export const filesTimes = T;
