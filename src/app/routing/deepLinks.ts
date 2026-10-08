import { deliverGoogleSignInCode } from "@/features/auth/googleSignInCode";
import { openExternalLink } from "@/features/workspace/externalLinks";
import { hasTauriInternals } from "@/shared/platform/tauri";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
const mistyDeepLinkScheme = "misty:";
const ignoredMistyHosts = new Set(["recent", "starred", "trash"]);
export function installMistyDeepLinkHandler(
  navigate: (route: string) => void,
  isRouteAllowed: (route: string) => boolean,
  resolveAuthRoute: (target: AuthDeepLinkTarget) => string,
): () => void {
  let active = true;
  let unlisten: UnlistenFn | null = null;
  let lastCurrentSignature: string | null = null;
  let lastHandledAt = 0;
  const currentUrlPoll: number | null = null;
  const handleUrls = (urls: string[] | null, source: "current" | "event") => {
    if (!active || !urls) return;
    const signature = urls.join("\n");
    if (source === "current" && signature === lastCurrentSignature) return;
    // A cold launch reports the same links as both the current URL and an event.
    if (signature === lastCurrentSignature && Date.now() - lastHandledAt < 1500) return;
    lastCurrentSignature = signature;
    lastHandledAt = Date.now();
    // Web links arrive here once Misty is the default browser; each opens in its own tab.
    const webUrls = urls.filter(isWebUrl);
    for (const url of webUrls) {
      try {
        navigate(openExternalLink(url).route);
      } catch {
        // An address the browser can't open is ignored, as it would be from the omnibox.
      }
    }
    if (webUrls.length) return;
    for (const url of urls) {
      const route = routeForMistyDeepLink(url, isRouteAllowed, resolveAuthRoute);
      if (route) {
        navigate(route);
        return;
      }
    }
  };
  const handleCurrentUrls = async () => {
    try {
      if (!hasTauriInternals()) return;
      handleUrls(await getCurrent(), "current");
    } catch {}
  };
  const handleVisibleCurrentUrls = () => {
    if (document.visibilityState === "visible") void handleCurrentUrls();
  };
  void (async () => {
    try {
      if (!hasTauriInternals()) return;
      await handleCurrentUrls();
      unlisten = await onOpenUrl((urls) => handleUrls(urls, "event"));
    } catch {}
  })();
  window.addEventListener("focus", handleCurrentUrls);
  document.addEventListener("visibilitychange", handleVisibleCurrentUrls);
  return () => {
    active = false;
    window.removeEventListener("focus", handleCurrentUrls);
    document.removeEventListener("visibilitychange", handleVisibleCurrentUrls);
    if (currentUrlPoll !== null) window.clearInterval(currentUrlPoll);
    if (unlisten) void unlisten();
  };
}
export function routeForMistyDeepLink(
  rawUrl: string,
  isRouteAllowed: (route: string) => boolean,
  resolveAuthRoute: (target: AuthDeepLinkTarget) => string,
): string | null {
  const url = parseMistyDeepLink(rawUrl);
  if (!url) return null;
  const parts = deepLinkParts(url);
  const [first, ...rest] = parts;
  if (!first || ignoredMistyHosts.has(first)) return null;
  if (first === "open") {
    return normalizeDeepLinkRoute(rest, url.search, isRouteAllowed);
  }
  if (first === "auth" && rest[0] === "google" && rest[1] === "complete") {
    // The browser finishing Google sign-in hands over its one-time code.
    deliverGoogleSignInCode(url.searchParams.get("code") ?? "");
    return null;
  }
  if (first === "auth") {
    return resolveAuthRoute(
      rest[0] === "providers" || rest[0] === "provider" ? "providers" : "account",
    );
  }
  return normalizeDeepLinkRoute(parts, url.search, isRouteAllowed);
}
function isWebUrl(rawUrl: string): boolean {
  try {
    const { protocol } = new URL(rawUrl);
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}
function parseMistyDeepLink(rawUrl: string): URL | null {
  try {
    const url = new URL(rawUrl);
    return url.protocol === mistyDeepLinkScheme ? url : null;
  } catch {
    return null;
  }
}
function deepLinkParts(url: URL): string[] {
  return [url.hostname, ...url.pathname.split("/")]
    .map((part) => decodeURIComponent(part).trim().toLowerCase())
    .filter(Boolean);
}
function normalizeDeepLinkRoute(
  parts: string[],
  search: string,
  isRouteAllowed: (route: string) => boolean,
): string | null {
  const route = `/${parts.join("/")}`;
  if (!isRouteAllowed(route)) {
    return null;
  }
  return `${route}${search}`;
}
export type AuthDeepLinkTarget = "account" | "providers";
