import { invoke } from "@tauri-apps/api/core";

/** A site's own look: extra CSS (hidden elements included) and an optional dark mode. */
export interface SiteStyle {
  host: string;
  css: string;
  dark: boolean;
}

export function parseSiteStyles(raw: string): SiteStyle[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((entry) => {
      if (!entry || typeof entry !== "object") return [];
      const { host, css, dark } = entry as Record<string, unknown>;
      if (typeof host !== "string" || !host || host.length > 253) return [];
      return [
        {
          host: host.toLowerCase(),
          css: typeof css === "string" ? css.slice(0, 32_768) : "",
          dark: dark === true,
        },
      ];
    });
  } catch {
    return [];
  }
}

/** The site a page's style is stored under: its host without `www.`. */
export function siteStyleHost(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

/** The setting after one site's style changes; an empty style removes the site. */
export function siteStylesWith(raw: string, host: string, style: Omit<SiteStyle, "host">): string {
  const rest = parseSiteStyles(raw).filter((entry) => entry.host !== host);
  const keep = style.css.trim() || style.dark;
  return JSON.stringify(keep ? [...rest, { host, css: style.css, dark: style.dark }] : rest);
}

let pushed: string | null = null;

/** Sends the account's site styles to the native browser, which applies them per page. */
export function configureBrowserSiteStyles(raw: string): void {
  const sites = parseSiteStyles(raw);
  const signature = JSON.stringify(sites);
  if (signature === pushed) return;
  pushed = signature;
  void invoke<void>("browser_set_site_styles", { sites }).catch(() => {
    pushed = null;
  });
}
