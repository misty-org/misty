const defaultMistyPublicUrl = "https://mistysys.com";

export function normalizeMistyPublicUrl(value: string | null | undefined): string {
  const candidate = value?.trim() || defaultMistyPublicUrl;
  try {
    const url = new URL(candidate);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) {
      return defaultMistyPublicUrl;
    }
    return url.href.replace(/\/$/, "");
  } catch {
    return defaultMistyPublicUrl;
  }
}

export const mistyPublicUrl = normalizeMistyPublicUrl(import.meta.env.VITE_MISTY_PUBLIC_URL);

export function mistyPublicPage(path: string): string {
  return new URL(path, `${mistyPublicUrl}/`).href;
}
