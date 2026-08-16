import { contactDraft } from "../data/project";
import type { AppState } from "../film/state";
import { linear, ramp, typed, typingEnd } from "../film/time";
import { base, DESKTOP, group, groupedTabs, LAPTOP, tabs, type SceneScript } from "./common";

export const SCROLL = 930;
const CPS = 22;
const RESUME = " Checked again on the laptop.";
export const S = {
  staging: 66.35,
  scroll: 66.6,
  caret: 67.75,
  type: 67.9,
  pullOut: 70.2,
  dim: 71.0,
  sync: 73.55,
  open: 74.45,
  arrive: 75.35,
  restored: 77.15,
  dismiss: 77.45,
  compareIn: 77.7,
  compareOut: 81.9,
  resumeClick: 82.2,
  resume: 82.4,
};
const typedEnd = typingEnd(contactDraft, S.type, CPS);
const workspaceTabs = groupedTabs(tabs.team, tabs.files, tabs.transfers, tabs.agents);
/** Restore progress 0 → 1 across the four restored pages (see SyncPopup). */
export const restoreAt = (t: number) => linear(t, S.arrive, S.restored - S.arrive);

export function desktopSync(t: number): AppState {
  const active = t >= S.staging ? "staging" : "agents";
  return base({
    rail: active === "staging" ? "browser" : "agents",
    group,
    tabs: workspaceTabs,
    active,
    browser: {
      site: "staging",
      scroll: SCROLL * ramp(t, S.scroll, 0.9),
      contactMessage: typed(contactDraft, t, S.type, CPS),
      caret: t >= S.caret && t < S.pullOut,
    },
    agents: { agent: "project-planner", attachment: true, draft: "", sent: true, working: 1, reply: 1 },
  });
}

export function laptopSync(t: number): AppState {
  const sync = t >= S.sync && t < S.dismiss ? { open: true, opening: t >= S.open, restore: t >= S.arrive ? restoreAt(t) : undefined } : undefined;
  if (t < S.arrive)
    return base({ device: "laptop", rail: "home", tabs: [{ id: "home", kind: "home", title: "Home" }], active: "home", empty: true, sync, pressed: t >= S.sync - 0.05 && t < S.sync + 0.15 ? "rail-sync" : undefined });
  // The staging page loads first, then its scroll position and form text are restored.
  const pageBack = S.arrive + (S.restored - S.arrive) * 0.45;
  const resumed = t >= S.resume ? typed(RESUME, t, S.resume, CPS) : "";
  return base({
    device: "laptop",
    rail: "browser",
    group,
    tabs: workspaceTabs,
    active: "staging",
    sync,
    browser: {
      site: "staging",
      scroll: t < pageBack ? 0 : SCROLL * ramp(t, pageBack, 0.35),
      loading: t < pageBack ? linear(t, S.arrive, pageBack - S.arrive) : undefined,
      contactMessage: t >= pageBack + 0.2 ? contactDraft + resumed : "",
      caret: t >= S.resumeClick,
    },
  });
}

/** Desktop dims once Alex steps away, before the laptop picks up the workspace. */
export const desktopDim = (t: number) => 0.62 * ramp(t, S.dim, 0.6);
export const bezelOpacity = (t: number) => ramp(t, S.pullOut, 0.9);

export const syncScript: SceneScript = {
  moves: [
    { at: S.staging, to: "desktop:tab-staging", click: true, dur: 0.6 },
    { at: S.caret, to: "desktop:contact-message", click: true, dur: 0.7, anchor: { x: 0.6, y: 0.6 } },
    { at: S.sync, to: "laptop:rail-sync", click: true, dur: 1.4 },
    { at: S.open, to: "laptop:sync-open-remote", click: true, dur: 0.6 },
    { at: S.dismiss, to: "laptop:page", click: true, dur: 0.7, anchor: { x: 0.75, y: 0.3 } },
    { at: S.resumeClick, to: "laptop:contact-message", click: true, dur: 0.5, anchor: { x: 0.85, y: 0.3 } },
  ],
  cams: [
    { t: 66.0, at: [840, 400], zoom: 1.6 },
    { t: 66.6, at: [DESKTOP.w / 2, DESKTOP.h / 2], zoom: 1.12 },
    { t: 67.5, at: "desktop:contact-message", zoom: 1.75, dy: -30 },
    { t: S.pullOut, at: "desktop:contact-message", zoom: 1.75, dy: -30 },
    { t: 71.3, at: [(LAPTOP.x + LAPTOP.w) / 2, 600], zoom: 0.5 },
    { t: 72.1, at: [(LAPTOP.x + LAPTOP.w) / 2, 600], zoom: 0.5 },
    { t: 72.9, at: [LAPTOP.x + LAPTOP.w / 2, LAPTOP.y + 470], zoom: 0.62 },
    { t: 73.6, at: "laptop:rail-sync", zoom: 1.5, dx: 330, dy: -150 },
    { t: 75.1, at: "laptop:rail-sync", zoom: 1.5, dx: 330, dy: -150 },
    { t: 75.9, at: [LAPTOP.x + 600, LAPTOP.y + 420], zoom: 1.2 },
    { t: 77.6, at: [LAPTOP.x + 600, LAPTOP.y + 420], zoom: 1.2 },
    { t: 81.9, at: "laptop:contact-message", zoom: 1.7, dy: -30 },
    { t: 84.0, at: "laptop:contact-message", zoom: 1.72, dy: -30 },
  ],
  typing: [
    { start: S.type, chars: contactDraft.length, cps: CPS },
    { start: S.resume, chars: RESUME.length, cps: CPS },
  ],
  chimes: [S.restored],
};

export const syncTimes = { typedEnd };
