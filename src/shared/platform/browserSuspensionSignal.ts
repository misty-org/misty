type BrowserSuspensionListener = (suspended: boolean, reason: string) => void;

const listeners = new Set<BrowserSuspensionListener>();
const activeReasons = new Set<string>();

/**
 * Lets Core overlays coordinate with an optional embedded Browser without
 * importing Browser itself into the Core bundle.
 */
export function requestEmbeddedBrowserSuspension(suspended: boolean, reason: string): void {
  if (suspended) activeReasons.add(reason);
  else activeReasons.delete(reason);
  listeners.forEach((listener) => listener(suspended, reason));
}

export function subscribeEmbeddedBrowserSuspension(
  listener: BrowserSuspensionListener,
): () => void {
  listeners.add(listener);
  activeReasons.forEach((reason) => listener(true, reason));
  return () => listeners.delete(listener);
}
