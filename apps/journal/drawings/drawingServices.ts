import type { MistyAppSDK, SpaceDrawing as SdkDrawing } from "@misty/sdk";
import type { SpaceDrawing } from "./types";
import type { DrawingsListServices } from "./hooks/useSpaceDrawingsView";

/** Bound to one mounted Journal view. Events and late responses die with that view. */
export function createSdkDrawingServices(
  misty: MistyAppSDK,
  spaceId: string,
  signal: AbortSignal,
  closeDocument: DrawingsListServices["closeDocument"],
  report: (error: unknown) => void,
) {
  let closed = signal.aborted;
  const subscriptions = new Set<() => void>();
  const assert = (requestedSpace: string) => {
    if (closed || signal.aborted) throw new Error("This Journal view is closed.");
    if (!spaceId || spaceId !== requestedSpace)
      throw new Error("This drawing belongs to another Space.");
  };
  const close = () => {
    closed = true;
    for (const unsubscribe of subscriptions) unsubscribe();
    subscriptions.clear();
    signal.removeEventListener("abort", close);
  };
  signal.addEventListener("abort", close, { once: true });
  const services: DrawingsListServices = {
    async list(space) {
      assert(space);
      const drawings = await misty.drawings.list();
      assert(space);
      return { drawings: drawings.map(drawingView) };
    },
    async create(space, title) {
      assert(space);
      const drawing = await misty.drawings.create({ title });
      assert(space);
      return drawingView(drawing);
    },
    async rename(space, drawingID, title) {
      assert(space);
      const drawing = await misty.drawings.update(drawingID, { title });
      assert(space);
      return drawingView(drawing);
    },
    async remove(space, drawingID) {
      assert(space);
      await misty.server.call("drawings.delete", { path: { drawingID } });
      assert(space);
    },
    changed() {
      /* Successful SDK mutations already publish the host data event. */
    },
    closeDocument,
    subscribe(space, listener) {
      assert(space);
      let disposed = false,
        remove: (() => void) | undefined;
      const unsubscribe = () => {
        disposed = true;
        remove?.();
        subscriptions.delete(unsubscribe);
      };
      subscriptions.add(unsubscribe);
      void misty.data
        .subscribe("drawings", () => {
          if (!closed && !disposed && !signal.aborted) listener();
        })
        .then((cleanup) => {
          if (disposed || closed) cleanup();
          else remove = cleanup;
        })
        .catch((error) => {
          if (!closed && !disposed) report(error);
        });
      return unsubscribe;
    },
  };
  return { services, close };
}

function drawingView(drawing: SdkDrawing): SpaceDrawing {
  const lifecycle = drawing.lifecycle_state;
  if (lifecycle !== "active" && lifecycle !== "deleting")
    throw new Error("This drawing's lifecycle is not supported by this Journal version.");
  return { ...drawing, lifecycle_state: lifecycle };
}
