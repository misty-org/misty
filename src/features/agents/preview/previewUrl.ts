import { createDeviceSetting } from "@/shared/lib/deviceSetting";

/** Where a dev server usually is. */
export const defaultPreviewUrl = "http://localhost:3000";

type PreviewAddress = { ok: true; url: string } | { ok: false; message: string };

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

/** The address each Space's preview last showed: Space → address and when it was kept. */
type RememberedUrls = Record<string, { url: string; at: number }>;

/** Spaces kept at most; the ones shown longest ago are let go first. */
const keptSpaces = 200;

const previewUrls = createDeviceSetting<RememberedUrls>({
  scope: "preview-urls",
  defaults: {},
  normalize: (stored) => {
    const kept: RememberedUrls = {};
    if (!stored || typeof stored !== "object") return kept;
    for (const [space, entry] of Object.entries(stored as Record<string, unknown>)) {
      const { url, at } = (entry ?? {}) as { url?: unknown; at?: unknown };
      if (typeof url === "string" && typeof at === "number") kept[space] = { url, at };
    }
    return kept;
  },
});

const spaceKey = (space: string) => space || "personal";
/** Where a Space's address lived before `misty.db`; moved over the first time it is read. */
const legacyKey = (space: string) => `misty.preview.url:${spaceKey(space)}`;

function legacyUrl(space: string): string | null {
  try {
    const url = localStorage.getItem(legacyKey(space));
    if (url !== null) localStorage.removeItem(legacyKey(space));
    return url;
  } catch {
    return null;
  }
}

/** The address this Space's preview last showed, on this device. */
export function rememberedPreviewUrl(space: string): string {
  const kept = previewUrls.getState().value[spaceKey(space)]?.url;
  const moved = kept === undefined ? legacyUrl(space) : null;
  const parsed = parsePreviewUrl(kept ?? moved ?? "");
  if (moved !== null && parsed.ok) rememberPreviewUrl(space, parsed.url);
  return parsed.ok ? parsed.url : defaultPreviewUrl;
}

export function rememberPreviewUrl(space: string, url: string): void {
  previewUrls.getState().set((current) => {
    const next = { ...current, [spaceKey(space)]: { url, at: Date.now() } };
    const recent = Object.entries(next).sort(([, a], [, b]) => b.at - a.at);
    return Object.fromEntries(recent.slice(0, keptSpaces));
  });
}
