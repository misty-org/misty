export function libraryReauthenticationHeaders(token: string): Record<string, string> {
  return token ? { "X-Misty-Library-Reauthentication": token } : {};
}

export function libraryPreviewPath(
  spaceId: string,
  itemId: string,
  original: boolean,
  cacheVersion?: string | number,
): string {
  const query = new URLSearchParams();
  if (original) query.set("version", "original");
  if (cacheVersion !== undefined && String(cacheVersion))
    query.set("cache_version", String(cacheVersion));
  const suffix = query.size > 0 ? `?${query.toString()}` : "";
  return `/spaces/${encodeURIComponent(spaceId)}/library/items/${encodeURIComponent(itemId)}/preview${suffix}`;
}
