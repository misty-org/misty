const storageKey = "misty:developer-workspace-url";
const defaultIdeUrl = "http://127.0.0.1:3000";

export function suggestedDeveloperWorkspaceUrl(): string {
  return import.meta.env.VITE_MISTY_DEVELOPER_WORKSPACE_URL?.trim() || defaultIdeUrl;
}

export function readDeveloperWorkspaceUrl(): string {
  try {
    return window.localStorage.getItem(storageKey)?.trim() ?? "";
  } catch {
    return "";
  }
}

export function writeDeveloperWorkspaceUrl(url: string): void {
  try {
    if (url) window.localStorage.setItem(storageKey, url);
    else window.localStorage.removeItem(storageKey);
  } catch {}
}

/**
 * Embedded IDEs can execute code and open terminals, so Misty only frames a
 * server bound to this computer. Remote IDEs still belong in the browser.
 */
export function normalizeLocalDeveloperWorkspaceUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) throw new Error("Enter the address of the IDE running on this computer.");
  if (trimmed.length > 2048) throw new Error("The IDE address is too long.");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a complete address, such as http://127.0.0.1:3000.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("The IDE address must start with http:// or https://.");
  }
  if (url.username || url.password) {
    throw new Error("Put connection tokens in the address query, not in a username or password.");
  }
  if (!isLoopbackHost(url.hostname)) {
    throw new Error("For safety, Misty only embeds an IDE running on this computer.");
  }

  return url.toString();
}

function isLoopbackHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1";
}
