export function hostAddress(value: string): string {
  try {
    const url = new URL(value);
    if (url.protocol === "https:") return url.hostname.replace(/^www\./, "");
  } catch {}
  return value === "about:blank" ? "" : value;
}
