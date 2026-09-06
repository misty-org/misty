import { invoke } from "@tauri-apps/api/core";

/** Zoom factors keyed by host; 100% is never stored. */
export type SiteZoomLevels = Record<string, number>;

/** Oldest sites drop off first so the account setting stays small. */
const maxSites = 200;

function validFactor(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0.25 && value <= 5;
}

/** Stored as `[{ host, factor }]`, the list shape structured account settings use. */
export function parseSiteZoomLevels(raw: string): SiteZoomLevels {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return {};
    const levels: SiteZoomLevels = {};
    for (const entry of parsed) {
      if (!entry || typeof entry !== "object") continue;
      const { host, factor } = entry as { host?: unknown; factor?: unknown };
      if (typeof host === "string" && host.length > 0 && validFactor(factor) && factor !== 1)
        levels[host.toLowerCase()] = factor;
    }
    return levels;
  } catch {
    return {};
  }
}

/** The host a level is stored under; matches the native `site_key`. */
export function siteZoomKey(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.toLowerCase() || null;
  } catch {
    return null;
  }
}

export function siteZoomPercent(levels: SiteZoomLevels, url: string): number {
  const key = siteZoomKey(url);
  const factor = key ? levels[key] : undefined;
  return factor ? Math.round(factor * 100) : 100;
}

/** The setting value after this site's level changes, or null for pages without a site. */
export function siteZoomSettingWith(raw: string, url: string, factor: number): string | null {
  const key = siteZoomKey(url);
  if (!key) return null;
  const entries = Object.entries(parseSiteZoomLevels(raw)).filter(([host]) => host !== key);
  // The most recently changed site goes last, so trimming drops the stalest.
  if (factor !== 1) entries.push([key, factor]);
  return JSON.stringify(entries.slice(-maxSites).map(([host, level]) => ({ host, factor: level })));
}

let pushed: string | null = null;

/** Sends the account's levels to the native browser, which applies them on every page load. */
export function configureBrowserSiteZoom(raw: string): void {
  const levels = parseSiteZoomLevels(raw);
  const signature = JSON.stringify(levels);
  if (signature === pushed) return;
  pushed = signature;
  void invoke<void>("browser_set_site_zoom_levels", { levelsBySite: levels }).catch(() => {
    pushed = null;
  });
}
