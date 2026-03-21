import { getCurrent, onOpenUrl } from "@tauri-apps/plugin-deep-link";
import type { UnlistenFn } from "@tauri-apps/api/event";
import type { AppFormFactor } from "./platform";

const mistyDeepLinkScheme = "misty:";
const ignoredMistyHosts = new Set(["recent", "starred", "trash"]);
const mobileRoutePrefixes = ["/files", "/transfers", "/providers", "/hub", "/account", "/diagnostics"];
const desktopRoutePrefixes = [
  ...mobileRoutePrefixes,
  "/activity",
  "/dock",
  "/settings",
];

export function installMistyDeepLinkHandler(
  formFactor: AppFormFactor,
  navigate: (route: string) => void,
): () => void {
  let active = true;
  let unlisten: UnlistenFn | null = null;

  const handleUrls = (urls: string[] | null) => {
    if (!active || !urls) return;
    for (const url of urls) {
      const route = routeForMistyDeepLink(url, formFactor);
      if (route) {
        navigate(route);
        return;
      }
    }
  };

  void (async () => {
    try {
      handleUrls(await getCurrent());
      unlisten = await onOpenUrl(handleUrls);
    } catch {
      // Browser smoke mode and unsupported platforms run without deep-link internals.
    }
  })();

  return () => {
    active = false;
    if (unlisten) void unlisten();
  };
}

export function routeForMistyDeepLink(rawUrl: string, formFactor: AppFormFactor): string | null {
  const url = parseMistyDeepLink(rawUrl);
  if (!url) return null;

  const parts = deepLinkParts(url);
  const [first, ...rest] = parts;
  if (!first || ignoredMistyHosts.has(first)) return null;

  if (first === "open") {
    return normalizeDeepLinkRoute(rest, formFactor);
  }
  if (first === "auth") {
    return rest[0] === "providers" || rest[0] === "provider" ? "/providers" : "/account";
  }

  return normalizeDeepLinkRoute(parts, formFactor);
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

function normalizeDeepLinkRoute(parts: string[], formFactor: AppFormFactor): string | null {
  const route = `/${parts.join("/")}`;
  const allowedPrefixes = formFactor === "mobile" ? mobileRoutePrefixes : desktopRoutePrefixes;
  if (!allowedPrefixes.some((prefix) => route === prefix || route.startsWith(`${prefix}/`))) {
    return null;
  }
  if (formFactor === "mobile" && route.startsWith("/account/")) {
    return route === "/account/signin" || route === "/account/register" ? route : "/account";
  }
  return route;
}
