export const webHomeUrl = "https://www.google.com/";

export const searchAddress = (typed: string) =>
  `https://www.google.com/search?q=${encodeURIComponent(typed)}`;

export function looksLikeAddress(typed: string): boolean {
  return (
    /^https?:\/\//i.test(typed) ||
    (!/\s/.test(typed) &&
      (/^localhost(:\d+)?(\/|$)/i.test(typed) || /^[\w-]+(\.[\w-]+)+(:\d+)?(\/|$)/.test(typed)))
  );
}

export function webAddress(input: string): string | null {
  const typed = input.trim();
  if (!typed) return null;
  if (/^https?:\/\//i.test(typed)) {
    try {
      return new URL(typed).href;
    } catch {
      return null;
    }
  }
  if (looksLikeAddress(typed)) {
    const scheme = /^(localhost|127\.0\.0\.1)(:|\/|$)/i.test(typed) ? "http" : "https";
    try {
      return new URL(`${scheme}://${typed}`).href;
    } catch {
      return null;
    }
  }
  return searchAddress(typed);
}

export function shownAddress(url: string): { host: string; rest: string } {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return { host: "", rest: "" };
    const rest = `${parsed.pathname === "/" ? "" : parsed.pathname}${parsed.search}${parsed.hash}`;
    return { host: parsed.host.replace(/^www\./, ""), rest };
  } catch {
    return { host: "", rest: "" };
  }
}

export function pageLabel(url: string, title: string): string {
  if (title.trim()) return title.trim();
  return shownAddress(url).host || "New tab";
}
