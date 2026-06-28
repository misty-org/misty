import { openUrl } from "@tauri-apps/plugin-opener";
import { platform } from "@tauri-apps/plugin-os";
import { selectGeneralPreferences, useSettingsStore } from "../features/settings/useSettingsStore";
import type { MouseEvent } from "react";
import { hasTauriInternals } from "./tauri";

export interface ProviderAuthorizationOpenResult {
  strategy: "in-app-browser" | "system-browser" | "window-open";
  platform: string;
  attemptedAt: number;
  fallbackReason?: string;
}

export async function openExternalLink(url: string): Promise<void> {
  const href = url.trim();
  if (!href) return;

  const { openLinksExternally } = selectGeneralPreferences(useSettingsStore.getState().settings?.document);
  if (openLinksExternally && isExternalUrl(href)) {
    try {
      await openNativeUrl(href);
      return;
    } catch {
      // Browser smoke mode or a native opener failure falls through to web-style opening.
    }
  }

  window.open(href, "_blank", "noopener,noreferrer");
}

export async function openSystemExternalLink(url: string): Promise<void> {
  const href = url.trim();
  if (!href) return;

  try {
    await openNativeUrl(href);
    return;
  } catch (error) {
    if (hasTauriInternals()) {
      throw error;
    }
    // Browser smoke mode runs without Tauri internals, so keep the web fallback there.
  }

  window.open(href, "_blank", "noopener,noreferrer");
}

export async function openProviderAuthorizationLink(url: string): Promise<ProviderAuthorizationOpenResult> {
  const href = url.trim();
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

  try {
    await openSystemExternalLink(href);
    return {
      strategy: "system-browser",
      platform: currentPlatform,
      attemptedAt,
    };
  } catch (error) {
    throw new Error(`system browser failed: ${errorTextForOpen(error)}`);
  }
}

export function handleExternalLinkClick(url: string): (event: MouseEvent<HTMLAnchorElement>) => void {
  return (event) => {
    event.preventDefault();
    void openExternalLink(url);
  };
}

function isExternalUrl(url: string): boolean {
  return url.startsWith("https://") || url.startsWith("http://") || url.startsWith("mailto:");
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
