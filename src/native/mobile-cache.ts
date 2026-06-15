import { invoke } from "./invoke";

export async function mobileCacheRead<T>(accountId: string, recordKey: string): Promise<T | null> {
  const value = await invoke<string | null>("mobile_cache_read", { accountId, recordKey });
  if (!value) return null;
  return JSON.parse(value) as T;
}

export function mobileCacheWrite(
  accountId: string,
  recordKey: string,
  value: unknown,
): Promise<void> {
  return invoke("mobile_cache_write", { accountId, recordKey, value: JSON.stringify(value) });
}

export function mobileCacheRemove(accountId: string, recordKey: string): Promise<void> {
  return invoke("mobile_cache_remove", { accountId, recordKey });
}

export function mobileCachePurgeAccount(accountId: string): Promise<void> {
  return invoke("mobile_cache_purge_account", { accountId });
}
