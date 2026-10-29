const devMistyPublicUrl = "http://localhost:5174";

/** A safe http(s) origin without a trailing slash, else `fallback` (none by default). */
export function normalizeMistyPublicUrl(value: string | null | undefined, fallback = ""): string {
  const candidate = value?.trim();
  if (!candidate) return fallback;
  try {
    const url = new URL(candidate);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
      return fallback;
    }
    return url.href.replace(/\/$/, "");
  } catch {
    return fallback;
  }
}

/** The Misty server's website, named at build time (VITE_MISTY_PUBLIC_URL); none by default. */
const mistyPublicUrl = normalizeMistyPublicUrl(
  import.meta.env.VITE_MISTY_PUBLIC_URL,
  import.meta.env.DEV ? devMistyPublicUrl : "",
);

/** A page on that website, or null when this build names none. */
export function mistyPublicPage(path: string): string | null {
  return mistyPublicUrl ? new URL(path, `${mistyPublicUrl}/`).href : null;
}

/** The website's host, or "" when this build names none. */
export function mistyPublicHost(): string {
  return mistyPublicUrl ? new URL(mistyPublicUrl).host : "";
}
