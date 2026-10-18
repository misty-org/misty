import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";

/** A saved response and when it was fetched (Unix milliseconds). */
export interface ApiCacheHit {
  body: string;
  fetchedAt: number;
}

// Copies of account data fetched from the server, kept so pages can paint from them at once.
// On desktop they live encrypted under ~/.misty/cache/api (src-tauri/src/infra/api_cache.rs);
// this in-process layer sits in front so a repeat read costs no round trip, and is all there
// is where there is no desktop shell. Every call is best effort: a cache that fails is a miss.
const memory = new Map<string, ApiCacheHit>();
const memoryLimit = 400;
const slot = (account: string, key: string) => `${account}\n${key}`;

function remember(account: string, key: string, hit: ApiCacheHit) {
  const id = slot(account, key);
  memory.delete(id);
  memory.set(id, hit);
  // Oldest first out, as Map keeps insertion order.
  if (memory.size > memoryLimit) memory.delete(memory.keys().next().value as string);
}

export async function readApiCache(account: string, key: string): Promise<ApiCacheHit | undefined> {
  const warm = memory.get(slot(account, key));
  if (warm) return warm;
  if (!hasTauriInternals()) return undefined;
  try {
    const hit = await invoke<ApiCacheHit | null>("api_cache_get", { account, key });
    if (hit) remember(account, key, hit);
    return hit ?? undefined;
  } catch {
    return undefined;
  }
}

export async function writeApiCache(account: string, key: string, body: string): Promise<void> {
  remember(account, key, { body, fetchedAt: Date.now() });
  if (!hasTauriInternals()) return;
  try {
    await invoke("api_cache_put", { account, key, body });
  } catch {
    /* the in-process copy still serves this session */
  }
}

/** Forgets every saved response of the account whose path starts with `prefix`. */
export async function deleteApiCachePrefix(account: string, prefix: string): Promise<void> {
  for (const id of [...memory.keys()]) {
    if (id.startsWith(`${account}\n${prefix}`)) memory.delete(id);
  }
  if (!hasTauriInternals()) return;
  try {
    await invoke("api_cache_delete_prefix", { account, prefix });
  } catch {
    /* an entry that stays is revalidated on its next read */
  }
}

/** Forgets everything saved for the account: sign-out, and removing a saved account. */
export async function clearApiCache(account: string): Promise<void> {
  for (const id of [...memory.keys()]) {
    if (id.startsWith(`${account}\n`)) memory.delete(id);
  }
  if (!hasTauriInternals()) return;
  try {
    await invoke("api_cache_clear", { account });
  } catch {
    /* nothing more can be done from here */
  }
}

/**
 * The part of a path a change reaches: `/spaces/abc/tasks/9` changes what `/spaces/abc/...`
 * shows. Two segments is wide enough to catch the lists a change touches and narrow enough
 * to keep the rest. Over-invalidating only costs a revalidation, never a stale page.
 */
export function mutationScope(path: string): string {
  const [pathname = ""] = path.split("?");
  const segments = pathname.split("/").filter(Boolean);
  return `/${segments.slice(0, 2).join("/")}`;
}
