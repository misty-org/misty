import { invoke } from "@/native/invoke";
import { hasTauriInternals } from "@/shared/platform/tauri";

/**
 * Whether an icon is all dark, all light, or shows on any surface. An all-dark one needs a backing
 * in a dark theme, and an all-light one in a light theme.
 */
type SiteIconTone = "dark" | "light" | "mixed";

interface SiteIconImage {
  src: string;
  tone: SiteIconTone;
}

/** A shown icon's share of drawn pixels that must stand out for it to need no backing. */
const VISIBLE_SHARE = 0.12;
/** Tabs show icons at 16px; this keeps them sharp on any display and small in memory. */
const MAX_SIDE = 64;
const CACHE_SIZE = 256;
const RETRY_AFTER_MS = 5 * 60 * 1000;

/** Decides an icon's tone from RGBA pixels, ignoring what is mostly transparent. */
export function siteIconTone(pixels: ArrayLike<number>): SiteIconTone {
  let drawn = 0;
  let showsOnDark = 0;
  let showsOnLight = 0;
  for (let index = 0; index + 3 < pixels.length; index += 4) {
    if (pixels[index + 3] < 64) continue;
    drawn += 1;
    const luminance =
      (0.2126 * pixels[index] + 0.7152 * pixels[index + 1] + 0.0722 * pixels[index + 2]) / 255;
    if (luminance >= 0.25) showsOnDark += 1;
    if (luminance <= 0.75) showsOnLight += 1;
  }
  if (!drawn) return "mixed";
  if (showsOnDark / drawn < VISIBLE_SHARE) return "dark";
  if (showsOnLight / drawn < VISIBLE_SHARE) return "light";
  return "mixed";
}

/** Shrinks a fetched icon and reads its tone. The original stands if the canvas can't do either. */
function prepared(src: string): Promise<SiteIconImage | null> {
  return new Promise((resolve) => {
    const image = new Image();
    image.onerror = () => resolve(null);
    image.onload = () => {
      try {
        const scale = Math.min(1, MAX_SIDE / Math.max(image.naturalWidth, image.naturalHeight, 1));
        const width = Math.max(1, Math.round((image.naturalWidth || MAX_SIDE) * scale));
        const height = Math.max(1, Math.round((image.naturalHeight || MAX_SIDE) * scale));
        const canvas = document.createElement("canvas");
        canvas.width = width;
        canvas.height = height;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("no canvas");
        context.drawImage(image, 0, 0, width, height);
        const { data } = context.getImageData(0, 0, width, height);
        resolve({ src: canvas.toDataURL("image/png"), tone: siteIconTone(data) });
      } catch {
        resolve({ src, tone: "mixed" });
      }
    };
    image.src = src;
  });
}

const known = new Map<string, { image: SiteIconImage | null; at: number }>();
const loading = new Map<string, Promise<SiteIconImage | null>>();

/** What the window's own image tag has to load: no fetch can do better for these. */
function loadsDirectly(url: string): boolean {
  return !hasTauriInternals() || !/^https?:/i.test(url);
}

/**
 * The icon if it's already known: an image, null when it failed, undefined while unknown. A failed
 * icon is tried again later, since the site or the connection may only have been down.
 */
export function knownSiteIcon(url: string): SiteIconImage | null | undefined {
  if (loadsDirectly(url)) return { src: url, tone: "mixed" };
  const entry = known.get(url);
  if (!entry) return undefined;
  if (!entry.image && Date.now() - entry.at > RETRY_AFTER_MS) {
    known.delete(url);
    return undefined;
  }
  return entry.image;
}

function remember(url: string, image: SiteIconImage | null) {
  known.delete(url);
  known.set(url, { image, at: Date.now() });
  if (known.size > CACHE_SIZE) known.delete(known.keys().next().value as string);
}

export function loadSiteIcon(url: string): Promise<SiteIconImage | null> {
  const current = knownSiteIcon(url);
  if (current !== undefined) return Promise.resolve(current);
  const running = loading.get(url);
  if (running) return running;
  const load = invoke<string>("browser_site_icon", { url })
    .then(prepared)
    .catch((error: unknown): SiteIconImage | null =>
      // A site on this computer or network: the window may still reach it.
      String(error).includes("private_address") ? { src: url, tone: "mixed" } : null,
    )
    .then((image) => {
      remember(url, image);
      loading.delete(url);
      return image;
    });
  loading.set(url, load);
  return load;
}
