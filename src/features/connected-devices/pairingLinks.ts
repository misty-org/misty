// Pairing links carry a one-time secret. They are handed to the pairing dialog
// directly and never become routes, because routes are saved with the workspace.
const pairingLinkEvent = "misty:device-pairing-link";
let pendingLink: string | null = null;

export function isDevicePairingLink(raw: string): boolean {
  try {
    const url = new URL(raw);
    return (
      url.protocol === "misty:" &&
      url.hostname.toLowerCase() === "devices" &&
      url.pathname.replace(/\/+$/, "").toLowerCase() === "/pair" &&
      Boolean(url.searchParams.get("session") && url.searchParams.get("secret"))
    );
  } catch {
    return false;
  }
}

/** Held until a signed-in window takes it, so a link that launches Misty is not lost. */
export function deliverDevicePairingLink(link: string): void {
  pendingLink = link;
  window.dispatchEvent(new Event(pairingLinkEvent));
}

export function takeDevicePairingLink(): string | null {
  const link = pendingLink;
  pendingLink = null;
  return link;
}

export function subscribeDevicePairingLinks(listener: () => void): () => void {
  window.addEventListener(pairingLinkEvent, listener);
  return () => window.removeEventListener(pairingLinkEvent, listener);
}
