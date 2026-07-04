import { mistyBrowserProviders } from "@misty/sdk";
import { savedWebsiteUrl } from "./websiteIntegrations";

type Provider = keyof typeof mistyBrowserProviders;
type Destination = { provider: Provider; accountId: string; url: string };

// Hashes and query strings can identify different documents (including Gmail
// folders). Preserve them, and preserve the native session owning an old pin.
export function pagePinKey(pin: Destination) {
  return JSON.stringify([
    pin.provider,
    pin.accountId,
    savedWebsiteUrl(pin.provider, pin.url) ?? pin.url,
  ]);
}

export function uniquePagePins<T extends Destination>(pins: T[]): T[] {
  const seen = new Set<string>();
  return pins.filter((pin) => {
    const key = pagePinKey(pin);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export async function pagePinId(pin: Destination) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(pagePinKey(pin)),
  );
  return (
    "page-" +
    Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("")
  );
}

export function extractAccountEmail(title: string): string | undefined {
  const match = title.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  return match?.[1]?.trim();
}

const genericPinLabels = new Set([
  "inbox",
  "messages",
  "mail",
  "direct messages",
  "home",
  "drive",
  "my drive",
  "notes",
  "all notes",
  "calendar",
  "agenda",
  "tasks",
  "all items",
  "recent",
  "favorites",
  "collections",
  "albums",
  "roadmaps",
  "drawings",
  "chat",
  "social",
  "planner",
  "journal",
  "library",
]);

export function isGenericPinLabel(
  label: string,
  providerLabel?: string,
  appId?: string,
): boolean {
  const clean = label
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .replace(/^\(\d+\)\s*/, "")
    .toLowerCase();
  if (!clean) return true;
  if (genericPinLabels.has(clean)) return true;
  if (providerLabel && clean === providerLabel.toLowerCase()) return true;
  if (appId && clean === appId.toLowerCase()) return true;
  return false;
}

export function pagePinLabel(
  title: string,
  providerLabel: string,
  accountLabel?: string,
) {
  let label = title
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .replace(/^\(\d+\)\s*/, "");
  for (const separator of [" · ", " • ", " | ", " - ", " – ", " — "]) {
    if (label.startsWith(providerLabel + separator))
      label = label.slice(providerLabel.length + separator.length);
    if (label.endsWith(separator + providerLabel))
      label = label.slice(0, -(providerLabel.length + separator.length));
  }
  const clean = label.trim();
  const emailInTitle = extractAccountEmail(title);
  const profile =
    accountLabel &&
    accountLabel.trim().toLowerCase() !== providerLabel.toLowerCase()
      ? accountLabel.trim()
      : emailInTitle;
  if (profile && isGenericPinLabel(clean, providerLabel)) {
    return profile.slice(0, 200);
  }
  return (clean || profile || providerLabel).slice(0, 200);
}

export function resolvePinLabel(
  label: string,
  providerLabel: string,
  accountLabel?: string,
  appId?: string,
): string {
  if (
    accountLabel &&
    accountLabel.trim().toLowerCase() !== providerLabel.toLowerCase() &&
    isGenericPinLabel(label, providerLabel, appId)
  ) {
    return accountLabel.trim().slice(0, 200);
  }
  return label || accountLabel || providerLabel;
}
