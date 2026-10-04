import { sharedNote } from "../data/project";
import type { AppState, SpaceState } from "../film/state";
import { typed } from "../film/time";
import { base, group, groupedTabs, tabs, wide, type SceneScript } from "./common";

// Personal Space 17–29.5s, shared Space 29.5–42s: equal time for each.
const P = { open: 17.25, brief: 18.2, planner: 21.6, library: 25.2 };
const S = {
  open: 29.35,
  message: 31.0,
  note: 32.7,
  caret: 33.5,
  type: 33.7,
  planner: 36.6,
  row: 37.35,
  field: 38.35,
  pick: 39.25,
  close: 40.45,
};
const ADD_CPS = 20;

function personal(t: number): SpaceState {
  if (t >= P.library) return { space: "personal", section: "library" };
  if (t >= P.planner) return { space: "personal", section: "planner" };
  if (t >= P.brief) return { space: "personal", section: "journal", open: "brief" };
  return { space: "personal", section: "journal" };
}

function team(t: number): SpaceState {
  if (t >= S.planner) {
    const assign =
      t >= S.close ? "done" : t >= S.pick ? "assigned" : t >= S.field ? "menu" : t >= S.row ? "open" : undefined;
    return { space: "team", section: "planner", assign, menuHighlight: t >= S.pick - 0.3 ? "sam" : undefined };
  }
  if (t >= S.note)
    return {
      space: "team",
      section: "journal",
      open: "homepage-copy",
      noteAddition: t >= S.caret ? typed(sharedNote.addition, t, S.type, ADD_CPS) : undefined,
    };
  return { space: "team", section: "chat", open: "everyone", messageCount: t >= S.message ? 3 : 2 };
}

export function spacesApp(t: number): AppState {
  if (t < S.open)
    return base({ rail: "space-personal", group, tabs: groupedTabs(tabs.personal), active: "space", space: personal(t) });
  return base({ rail: "space-team", group, tabs: groupedTabs(tabs.team), active: "space", space: team(t) });
}

export const spacesScript: SceneScript = {
  moves: [
    { at: P.open, to: "desktop:rail-space-personal", click: true, dur: 0.55 },
    { at: P.brief, to: "desktop:row-Launch brief", click: true, dur: 0.6, anchor: { x: 0, y: 0.5 } },
    { at: 20.2, to: "desktop:brief-requirements", dur: 1.2, anchor: { x: 0.85, y: 0.3 } },
    { at: P.planner, to: "desktop:space-personal-planner", click: true, dur: 0.7 },
    { at: 23.6, to: "desktop:row-Export hero images", dur: 1, anchor: { x: 0, y: 0.5 } },
    { at: P.library, to: "desktop:space-personal-library", click: true, dur: 0.6 },
    { at: 27.0, to: "desktop:row-Homepage wireframe.png", dur: 1.1 },
    { at: S.open, to: "desktop:rail-space-team", click: true, dur: 0.7 },
    { at: S.note, to: "desktop:chat-note-link", click: true, dur: 0.9 },
    { at: S.caret, to: "desktop:shared-addition", click: true, dur: 0.6, anchor: { x: 0.02, y: 0.5 } },
    { at: S.planner, to: "desktop:space-team-planner", click: true, dur: 0.7 },
    { at: S.row, to: "desktop:row-Export hero images", click: true, dur: 0.6, anchor: { x: 0, y: 0.5 } },
    { at: S.field, to: "desktop:assignee-field", click: true, dur: 0.6, anchor: { x: 0.3, y: 0.5 } },
    { at: S.pick, to: "desktop:assignee-sam", click: true, dur: 0.55, anchor: { x: 0.3, y: 0.5 } },
    { at: S.close, to: "desktop:drawer-close", click: true, dur: 0.6 },
  ],
  cams: [
    wide(17.0, 1.16),
    wide(17.6, 1.16),
    { t: 18.6, at: "desktop:brief-body", zoom: 1.62, dy: -40 },
    { t: 21.3, at: "desktop:brief-body", zoom: 1.62, dy: 30 },
    { t: 22.0, at: [820, 300], zoom: 1.5 },
    { t: 24.8, at: [820, 300], zoom: 1.5 },
    { t: 25.6, at: [860, 360], zoom: 1.3 },
    { t: 28.8, at: [860, 360], zoom: 1.36 },
    { t: 29.6, at: [700, 300], zoom: 1.5 },
    { t: 32.3, at: [700, 310], zoom: 1.5 },
    { t: 33.1, at: "desktop:shared-body", zoom: 1.6, dy: 40 },
    { t: 36.2, at: "desktop:shared-body", zoom: 1.6, dy: 80 },
    { t: 37.1, at: [880, 320], zoom: 1.35 },
    { t: 37.8, at: [1150, 330], zoom: 1.7 },
    { t: 40.2, at: [1150, 330], zoom: 1.7 },
    { t: 40.9, at: [860, 300], zoom: 1.45 },
    { t: 41.7, at: [860, 300], zoom: 1.45 },
  ],
  typing: [{ start: S.type, chars: sharedNote.addition.length, cps: ADD_CPS }],
  chimes: [S.message],
};
