import {
  peekCachedResource,
  refreshCachedResource,
  refreshWatchedCachedResources,
  setCachedResource,
  useCachedResource,
  type CachedResource,
} from "@/api/cache/cached_resource";
import { readApiAccountId } from "@/api/client/session";

export function spaceResourceKey(path: string): string {
  return `space:${epoch}:${readApiAccountId()}:${path}`;
}

let epoch = 0;

export function forgetSpaceResources() {
  epoch += 1;
}

export function useSpaceResource<T>(
  path: string | null,
  loader: () => Promise<T>,
): CachedResource<T> {
  return useCachedResource(path ? spaceResourceKey(path) : null, loader, { persist: "account" });
}

export function refreshSpaceResource<T>(path: string, loader: () => Promise<T>): Promise<T> {
  return refreshCachedResource(spaceResourceKey(path), loader, "account");
}

export function setSpaceResource<T>(path: string, next: T | ((previous: T | undefined) => T)) {
  setCachedResource(spaceResourceKey(path), next, "account");
}

export function peekSpaceResource<T>(path: string): T | undefined {
  return peekCachedResource<T>(spaceResourceKey(path));
}

export function refreshWatchedSpaceResources(): Promise<void> {
  return refreshWatchedCachedResources(spaceResourceKey(""));
}
