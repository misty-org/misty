/** Page-state restore preferences, mirrored from Settings → Privacy. */
export interface PageRestoreSettings {
  enabled: boolean;
  agent: boolean;
  excludedSites: string[];
}

let current: PageRestoreSettings = { enabled: true, agent: true, excludedSites: [] };

export function configurePageRestore(next: {
  enabled: boolean;
  agent: boolean;
  excludedSites: string;
}) {
  current = {
    enabled: next.enabled,
    agent: next.enabled && next.agent,
    excludedSites: parseSiteList(next.excludedSites),
  };
}

export const pageRestoreSettings = () => current;

export function parseSiteList(value: string): string[] {
  return [
    ...new Set(
      value
        .split(/[\s,]+/)
        .map((site) =>
          site
            .trim()
            .toLowerCase()
            .replace(/^https?:\/\//, "")
            .replace(/\/.*$/, ""),
        )
        .filter((site) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(site)),
    ),
  ];
}

/** A site and all its subdomains are excluded: capture URL and scroll only. */
export function isExcludedSite(url: string, sites = current.excludedSites): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return sites.some((site) => host === site || host.endsWith(`.${site}`));
}
