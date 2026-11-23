import { useMemo } from "react";
import {
  normalizeDockingLayout,
  useDockingLayoutStore,
  validDockingLayout,
} from "@/app/shell/docking_layout";
import { useWorkspaceStore } from "../tabs/use_workspace_store";

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
