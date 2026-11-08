let excludedSites: string[] = [];

/** The sites whose pages keep no page state, from Settings › Privacy. */
export function configureExcludedSites(value: string) {
  excludedSites = parseSiteList(value);
}

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
export function isExcludedSite(url: string, sites = excludedSites): boolean {
  let host: string;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return true;
  }
  return sites.some((site) => host === site || host.endsWith(`.${site}`));
}
