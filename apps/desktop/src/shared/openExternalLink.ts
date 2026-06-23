import { openExternalUrl } from "../api/misty";
import { selectGeneralPreferences, useSettingsStore } from "../features/settings/useSettingsStore";
import type { MouseEvent } from "react";

export async function openExternalLink(url: string): Promise<void> {
  const href = url.trim();
  if (!href) return;

  const { openLinksExternally } = selectGeneralPreferences(useSettingsStore.getState().settings?.document);
  if (openLinksExternally && isExternalUrl(href)) {
    try {
      await openExternalUrl(href);
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
    await openExternalUrl(href);
    return;
  } catch {
    // Browser smoke mode or a native opener failure falls through to web-style opening.
  }

  window.open(href, "_blank", "noopener,noreferrer");
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
