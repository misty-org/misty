import type { ReactNode } from "react";
import { explorerCancelDragPreparation, explorerPrepareDragItems } from "@/features/files/native";
import { getAppliedAppZoom } from "@/shared/hooks/useAppZoom";
import { hasTauriInternals } from "@/shared/platform/tauri";
import { useExplorerStore } from "../store";
import { ExplorerDragProviderView, type ExplorerDragRuntime } from "./ExplorerDragProviderView";
import { physicalToClientPoint } from "./geometry";
export { Droppable, useExplorerDragSource, useExplorerDropZone, useExplorerDropRegistry } from "./ExplorerDragHooks";
const runtime: ExplorerDragRuntime = {
  prepare: explorerPrepareDragItems,
  cancelPreparation: explorerCancelDragPreparation,
  notify: message => useExplorerStore.getState().pushNotification(String(message), "error"),
  refresh: () => {
    const store = useExplorerStore.getState();
    Object.keys(store.panes).forEach(id => void store.refreshPane(id));
  },
  async startDrag(paths, icon, mode, done) {
    const {startDrag} = await import("@crabnebula/tauri-plugin-drag");
    await startDrag({item: paths, icon, mode}, event => done(event.result === "Dropped"));
  },
  async subscribeNative(listener) {
    if (!hasTauriInternals()) return () => {};
    const [webview, windowApi] = await Promise.all([import("@tauri-apps/api/webview"), import("@tauri-apps/api/window")]);
    const appWindow = windowApi.getCurrentWindow();
    let scale = await appWindow.scaleFactor();
    const removeScale = await appWindow.onScaleChanged(({payload}) => { scale = payload.scaleFactor; });
    try {
      const removeDrag = await webview.getCurrentWebview().onDragDropEvent(({payload}) => {
        if (payload.type === "leave") listener({type: "leave", position: {x: 0, y: 0}});
        else listener({...payload, position: physicalToClientPoint(payload.position, scale, getAppliedAppZoom())});
      });
      return () => { removeScale(); removeDrag(); };
    } catch (error) { removeScale(); throw error; }
  },
};
export function ExplorerDragProvider(props: {children: ReactNode}) {
  return <ExplorerDragProviderView {...props} runtime={runtime} />;
}
