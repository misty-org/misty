import type { MistyBrowserSDK, MistyBrowserBounds, MistyBrowserEvent } from "@misty/sdk";

type Geometry = { bounds: MistyBrowserBounds; visible: boolean; nativeLiveResize: boolean };
type View = Awaited<ReturnType<MistyBrowserSDK["create"]>>;

/** Owns a single SDK view and coalesces layout changes while RPC is busy. */
export function createSdkBrowserController(
  browser: MistyBrowserSDK,
  callbacks: {
    ready(view: View): void;
    event(event: MistyBrowserEvent): void;
    error(error: unknown): void;
  },
) {
  let view: View | undefined;
  let closed = false;
  let latest: Geometry | undefined;
  let lastKey = "";
  let running: Promise<void> | undefined;
  let cleanup: Promise<void> | undefined;
  let unlisten: (() => void) | undefined;
  const synchronize = async () => {
    while (!closed && latest) {
      const geometry = latest;
      latest = undefined;
      const key = JSON.stringify(geometry);
      if (key === lastKey) continue;
      if (!view) {
        if (!geometry.visible) continue;
        view = await browser.create({
          bounds: geometry.bounds,
          nativeLiveResize: geometry.nativeLiveResize,
        });
        if (closed) return;
        callbacks.ready(view);
        unlisten = await browser.subscribe(view.handle, (event) => {
          if (closed) return;
          if (event.type === "layout") lastKey = "";
          callbacks.event(event);
        });
        if (closed) return;
      } else {
        await browser.layout(view.handle, geometry);
      }
      lastKey = key;
    }
  };
  const flush = () => {
    if (running || closed) return;
    running = synchronize()
      .catch((error) => {
        lastKey = "";
        if (!closed) callbacks.error(error);
      })
      .finally(() => {
        running = undefined;
        if (latest && !closed) flush();
      });
  };
  return {
    update(geometry: Geometry, force = false) {
      if (closed) return;
      latest = geometry;
      if (force) lastKey = "";
      flush();
    },
    view: () => view,
    close() {
      if (cleanup) return cleanup;
      closed = true;
      latest = undefined;
      cleanup = (async () => {
        await running;
        unlisten?.();
        if (view) await browser.close(view.handle);
      })();
      return cleanup;
    },
  };
}
