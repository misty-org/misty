import { isAllowedServerUrl } from "@/api/client/base_url";

interface ServerAddress {
  origin: string;
  apiBase: string;
}

export interface SetupLink extends ServerAddress {
  setupKey: string;
}

const setupKeyPattern = /^misty_setup_[a-z2-7]{32}$/i;

export function isSetupKey(value: string): boolean {
  return setupKeyPattern.test(value.trim());
}

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

export function parseServerAddress(input: string): ServerAddress | { error: string } {
  const text = input.trim();
  if (!text) return { error: "Enter your server's address." };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(text) ? text : `https://${text}`);
  } catch {
    return { error: "That doesn't look like a web address." };
  }
  if (url.protocol !== "https:" && url.protocol !== "http:")
    return { error: "Use an https:// address." };
  if (!url.hostname || url.username || url.password)
    return { error: "That doesn't look like a web address." };
  if (
    url.protocol === "http:" &&
    !loopbackHosts.has(url.hostname) &&
    !url.hostname.endsWith(".localhost")
  )
    return { error: "Use an https:// address." };
  if (!isAllowedServerUrl(url.href))
    return { error: "Use your server's https:// domain, such as misty.example.com." };
  const path = url.pathname.replace(/\/+$/, "");
  const apiPath = /^(?:\/api)?\/v\d+$/i.test(path) ? path : "/v1";
  return { origin: url.origin, apiBase: `${url.origin}${apiPath}` };
}

function linkedServer(server: string): ServerAddress | null {
  const text = server.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^https:\/\//i.test(text)) return null;
  const address = parseServerAddress(server);
  return "error" in address || !address.origin.startsWith("https://") ? null : address;
}

export function parseSetupLink(input: string): SetupLink | null {
  const text = input.trim();
  const hash = text.indexOf("#");
  if (hash < 0) return null;
  const fragment = new URLSearchParams(text.slice(hash + 1));
  const key = fragment.get("key")?.trim() ?? "";
  if (!isSetupKey(key)) return null;
  const named = fragment.get("server");
  if (named !== null) {
    const address = linkedServer(named);
    return address ? { ...address, setupKey: key } : null;
  }
  const address = parseServerAddress(text.slice(0, hash));
  if ("error" in address) return null;
  return { ...address, setupKey: key };
}

export function parseSetupDeepLink(input: string): SetupLink | null {
  let url: URL;
  try {
    url = new URL(input.trim());
  } catch {
    return null;
  }
  const route = [url.hostname, ...url.pathname.split("/")].filter(Boolean).join("/");
  if (url.protocol !== "misty:" || route.toLowerCase() !== "setup") return null;
  const key = url.searchParams.get("key")?.trim() ?? "";
  const address = linkedServer(url.searchParams.get("server") ?? "");
  return address && isSetupKey(key) ? { ...address, setupKey: key } : null;
}

export function serverHost(apiBase: string): string {
  try {
    return new URL(apiBase).host;
  } catch {
    return apiBase;
  }
}
