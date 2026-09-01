import type { ProviderAuthorizationOpenResult } from "@/shared/platform/model/interfaces/openExternalLink";
import { openUrl } from "@tauri-apps/plugin-opener";
import { platform } from "@tauri-apps/plugin-os";
import type { MouseEvent as ReactMouseEvent } from "react";
import { hasTauriInternals } from "./tauri";
export type { ProviderAuthorizationOpenResult } from "@/shared/platform/model/interfaces/openExternalLink";

let shouldOpenLinksExternally = () => false;
let openInMistyBrowser: ((url: string) => void | Promise<void>) | null = null;

export function configureExternalLinkPreference(getPreference: () => boolean): void {
  shouldOpenLinksExternally = getPreference;
}

export function configureMistyBrowserLinkOpener(
  opener: ((url: string) => void | Promise<void>) | null,
): void {
  openInMistyBrowser = opener;
}

export function configureProviderAuthorizationLinkOpener(
  opener: ((url: string) => void | Promise<void>) | null,
): void {
  configureMistyBrowserLinkOpener(opener);
}

export async function openExternalLink(url: string): Promise<void> {
  const href = normalizeExternalUrl(url);
  if (!href) return;

  if (!isWebUrl(href)) {
    await openSystemExternalLink(href);
    return;
  }

  if (shouldOpenLinksExternally()) {
    try {
      await openNativeUrl(href);
      return;
    } catch {}
  }

  if (openInMistyBrowser) {
    try {
      await openInMistyBrowser(href);
      return;
    } catch {}
  }

  window.open(href, "_blank", "noopener,noreferrer");
}

export async function openSystemExternalLink(url: string): Promise<void> {
  const href = normalizeExternalUrl(url);
  if (!href) return;

  try {
    await openNativeUrl(href);
    return;
  } catch (error) {
    if (hasTauriInternals()) {
      throw error;
    }
  }

  window.open(href, "_blank", "noopener,noreferrer");
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
  if (currentPlatform === "ios" || currentPlatform === "android") {
    try {
      await openUrl(href, "inAppBrowser");
      return {
        strategy: "in-app-browser",
        platform: currentPlatform,
        attemptedAt,
      };
    } catch (error) {
      try {
        await openNativeUrl(href);
        return {
          strategy: "system-browser",
          platform: currentPlatform,
          attemptedAt,
          fallbackReason: errorTextForOpen(error),
        };
      } catch (fallbackError) {
        if (hasTauriInternals()) {
          throw new Error(
            `inAppBrowser failed: ${errorTextForOpen(error)}; system browser failed: ${errorTextForOpen(fallbackError)}`,
          );
        }
        window.open(href, "_blank", "noopener,noreferrer");
        return {
          strategy: "window-open",
          platform: currentPlatform,
          attemptedAt,
          fallbackReason: `${errorTextForOpen(error)}; ${errorTextForOpen(fallbackError)}`,
        };
      }
    }
  }

  let mistyBrowserError: unknown;
  if (openInMistyBrowser) {
    try {
      await openInMistyBrowser(href);
      return {
        strategy: "misty-browser",
        platform: currentPlatform,
        attemptedAt,
      };
    } catch (error) {
      mistyBrowserError = error;
    }
  }

  try {
    await openSystemExternalLink(href);
    return {
      strategy: "system-browser",
      platform: currentPlatform,
      attemptedAt,
      fallbackReason: mistyBrowserError ? errorTextForOpen(mistyBrowserError) : undefined,
    };
  } catch (error) {
    if (mistyBrowserError) {
      throw new Error(
        `Misty Browser failed: ${errorTextForOpen(mistyBrowserError)}; system browser failed: ${errorTextForOpen(error)}`,
      );
    }
    throw new Error(`system browser failed: ${errorTextForOpen(error)}`);
  }
}

export function handleExternalLinkClick(
  url: string,
): (event: ReactMouseEvent<HTMLAnchorElement>) => void {
  return (event) => {
    event.preventDefault();
    void openExternalLink(url);
  };
}

export function installExternalLinkRouting(root: Document = document): () => void {
  const handleClick = (event: MouseEvent) => {
    if (event.defaultPrevented || event.button !== 0) return;
    const element =
      event.target instanceof Element
        ? event.target
        : event.target instanceof Node
          ? event.target.parentElement
          : null;
    const anchor = element?.closest<HTMLAnchorElement>("a[href]");
    if (
      !anchor ||
      anchor.hasAttribute("download") ||
      anchor.dataset.openSystemExternal === "true"
    ) {
      return;
    }
    const rawHref = anchor.getAttribute("href")?.trim() ?? "";
    if (!/^(?:https?:|mailto:|\/\/)/i.test(rawHref)) return;
    event.preventDefault();
    void openExternalLink(anchor.href);
  };

  root.addEventListener("click", handleClick);
  return () => root.removeEventListener("click", handleClick);
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
    return hasTauriInternals() ? platform() : "browser";
  } catch {
    return "browser";
  }
}

function errorTextForOpen(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}
