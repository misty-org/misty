/**
 * The self-hosted servers this device has connected to.
 *
 * Native configuration only ever holds the *current* server, so switching back
 * to Hosted would otherwise erase any way to return. This list is a local
 * convenience index, not an authority: routing always comes from the native
 * environment snapshot.
 */
export interface KnownDeployment {
  url: string;
  serverId: string | null;
  name: string;
}

const knownDeploymentsKey = "misty:known-deployments:v1";
const maxKnownDeployments = 8;

export function readKnownDeployments(
  storage: Pick<Storage, "getItem"> = window.localStorage,
): KnownDeployment[] {
  try {
    const raw = storage.getItem(knownDeploymentsKey);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isKnownDeployment).slice(0, maxKnownDeployments);
  } catch {
    return [];
  }
}

/** Records a server, moving an already-known one back to the front. */
export function rememberDeployment(
  entry: KnownDeployment,
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage,
): KnownDeployment[] {
  if (!entry.url) return readKnownDeployments(storage);
  const next = [
    entry,
    ...readKnownDeployments(storage).filter((known) => known.url !== entry.url),
  ].slice(0, maxKnownDeployments);
  try {
    storage.setItem(knownDeploymentsKey, JSON.stringify(next));
  } catch {
    // The list is only a convenience, so a full or blocked store is not fatal.
  }
  return next;
}

export function forgetDeployment(
  url: string,
  storage: Pick<Storage, "getItem" | "setItem"> = window.localStorage,
): KnownDeployment[] {
  const next = readKnownDeployments(storage).filter((known) => known.url !== url);
  try {
    storage.setItem(knownDeploymentsKey, JSON.stringify(next));
  } catch {
    // See rememberDeployment.
  }
  return next;
}

/** A short label for a server URL, used when the server reports no name. */
export function deploymentHostLabel(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function isKnownDeployment(value: unknown): value is KnownDeployment {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<KnownDeployment>;
  return typeof candidate.url === "string" && candidate.url.length > 0;
}
