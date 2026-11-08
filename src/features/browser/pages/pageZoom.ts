import { settingsString, useSettingsStore } from "@/features/settings";
import {
  parseSiteZoomLevels,
  siteZoomKey,
  siteZoomPercent,
  siteZoomSettingWith,
} from "../webviews/siteZoom";
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";

/** The page zoom steps, in percent, shared by the menu's zoom row and Cmd/Ctrl +, - and 0. */
export const pageZoomLevels = [
  25, 33, 50, 67, 75, 80, 90, 100, 110, 125, 150, 175, 200, 250, 300, 400, 500,
];

/** Private tabs zoom only themselves and never save a level; this holds theirs by runtime id. */
export const usePrivatePageZoom = create<{ levels: Record<string, number> }>(() => ({
  levels: {},
}));

function siteZoomSetting(): string {
  return settingsString(
    useSettingsStore.getState().settings?.document ?? {},
    "general",
    "browser_site_zoom_json",
    "[]",
  );
}

/** The level the page shows now: the site's saved one, or a private tab's own. */
function pageZoomPercent(runtimeId: string, url: string, privateTab: boolean): number {
  if (privateTab) return usePrivatePageZoom.getState().levels[runtimeId] ?? 100;
  return siteZoomKey(url) ? siteZoomPercent(parseSiteZoomLevels(siteZoomSetting()), url) : 100;
}

/** Zooms the page and remembers the level for its site (or for the private tab only). */
export async function setPageZoom(
  runtimeId: string,
  url: string,
  privateTab: boolean,
  factor: number,
): Promise<void> {
  await invoke("browser_webview_set_zoom", { request: { id: runtimeId, factor } });
  if (privateTab) {
    usePrivatePageZoom.setState((state) => ({
      levels: { ...state.levels, [runtimeId]: Math.round(factor * 100) },
    }));
    return;
  }
  const raw = siteZoomSetting();
  const next = siteZoomSettingWith(raw, url, factor);
  if (next !== null && next !== raw)
    useSettingsStore.getState().updateSetting("general", "browser_site_zoom_json", next);
}

/** One step in or out, or back to 100%. Nothing happens past the last step. */
export async function stepPageZoom(
  runtimeId: string,
  url: string,
  privateTab: boolean,
  direction: "in" | "out" | "reset",
): Promise<void> {
  const percent = pageZoomPercent(runtimeId, url, privateTab);
  const next =
    direction === "reset"
      ? 100
      : direction === "in"
        ? pageZoomLevels.find((level) => level > percent)
        : [...pageZoomLevels].reverse().find((level) => level < percent);
  if (next === undefined || next === percent) return;
  await setPageZoom(runtimeId, url, privateTab, next / 100);
}
