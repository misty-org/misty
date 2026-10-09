import { invoke } from "@tauri-apps/api/core";

/** Sites (hosts) where ad and tracker blocking is off, subdomains included. */
export function parseContentBlockingAllowedSites(raw: string): string[] {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const hosts = parsed.flatMap((entry) => {
      const host = entry && typeof entry === "object" ? (entry as { host?: unknown }).host : null;
      return typeof host === "string" && host.length > 0 && host.length <= 253
        ? [host.toLowerCase()]
        : [];
    });
    return [...new Set(hosts)];
  } catch {
    return [];
  }
}

/** The site a page's blocking choice is stored under: its host without `www.`. */
export function contentBlockingSite(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    return parsed.hostname.toLowerCase().replace(/^www\./, "") || null;
  } catch {
    return null;
  }
}

export function contentBlockingAllowedOn(allowed: readonly string[], url: string): boolean {
  const site = contentBlockingSite(url);
  return Boolean(site) && allowed.some((host) => site === host || site!.endsWith(`.${host}`));
}

/** The setting value after turning blocking on or off for one site. */
export function contentBlockingSettingWith(
  raw: string,
  url: string,
  blocked: boolean,
): string | null {
  const site = contentBlockingSite(url);
  if (!site) return null;
  const allowed = parseContentBlockingAllowedSites(raw).filter(
    (host) => host !== site && !site.endsWith(`.${host}`),
  );
  if (!blocked) allowed.push(site);
  return JSON.stringify(allowed.map((host) => ({ host })));
}

let pushed: string | null = null;

/** Sends the account's blocking choice to the native browser, which filters every page. */
export function configureBrowserContentBlocking(enabled: boolean, allowedRaw: string): void {
  const allowedSites = parseContentBlockingAllowedSites(allowedRaw);
  const signature = JSON.stringify([enabled, allowedSites]);
  if (signature === pushed) return;
  pushed = signature;
  void invoke<void>("browser_set_content_blocking", { enabled, allowedSites }).catch(() => {
    pushed = null;
  });
}
