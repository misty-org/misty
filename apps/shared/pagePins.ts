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

export function pagePinLabel(title: string, providerLabel: string) {
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
  return (label.trim() || providerLabel).slice(0, 200);
}
