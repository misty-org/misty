import { useMultiPanelStore } from "@/features/workspace";
import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import type { ResizeTarget } from "../../model/types/workspace";
import {
  explorerWorkspaceNeedsSave,
  scheduleExplorerWorkspaceSave,
  useExplorerStore,
} from "../../store";
import {
  maxPreviewWidth,
  maxSidebarWidth,
  minPreviewWidth,
  minSidebarWidth,
} from "../ExplorerWorkspaceConstants";
import { clamp, multiPanelWorkspaceNeedsSave } from "../ExplorerWorkspaceUtils";

/**
 * Drag-to-resize for the sidebar and preview panes.
 *
 * Pointer moves are coalesced into one animation frame so a fast drag does not
 * queue a store write per event. Layout saves are held back until the drag
 * ends — otherwise every frame would persist a new width.
 */
export function usePanelResize(options: {
  workspaceRef: RefObject<HTMLElement | null>;
  mainRef: RefObject<HTMLElement | null>;
}) {
  const { workspaceRef, mainRef } = options;
  const [resizeTarget, setResizeTarget] = useState<ResizeTarget>(null);
  const resizeTargetRef = useRef<ResizeTarget>(null);
  const pendingResizeSaveRef = useRef(false);
  const pendingResizeXRef = useRef(0);
  const resizeFrameRef = useRef<number | null>(null);

  useEffect(() => {
    const unsubscribeExplorer = useExplorerStore.subscribe((state, previous) => {
      if (!explorerWorkspaceNeedsSave(state, previous)) return;
      if (resizeTargetRef.current) pendingResizeSaveRef.current = true;
      else scheduleExplorerWorkspaceSave();
    });
    const unsubscribeMulti = useMultiPanelStore.subscribe((state, previous) => {
      if (multiPanelWorkspaceNeedsSave(state, previous)) scheduleExplorerWorkspaceSave();
    });
    return () => {
      unsubscribeExplorer();
      unsubscribeMulti();
    };
  }, []);

  useEffect(() => {
    resizeTargetRef.current = resizeTarget;
    if (!resizeTarget && pendingResizeSaveRef.current) {
      pendingResizeSaveRef.current = false;
      scheduleExplorerWorkspaceSave();
    }
  }, [resizeTarget]);

  useEffect(() => {
    if (!resizeTarget) return;

    const previousCursor = document.body.style.cursor;
    const previousUserSelect = document.body.style.userSelect;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const applyResize = () => {
      resizeFrameRef.current = null;
      const clientX = pendingResizeXRef.current;
      if (resizeTarget === "sidebar") {
        const rect = workspaceRef.current?.getBoundingClientRect();
        if (rect)
          useExplorerStore
            .getState()
            .setSidebarWidth(clamp(clientX - rect.left, minSidebarWidth, maxSidebarWidth));
      } else if (resizeTarget === "preview") {
        const rect = mainRef.current?.getBoundingClientRect();
        if (rect)
          useExplorerStore
            .getState()
            .setPreviewWidth(clamp(rect.right - clientX, minPreviewWidth, maxPreviewWidth));
      }
    };

    const onPointerMove = (event: globalThis.PointerEvent) => {
      pendingResizeXRef.current = event.clientX;
      if (resizeFrameRef.current === null)
        resizeFrameRef.current = window.requestAnimationFrame(applyResize);
    };
    const onPointerUp = () => setResizeTarget(null);

    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp, { once: true });
    return () => {
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      if (resizeFrameRef.current !== null) {
        window.cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      document.body.style.cursor = previousCursor;
      document.body.style.userSelect = previousUserSelect;
    };
  }, [mainRef, resizeTarget, workspaceRef]);

  return {
    resizeTarget,
    startSidebarResize: useCallback((event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      setResizeTarget("sidebar");
    }, []),
    startPreviewResize: useCallback((event: PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      setResizeTarget("preview");
    }, []),
  };
}
