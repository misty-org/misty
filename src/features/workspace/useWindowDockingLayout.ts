import { useMemo } from "react";
import {
  normalizeDockingLayout,
  useDockingLayoutStore,
  validDockingLayout,
} from "@/features/app-shell/dockingLayout";
import { useWorkspaceStore } from "./useWorkspaceStore";

/** Keep the shell and Settings on the same window, including after a scope switch. */
export function useWindowDockingLayout() {
  const layout = useWorkspaceStore(
    (state) =>
      state.windowsByScope[state.activeScopeKey]?.find(
        (window) => window.id === state.activeWindowId,
      )?.dockingLayout,
  );
  const initialLayout = useDockingLayoutStore((state) => state.initialLayout);
  const chosen = validDockingLayout(layout) ? layout : initialLayout;
  return useMemo(
    () => normalizeDockingLayout(chosen),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chosen.navigation, chosen.tabs],
  );
}
