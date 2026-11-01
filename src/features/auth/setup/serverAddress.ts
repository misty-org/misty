/**
 * What people type or paste in the setup wizard: a server address, or the setup link from a
 * welcome email (`https://mistysys.com/setup#server=<host>&key=<key>`, or an older server's own
 * `https://<server>/setup#key=<key>`). The website's setup page opens the app with
 * `misty://setup?server=<host>&key=<key>`. A server's API lives at `/v1` on its address.
 */
export interface ServerAddress {
  /** The address people know, such as `https://api.mistysys.com`. */
  origin: string;
  /** The API base every request goes to. */
  apiBase: string;
}

export interface SetupLink extends ServerAddress {
  setupKey: string;
}

/** `misty_setup_` and 32 base32 characters. */
const setupKeyPattern = /^misty_setup_[a-z2-7]{32}$/i;

export function isSetupKey(value: string): boolean {
  return setupKeyPattern.test(value.trim());
}

const loopbackHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

/** A server address, or an error to show. Without a scheme, https is assumed. */
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
    return { error: "Use an https:// address. Plain http works only on this computer." };
  // The setup link and the API path both name the server itself.
  const path = url.pathname.replace(/\/+$/, "");
  const apiPath = /^(?:\/api)?\/v\d+$/i.test(path) ? path : "/v1";
  return { origin: url.origin, apiBase: `${url.origin}${apiPath}` };
}

/** A server address a link names, which must be https: a link never points at plain http. */
function linkedServer(server: string): ServerAddress | null {
  const text = server.trim();
  // An explicit scheme must be https; `host:port` alone is a server address.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^https:\/\//i.test(text)) return null;
  const address = parseServerAddress(server);
  return "error" in address || !address.origin.startsWith("https://") ? null : address;
}

/** The server and setup key in a pasted setup link, or null when it isn't one. */
export function parseSetupLink(input: string): SetupLink | null {
  const text = input.trim();
  const hash = text.indexOf("#");
  if (hash < 0) return null;
  const fragment = new URLSearchParams(text.slice(hash + 1));
  const key = fragment.get("key")?.trim() ?? "";
  if (!isSetupKey(key)) return null;
  // The website's link names the server in the fragment; an older server's link is its own.
  const named = fragment.get("server");
  if (named !== null) {
    const address = linkedServer(named);
    return address ? { ...address, setupKey: key } : null;
  }
  const address = parseServerAddress(text.slice(0, hash));
  if ("error" in address) return null;
  return { ...address, setupKey: key };
}

/** `misty://setup?server=<host>&key=<key>`, from the website's setup page, or null. */
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

/** The host to show for an API base, such as `api.mistysys.com`. */
export function serverHost(apiBase: string): string {
  try {
    return new URL(apiBase).host;
  } catch {
    return apiBase;
  }
}
