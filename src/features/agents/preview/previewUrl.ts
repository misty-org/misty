/** Where a dev server usually is. */
export const defaultPreviewUrl = "http://localhost:3000";

export type PreviewAddress = { ok: true; url: string } | { ok: false; message: string };

const refusal =
  "The preview shows only your own app on this computer. Use an address like http://localhost:3000.";

/** Whether a host name is this computer: localhost, a `.localhost` name or a loopback address. */
function isLocalHost(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  return (
    host === "localhost" || host.endsWith(".localhost") || host === "127.0.0.1" || host === "[::1]"
  );
}

/**
 * Reads what the person typed as the address of their local app. `localhost:5173` gets its
 * `http://`; anything that isn't plain http on this computer is refused, since the preview is
 * for the person's own app and is not a browser.
 */
export function parsePreviewUrl(input: string): PreviewAddress {
  const typed = input.trim();
  if (!typed)
    return { ok: false, message: "Enter your app's address, like http://localhost:3000." };
  const withScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(typed) ? typed : `http://${typed}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return { ok: false, message: refusal };
  }
  if (url.protocol !== "http:" || url.username || url.password || !isLocalHost(url.hostname))
    return { ok: false, message: refusal };
  return { ok: true, url: url.href };
}

/** The address as the field shows it: without the slash a bare origin ends with. */
export function shownPreviewUrl(url: string): string {
  return url.endsWith("/") && new URL(url).pathname === "/" && !/[?#]/.test(url)
    ? url.slice(0, -1)
    : url;
}

const storageKey = (space: string) => `misty.preview.url:${space || "personal"}`;

/** The address this Space's preview last showed, on this device. */
export function rememberedPreviewUrl(space: string): string {
  try {
    const parsed = parsePreviewUrl(localStorage.getItem(storageKey(space)) ?? "");
    return parsed.ok ? parsed.url : defaultPreviewUrl;
  } catch {
    return defaultPreviewUrl;
  }
}

export function rememberPreviewUrl(space: string, url: string): void {
  try {
    localStorage.setItem(storageKey(space), url);
  } catch {
    // Without storage the preview starts at the default address next time.
  }
}
