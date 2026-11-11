/** A secure page's site without protocol, www or path; anything else keeps its full address,
 * and a blank page has none. */
export function hostAddress(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.hostname.replace(/^www\./, "");
  } catch {
    /* Not a URL: show it as it is. */
  }
  return value === "about:blank" ? "" : value;
}
