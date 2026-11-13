import {
  peekCachedResource,
  refreshCachedResource,
  setCachedResource,
  useCachedResource,
  type CachedResource,
} from "@/api/cache/cached-resource";
import { readApiAccountId } from "@/api/client/session";

/**
 * A Space resource's cache key: the signed-in account, then the server path it mirrors. Two
 * accounts on one computer can share a Space, so one never paints the other's copy (its private
 * chats, its private notes), even from this session's memory.
 */
export function spaceResourceKey(path: string): string {
  return `space:${epoch}:${readApiAccountId()}:${path}`;
}

let epoch = 0;

/**
 * Starts every Space resource afresh, as if nothing had ever been read: copies made before are no
 * longer found. Tests call it between cases, so one case's copy never paints into the next.
 */
export function forgetSpaceResources() {
  epoch += 1;
}

/**
 * Space data a screen shows, from the cache first: the last copy paints at once (this session's,
 * else the one saved for the account), and a fresh read runs behind it. Every screen reading the
 * same `path` shares one copy and one read in flight. `path` is null to hold off.
 */
export function useSpaceResource<T>(
  path: string | null,
  loader: () => Promise<T>,
): CachedResource<T> {
  return useCachedResource(path ? spaceResourceKey(path) : null, loader, { persist: "account" });
}

/** Reads `path` again for every screen showing it, keeping what they show until it answers. */
export function refreshSpaceResource<T>(path: string, loader: () => Promise<T>): Promise<T> {
  return refreshCachedResource(spaceResourceKey(path), loader, "account");
}

/** Changes what every screen showing `path` shows, such as after a change made here. */
export function setSpaceResource<T>(path: string, next: T | ((previous: T | undefined) => T)) {
  setCachedResource(spaceResourceKey(path), next, "account");
}

/** The copy of `path` this session holds, if any, for reading outside React. */
export function peekSpaceResource<T>(path: string): T | undefined {
  return peekCachedResource<T>(spaceResourceKey(path));
}
