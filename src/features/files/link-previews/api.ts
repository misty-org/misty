import { invoke } from "@tauri-apps/api/core";
import { readApiCache, writeApiCache } from "@/api/cache/api_cache";
import { readApiAccountId } from "@/api/client/session";
import { hasTauriInternals } from "@/shared/platform/tauri";

export interface LinkPreview {
  url: string;
  siteName: string;
  title: string;
  description: string;
  image: string | null;
}

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
      } catch {}
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

export function loadLinkPreview(url: string): Promise<LinkPreview | null> {
  if (!hasTauriInternals()) return Promise.resolve(null);
  const request = pending.get(url) ?? fetchPreview(url);
  pending.set(url, request);
  void request.then((value) => known.set(url, value));
  return request;
}

export function knownLinkPreview(url: string): LinkPreview | null | undefined {
  return known.get(url);
}
