import { openUrl } from "@tauri-apps/plugin-opener";
import { platform } from "@tauri-apps/plugin-os";
import { selectGeneralPreferences, useSettingsStore } from "../features/settings/useSettingsStore";
import type { MouseEvent } from "react";

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

export async function openProviderAuthorizationLink(url: string): Promise<void> {
  const href = url.trim();
  if (!href) return;

  if (isNativeMobilePlatform()) {
    try {
      await openUrl(href, "inAppBrowser");
      return;
    } catch {
      await openSystemExternalLink(href);
      return;
    }
  }

  await openSystemExternalLink(href);
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

function isNativeMobilePlatform(): boolean {
  try {
    const currentPlatform = platform();
    return currentPlatform === "ios" || currentPlatform === "android";
  } catch {
    return false;
  }
}

function hasTauriInternals(): boolean {
  const internals = (window as typeof window & {
    __TAURI_INTERNALS__?: { invoke?: unknown };
  }).__TAURI_INTERNALS__;
  return typeof internals?.invoke === "function";
}
