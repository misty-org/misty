import type { ProviderAuthorizationOpenResult } from "@/shared/platform/model/interfaces/openExternalLink";
import { openUrl } from "@tauri-apps/plugin-opener";
import { platform } from "@tauri-apps/plugin-os";
import type { MouseEvent } from "react";
import { hasTauriInternals } from "./tauri";
export type { ProviderAuthorizationOpenResult } from "@/shared/platform/model/interfaces/openExternalLink";

let shouldOpenLinksExternally = () => false;
let openProviderAuthorizationInMisty: ((url: string) => void | Promise<void>) | null = null;

export function configureExternalLinkPreference(getPreference: () => boolean): void {
  shouldOpenLinksExternally = getPreference;
}

export function configureProviderAuthorizationLinkOpener(
  opener: ((url: string) => void | Promise<void>) | null,
): void {
  openProviderAuthorizationInMisty = opener;
}

export async function openExternalLink(url: string): Promise<void> {
  const href = normalizeExternalUrl(url);
  if (!href) return;

  if (shouldOpenLinksExternally() && isExternalUrl(href)) {
    try {
      await openNativeUrl(href);
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
  if (openProviderAuthorizationInMisty) {
    try {
      await openProviderAuthorizationInMisty(href);
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
): (event: MouseEvent<HTMLAnchorElement>) => void {
  return (event) => {
    event.preventDefault();
    void openExternalLink(url);
  };
}

function isExternalUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://") || url.startsWith("mailto:");
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
