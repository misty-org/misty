import type { MistyAppSDK } from "@misty/sdk";

type Storage = MistyAppSDK["storage"]["local"];
export type BrowserPin = {
  id: string;
  url: string;
  label: string;
  order: number;
};
const prefix = "browser-page-pin-v1:";
export const browserPinsChanged = "misty:browser-pins-changed";
export function browserPinUrl(value: string) {
  try {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      return;
    return url.href;
  } catch {
    return;
  }
}
export async function loadBrowserPins(storage: Storage): Promise<BrowserPin[]> {
  const values = await Promise.all(
    (await storage.keys())
      .filter((key) => key.startsWith(prefix))
      .map((key) => storage.get<BrowserPin>(key)),
  );
  const seen = new Set<string>();
  return values
    .filter(
      (pin): pin is BrowserPin =>
        !!pin &&
        typeof pin.id === "string" &&
        typeof pin.label === "string" &&
        typeof pin.url === "string" &&
        !!browserPinUrl(pin.url) &&
        Number.isFinite(pin.order),
    )
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .filter((pin) => {
      const url = browserPinUrl(pin.url)!;
      if (seen.has(url)) return false;
      seen.add(url);
      return true;
    });
}
export async function toggleBrowserPin(
  storage: Storage,
  address: string,
  title: string,
) {
  const url = browserPinUrl(address);
  if (!url) return;
  const existing = (await loadBrowserPins(storage)).find(
    (pin) => browserPinUrl(pin.url) === url,
  );
  if (existing) await storage.delete(prefix + existing.id);
  else {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(url),
    );
    const id = Array.from(new Uint8Array(digest), (byte) =>
      byte.toString(16).padStart(2, "0"),
    ).join("");
    const label =
      title
        .replace(/[\u0000-\u001f\u007f]/g, "")
        .trim()
        .replace(/^\(\d+\)\s*/, "") || new URL(url).hostname;
    await storage.set(prefix + id, {
      id,
      url,
      label: label.slice(0, 80),
      order: Date.now(),
    });
  }
  window.dispatchEvent(new Event(browserPinsChanged));
}
export function browserPinNavigation(pins: BrowserPin[]) {
  return pins.map((pin) => ({
    id: `pin-${pin.id}`,
    label: pin.label,
    route: `/apps/browser?pin=${encodeURIComponent(pin.id)}`,
  }));
}
