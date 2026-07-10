import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { AppFormFactor } from "../platform/formFactor";
import { hasTauriInternals } from "../shared/tauri";

const mistyDeepLinkScheme = "misty:";
const ignoredMistyHosts = new Set(["recent", "starred", "trash"]);
type AuthDeepLinkTarget = "account" | "providers";

export function installMistyDeepLinkHandler(
  formFactor: AppFormFactor,
  navigate: (route: string) => void,
  isRouteAllowed: (route: string, formFactor: AppFormFactor) => boolean,
  resolveAuthRoute: (target: AuthDeepLinkTarget) => string,
): () => void {
  let active = true;
  let unlisten: UnlistenFn | null = null;
  let lastCurrentSignature: string | null = null;
  let currentUrlPoll: number | null = null;

  const handleUrls = (urls: string[] | null, source: "current" | "event") => {
    if (!active || !urls) return;
    const signature = urls.join("\n");
    if (source === "current" && signature === lastCurrentSignature) return;
    lastCurrentSignature = signature;
    for (const url of urls) {
      const route = routeForMistyDeepLink(
        url,
        formFactor,
        isRouteAllowed,
        resolveAuthRoute,
      );
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
  if (formFactor === "mobile") {
    currentUrlPoll = window.setInterval(() => {
      if (document.visibilityState === "visible") void handleCurrentUrls();
    }, 900);
  }

  return () => {
    active = false;
    window.removeEventListener("focus", handleCurrentUrls);
    document.removeEventListener("visibilitychange", handleVisibleCurrentUrls);
    if (currentUrlPoll !== null) window.clearInterval(currentUrlPoll);
    if (unlisten) void unlisten();
  };
}

function routeForMistyDeepLink(
  rawUrl: string,
  formFactor: AppFormFactor,
  isRouteAllowed: (route: string, formFactor: AppFormFactor) => boolean,
  resolveAuthRoute: (target: AuthDeepLinkTarget) => string,
): string | null {
  const url = parseMistyDeepLink(rawUrl);
  if (!url) return null;

  const parts = deepLinkParts(url);
  const [first, ...rest] = parts;
  if (!first || ignoredMistyHosts.has(first)) return null;

  if (first === "open") {
    return normalizeDeepLinkRoute(rest, formFactor, isRouteAllowed);
  }
  if (first === "auth") {
    return resolveAuthRoute(
      rest[0] === "providers" || rest[0] === "provider"
        ? "providers"
        : "account",
    );
  }

  return normalizeDeepLinkRoute(parts, formFactor, isRouteAllowed);
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
  return [
    url.hostname,
    ...url.pathname.split("/"),
  ]
    .map((part) => decodeURIComponent(part).trim().toLowerCase())
    .filter(Boolean);
}

function normalizeDeepLinkRoute(
  parts: string[],
  formFactor: AppFormFactor,
  isRouteAllowed: (route: string, formFactor: AppFormFactor) => boolean,
): string | null {
  const route = `/${parts.join("/")}`;
  if (!isRouteAllowed(route, formFactor)) {
    return null;
  }
  if (formFactor === "mobile" && route.startsWith("/account/")) {
    return route === "/account/signin" || route === "/account/register" || route === "/account/settings"
      ? route
      : "/account";
  }
  return route;
}
