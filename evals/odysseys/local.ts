// The runner only ever drives a stack on this computer.

const localHosts = ["127.0.0.1", "localhost", "::1", "[::1]"];

export function isLocalUrl(url: string): boolean {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return false;
  return localHosts.includes(parsed.hostname) || parsed.hostname.endsWith(".localhost");
}

/** Throws unless `url` is on this computer. `what` names it in the message. */
export function assertLocalUrl(what: string, url: string): void {
  if (!isLocalUrl(url))
    throw new Error(`The eval runs only against a local stack, and ${what} is ${url}.`);
}
