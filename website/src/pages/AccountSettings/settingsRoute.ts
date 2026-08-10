import { TABS, type Tab } from "./tabs";

export const SETTINGS_PATH = "/settings";

/**
 * The settings dialog is reachable two ways, and they behave differently on
 * purpose:
 *
 * - From the nav menu it is an overlay over whatever page you are on, and the
 *   URL must not change (the e2e asserts you stay on /pricing).
 * - From a URL — which is how the desktop app hands off — it is addressable, so
 *   the path sticks, the tab is shareable, and a reload returns you to it.
 *
 * These helpers are the single definition of that second form.
 */
export function settingsTabFromPathname(pathname: string): Tab | null {
  const trimmed = pathname.replace(/\/+$/, "") || "/";
  if (trimmed === SETTINGS_PATH) return TABS[0].id;
  if (!trimmed.startsWith(`${SETTINGS_PATH}/`)) return null;

  const segment = trimmed.slice(SETTINGS_PATH.length + 1);
  return TABS.find((tab) => tab.id === segment)?.id ?? null;
}

export function settingsPathForTab(tab: Tab): string {
  return `${SETTINGS_PATH}/${tab}`;
}

/**
 * Whether a path is a settings URL at all — including an unknown tab, which
 * `settingsTabFromPathname` reports as null so the caller can redirect to the
 * default tab rather than render nothing.
 */
export function isSettingsPathname(pathname: string): boolean {
  const trimmed = pathname.replace(/\/+$/, "") || "/";
  return trimmed === SETTINGS_PATH || trimmed.startsWith(`${SETTINGS_PATH}/`);
}
