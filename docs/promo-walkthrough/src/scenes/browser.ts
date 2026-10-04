import { groupName } from "../data/project";
import type { AppState, BrowserState, Tab } from "../film/state";
import { linear, typed } from "../film/time";
import { base, tabs, wide, type SceneScript } from "./common";

const ADDRESS = "webguide.example/launch-checklist";
const T = {
  newTab: 7.9,
  typeAddress: 8.15,
  enter: 9.6,
  images: 10.7,
  staging: 11.3,
  checklist: 11.9,
  menu1: 12.5,
  submenu1: 12.95,
  newGroup: 13.4,
  typeName: 13.6,
  done: 14.75,
  menu2: 15.2,
  submenu2: 15.55,
  join: 15.95,
};
const ADDRESS_CPS = 26;
const NAME_CPS = 20;

function browserFor(active: string, t: number): BrowserState {
  if (active !== "checklist") return { site: active as BrowserState["site"], scroll: 0 };
  if (t < T.enter) return { site: "checklist", scroll: 0, address: typed(ADDRESS, t, T.typeAddress, ADDRESS_CPS), loading: 0 };
  return { site: "checklist", scroll: 0, loading: t < T.enter + 0.5 ? linear(t, T.enter, 0.5) : undefined };
}

/** Desktop window from the opening shot until Spaces. */
export function browserApp(t: number): AppState {
  const opened = t >= T.newTab;
  const checklist: Tab = t >= T.enter + 0.3 ? tabs.checklist : tabs.newTab;
  let active = opened ? "checklist" : "staging";
  if (t >= T.images) active = "images";
  if (t >= T.staging) active = "staging";
  if (t >= T.checklist) active = "checklist";
  const grouped = t >= T.newGroup;
  const joined = t >= T.join;
  const list: Tab[] = [
    tabs.staging,
    tabs.cms,
    { ...tabs.images, grouped: joined },
    ...(opened ? [{ ...checklist, grouped }] : []),
  ];
  const state = base({ tabs: list, active, browser: browserFor(active, t) });
  if (grouped)
    state.group = {
      name: t >= T.done ? groupName : typed(groupName, t, T.typeName, NAME_CPS),
      reveal: linear(t, T.newGroup, 0.3),
    };
  if (t >= T.menu1 && t < T.newGroup)
    state.tabMenu = { tabId: "checklist", submenu: t >= T.submenu1, highlight: t >= T.newGroup - 0.25 ? "new" : "add" };
  if (t >= T.newGroup + 0.05 && t < T.done + 0.08)
    state.groupEditor = { name: typed(groupName, t, T.typeName, NAME_CPS), caret: true, done: t >= T.done };
  if (t >= T.menu2 && t < T.join)
    state.tabMenu = { tabId: "images", submenu: t >= T.submenu2, highlight: "add" };
  return state;
}

export const browserScript: SceneScript = {
  moves: [
    { at: 7.25, to: [900, 520], dur: 0 },
    { at: T.newTab, to: "desktop:tab-new", click: true, dur: 0.6 },
    { at: T.enter, to: "desktop:omnibox", dur: 0.5, anchor: { x: 0.62, y: 0.5 } },
    { at: T.images, to: "desktop:tab-images", click: true, dur: 0.5 },
    { at: T.staging, to: "desktop:tab-staging", click: true, dur: 0.4 },
    { at: T.checklist, to: "desktop:tab-checklist", click: true, dur: 0.45 },
    { at: T.menu1, to: "desktop:tab-checklist", click: true, dur: 0.3, anchor: { x: 0.4, y: 0.5 } },
    { at: T.submenu1, to: "desktop:menu-add-group", dur: 0.4 },
    { at: T.newGroup, to: "desktop:menu-new-group", click: true, dur: 0.4 },
    { at: T.done, to: "desktop:group-done", click: true, dur: 0.55 },
    { at: T.menu2, to: "desktop:tab-images", click: true, dur: 0.4 },
    { at: T.submenu2, to: "desktop:menu-add-group", dur: 0.35 },
    { at: T.join, to: "desktop:menu-existing-group", click: true, dur: 0.38 },
    { at: 16.7, to: "desktop:group-label", dur: 0.6 },
  ],
  cams: [
    wide(3.4, 1.06),
    wide(7.0, 1.12),
    { t: 7.7, at: [560, 260], zoom: 1.55 },
    { t: 9.7, at: [560, 260], zoom: 1.55 },
    { t: 10.4, at: [720, 400], zoom: 1.24 },
    { t: 12.1, at: [720, 400], zoom: 1.24 },
    { t: 12.8, at: [620, 230], zoom: 1.8 },
    { t: 16.2, at: [620, 230], zoom: 1.8 },
    wide(17.0, 1.16),
  ],
  typing: [
    { start: T.typeAddress, chars: ADDRESS.length, cps: ADDRESS_CPS },
    { start: T.typeName, chars: groupName.length, cps: NAME_CPS },
  ],
  chimes: [],
  keys: [T.enter],
};
