import { useDockingLayoutStore, validDockingLayout } from "@/features/app-shell/dockingLayout";
import { useWorkspaceStore } from "./useWorkspaceStore";

/** Keep the shell and Settings on the same window, including after a scope switch. */
export function useWindowDockingLayout() {
  const layout = useWorkspaceStore(
    (state) =>
      state.virtualWindowsByScope[state.activeScopeKey]?.find(
        (window) => window.id === state.activeVirtualWindowId,
      )?.dockingLayout,
  );
  const initialLayout = useDockingLayoutStore((state) => state.initialLayout);
  return validDockingLayout(layout) ? layout : initialLayout;
}
