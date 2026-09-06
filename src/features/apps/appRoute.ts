import { isNativeMobileBuild } from "@/shared/platform/buildTarget";

export function officialAppRoute(appId: string, spaceId?: string, _accountId = ""): string {
  if (appId === "transfers") return "/apps/files?view=transfers";
  const slug = officialAppSlug(appId);
  if (isNativeMobileBuild) return `/apps/${encodeURIComponent(slug)}`;
  const query = new URLSearchParams();
  if (spaceId) query.set("space", spaceId);
  const suffix = query.toString();
  return `/apps/${encodeURIComponent(slug)}${suffix ? `?${suffix}` : ""}`;
}

export function canonicalAppRoute(route: string): string {
  const url = new URL(route, "https://misty.local");
  if (url.pathname === "/transfers" || url.pathname === "/apps/transfers") {
    url.pathname = "/apps/files";
    url.searchParams.set("view", "transfers");
  }
  return `${url.pathname}${url.search}${url.hash}`;
}

export function officialAppSlug(appId: string): string {
  return appId === "chat" ? "social" : appId;
}

export function officialAppIdFromSlug(slug: string): string {
  return slug === "social" ? "chat" : slug;
}
