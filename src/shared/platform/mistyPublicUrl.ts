const defaultMistyPublicUrl = "https://mistysys.com";
const devMistyPublicUrl = "http://localhost:5174";

export function normalizeMistyPublicUrl(
  value: string | null | undefined,
  fallback = defaultMistyPublicUrl,
): string {
  const candidate = value?.trim() || fallback;
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

const defaultResolvedPublicUrl = import.meta.env.DEV ? devMistyPublicUrl : defaultMistyPublicUrl;

export const mistyPublicUrl = normalizeMistyPublicUrl(
  import.meta.env.VITE_MISTY_PUBLIC_URL || defaultResolvedPublicUrl,
);

export function mistyPublicPage(path: string): string {
  return new URL(path, `${mistyPublicUrl}/`).href;
}
