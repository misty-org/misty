import type {
  MistyBrowserSDK,
  MistyBrowserBounds,
  MistyBrowserEvent,
} from "@misty/sdk";

const closingControllers = new WeakMap<MistyBrowserSDK, Promise<void>>();

type Geometry = {
  bounds: MistyBrowserBounds;
  visible: boolean;
  nativeLiveResize: boolean;
};
type View = Awaited<ReturnType<MistyBrowserSDK["create"]>>;

/** Owns a single SDK view and coalesces layout changes while RPC is busy. */
export function createSdkBrowserController(
  browser: MistyBrowserSDK,
  callbacks: {
    ready(view: View): void;
    event(event: MistyBrowserEvent): void;
    error(error: unknown): void;
  },
  options: Pick<
    Parameters<MistyBrowserSDK["create"]>[0],
    "url" | "provider"
  > = {},
) {
  let view: View | undefined;
  let closed = false;
  let latest: Geometry | undefined;
  let lastKey = "";
  let correction = 0;
  let running: Promise<void> | undefined;
  let cleanup: Promise<void> | undefined;
  let unlisten: (() => void) | undefined;
  const synchronize = async () => {
    while (!closed && latest) {
      const geometry = latest;
      latest = undefined;
      const revision = correction;
      const key = JSON.stringify(geometry);
      if (key === lastKey) continue;
      let created = false;
      if (!view) {
        if (!geometry.visible) continue;
        const previousClose = closingControllers.get(browser);
        if (previousClose) await previousClose;
        if (closed) return;
        view = await browser.create({
          ...options,
          bounds: geometry.bounds,
          nativeLiveResize: geometry.nativeLiveResize,
        });
        if (closed) return;
        created = true;
      }
      // A failed subscription must be retried even when native creation worked.
      // Publish the handle only once page events can keep the UI responsive.
      if (!unlisten) {
        unlisten = await browser.subscribe(view.handle, (event) => {
          if (closed) return;
          if (event.type === "layout") {
            correction++;
            lastKey = "";
          }
          callbacks.event(event);
        });
        if (closed) return;
        callbacks.ready(view);
      }
      if (!created) {
        await browser.layout(view.handle, geometry);
      }
      lastKey = correction === revision ? key : "";
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
      if (force) {
        correction++;
        lastKey = "";
      }
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
      closingControllers.set(
        browser,
        cleanup.catch(() => undefined),
      );
      return cleanup;
    },
  };
}
