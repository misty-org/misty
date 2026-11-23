const devMistyPublicUrl = "http://localhost:5174";

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

const mistyPublicUrl = normalizeMistyPublicUrl(
  import.meta.env.VITE_MISTY_PUBLIC_URL,
  import.meta.env.DEV ? devMistyPublicUrl : "",
);

export function mistyPublicPage(path: string): string | null {
  return mistyPublicUrl ? new URL(path, `${mistyPublicUrl}/`).href : null;
}
