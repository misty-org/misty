import { invoke } from "@tauri-apps/api/core";
import { hasTauriInternals } from "@/shared/platform/tauri";

interface ApiCacheHit {
  body: string;
  fetchedAt: number;
}

const memory = new Map<string, ApiCacheHit>();
const memoryLimit = 400;
const slot = (account: string, key: string) => `${account}\n${key}`;

function remember(account: string, key: string, hit: ApiCacheHit) {
  const id = slot(account, key);
  memory.delete(id);
  memory.set(id, hit);
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
  } catch {}
}

export async function deleteApiCachePrefix(account: string, prefix: string): Promise<void> {
  for (const id of [...memory.keys()]) {
    if (id.startsWith(`${account}\n${prefix}`)) memory.delete(id);
  }
  if (!hasTauriInternals()) return;
  try {
    await invoke("api_cache_delete_prefix", { account, prefix });
  } catch {}
}

export async function clearApiCache(account: string): Promise<void> {
  for (const id of [...memory.keys()]) {
    if (id.startsWith(`${account}\n`)) memory.delete(id);
  }
  if (!hasTauriInternals()) return;
  try {
    await invoke("api_cache_clear", { account });
  } catch {}
}

export function mutationScope(path: string): string {
  const [pathname = ""] = path.split("?");
  const segments = pathname.split("/").filter(Boolean);
  return `/${segments.slice(0, 2).join("/")}`;
}
