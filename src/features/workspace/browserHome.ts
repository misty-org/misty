import { blankBrowserUrl } from "./browserUrl";

/** Where a browser tab starts when nothing else asked for a URL. */
export const defaultBrowserHomeUrl = "https://www.google.com";

let configuredHomeUrl = defaultBrowserHomeUrl;

/**
 * The homepage new browser tabs open on.
 *
 * Read through a function rather than a constant so the value stays live: the
 * settings store pushes the saved preference in on load and on every change.
 */
export function browserHomeUrl(): string {
  return configuredHomeUrl;
}

export function configureBrowserHomeUrl(value: string): void {
  configuredHomeUrl = normalizeBrowserHomeUrl(value);
}

/**
 * Resolves a user-entered homepage.
 *
 * A bare host is completed to HTTPS, an explicitly blank page is honoured, and
 * anything that is not a usable web address falls back to the default rather
 * than opening tabs on something broken.
 */
export function normalizeBrowserHomeUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return defaultBrowserHomeUrl;
  if (trimmed === blankBrowserUrl) return blankBrowserUrl;
  const candidate = /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const parsed = new URL(candidate);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return defaultBrowserHomeUrl;
    return parsed.hostname ? parsed.toString() : defaultBrowserHomeUrl;
  } catch {
    return defaultBrowserHomeUrl;
  }
}
