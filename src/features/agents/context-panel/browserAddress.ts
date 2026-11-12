/**
 * What an address field makes of what was typed: a web address as it is, a bare name like
 * `example.com` with `https://`, and anything else as a Google search.
 */
export function browserAddress(input: string): string | null {
  const typed = input.trim();
  if (!typed) return null;
  if (/^https?:\/\//i.test(typed)) {
    try {
      return new URL(typed).href;
    } catch {
      return null;
    }
  }
  const looksLikeHost =
    !/\s/.test(typed) &&
    (/^localhost(:\d+)?(\/|$)/i.test(typed) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(typed));
  if (looksLikeHost) {
    const scheme = /^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(typed) ? "http" : "https";
    try {
      return new URL(`${scheme}://${typed}`).href;
    } catch {
      return null;
    }
  }
  return `https://www.google.com/search?q=${encodeURIComponent(typed)}`;
}

const storageKey = (space: string) => `misty.browser-panel.url:${space || "personal"}`;

/** The page this Space's browser panel last showed on this device, or "" for a blank page. */
export function rememberedAddress(space: string): string {
  try {
    const saved = localStorage.getItem(storageKey(space));
    return saved && /^https?:\/\//i.test(saved) ? saved : "";
  } catch {
    return "";
  }
}

export function rememberAddress(space: string, url: string): void {
  try {
    localStorage.setItem(storageKey(space), url);
  } catch {
    // Without storage the panel starts on a blank page next time.
  }
}
