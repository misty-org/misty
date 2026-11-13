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
