/**
 * Browser pages Misty draws itself, like chrome://history. They open in an
 * ordinary browser tab but render in the renderer instead of a native page.
 */
export const browserInternalPages = {
  history: { url: "misty://history", title: "History" },
  downloads: { url: "misty://downloads", title: "Downloads" },
  bookmarks: { url: "misty://bookmarks", title: "Bookmarks" },
  extensions: { url: "misty://extensions", title: "Extensions" },
  settings: { url: "misty://settings", title: "Browser settings" },
} as const;

export type BrowserInternalPage = keyof typeof browserInternalPages;

export function browserInternalUrl(page: BrowserInternalPage): string {
  return browserInternalPages[page].url;
}

/** The internal page an address names, ignoring case and a trailing slash. */
export function browserInternalPage(url: string): BrowserInternalPage | null {
  const match = /^misty:\/\/([a-z]+)\/?$/i.exec(url.trim());
  if (!match) return null;
  const page = match[1].toLowerCase();
  return Object.prototype.hasOwnProperty.call(browserInternalPages, page) ? (page as BrowserInternalPage) : null;
}

export function isBrowserInternalUrl(url: string): boolean {
  return browserInternalPage(url) !== null;
}
