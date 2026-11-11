import { invoke } from "@tauri-apps/api/core";
import { deliverGoogleSignInCode } from "@/features/account";
import { openSetupDeepLink } from "@/features/account";
import { isLinkTargetWindow } from "@/features/app-windows";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
/** Native routes web links to the profile that claims their site, then says so here. */
const profileLinksEvent = "misty://profile-links";
const mistyDeepLinkScheme = "misty:";
const ignoredMistyHosts = new Set(["recent", "starred", "trash"]);
export function installMistyDeepLinkHandler(
  navigate: (route: string) => void,
  isRouteAllowed: (route: string) => boolean,
  resolveAuthRoute: () => string,
): () => void {
  let active = true;
  let unlisten: UnlistenFn | null = null;
  let unlistenLinks: UnlistenFn | null = null;
  let lastCurrentSignature: string | null = null;
  let lastHandledAt = 0;
  const currentUrlPoll: number | null = null;
  // Web links from other apps (Misty left as the default browser) are taken so they don't pile
  // up, and dropped: Misty shows web pages only to agents, never in a pane for a person.
  const takeWebLinks = async () => {
    if (!active) return;
    await invoke<string[]>("app_take_launch_urls").catch(() => []);
  };
  const handleUrls = async (urls: string[] | null, source: "current" | "event") => {
    if (!active || !urls) return;
    const mistyUrls = urls.filter((url) => !isWebUrl(url));
    if (!mistyUrls.length) return;
    // Every window hears these; only the one used last opens them.
    if (!(await isLinkTargetWindow())) return;
    if (!active) return;
    const signature = mistyUrls.join("\n");
    if (source === "current" && signature === lastCurrentSignature) return;
    // A cold launch reports the same links as both the current URL and an event.
    if (signature === lastCurrentSignature && Date.now() - lastHandledAt < 1500) return;
    lastCurrentSignature = signature;
    lastHandledAt = Date.now();
    for (const url of mistyUrls) {
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
      await handleUrls(await getCurrent(), "current");
    } catch {}
  };
  const handleVisibleCurrentUrls = () => {
    if (document.visibilityState === "visible") void handleCurrentUrls();
  };
  void (async () => {
    try {
      if (!hasTauriInternals()) return;
      await handleCurrentUrls();
      unlistenLinks = await listen(profileLinksEvent, () => void takeWebLinks());
      await takeWebLinks();
      unlisten = await onOpenUrl((urls) => void handleUrls(urls, "event"));
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
    if (unlistenLinks) void unlistenLinks();
  };
}
export function routeForMistyDeepLink(
  rawUrl: string,
  isRouteAllowed: (route: string) => boolean,
  resolveAuthRoute: () => string,
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
    return resolveAuthRoute();
  }
  if (first === "setup") {
    // The website's setup page: the wizard opens on Misty Pro, filled in.
    openSetupDeepLink(rawUrl);
    return null;
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
