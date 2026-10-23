import { useNavigationNames } from "@/features/navigation-names/store";
import { registerShortcutHandler, useShortcutHandler } from "@/features/shortcuts";
import {
  canCloseWorkspaceView,
  dockLeaves,
  findDockLeaf,
  useWorkspaceStore,
  type WorkspaceView,
} from "@/features/workspace";
import { layoutTabs } from "@/features/workspace/layoutTabs";
import { closePeek, usePeekStore } from "@/features/workspace/peek";
import { mapAllWorkspaceWindowLayouts } from "@/features/workspace/windows";
import { useCallback, useEffect } from "react";
import { useLocation, useNavigate } from "react-router-dom";

/** Gives tabs saved before titles were stored the names they had in the old navigation. */
export function useLegacyTabTitles() {
  const legacyNames = useNavigationNames((state) => state.names);
  const legacyNamesReady = useNavigationNames((state) => state.ready);
  useEffect(() => {
    if (!legacyNamesReady) return;
    useWorkspaceStore.setState(
      mapAllWorkspaceWindowLayouts(useWorkspaceStore.getState(), (layout) => ({
        ...layout,
        tabs: layoutTabs(layout).map((tab) => {
          if (!tab.legacyNameKeys) return tab;
          const { legacyNameKeys, ...rest } = tab;
          return {
            ...rest,
            title: rest.title ?? legacyNameKeys.map((key) => legacyNames[key]).find(Boolean),
          };
        }),
      })),
    );
  }, [legacyNames, legacyNamesReady]);
}

/** Close, reopen, cycle and pick tabs from the keyboard, and focus a tab another surface asks for. */
export function useWorkspaceTabShortcuts(navigateToActiveLayoutTab: () => void) {
  const location = useLocation();
  const navigate = useNavigate();
  const closeActiveTab = useCallback(() => {
    const peek = usePeekStore.getState().peek;
    if (peek && peek.tabId === useWorkspaceStore.getState().layout.activeTabId) {
      if (closePeek()) navigateToActiveLayoutTab();
      return;
    }
    const state = useWorkspaceStore.getState();
    const id = state.layout.activeTabId;
    const pane = findDockLeaf(state.layout.root, state.layout.focusedPaneId);
    if (dockLeaves(state.layout.root).length === 1 && id && state.resetPinnedTab(id)) return;
    const closed =
      dockLeaves(state.layout.root).length > 1
        ? pane?.views[0] && state.closeView(pane.views[0].id)
        : id && state.closeTab(id);
    if (closed) navigateToActiveLayoutTab();
  }, [navigateToActiveLayoutTab]);

  const canCloseActiveTab = useCallback(() => {
    const state = useWorkspaceStore.getState();
    return canCloseWorkspaceView(
      findDockLeaf(state.layout.root, state.layout.focusedPaneId)?.views[0],
    );
  }, []);

  const openSelectedTab = useCallback(
    (tab: WorkspaceView | null) => {
      if (tab && `${location.pathname}${location.search}` !== tab.route)
        navigate(tab.route, { replace: true });
    },
    [location.pathname, location.search, navigate],
  );

  useShortcutHandler("workspace.close_tab", closeActiveTab, canCloseActiveTab);
  useShortcutHandler(
    "workspace.reopen_tab",
    useCallback(
      () => openSelectedTab(useWorkspaceStore.getState().reopenClosedView()),
      [openSelectedTab],
    ),
  );
  useShortcutHandler(
    "workspace.next_tab",
    useCallback(
      () => openSelectedTab(useWorkspaceStore.getState().cycleView(1)),
      [openSelectedTab],
    ),
  );
  useShortcutHandler(
    "workspace.previous_tab",
    useCallback(
      () => openSelectedTab(useWorkspaceStore.getState().cycleView(-1)),
      [openSelectedTab],
    ),
  );
  useShortcutHandler(
    "workspace.new_tab",
    useCallback(() => {
      const view = useWorkspaceStore.getState().newTab();
      openSelectedTab(view);
    }, [openSelectedTab]),
  );
  useEffect(() => {
    const unregister = Array.from({ length: 9 }, (_, index) =>
      registerShortcutHandler(`workspace.tab_${index + 1}`, () => {
        const state = useWorkspaceStore.getState();
        const tab = state.selectView(index === 8 ? "last" : index);
        openSelectedTab(tab);
      }),
    );
    return () => unregister.forEach((remove) => remove());
  }, [openSelectedTab]);

  useEffect(() => {
    const focusRequestedTab = (event: Event) => {
      const tabId = (event as CustomEvent<{ tabId?: string }>).detail?.tabId;
      if (!tabId) return;
      const workspace = useWorkspaceStore.getState();
      if (!workspace.focusView(tabId)) return;
      const tab = dockLeaves(useWorkspaceStore.getState().layout.root)
        .flatMap((pane) => pane.views)
        .find((candidate) => candidate.id === tabId);
      openSelectedTab(tab ?? null);
    };
    window.addEventListener("misty:focus-workspace-tab", focusRequestedTab);
    return () => window.removeEventListener("misty:focus-workspace-tab", focusRequestedTab);
  }, [openSelectedTab]);
}
