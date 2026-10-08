import { useMemo } from "react";
import {
  normalizeDockingLayout,
  useDockingLayoutStore,
  validDockingLayout,
} from "@/features/app-shell/dockingLayout";
import { useWorkspaceStore } from "./useWorkspaceStore";

/** Keep the shell and Settings on this window's layout, including after a scope switch. */
export function useWindowDockingLayout() {
  const layout = useWorkspaceStore((state) => state.dockingLayout);
  const initialLayout = useDockingLayoutStore((state) => state.initialLayout);
  const chosen = validDockingLayout(layout) ? layout : initialLayout;
  return useMemo(
    () => normalizeDockingLayout(chosen),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [chosen.navigation, chosen.tabs],
  );
}
