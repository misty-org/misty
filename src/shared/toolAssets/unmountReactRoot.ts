import type { Root } from "react-dom/client";

/** Leave the host's React commit, then finish cleanup before reusing its DOM. */
export function unmountReactRoot(root: Root | undefined): Promise<void> {
  return Promise.resolve().then(() => root?.unmount());
}
