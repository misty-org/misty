import { invoke } from "@tauri-apps/api/core";
import { readApiCache, writeApiCache } from "@/api/cache/apiCache";
import { readApiAccountId } from "@/api/client/session";
import { hasTauriInternals } from "@/shared/platform/tauri";

/** What a page says about itself; the image is a small data URL, so showing it contacts no site. */
export interface LinkPreview {
  url: string;
  siteName: string;
  title: string;
  description: string;
  image: string | null;
}

// A page that has a preview keeps it a week; one that has none is not asked again for a day.
const keepMs = 7 * 24 * 3_600_000;
const missMs = 24 * 3_600_000;
const pending = new Map<string, Promise<LinkPreview | null>>();
const known = new Map<string, LinkPreview | null>();

async function fetchPreview(url: string): Promise<LinkPreview | null> {
  const account = readApiAccountId();
  const key = `link-preview:v1:${url}`;
  if (account) {
    const hit = await readApiCache(account, key);
    if (hit) {
      try {
        const saved = JSON.parse(hit.body) as LinkPreview | null;
        if (Date.now() - hit.fetchedAt < (saved ? keepMs : missMs)) return saved;
      } catch {
        /* a copy that cannot be read is a miss */
      }
    }
  }
  let preview: LinkPreview | null = null;
  try {
    preview = await invoke<LinkPreview | null>("link_preview_fetch", { url });
  } catch {
    return null;
  }
  if (account) void writeApiCache(account, key, JSON.stringify(preview));
  return preview;
}

/** The preview for one link, fetched on this device; null when there is none. */
export function loadLinkPreview(url: string): Promise<LinkPreview | null> {
  if (!hasTauriInternals()) return Promise.resolve(null);
  const request = pending.get(url) ?? fetchPreview(url);
  pending.set(url, request);
  void request.then((value) => known.set(url, value));
  return request;
}

/** The preview if it was already loaded in this session, else undefined. */
export function knownLinkPreview(url: string): LinkPreview | null | undefined {
  return known.get(url);
}
