import type { ProviderAuthorizationOpenResult } from "@/shared/platform/model/interfaces/openExternalLink";
import { openUrl } from "@tauri-apps/plugin-opener";
import { platform } from "@tauri-apps/plugin-os";
import { hasTauriInternals } from "./tauri";
export type { ProviderAuthorizationOpenResult } from "@/shared/platform/model/interfaces/openExternalLink";
let openInMistyBrowser: ((url: string) => void | Promise<void>) | null = null;
export function configureMistyBrowserLinkOpener(
  opener: ((url: string) => void | Promise<void>) | null,
): void {
  openInMistyBrowser = opener;
}
export async function openExternalLink(url: string): Promise<void> {
  const href = normalizeExternalUrl(url);
  if (!href) return;
  if (!isWebUrl(href)) {
    await openSystemExternalLink(href);
    return;
  }
  if (openInMistyBrowser) {
    await openInMistyBrowser(href);
    return;
  }
  throw new Error("Misty Browser is not ready. Try opening the link again.");
}
export async function openSystemExternalLink(url: string): Promise<void> {
  const href = normalizeExternalUrl(url);
  if (!href) return;

  // All callers share the same web routing policy.
  if (isWebUrl(href)) return openExternalLink(href);
  await openNativeUrl(href);
}
export async function openProviderAuthorizationLink(
  url: string,
): Promise<ProviderAuthorizationOpenResult> {
  const href = normalizeExternalUrl(url);
  const attemptedAt = Date.now();
  if (!href) {
    throw new Error("Provider authorization URL is empty.");
  }
  const currentPlatform = nativePlatform();
  await openExternalLink(href);
  return {
    strategy: "misty-browser",
    platform: currentPlatform,
    attemptedAt,
  };
}
export function installExternalLinkRouting(root: Document = document): () => void {
  const handleClick = (event: MouseEvent) => {
    if (event.defaultPrevented || ![0, 1].includes(event.button)) return;
    const element =
      event.target instanceof Element
        ? event.target
        : event.target instanceof Node
          ? event.target.parentElement
          : null;
    const anchor = element?.closest<HTMLAnchorElement>("a[href]");
    if (!anchor || anchor.hasAttribute("download")) {
      return;
    }
    const rawHref = anchor.getAttribute("href")?.trim() ?? "";
    if (!/^(?:https?:|mailto:|\/\/)/i.test(rawHref)) {
      // The shell never navigates away from its own pages: asset:, file:,
      // data: and other schemes would replace the app (see navigation_guard.rs).
      if (!isShellUrl(anchor.href)) event.preventDefault();
      return;
    }
    event.preventDefault();
    void openExternalLink(anchor.href);
  };
  root.addEventListener("click", handleClick);
  root.addEventListener("auxclick", handleClick);
  return () => {
    root.removeEventListener("click", handleClick);
    root.removeEventListener("auxclick", handleClick);
  };
}
function isShellUrl(href: string): boolean {
  try {
    return new URL(href, window.location.href).origin === window.location.origin;
  } catch {
    return false;
  }
}
function isWebUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://");
}
export function normalizeExternalUrl(value: string): string {
  const href = value.trim();
  if (!href) return "";
  if (href.length > 4096) throw new Error("External URL is too long.");
  let parsed: URL;
  try {
    parsed = new URL(href);
  } catch {
    throw new Error("External URL is invalid.");
  }
  if (!["https:", "http:", "mailto:"].includes(parsed.protocol)) {
    throw new Error("External URL protocol is not allowed.");
  }
  if (
    (parsed.protocol === "https:" || parsed.protocol === "http:") &&
    (parsed.username || parsed.password)
  ) {
    throw new Error("External URLs cannot contain credentials.");
  }
  return href;
}
async function openNativeUrl(url: string): Promise<void> {
  await openUrl(url);
}
function nativePlatform(): string {
  try {
    return hasTauriInternals() ? platform() : "unknown";
  } catch {
    return "unknown";
  }
}
